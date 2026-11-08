import { useEffect, useRef } from 'react';
import { api } from '../../lib/api';
import { wsHub } from '../../lib/ws';
import { Product } from '../../types';

export interface CartLine {
  product: Product;
  qty: number;
  unitPriceMinor: number;
  discountMinor: number;
  note: string;
}

interface BasketLine {
  product_id: string;
  qty: number;
  unit_price_minor: number;
  discount_minor: number;
  note: string;
}

interface BasketState {
  device_id: string;
  lines: BasketLine[];
}

const SEND_DELAY_MS = 150;

const toLines = (cart: CartLine[]): BasketLine[] =>
  cart.map((l) => ({
    product_id: l.product.id,
    qty: l.qty,
    unit_price_minor: l.unitPriceMinor,
    discount_minor: l.discountMinor,
    note: l.note,
  }));

// Products that are not in this screen's catalogue are skipped.
const fromLines = (lines: BasketLine[], products: Product[]): CartLine[] => {
  const byId = new Map(products.map((p) => [p.id, p]));
  return lines.flatMap((l) => {
    const product = byId.get(l.product_id);
    if (!product) return [];
    return [{ product, qty: l.qty, unitPriceMinor: l.unit_price_minor, discountMinor: l.discount_minor, note: l.note }];
  });
};

/**
 * Keeps the checkout basket the same on every screen where this cashier is signed in,
 * e.g. scanning with a phone fills the basket on the counter computer. Each local change
 * is sent to the server, which pushes it live to the other screens ("basket.sync").
 * A screen that opens later loads the current basket first.
 */
export function useSharedBasket(
  cart: CartLine[],
  setCart: (cart: CartLine[]) => void,
  products: Product[]
) {
  const deviceIdRef = useRef<string>(crypto.randomUUID());
  const readyRef = useRef(false);
  // Set when the basket was replaced from another screen, so that change is not sent back.
  const skipNextSendRef = useRef(false);
  const productsRef = useRef(products);
  const setCartRef = useRef(setCart);
  const cartRef = useRef(cart);

  useEffect(() => {
    productsRef.current = products;
    setCartRef.current = setCart;
    cartRef.current = cart;
  });

  const productsLoaded = products.length > 0;

  // Load the current basket once the catalogue is available, and again after reconnecting.
  useEffect(() => {
    if (!productsLoaded) return;
    let cancelled = false;

    const applyRemote = (state: BasketState) => {
      skipNextSendRef.current = true;
      setCartRef.current(fromLines(state.lines || [], productsRef.current));
    };

    const load = async () => {
      try {
        const state = await api.get<BasketState>('/pos/basket');
        if (cancelled) return;
        if (state.lines?.length) {
          applyRemote(state);
        } else if (cartRef.current.length && !readyRef.current) {
          // Items added on this screen before the shared basket loaded are kept and shared.
          readyRef.current = true;
          void api.post('/pos/basket', { device_id: deviceIdRef.current, lines: toLines(cartRef.current) });
        }
      } catch {
        // Offline or not allowed: this screen keeps its own basket.
      } finally {
        if (!cancelled) readyRef.current = true;
      }
    };
    void load();

    const offSync = wsHub.subscribe('basket.sync', (state: BasketState) => {
      if (!state || state.device_id === deviceIdRef.current) return;
      applyRemote(state);
    });
    const offConnection = wsHub.subscribe('connection', (connected: boolean) => {
      if (connected) void load();
    });
    return () => {
      cancelled = true;
      offSync();
      offConnection();
    };
  }, [productsLoaded]);

  // Send each local change (add, remove, quantity, clear, sale finished).
  useEffect(() => {
    if (!readyRef.current) return;
    if (skipNextSendRef.current) {
      skipNextSendRef.current = false;
      return;
    }
    const timer = setTimeout(() => {
      void api.post('/pos/basket', { device_id: deviceIdRef.current, lines: toLines(cart) }).catch(() => {});
    }, SEND_DELAY_MS);
    return () => clearTimeout(timer);
  }, [cart]);
}
