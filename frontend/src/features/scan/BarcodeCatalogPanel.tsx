import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Barcode, ChevronUp, Search, X } from 'lucide-react';
import { ApiError } from '../../lib/api';
import { canEncodeCode128, encodeCode128 } from '../../lib/code128';
import { formatMoney } from '../../lib/money';
import { MenuItem } from '../../types';
import { loadActiveProducts, productCode } from './productBarcodes';

// Panel width on wide screens. The scan page adds the same right padding (xl:pr-[420px]) while it is open.
export const BARCODE_PANEL_WIDTH_CLASS = 'xl:w-[420px]';

// Draws a Code 128 barcode. White background and quiet zones so it can be scanned off a screen.
const Code128Svg: React.FC<{ code: string }> = ({ code }) => {
  const { bars, width } = useMemo(() => encodeCode128(code), [code]);
  return (
    <svg
      viewBox={`0 0 ${width} 60`}
      preserveAspectRatio="none"
      shapeRendering="crispEdges"
      role="img"
      aria-label={`Barcode ${code}`}
      className="block h-28 w-full bg-white"
      // At least 2px per bar module, so phone cameras can resolve the bars.
      style={{ minWidth: width * 2, maxWidth: width * 3 }}
    >
      {bars.map(([x, w]) => (
        <rect key={x} x={x} y={0} width={w} height={60} fill="#000" />
      ))}
    </svg>
  );
};

const BarcodeCard: React.FC<{ item: MenuItem }> = ({ item }) => {
  const code = productCode(item);
  if (!code || !canEncodeCode128(code.code)) {
    return (
      <p className="mt-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-900">
        {code ? `The code "${code.code}" contains characters that can't be drawn as a barcode.` : 'This product has no barcode or SKU.'}
      </p>
    );
  }
  return (
    <div className="mt-2 rounded-lg border border-[#E3E6E8] bg-white py-3">
      <div className="flex justify-center overflow-x-auto px-2">
        <Code128Svg code={code.code} />
      </div>
      <p className="mt-1.5 text-center font-mono text-base tracking-[0.2em] text-[#0F172A]">{code.code}</p>
      <p className="mt-1 text-center text-[11px] text-[#64748B]">
        {[item.brand, item.package_size].filter(Boolean).join(' · ')} · {formatMoney(item.base_price_minor)}
        {code.kind === 'SKU' && ' · no barcode, SKU shown'}
      </p>
    </div>
  );
};

// Top of the panel = bottom of the navigation bar, kept in sync while scrolling and resizing.
const useNavbarBottom = () => {
  const [top, setTop] = useState(0);
  useEffect(() => {
    const header = document.querySelector('header');
    if (!header) return;
    const update = () => setTop(Math.max(0, header.getBoundingClientRect().bottom));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(header);
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      observer.disconnect();
      window.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, []);
  return top;
};

// Side panel listing every product with a "See barcode" button that shows a scannable barcode
// inside the panel. On wide screens it sits beside the scan page (which moves left to make room),
// so the live scan activity stays visible. On smaller screens it covers the page.
export const BarcodeCatalogPanel: React.FC<{ open: boolean; onClose: () => void }> = ({ open, onClose }) => {
  const [items, setItems] = useState<MenuItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const loadStartedRef = useRef(false);
  const top = useNavbarBottom();

  // Load products the first time the panel opens.
  useEffect(() => {
    if (!open || loadStartedRef.current) return;
    loadStartedRef.current = true;
    loadActiveProducts()
      .then(setItems)
      .catch((err) => {
        loadStartedRef.current = false; // allow a retry on the next open
        setError(err instanceof ApiError ? err.message : 'Could not load products');
      })
      .finally(() => setLoaded(true));
  }, [open]);

  // Esc hides an open barcode first, then closes the panel.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (expandedId) setExpandedId(null);
      else onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, expandedId, onClose]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((it) =>
      [it.name_en, it.name_bn, it.brand, it.barcode, it.sku].some((field) => field?.toLowerCase().includes(q))
    );
  }, [items, query]);

  return (
    <aside
      aria-label="Product barcodes"
      aria-hidden={!open}
      inert={!open}
      style={{ top }}
      className={`fixed bottom-0 right-0 z-30 flex w-full sm:w-[420px] ${BARCODE_PANEL_WIDTH_CLASS} flex-col border-l border-[#E3E6E8] bg-white shadow-xl transition-transform duration-300 ease-out ${
        open ? 'translate-x-0' : 'translate-x-full'
      }`}
    >
      <div className="flex items-center gap-3 border-b border-[#E3E6E8] px-4 py-3">
        <Barcode className="w-5 h-5 text-[#E21B70]" />
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-bold text-[#0F172A]">Product barcodes</h2>
          <p className="text-xs text-[#64748B]">{loaded ? `${filtered.length} of ${items.length} products` : 'Loading…'}</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close panel" className="rounded-full p-2 text-[#334155] hover:bg-[#F1F5F9]">
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="border-b border-[#E3E6E8] px-4 py-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#94A3B8]" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name, brand, barcode or SKU"
            aria-label="Search products"
            className="min-h-[40px] w-full rounded-lg border border-[#CBD5E1] pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#E21B70]"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {error ? (
          <p role="alert" className="m-4 rounded-lg bg-rose-50 border border-rose-200 px-3 py-2 text-sm text-rose-800">
            {error}
          </p>
        ) : loaded && filtered.length === 0 ? (
          <p className="p-6 text-center text-sm text-[#64748B]">No products match "{query}".</p>
        ) : (
          <ul className="divide-y divide-[#F1F5F9]">
            {filtered.map((it) => {
              const code = productCode(it);
              const expanded = expandedId === it.id;
              return (
                <li key={it.id} className={`px-4 py-3 ${expanded ? 'bg-[#FFF8FB]' : ''}`}>
                  <div className="flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-[#0F172A]">{it.name_en}</p>
                      <p className="truncate font-mono text-xs text-[#64748B]">
                        {code ? code.code : 'No barcode'}
                        {code?.kind === 'SKU' && <span className="ml-1.5 font-sans text-[10px] font-bold uppercase">SKU</span>}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setExpandedId(expanded ? null : it.id)}
                      disabled={!code}
                      aria-expanded={expanded}
                      className="inline-flex shrink-0 items-center gap-1.5 min-h-[36px] rounded-lg bg-[#FFF0F6] px-3 text-xs font-bold text-[#E21B70] hover:bg-[#FFE0EE] disabled:opacity-40"
                    >
                      {expanded ? (
                        <>
                          <ChevronUp className="w-4 h-4" /> Hide barcode
                        </>
                      ) : (
                        <>
                          <Barcode className="w-4 h-4" /> See barcode
                        </>
                      )}
                    </button>
                  </div>
                  {expanded && <BarcodeCard item={it} />}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
};
