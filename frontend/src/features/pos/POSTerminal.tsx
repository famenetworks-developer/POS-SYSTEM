import React, { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { Product, Table as Register, Order, Customer, Promotion } from '../../types';
import { api } from '../../lib/api';
import { formatMoney } from '../../lib/money';
import { t } from '../../lib/i18n';
import { wsHub } from '../../lib/ws';
import { getProductFallback, getProductImage } from '../../lib/productImages';
import { ReceiptModal } from '../../components/ui/ReceiptModal';
import { ShiftBar } from './ShiftBar';
import { BasketScanResult, CameraBasketScanner } from './CameraBasketScanner';
import {
  Search,
  Plus,
  Minus,
  Trash2,
  Receipt,
  CreditCard,
  Banknote,
  QrCode,
  DollarSign,
  ShoppingBag,
  Truck,
  Sparkles,
  Percent,
  Check,
  PauseCircle,
  PlayCircle,
  RotateCcw,
  Scale,
  Barcode,
  ScanBarcode,
  UserPlus,
  Tag,
  AlertTriangle,
  Flame,
  Star,
  CheckCircle2,
  X,
  HelpCircle,
  ChevronRight,
  MapPin,
  Clock3,
  ShieldCheck,
} from 'lucide-react';

interface CartLine {
  product: Product;
  qty: number;
  unitPriceMinor: number;
  discountMinor: number;
  note: string;
}

interface HeldSale {
  id: string;
  heldAt: string;
  customerName?: string;
  cart: CartLine[];
  orderType: 'walk_in' | 'pickup' | 'delivery';
  registerId?: string;
}

export const POSTerminal: React.FC = () => {
  const { user, restaurant, activeBranch } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  // Core Data
  const [categories, setCategories] = useState<any[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [registers, setRegisters] = useState<Register[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [promotions, setPromotions] = useState<Promotion[]>([]);

  // Navigation & Search State
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [quickFilter, setQuickFilter] = useState<'all' | 'deals' | 'popular' | 'new'>('all');
  const [showAllProducts, setShowAllProducts] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [scanFlash, setScanFlash] = useState<boolean>(false);
  const [showCameraScanner, setShowCameraScanner] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Sales State
  const [orderType, setOrderType] = useState<'walk_in' | 'pickup' | 'delivery'>('walk_in');
  const [selectedRegister, setSelectedRegister] = useState<Register | null>(null);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [appliedCoupon, setAppliedCoupon] = useState<Promotion | null>(null);
  const [couponCodeInput, setCouponCodeInput] = useState<string>('');
  const [couponError, setCouponError] = useState<string>('');

  // Delivery details (when orderType === 'delivery')
  const [deliveryAddress, setDeliveryAddress] = useState<string>('');
  const [deliveryPhone, setDeliveryPhone] = useState<string>('');
  const [deliveryRecipient, setDeliveryRecipient] = useState<string>('');
  const [deliveryFeeMinor, setDeliveryFeeMinor] = useState<number>(6000); // ৳60.00 default delivery fee

  // Mobile/Tablet Tab Switcher
  const [mobileTab, setMobileTab] = useState<'products' | 'cart'>('products');

  // Modals & Drawers
  const [weightedModalProduct, setWeightedModalProduct] = useState<Product | null>(null);
  const [customWeightInput, setCustomWeightInput] = useState<string>('1.000');

  const [showCheckoutModal, setShowCheckoutModal] = useState<boolean>(false);
  const [paymentMethod, setPaymentMethod] = useState<string>('cash');
  const [cashTendered, setCashTendered] = useState<string>('');
  const [paymentRef, setPaymentRef] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  // Bumped after each sale so the shift bar reloads the cash that should be in the drawer.
  const [shiftRefresh, setShiftRefresh] = useState(0);
  // Selling is blocked until the cashier has an open shift (the server enforces this too).
  const [hasOpenShift, setHasOpenShift] = useState(false);

  // Held Sales Drawer
  const [heldSales, setHeldSales] = useState<HeldSale[]>([]);
  const [showHeldSalesDrawer, setShowHeldSalesDrawer] = useState<boolean>(false);

  // Quick New Customer Modal
  const [showNewCustomerModal, setShowNewCustomerModal] = useState<boolean>(false);
  const [newCustName, setNewCustName] = useState<string>('');
  const [newCustPhone, setNewCustPhone] = useState<string>('');

  // Return / Refund Modal
  const [showRefundModal, setShowRefundModal] = useState<boolean>(false);
  const [showShopInfo, setShowShopInfo] = useState<boolean>(false);
  const [refundInvoiceInput, setRefundInvoiceInput] = useState<string>('');
  const [refundReason, setRefundReason] = useState<string>('Customer Return');
  const [refundRestock, setRefundRestock] = useState<boolean>(true);
  const [refundMessage, setRefundMessage] = useState<string>('');

  // Receipt Modal
  const [completedOrder, setCompletedOrder] = useState<Order | null>(null);
  const [receiptInvoiceNo, setReceiptInvoiceNo] = useState<string>('');
  const [receiptChange, setReceiptChange] = useState<number>(0);

  // Load Data
  const loadData = async () => {
    try {
      const data = await api.get(`/pos/bootstrap?branch_id=${activeBranch?.id || ''}`);
      setCategories(data.categories || []);
      setProducts(data.items || []);
      const regs = data.registers || data.tables || [];
      setRegisters(regs);
      if (regs.length > 0 && !selectedRegister) {
        setSelectedRegister(regs[0]);
      }
      setCustomers(data.customers || []);
      setPromotions(data.promotions || []);
    } catch (e) {
      console.error('POS bootstrap load error:', e);
    }
  };

  useEffect(() => {
    loadData();
    // Auto focus search / scanner
    if (searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [activeBranch?.id]);

  useEffect(() => {
    if (searchParams.get('delivery') === 'signup') {
      setOrderType('delivery');
      setDeliveryFeeMinor(0);
      setShowNewCustomerModal(true);
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  // Keyboard Shortcuts (F2 search, F4 hold, F8 clear, F9 checkout, Esc close)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F2') {
        e.preventDefault();
        searchInputRef.current?.focus();
      } else if (e.key === 'F4') {
        e.preventDefault();
        handleHoldSale();
      } else if (e.key === 'F8') {
        e.preventDefault();
        if (cart.length > 0 && confirm('Are you sure you want to clear the cart?')) {
          handleClearCart();
        }
      } else if (e.key === 'F9') {
        e.preventDefault();
        if (cart.length > 0 && hasOpenShift) {
          setShowCheckoutModal(true);
        }
      } else if (e.key === 'Escape') {
        setShowCheckoutModal(false);
        setWeightedModalProduct(null);
        setShowHeldSalesDrawer(false);
        setShowNewCustomerModal(false);
        setShowRefundModal(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [cart, hasOpenShift]);

  // Finds a product by barcode (main or extra) or SKU: the loaded catalogue first, then the server.
  const findProductByCode = async (code: string): Promise<Product | null> => {
    const found = products.find(
      (p) =>
        p.barcode === code ||
        (p.barcodes && p.barcodes.includes(code)) ||
        (p.sku && p.sku.toLowerCase() === code.toLowerCase())
    );
    if (found) return found;
    try {
      return (await api.get<Product>(`/items/barcode/${encodeURIComponent(code)}`)) || null;
    } catch {
      return null;
    }
  };

  // Barcode rapid scanner handler (USB scanners type the code and press Enter)
  const handleSearchKeyDown = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const code = searchQuery.trim();
      if (!code) return;

      const product = await findProductByCode(code);
      if (product) {
        addProductToCart(product);
        triggerScanFeedback();
        setSearchQuery('');
      }
      // Otherwise keep the text as a search filter.
    }
  };

  // Phone/tablet camera: every product read is added to the basket.
  const handleCameraCode = async (code: string): Promise<BasketScanResult> => {
    if (code.length > 64 || /\s/.test(code)) {
      return { ok: false, message: 'That is not a product barcode' };
    }
    const product = await findProductByCode(code);
    if (!product) return { ok: false, message: `No product with code ${code}` };
    addProductToCart(product);
    if (product.is_weighted) {
      return { ok: true, message: `${product.name_en}: enter the weight`, close: true };
    }
    triggerScanFeedback();
    return { ok: true, message: `Added ${product.name_en} · ${formatMoney(product.base_price_minor, restaurant?.currency)}` };
  };

  const triggerScanFeedback = () => {
    setScanFlash(true);
    setTimeout(() => setScanFlash(false), 300);
  };

  // Add Product to Cart
  const addProductToCart = (product: Product, quantity = 1) => {
    if (product.is_weighted && quantity === 1) {
      setWeightedModalProduct(product);
      setCustomWeightInput('1.000');
      return;
    }

    setCart((prev) => {
      const idx = prev.findIndex((l) => l.product.id === product.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx].qty += quantity;
        return next;
      }
      return [
        ...prev,
        {
          product,
          qty: quantity,
          unitPriceMinor: product.base_price_minor,
          discountMinor: 0,
          note: '',
        },
      ];
    });
  };

  // Confirm weighted good decimal quantity
  const handleConfirmWeight = () => {
    if (!weightedModalProduct) return;
    const weight = parseFloat(customWeightInput);
    if (isNaN(weight) || weight <= 0) {
      alert('Please enter a valid weight in kg or decimal quantity');
      return;
    }

    setCart((prev) => {
      const idx = prev.findIndex((l) => l.product.id === weightedModalProduct.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx].qty = parseFloat((next[idx].qty + weight).toFixed(3));
        return next;
      }
      return [
        ...prev,
        {
          product: weightedModalProduct,
          qty: parseFloat(weight.toFixed(3)),
          unitPriceMinor: weightedModalProduct.base_price_minor,
          discountMinor: 0,
          note: `${weight} kg`,
        },
      ];
    });

    setWeightedModalProduct(null);
    triggerScanFeedback();
  };

  const updateLineQty = (index: number, newQty: number) => {
    setCart((prev) => {
      if (newQty <= 0) {
        return prev.filter((_, i) => i !== index);
      }
      const next = [...prev];
      next[index].qty = parseFloat(newQty.toFixed(3));
      return next;
    });
  };

  const removeLine = (index: number) => {
    setCart((prev) => prev.filter((_, i) => i !== index));
  };

  const handleClearCart = () => {
    setCart([]);
    setAppliedCoupon(null);
    setCouponCodeInput('');
  };

  // Hold & Resume Sales
  const handleHoldSale = () => {
    if (cart.length === 0) return;
    const newHold: HeldSale = {
      id: Math.random().toString(36).substring(2, 9),
      heldAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      customerName: selectedCustomer?.name || 'Walk-in Shopper',
      cart: [...cart],
      orderType,
      registerId: selectedRegister?.id,
    };
    setHeldSales((prev) => [newHold, ...prev]);
    setCart([]);
    setAppliedCoupon(null);
    alert('Sale has been put on hold.');
  };

  const handleResumeSale = (hold: HeldSale) => {
    if (cart.length > 0 && !confirm('Active cart has items. Replace with held sale?')) {
      return;
    }
    setCart(hold.cart);
    setOrderType(hold.orderType);
    setHeldSales((prev) => prev.filter((h) => h.id !== hold.id));
    setShowHeldSalesDrawer(false);
  };

  // Quick Customer Creation
  const handleCreateCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCustName || !newCustPhone) return;
    try {
      const created = await api.post('/customers', {
        name: newCustName,
        phone: newCustPhone,
        customer_group: 'Regular',
      });
      setCustomers((prev) => [created, ...prev]);
      setSelectedCustomer(created);
      setShowNewCustomerModal(false);
      setNewCustName('');
      setNewCustPhone('');
    } catch (err: any) {
      alert('Could not save customer: ' + err.message);
    }
  };

  // Coupon application
  const handleApplyCoupon = async () => {
    setCouponError('');
    if (!couponCodeInput.trim()) return;
    try {
      const res = await api.post('/promotions/validate', {
        code: couponCodeInput.trim(),
        subtotal_minor: cartSubtotalMinor,
      });
      if (res && res.valid) {
        setAppliedCoupon({
          id: res.code,
          code: res.code,
          name: res.name,
          type: 'fixed',
          discount_pct: 0,
          discount_minor: res.discount_minor,
          min_spend_minor: 0,
          is_active: true,
        });
      }
    } catch (err: any) {
      setCouponError(err.message || 'Invalid or expired coupon');
    }
  };

  // Calculate Financial Totals
  const cartSubtotalMinor = cart.reduce(
    (sum, line) => sum + Math.round(line.qty * line.unitPriceMinor),
    0
  );

  const couponDiscountMinor = appliedCoupon ? appliedCoupon.discount_minor : 0;
  const taxableBase = Math.max(0, cartSubtotalMinor - couponDiscountMinor);
  // Super shop standard VAT: 5% in Bangladesh
  const vatMinor = Math.round(taxableBase * 0.05);
  const deliveryCostMinor = orderType === 'delivery' ? deliveryFeeMinor : 0;
  const rawTotalMinor = taxableBase + vatMinor + deliveryCostMinor;
  // Round to nearest whole BDT (100 minor units)
  const roundOffMinor = (100 - (rawTotalMinor % 100)) % 100;
  const grandTotalMinor = rawTotalMinor + roundOffMinor;

  // Checkout submission
  const handleCompleteSale = async () => {
    if (cart.length === 0) return;
    setIsSubmitting(true);

    try {
      const clientOrderId = crypto.randomUUID();
      const orderBody = {
        id: clientOrderId,
        branch_id: activeBranch?.id,
        type: orderType,
        table_id: selectedRegister?.id,
        customer_id: selectedCustomer?.id,
        delivery_fee: deliveryCostMinor,
        notes: orderType === 'delivery' ? `Delivery to: ${deliveryAddress} (${deliveryPhone})` : '',
        items: cart.map((line) => ({
          item_id: line.product.id,
          name_snapshot: line.product.name_en,
          qty: line.qty,
          unit_price_minor: line.unitPriceMinor,
          discount_minor: line.discountMinor,
          note: line.note,
        })),
      };

      const createdOrder = await api.post('/orders', orderBody);

      // Submit payment
      const tenderedMinor = cashTendered ? Math.round(parseFloat(cashTendered) * 100) : grandTotalMinor;
      const payRes = await api.post(`/orders/${createdOrder.id}/pay`, {
        payments: [
          {
            method_code: paymentMethod,
            amount_minor: grandTotalMinor,
            reference: paymentRef,
          },
        ],
        cash_received: tenderedMinor,
      });

      // Show receipt modal
      setCompletedOrder({
        ...createdOrder,
        total_minor: grandTotalMinor,
        subtotal_minor: cartSubtotalMinor,
        tax_minor: vatMinor,
        table_name: selectedRegister?.name || 'Counter 01',
        customer_name: selectedCustomer?.name,
        waiter_name: user?.name,
      });
      setReceiptInvoiceNo(payRes.invoice_no);
      setReceiptChange(payRes.change_due || (tenderedMinor > grandTotalMinor ? tenderedMinor - grandTotalMinor : 0));

      setShiftRefresh((n) => n + 1);

      // Reset cart
      handleClearCart();
      setShowCheckoutModal(false);
      setCashTendered('');
      setPaymentRef('');
      loadData();
    } catch (e: any) {
      alert('Checkout error: ' + (e.message || 'Payment failed'));
    } finally {
      setIsSubmitting(false);
    }
  };

  // Process Return / Refund
  const handleProcessRefund = async () => {
    if (!refundInvoiceInput.trim()) {
      alert('Please enter an invoice number');
      return;
    }
    try {
      // Find invoice from orders
      const ordersList = await api.get(`/orders?branch_id=${activeBranch?.id || ''}`);
      const found = (ordersList || []).find((o: any) => o.order_no?.toString() === refundInvoiceInput.trim() || o.id === refundInvoiceInput.trim());
      if (!found) {
        alert('Invoice / Order not found in recent records.');
        return;
      }
      await api.post(`/orders/${found.id}/refund-request`, {
        amount_minor: found.total_minor,
        reason: refundReason,
        restock: refundRestock,
      });
      setRefundMessage(`Refund request submitted for Order #${found.order_no}. A Manager or Owner must approve it.`);
      loadData();
    } catch (err: any) {
      alert('Return failed: ' + err.message);
    }
  };

  // Filter Products
  const filteredProducts = products.filter((p) => {
    // Quick filter tab
    if (quickFilter === 'deals' && !p.is_hot_deal) return false;
    if (quickFilter === 'popular' && !p.is_popular) return false;
    if (quickFilter === 'new' && !p.is_new_arrival) return false;

    // Category
    if (selectedCategory !== 'all' && p.category_id !== selectedCategory) {
      return false;
    }

    // Search query
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      const matchName = p.name_en.toLowerCase().includes(q);
      const matchBn = p.name_bn && p.name_bn.includes(q);
      const matchSku = p.sku && p.sku.toLowerCase().includes(q);
      const matchBarcode = p.barcode && p.barcode.includes(q);
      const matchBrand = p.brand && p.brand.toLowerCase().includes(q);
      const matchDept = p.department && p.department.toLowerCase().includes(q);
      return matchName || matchBn || matchSku || matchBarcode || matchBrand || matchDept;
    }

    return true;
  });

  return (
    <div className={`pos-shell flex-1 flex flex-col lg:flex-row h-[calc(100dvh-7.25rem)] overflow-hidden gap-0 ${scanFlash ? 'scan-flash' : ''}`}>
      {/* Mobile Tab Switcher */}
      <div className="lg:hidden flex border-b border-[#E2E8F0] bg-white shrink-0 rounded-xl overflow-hidden shadow-sm">
        <button
          onClick={() => setMobileTab('products')}
          className={`flex-1 py-3 text-xs font-bold flex items-center justify-center gap-2 border-b-2 transition-all ${
            mobileTab === 'products'
              ? 'border-[#0D5C3A] text-[#0D5C3A] bg-[#0D5C3A]/5'
              : 'border-transparent text-[#64748B]'
          }`}
        >
          <ShoppingBag className="w-4 h-4" />
          <span>Catalogue ({filteredProducts.length})</span>
        </button>
        <button
          onClick={() => setMobileTab('cart')}
          className={`flex-1 py-3 text-xs font-bold flex items-center justify-center gap-2 border-b-2 transition-all ${
            mobileTab === 'cart'
              ? 'border-[#0D5C3A] text-[#0D5C3A] bg-[#0D5C3A]/5'
              : 'border-transparent text-[#64748B]'
          }`}
        >
          <Receipt className="w-4 h-4" />
          <span>Cart ({cart.reduce((s, c) => s + c.qty, 0)}) • {formatMoney(grandTotalMinor, restaurant?.currency)}</span>
        </button>
      </div>

      {/* LEFT / CENTER: Catalogue Area */}
      <div className={`pos-menu-panel relative flex-1 flex flex-col h-full overflow-hidden bg-white border-r border-[#e8e8e8] ${mobileTab === 'products' ? 'flex' : 'hidden lg:flex'}`}>
        {/* Top Controls: Sales Mode & Register & Quick Actions */}
        <div className="hidden">
          {/* Sales Mode Switcher */}
          <div className="flex rounded-xl bg-[#E2E8F0] p-1 shadow-inner">
            <button
              onClick={() => setOrderType('walk_in')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                orderType === 'walk_in'
                  ? 'bg-[#0D5C3A] text-white shadow-sm'
                  : 'text-[#475569] hover:text-[#0D5C3A]'
              }`}
            >
              <ShoppingBag className="w-3.5 h-3.5" />
              <span>{t('walk_in')}</span>
            </button>
            <button
              onClick={() => setOrderType('pickup')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                orderType === 'pickup'
                  ? 'bg-[#0D5C3A] text-white shadow-sm'
                  : 'text-[#475569] hover:text-[#0D5C3A]'
              }`}
            >
              <Receipt className="w-3.5 h-3.5" />
              <span>{t('pickup')}</span>
            </button>
            <button
              onClick={() => setOrderType('delivery')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                orderType === 'delivery'
                  ? 'bg-[#0D5C3A] text-white shadow-sm'
                  : 'text-[#475569] hover:text-[#0D5C3A]'
              }`}
            >
              <Truck className="w-3.5 h-3.5" />
              <span>{t('delivery')}</span>
            </button>
          </div>

          {/* Active Register Selection */}
          <div className="flex items-center gap-1.5 overflow-x-auto">
            <span className="text-xs font-bold text-[#64748B] shrink-0">Counter:</span>
            <select
              value={selectedRegister?.id || ''}
              onChange={(e) => {
                const r = registers.find((reg) => reg.id === e.target.value);
                if (r) setSelectedRegister(r);
              }}
              className="bg-white border border-[#CBD5E1] rounded-lg px-2.5 py-1 text-xs font-bold text-[#0D5C3A] focus:outline-none focus:ring-1 focus:ring-[#0D5C3A]"
            >
              {registers.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>

          {/* Quick Actions (Hold, Resume, Refund) */}
          <div className="flex items-center gap-1.5">
            <button
              onClick={handleHoldSale}
              disabled={cart.length === 0}
              title="Hold Sale (F4)"
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100 disabled:opacity-40 transition-colors"
            >
              <PauseCircle className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Hold</span>
            </button>

            <button
              onClick={() => setShowHeldSalesDrawer(true)}
              title="Resume Held Sales"
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold bg-[#E6F4EA] text-[#0D5C3A] border border-[#B7E1CD] hover:bg-[#D1EADB] transition-colors relative"
            >
              <PlayCircle className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Held ({heldSales.length})</span>
              {heldSales.length > 0 && (
                <span className="sm:hidden w-2 h-2 rounded-full bg-[#0D5C3A]" />
              )}
            </button>

            <button
              onClick={() => setShowRefundModal(true)}
              title="Return / Refund"
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100 transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Return</span>
            </button>
          </div>
        </div>

        {/* Premium store identity and service promise */}
        <div className="storefront-hero shrink-0 overflow-hidden" role="img" aria-label="Customers shopping for fresh groceries in a modern NovaMart supermarket">
        </div>

        {/* Rapid Barcode Scanner & Search Bar */}
        <div className="catalogue-search px-3 py-3 flex flex-col sm:flex-row gap-2.5">
          <div className="relative flex-1">
            <div className="absolute left-4 top-1/2 -translate-y-1/2 flex items-center justify-center text-[#6B7175] pointer-events-none z-10">
              <Search className="w-[18px] h-[18px]" strokeWidth={1.8} />
            </div>
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={handleSearchKeyDown}
              placeholder="Search products"
              aria-label="Search products by name, brand, SKU or barcode"
              className="w-full bg-white border border-[#D5D8DC] rounded-full pl-11 pr-4 py-3 text-sm font-normal text-[#2E3138] placeholder-[#6B7175] focus:bg-white focus:border-[#2E3138] focus:outline-none focus:ring-0 transition-colors"
            />
          </div>
          <button
            type="button"
            onClick={() => setShowCameraScanner(true)}
            title="Scan items into the basket with this device's camera"
            className="inline-flex shrink-0 items-center justify-center gap-2 min-h-[46px] rounded-full bg-[#E21B70] px-5 text-sm font-bold text-white hover:bg-[#C91661]"
          >
            <ScanBarcode className="w-[18px] h-[18px]" /> Scan with camera
          </button>

          {/* Quick Filter Buttons */}
          <div className="hidden">
            <button
              onClick={() => setQuickFilter('all')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                quickFilter === 'all'
                  ? 'bg-[#0D5C3A] text-white shadow-sm'
                  : 'bg-[#F1F5F9] text-[#475569] hover:bg-[#E2E8F0]'
              }`}
            >
              All
            </button>
            <button
              onClick={() => setQuickFilter('deals')}
              className={`flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                quickFilter === 'deals'
                  ? 'bg-[#DC2626] text-white shadow-sm'
                  : 'bg-red-50 text-[#DC2626] border border-red-200 hover:bg-red-100'
              }`}
            >
              <Flame className="w-3 h-3" />
              <span>Hot Deals</span>
            </button>
            <button
              onClick={() => setQuickFilter('popular')}
              className={`flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                quickFilter === 'popular'
                  ? 'bg-amber-600 text-white shadow-sm'
                  : 'bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100'
              }`}
            >
              <Star className="w-3 h-3" />
              <span>Popular</span>
            </button>
            <button
              onClick={() => setQuickFilter('new')}
              className={`flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                quickFilter === 'new'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100'
              }`}
            >
              <Sparkles className="w-3 h-3" />
              <span>New</span>
            </button>
          </div>
        </div>

        <div className="flex flex-1 min-h-0">
          {/* Desktop category rail — mirrors modern grocery marketplace navigation */}
          <aside className="hidden xl:flex w-[220px] shrink-0 border-r border-[#eeeeee] bg-white flex-col min-h-0">
            <div className="px-6 pt-6 pb-4 border-b border-[#eeeeee]">
              <h2 className="text-base font-black text-[#171717]">NovaMart Super Shop</h2>
              <button
                type="button"
                onClick={() => setShowShopInfo(true)}
                className="mt-3 w-full min-h-[44px] py-2 px-3 rounded-lg border border-[#2E3138] text-xs font-bold hover:bg-[#F7F7F7] focus-visible:ring-2 focus-visible:ring-[#E21B70]"
              >
                Shop and fee information
              </button>
              <h3 className="text-base font-black text-[#2E3138] mt-8">Categories</h3>
            </div>
            <div className="overflow-y-auto px-2 pb-4 space-y-0.5">
              <button
                onClick={() => setSelectedCategory('all')}
                className={`category-rail-item ${selectedCategory === 'all' ? 'active' : ''}`}
              >
                <span>Offers & all products</span><span>{products.length}</span>
              </button>
              {categories.map((cat) => {
                const count = products.filter((p) => p.category_id === cat.id).length;
                return (
                  <button key={cat.id} onClick={() => setSelectedCategory(cat.id)} className={`category-rail-item ${selectedCategory === cat.id ? 'active' : ''}`}>
                    <span>{cat.name_en}</span><span>{count}</span>
                  </button>
                );
              })}
            </div>
            <div className="m-3 mt-auto rounded-xl bg-[#f1f8f4] p-3 border border-[#dcefe4]">
              <p className="text-[10px] font-black text-[#0D5C3A]">Need a product?</p>
              <p className="text-[9px] leading-relaxed text-[#64748B] mt-1">Search by name, brand, SKU or scan the barcode.</p>
            </div>
          </aside>

          <main className="flex-1 flex flex-col min-w-0 min-h-0">
        {/* Mobile/tablet Categories Strip */}
        <div className="xl:hidden px-3 py-2.5 border-b border-[#eeeeee] bg-white flex gap-2 overflow-x-auto shrink-0 scrollbar-none">
          <button
            onClick={() => setSelectedCategory('all')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition-all ${
              selectedCategory === 'all'
                ? 'bg-[#0D5C3A] text-white shadow-sm'
                : 'bg-[#f7f7f7] text-[#475569] border border-transparent hover:bg-[#edf7f1] hover:text-[#0D5C3A]'
            }`}
          >
            All Categories ({products.length})
          </button>
          {categories.map((cat) => {
            const count = products.filter((p) => p.category_id === cat.id).length;
            const isSel = selectedCategory === cat.id;
            return (
              <button
                key={cat.id}
                onClick={() => setSelectedCategory(cat.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap flex items-center gap-1.5 transition-all ${
                  isSel
                    ? 'bg-[#0D5C3A] text-white shadow-sm'
                    : 'bg-[#f7f7f7] text-[#475569] border border-transparent hover:bg-[#edf7f1] hover:text-[#0D5C3A]'
                }`}
              >
                <span>{cat.name_en}</span>
                <span className={`text-[10px] px-1.5 py-0.2 rounded-full ${isSel ? 'bg-white/20 text-white' : 'bg-gray-100 text-gray-600'}`}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Grocery Product Cards Grid */}
        <div className="flex-1 overflow-y-auto p-3 sm:p-4 bg-[#fafafa]">
          <div className="flex items-end justify-between gap-3 mb-4">
            <div>
              <h2 className="text-lg font-black tracking-tight text-[#171717] mt-0.5">
                {quickFilter === 'deals' ? 'Hot deals' : quickFilter === 'new' ? 'New arrivals' : selectedCategory === 'all' ? 'Popular products' : categories.find((cat) => cat.id === selectedCategory)?.name_en || 'Products'}
              </h2>
            </div>
            <button
              type="button"
              onClick={() => setShowAllProducts((showAll) => !showAll)}
              aria-pressed={showAllProducts}
              className="min-h-[40px] px-3 rounded-lg text-xs font-semibold text-[#171717] hover:bg-white focus-visible:ring-2 focus-visible:ring-[#E21B70]"
            >
              {showAllProducts ? 'Show less' : 'View all'}
            </button>
          </div>
          {filteredProducts.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-6 text-[#94A3B8]">
              <Barcode className="w-12 h-12 stroke-[1.5] text-[#CBD5E1] mb-2" />
              <p className="text-sm font-bold text-[#475569]">No products match search criteria</p>
              <p className="text-xs text-[#94A3B8] mt-1">Try another category, barcode, or brand name</p>
            </div>
          ) : (
            <div className={`product-shelf ${showAllProducts ? 'show-all' : ''} grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-2 sm:gap-3 min-w-0`}>
              {filteredProducts.map((p) => {
                const inCart = cart.find((l) => l.product.id === p.id);
                const hasDiscount = p.regular_price_minor && p.regular_price_minor > p.base_price_minor;
                const discountPct = hasDiscount
                  ? Math.round(((p.regular_price_minor! - p.base_price_minor) / p.regular_price_minor!) * 100)
                  : 0;
                const isOutOfStock = p.stock_quantity !== undefined && p.stock_quantity <= 0;
                const isLowStock = p.stock_quantity !== undefined && p.stock_quantity > 0 && p.stock_quantity <= 10;
                const productImage = getProductImage(p);

                return (
                  <div
                    key={p.id}
                    onClick={() => !isOutOfStock && addProductToCart(p)}
                    className={`product-card min-w-0 max-w-full group relative bg-white border-0 rounded-none p-0 flex flex-col justify-between transition-all select-none cursor-pointer ${
                      inCart
                        ? 'border-[#0D5C3A] ring-2 ring-[#0D5C3A]/20 bg-[#E6F4EA]/10'
                        : isOutOfStock
                        ? 'opacity-60 bg-gray-50 border-gray-200 cursor-not-allowed'
                        : 'border-[#e8e8e8] hover:border-[#0D5C3A]/30'
                    }`}
                  >
                    {/* Image-led product discovery, matching modern grocery storefronts */}
                    <div className="relative aspect-square rounded-none bg-[#f7f7f7] overflow-hidden mb-2.5 flex items-center justify-center">
                      <img
                        src={productImage}
                        alt={`${p.name_en}${p.brand ? ` by ${p.brand}` : ''}`}
                        loading="lazy"
                        referrerPolicy="no-referrer"
                        onError={(event) => {
                          event.currentTarget.onerror = null;
                          event.currentTarget.src = getProductFallback(p);
                        }}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      />
                      {discountPct > 0 && (
                        <span className="absolute left-2 top-2 px-2 py-1 rounded-lg text-[9px] font-black bg-[#e21b4d] text-white shadow-sm">{discountPct}% OFF</span>
                      )}
                      {p.is_new_arrival && (
                        <span className="absolute right-2 top-2 px-2 py-1 rounded-lg text-[9px] font-black bg-white text-[#0D5C3A] shadow-sm">NEW</span>
                      )}
                    </div>

                    {/* Top tags: Brand & Discount / Badges */}
                    <div className="flex items-start justify-between gap-1 mb-1.5">
                      <span className="text-[10px] font-bold text-[#64748B] uppercase tracking-wider truncate max-w-[100px]">
                        {p.brand || 'NovaMart'}
                      </span>
                      <div className="flex items-center gap-1 shrink-0">
                        {p.is_weighted && (
                          <span className="px-1 py-0.5 rounded text-[9px] font-bold bg-blue-100 text-blue-700 flex items-center gap-0.5" title="Sold by weight">
                            <Scale className="w-2.5 h-2.5" />
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Product Name & Package */}
                    <div className="my-1">
                      <h3 className="text-xs font-bold text-[#0F172A] leading-snug line-clamp-2 group-hover:text-[#0D5C3A] transition-colors">
                        {p.name_en}
                      </h3>
                      {p.name_bn && (
                        <p className="text-[10px] text-[#64748B] truncate mt-0.5">
                          {p.name_bn}
                        </p>
                      )}
                      <p className="text-[10px] font-medium text-[#475569] mt-1 flex items-center gap-1">
                        <Tag className="w-2.5 h-2.5 text-[#94A3B8]" />
                        <span>{p.package_size || '1 pc'}</span>
                      </p>
                    </div>

                    {/* Pricing & Stock Indicator */}
                    <div className="pt-2 border-t border-dashed border-[#E2E8F0] mt-2 flex items-center justify-between gap-1 min-w-0">
                      <div className="flex flex-col min-w-0">
                        <span className="text-xs sm:text-sm font-black text-[#0D5C3A] truncate">
                          {formatMoney(p.base_price_minor, restaurant?.currency)}
                        </span>
                        {hasDiscount && (
                          <span className="text-[10px] text-[#94A3B8] line-through -mt-0.5">
                            {formatMoney(p.regular_price_minor!, restaurant?.currency)}
                          </span>
                        )}
                      </div>

                      {/* Add button or cart stepper */}
                      {inCart ? (
                        <div
                          onClick={(e) => e.stopPropagation()}
                          className="flex items-center gap-1 bg-[#0D5C3A] text-white rounded-lg p-0.5 shadow-sm"
                        >
                          <button
                            type="button"
                            aria-label={`Decrease ${p.name_en} quantity`}
                            onClick={() => {
                              const idx = cart.findIndex((l) => l.product.id === p.id);
                              if (idx >= 0) updateLineQty(idx, inCart.qty - 1);
                            }}
                            className="w-10 h-10 sm:w-7 sm:h-7 flex items-center justify-center hover:bg-black/20 rounded"
                          >
                            <Minus className="w-3 h-3" />
                          </button>
                          <span className="text-xs font-bold px-1 min-w-[20px] text-center">
                            {inCart.qty}
                          </span>
                          <button
                            type="button"
                            aria-label={`Increase ${p.name_en} quantity`}
                            onClick={() => {
                              const idx = cart.findIndex((l) => l.product.id === p.id);
                              if (idx >= 0) updateLineQty(idx, inCart.qty + 1);
                            }}
                            className="w-10 h-10 sm:w-7 sm:h-7 flex items-center justify-center hover:bg-black/20 rounded"
                          >
                            <Plus className="w-3 h-3" />
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          aria-label={isOutOfStock ? `${p.name_en} is out of stock` : `Add ${p.name_en} to cart`}
                          disabled={isOutOfStock}
                          className={`w-10 h-10 sm:w-7 sm:h-7 rounded-lg flex items-center justify-center transition-all ${
                            isOutOfStock
                              ? 'bg-gray-100 text-gray-400'
                              : 'bg-[#E6F4EA] text-[#0D5C3A] hover:bg-[#0D5C3A] hover:text-white shadow-sm'
                          }`}
                        >
                          <Plus className="w-4 h-4" />
                        </button>
                      )}
                    </div>

                    {/* Stock Alert Label */}
                    {isOutOfStock ? (
                      <span className="text-[8px] font-bold text-red-600 mt-1">Out of Stock</span>
                    ) : isLowStock ? (
                      <span className="text-[8px] font-bold text-amber-600 mt-1">Low Stock ({p.stock_quantity})</span>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </div>
          </main>
        </div>
      </div>

      {/* RIGHT: Persistent Checkout Cart */}
      <div className={`pos-cart-panel w-full lg:w-[340px] xl:w-[365px] flex flex-col h-full bg-white border-l border-[#e8e8e8] overflow-hidden ${mobileTab === 'cart' ? 'flex' : 'hidden lg:flex'}`}>
        <ShiftBar refreshKey={shiftRefresh} onShiftChange={setHasOpenShift} />
        {/* Cart Header */}
        <div className="p-4 border-b border-[#eeeeee] bg-white flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-[#E6F4EA] text-[#0D5C3A] flex items-center justify-center">
              <ShoppingBag className="w-4 h-4" />
            </div>
            <div><h2 className="text-sm font-black text-[#171717]">Your basket</h2><p className="text-[10px] text-[#94A3B8] font-medium mt-0.5">{cart.reduce((s, c) => s + c.qty, 0)} items from NovaMart</p></div>
          </div>
          {cart.length > 0 && (
            <button
              onClick={() => {
                if (confirm('Clear entire cart? (F8)')) handleClearCart();
              }}
              title="Clear Cart (F8)"
              className="text-xs font-bold text-[#DC2626] hover:bg-red-50 px-2 py-1 rounded-lg transition-colors flex items-center gap-1"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Clear</span>
            </button>
          )}
        </div>

        {/* Customer Lookup & Quick Add Customer */}
        <div className="p-3 border-b border-[#eeeeee] bg-[#fafafa] flex items-center justify-between gap-2">
          <div className="flex-1 min-w-0">
            <select
              value={selectedCustomer?.id || ''}
              onChange={(e) => {
                const c = customers.find((cust) => cust.id === e.target.value);
                setSelectedCustomer(c || null);
              }}
              className="w-full bg-[#F8FAFC] border border-[#CBD5E1] rounded-lg px-2.5 py-1.5 text-xs font-medium text-[#0F172A] focus:outline-none focus:ring-1 focus:ring-[#0D5C3A]"
            >
              <option value="">Walk-in Customer (Guest)</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} {c.phone ? `(${c.phone})` : ''} • {c.loyalty_points || 0} pts
                </option>
              ))}
            </select>
          </div>
          <button
            onClick={() => setShowNewCustomerModal(true)}
            title="Add New Customer"
            className="p-1.5 rounded-lg bg-[#E6F4EA] text-[#0D5C3A] hover:bg-[#D1EADB] border border-[#B7E1CD] transition-colors shrink-0"
          >
            <UserPlus className="w-4 h-4" />
          </button>
        </div>

        {/* Cart Line Items */}
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {cart.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-6 text-[#94A3B8]">
              <div className="w-16 h-16 rounded-full bg-[#f1f8f4] flex items-center justify-center mb-3"><ShoppingBag className="w-7 h-7 stroke-[1.5] text-[#0D5C3A]" /></div>
              <p className="text-sm font-black text-[#334155]">Your basket is empty</p>
              <p className="text-[10px] text-[#94A3B8] mt-1.5 max-w-[200px] leading-relaxed">Browse the catalogue and add your favourite products to start an order.</p>
            </div>
          ) : (
            cart.map((line, idx) => {
              const lineTotal = Math.round(line.qty * line.unitPriceMinor) - line.discountMinor;
              return (
                <div
                  key={idx}
                  className="bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl p-2.5 flex items-center justify-between gap-2 hover:border-[#CBD5E1] transition-all"
                >
                  <img
                    src={getProductImage(line.product)}
                    alt=""
                    loading="lazy"
                    referrerPolicy="no-referrer"
                    onError={(event) => {
                      event.currentTarget.onerror = null;
                      event.currentTarget.src = getProductFallback(line.product);
                    }}
                    className="w-11 h-11 rounded-lg object-cover bg-white border border-[#e8e8e8] shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <h4 className="text-xs font-bold text-[#0F172A] truncate">
                      {line.product.name_en}
                    </h4>
                    <div className="flex items-center gap-1.5 text-[10px] text-[#64748B] mt-0.5">
                      <span>{line.product.package_size || '1 pc'}</span>
                      <span>•</span>
                      <span>{formatMoney(line.unitPriceMinor, restaurant?.currency)}</span>
                      {line.product.barcode && (
                        <>
                          <span>•</span>
                          <span className="font-mono">{line.product.barcode}</span>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Quantity Stepper */}
                  <div className="flex items-center gap-1 bg-white border border-[#CBD5E1] rounded-lg p-0.5 shrink-0">
                    <button
                      onClick={() => updateLineQty(idx, line.qty - (line.product.is_weighted ? 0.25 : 1))}
                      className="w-5 h-5 flex items-center justify-center text-[#475569] hover:bg-[#F1F5F9] rounded"
                    >
                      <Minus className="w-3 h-3" />
                    </button>
                    <span className="text-xs font-bold px-1.5 min-w-[24px] text-center text-[#0F172A]">
                      {line.qty}
                    </span>
                    <button
                      onClick={() => updateLineQty(idx, line.qty + (line.product.is_weighted ? 0.25 : 1))}
                      className="w-5 h-5 flex items-center justify-center text-[#475569] hover:bg-[#F1F5F9] rounded"
                    >
                      <Plus className="w-3 h-3" />
                    </button>
                  </div>

                  {/* Line Total & Remove */}
                  <div className="text-right shrink-0">
                    <p className="text-xs font-black text-[#0D5C3A]">
                      {formatMoney(lineTotal, restaurant?.currency)}
                    </p>
                    <button
                      onClick={() => removeLine(idx)}
                      className="text-[10px] text-red-500 hover:text-red-700 mt-0.5"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Promo Code & Financial Summary */}
        <div className="border-t border-[#E2E8F0] p-3.5 bg-[#F8FAFC] space-y-2.5">
          {/* Coupon Code Input */}
          <div className="flex items-center gap-1.5">
            <input
              type="text"
              value={couponCodeInput}
              onChange={(e) => setCouponCodeInput(e.target.value.toUpperCase())}
              placeholder="COUPON (e.g. NOVAFIRST)"
              aria-label="Promotion coupon code"
              className="flex-1 bg-white border border-[#CBD5E1] rounded-lg px-2.5 py-1 text-xs font-mono font-bold uppercase text-[#0D5C3A] focus:outline-none focus:ring-1 focus:ring-[#0D5C3A]"
            />
            <button
              onClick={handleApplyCoupon}
              className="px-3 py-1 bg-[#0D5C3A] text-white text-xs font-bold rounded-lg hover:bg-[#083D26] transition-colors"
            >
              Apply
            </button>
          </div>
          {couponError && <p className="text-[10px] text-red-600 font-bold">{couponError}</p>}
          {appliedCoupon && (
            <div className="flex items-center justify-between text-[11px] font-bold text-[#0D5C3A] bg-[#E6F4EA] p-1.5 rounded-lg border border-[#B7E1CD]">
              <span>Coupon: {appliedCoupon.code}</span>
              <span>-{formatMoney(appliedCoupon.discount_minor, restaurant?.currency)}</span>
            </div>
          )}

          {/* Breakdown Rows */}
          <div className="text-xs space-y-1 text-[#475569]">
            <div className="flex justify-between">
              <span>{t('subtotal')}:</span>
              <span className="font-bold text-[#0F172A]">{formatMoney(cartSubtotalMinor, restaurant?.currency)}</span>
            </div>
            {couponDiscountMinor > 0 && (
              <div className="flex justify-between text-red-600 font-bold">
                <span>Coupon Discount:</span>
                <span>-{formatMoney(couponDiscountMinor, restaurant?.currency)}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span>VAT / Tax (5%):</span>
              <span className="font-semibold">{formatMoney(vatMinor, restaurant?.currency)}</span>
            </div>
            {orderType === 'delivery' && (
              <div className="flex justify-between text-[#0D5C3A] font-bold">
                <span>Delivery Charge:</span>
                <span>{formatMoney(deliveryCostMinor, restaurant?.currency)}</span>
              </div>
            )}
            {roundOffMinor > 0 && (
              <div className="flex justify-between text-[10px] text-[#94A3B8]">
                <span>Rounding:</span>
                <span>{formatMoney(roundOffMinor, restaurant?.currency)}</span>
              </div>
            )}
            <div className="flex justify-between text-base font-black text-[#0D5C3A] border-t border-[#CBD5E1] pt-1.5 mt-1">
              <span>{t('total')}:</span>
              <span>{formatMoney(grandTotalMinor, restaurant?.currency)}</span>
            </div>
          </div>

          {/* Checkout Button */}
          <button
            onClick={() => setShowCheckoutModal(true)}
            disabled={cart.length === 0 || !hasOpenShift}
            className="w-full py-3 rounded-xl text-xs sm:text-sm font-black bg-[#0D5C3A] hover:bg-[#083D26] text-white shadow-lg shadow-[#0D5C3A]/25 disabled:opacity-40 transition-all flex items-center justify-center gap-2"
          >
            <Banknote className="w-4 h-4" />
            <span>
              {hasOpenShift ? `PAY ${formatMoney(grandTotalMinor, restaurant?.currency)} (F9)` : 'Open a shift to sell'}
            </span>
          </button>
        </div>
      </div>

      {/* MODAL 1: Weighted Product Decimal Input */}
      {weightedModalProduct && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-fade-in">
          <div className="bg-white border border-[#CBD5E1] rounded-2xl shadow-2xl max-w-sm w-full p-5 space-y-4">
            <div className="flex items-center justify-between border-b pb-3">
              <div className="flex items-center gap-2 text-[#0D5C3A]">
                <Scale className="w-5 h-5" />
                <h3 className="text-sm font-black uppercase tracking-wide">Weighted Good</h3>
              </div>
              <button
                onClick={() => setWeightedModalProduct(null)}
                className="p-1 rounded-lg text-gray-500 hover:bg-gray-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div>
              <p className="text-xs font-bold text-[#0F172A]">{weightedModalProduct.name_en}</p>
              <p className="text-[11px] text-[#64748B]">{weightedModalProduct.name_bn}</p>
              <p className="text-xs font-bold text-[#0D5C3A] mt-1">
                Rate: {formatMoney(weightedModalProduct.base_price_minor, restaurant?.currency)} / {weightedModalProduct.unit || 'kg'}
              </p>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-[#475569]">Enter Weight in kg:</label>
              <input
                type="number"
                step="0.05"
                min="0.05"
                autoFocus
                value={customWeightInput}
                onChange={(e) => setCustomWeightInput(e.target.value)}
                className="w-full text-center text-2xl font-black font-mono border-2 border-[#0D5C3A] rounded-xl py-2 focus:outline-none"
              />
              <div className="flex gap-1.5 mt-2">
                {['0.250', '0.500', '1.000', '1.500', '2.000'].map((w) => (
                  <button
                    key={w}
                    onClick={() => setCustomWeightInput(w)}
                    className="flex-1 py-1 rounded bg-[#F1F5F9] text-xs font-bold hover:bg-[#E2E8F0]"
                  >
                    {w}kg
                  </button>
                ))}
              </div>
              <p className="text-xs text-right font-black text-[#0D5C3A] pt-1">
                Calculated Price: {formatMoney(Math.round(weightedModalProduct.base_price_minor * (parseFloat(customWeightInput) || 0)), restaurant?.currency)}
              </p>
            </div>

            <button
              onClick={handleConfirmWeight}
              className="w-full py-2.5 rounded-xl bg-[#0D5C3A] text-white font-bold text-xs hover:bg-[#083D26] shadow-md"
            >
              Add to Cart
            </button>
          </div>
        </div>
      )}

      {/* MODAL 2: Checkout & Tendered Cash / Payment Methods */}
      {showCheckoutModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/50 backdrop-blur-sm animate-fade-in">
          <div className="bg-white border border-[#CBD5E1] rounded-2xl shadow-2xl max-w-md w-full p-5 space-y-4">
            <div className="flex items-center justify-between border-b pb-3">
              <div className="flex items-center gap-2 text-[#0D5C3A]">
                <Banknote className="w-5 h-5" />
                <h3 className="text-sm font-black uppercase tracking-wide">Checkout & Tender</h3>
              </div>
              <button
                onClick={() => setShowCheckoutModal(false)}
                className="p-1 rounded-lg text-gray-500 hover:bg-gray-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Total Display */}
            <div className="bg-[#E6F4EA] border border-[#B7E1CD] rounded-xl p-3 text-center">
              <span className="text-xs font-bold text-[#64748B] uppercase">Net Payable</span>
              <p className="text-2xl sm:text-3xl font-black text-[#0D5C3A]">
                {formatMoney(grandTotalMinor, restaurant?.currency)}
              </p>
            </div>

            {/* Payment Method Selector */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-[#475569]">Select Payment Method:</label>
              <div className="grid grid-cols-3 gap-1.5">
                {[
                  { code: 'cash', label: 'Cash (নগদ)' },
                  { code: 'card', label: 'Card POS' },
                  { code: 'bkash', label: 'bKash' },
                  { code: 'nagad', label: 'Nagad' },
                  { code: 'rocket', label: 'Rocket' },
                  { code: 'due', label: 'Due / Credit' },
                ].map((pm) => (
                  <button
                    key={pm.code}
                    onClick={() => setPaymentMethod(pm.code)}
                    className={`py-2 rounded-xl text-xs font-bold transition-all border ${
                      paymentMethod === pm.code
                        ? 'bg-[#0D5C3A] text-white border-[#0D5C3A] shadow-sm'
                        : 'bg-white text-[#475569] border-[#CBD5E1] hover:bg-[#F1F5F9]'
                    }`}
                  >
                    {pm.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Cash Tendered & Quick Denominations */}
            {paymentMethod === 'cash' && (
              <div className="space-y-2">
                <label className="text-xs font-bold text-[#475569]">Cash Tendered (BDT):</label>
                <input
                  type="number"
                  value={cashTendered}
                  onChange={(e) => setCashTendered(e.target.value)}
                  placeholder={`Exact (${grandTotalMinor / 100})`}
                  className="w-full text-center text-xl font-black font-mono border border-[#CBD5E1] rounded-xl py-2 focus:outline-none focus:border-[#0D5C3A]"
                />
                <div className="flex gap-1.5">
                  {[50, 100, 500, 1000, 2000].map((amt) => (
                    <button
                      key={amt}
                      onClick={() => setCashTendered(amt.toString())}
                      className="flex-1 py-1 rounded bg-[#F1F5F9] text-xs font-bold text-[#0F172A] hover:bg-[#E2E8F0]"
                    >
                      ৳{amt}
                    </button>
                  ))}
                  <button
                    onClick={() => setCashTendered((grandTotalMinor / 100).toString())}
                    className="flex-1 py-1 rounded bg-[#E6F4EA] text-xs font-bold text-[#0D5C3A] hover:bg-[#D1EADB]"
                  >
                    Exact
                  </button>
                </div>
                {cashTendered && parseFloat(cashTendered) * 100 > grandTotalMinor && (
                  <p className="text-xs font-bold text-[#0D5C3A] text-right">
                    Change to Return: {formatMoney(Math.round(parseFloat(cashTendered) * 100 - grandTotalMinor), restaurant?.currency)}
                  </p>
                )}
              </div>
            )}

            {/* Non-cash transaction reference */}
            {paymentMethod !== 'cash' && (
              <div className="space-y-1">
                <label className="text-xs font-bold text-[#475569]">Transaction Ref / Approval Code:</label>
                <input
                  type="text"
                  value={paymentRef}
                  onChange={(e) => setPaymentRef(e.target.value)}
                  placeholder="e.g. TRX-9923841"
                  className="w-full border border-[#CBD5E1] rounded-xl px-3 py-2 text-xs font-mono font-bold focus:outline-none focus:border-[#0D5C3A]"
                />
              </div>
            )}

            <button
              onClick={handleCompleteSale}
              disabled={isSubmitting}
              className="w-full py-3 rounded-xl bg-[#0D5C3A] hover:bg-[#083D26] text-white font-black text-xs sm:text-sm shadow-lg shadow-[#0D5C3A]/25 disabled:opacity-40 transition-all flex items-center justify-center gap-2"
            >
              {isSubmitting ? 'Processing Sale...' : 'Confirm Payment & Print Receipt'}
            </button>
          </div>
        </div>
      )}

      {/* DRAWER: Held Sales */}
      {showHeldSalesDrawer && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-sm animate-fade-in">
          <div className="bg-white w-full max-w-sm h-full shadow-2xl flex flex-col p-4 space-y-3">
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="text-sm font-black text-[#0D5C3A] uppercase tracking-wide">Held Sales Queue</h3>
              <button
                onClick={() => setShowHeldSalesDrawer(false)}
                className="p-1 rounded-lg text-gray-500 hover:bg-gray-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-2">
              {heldSales.length === 0 ? (
                <p className="text-xs text-center text-gray-400 mt-10">No sales on hold</p>
              ) : (
                heldSales.map((h) => {
                  const hTotal = h.cart.reduce((s, c) => s + c.qty * c.unitPriceMinor, 0);
                  return (
                    <div
                      key={h.id}
                      className="border border-[#CBD5E1] rounded-xl p-3 space-y-1.5 hover:border-[#0D5C3A] transition-colors"
                    >
                      <div className="flex justify-between items-center text-xs font-bold">
                        <span>{h.customerName}</span>
                        <span className="text-[#0D5C3A]">{formatMoney(hTotal, restaurant?.currency)}</span>
                      </div>
                      <p className="text-[10px] text-gray-500">
                        {h.cart.length} item(s) • Held at {h.heldAt}
                      </p>
                      <button
                        onClick={() => handleResumeSale(h)}
                        className="w-full py-1.5 rounded-lg bg-[#0D5C3A] text-white text-xs font-bold hover:bg-[#083D26]"
                      >
                        Resume This Sale
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

      {/* MODAL 3: New Customer Quick Add */}
      {showNewCustomerModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-fade-in">
          <form onSubmit={handleCreateCustomer} className="bg-white border rounded-2xl shadow-2xl max-w-sm w-full p-5 space-y-3">
            <div className="flex items-center justify-between border-b pb-2">
              <h3 className="text-xs font-bold text-[#0D5C3A] uppercase tracking-wider">Quick Customer Register</h3>
              <button
                type="button"
                onClick={() => setShowNewCustomerModal(false)}
                className="p-1 rounded text-gray-500 hover:bg-gray-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div>
              <label className="text-[11px] font-bold text-[#475569]">Customer Name:</label>
              <input
                type="text"
                required
                value={newCustName}
                onChange={(e) => setNewCustName(e.target.value)}
                placeholder="Full Name"
                className="w-full border rounded-lg px-2.5 py-1.5 text-xs mt-0.5 focus:outline-none focus:border-[#0D5C3A]"
              />
            </div>
            <div>
              <label className="text-[11px] font-bold text-[#475569]">Phone Number (Required for loyalty):</label>
              <input
                type="tel"
                required
                value={newCustPhone}
                onChange={(e) => setNewCustPhone(e.target.value)}
                placeholder="+8801XXXXXXXXX"
                className="w-full border rounded-lg px-2.5 py-1.5 text-xs mt-0.5 focus:outline-none focus:border-[#0D5C3A]"
              />
            </div>
            <button
              type="submit"
              className="w-full py-2 rounded-xl bg-[#0D5C3A] text-white text-xs font-bold hover:bg-[#083D26]"
            >
              Save Customer & Attach
            </button>
          </form>
        </div>
      )}

      {/* MODAL 4: Return / Refund */}
      {showRefundModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-fade-in">
          <div className="bg-white border rounded-2xl shadow-2xl max-w-sm w-full p-5 space-y-3">
            <div className="flex items-center justify-between border-b pb-2">
              <h3 className="text-xs font-bold text-rose-700 uppercase tracking-wider">Return / Refund Lookup</h3>
              <button
                onClick={() => {
                  setShowRefundModal(false);
                  setRefundMessage('');
                }}
                className="p-1 rounded text-gray-500 hover:bg-gray-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            {refundMessage ? (
              <div className="p-3 bg-green-50 text-green-800 rounded-xl text-xs font-bold text-center">
                {refundMessage}
              </div>
            ) : (
              <>
                <div>
                  <label className="text-[11px] font-bold text-[#475569]">Order # or Invoice #:</label>
                  <input
                    type="text"
                    value={refundInvoiceInput}
                    onChange={(e) => setRefundInvoiceInput(e.target.value)}
                    placeholder="e.g. 3032 or BAN-..."
                    className="w-full border rounded-lg px-2.5 py-1.5 text-xs mt-0.5 focus:outline-none focus:border-rose-600"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-bold text-[#475569]">Return Reason:</label>
                  <select
                    value={refundReason}
                    onChange={(e) => setRefundReason(e.target.value)}
                    className="w-full border rounded-lg px-2.5 py-1.5 text-xs mt-0.5"
                  >
                    <option value="Customer Return">Customer Return (7 Days Policy)</option>
                    <option value="Damaged Item">Damaged / Defective Item</option>
                    <option value="Expired Item">Expired Item</option>
                    <option value="Wrong Item">Wrong Item Scanned</option>
                  </select>
                </div>
                <div className="flex items-center gap-2 pt-1">
                  <input
                    type="checkbox"
                    id="restockCheck"
                    checked={refundRestock}
                    onChange={(e) => setRefundRestock(e.target.checked)}
                    className="rounded text-[#0D5C3A]"
                  />
                  <label htmlFor="restockCheck" className="text-xs font-semibold text-[#475569]">
                    Restock items into store inventory
                  </label>
                </div>
                <button
                  onClick={handleProcessRefund}
                  className="w-full py-2.5 rounded-xl bg-rose-600 text-white text-xs font-bold hover:bg-rose-700 shadow-sm"
                >
                  Process Refund
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Store and fee information */}
      {showShopInfo && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/50 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="shop-info-title"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setShowShopInfo(false);
          }}
        >
          <div className="w-full max-w-md max-h-[calc(100dvh-24px)] overflow-y-auto bg-white rounded-xl shadow-2xl border border-[#E3E6E8]">
            <div className="sticky top-0 bg-white flex items-center justify-between gap-3 px-5 py-4 border-b border-[#E3E6E8]">
              <div>
                <h2 id="shop-info-title" className="text-base font-black text-[#2E3138]">Shop and fee information</h2>
                <p className="text-xs text-[#6B7175] mt-0.5">{activeBranch?.name || restaurant?.name || 'NovaMart Super Shop'}</p>
              </div>
              <button type="button" onClick={() => setShowShopInfo(false)} aria-label="Close shop information" className="w-10 h-10 rounded-full flex items-center justify-center hover:bg-[#F3F4F6]">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5 space-y-5 text-sm">
              <section>
                <h3 className="font-bold text-[#2E3138]">Store details</h3>
                <div className="mt-2 space-y-1.5 text-[#6B7175]">
                  <p>{activeBranch?.address || restaurant?.address || 'Address available during checkout'}</p>
                  {(activeBranch?.phone || restaurant?.phone) && <p>Phone: {activeBranch?.phone || restaurant?.phone}</p>}
                  <p className="text-emerald-700 font-semibold">Open daily · 8:00 AM–11:00 PM</p>
                </div>
              </section>
              <section className="border-t border-[#E3E6E8] pt-4">
                <h3 className="font-bold text-[#2E3138]">Fees and charges</h3>
                <dl className="mt-2 space-y-2 text-[#6B7175]">
                  <div className="flex justify-between gap-4"><dt>Standard delivery</dt><dd className="font-bold text-[#2E3138]">{formatMoney(deliveryFeeMinor, restaurant?.currency)}</dd></div>
                  <div className="flex justify-between gap-4"><dt>Pickup</dt><dd className="font-bold text-emerald-700">Free</dd></div>
                  <div className="flex justify-between gap-4"><dt>VAT</dt><dd className="font-bold text-[#2E3138]">5%</dd></div>
                  <div className="flex justify-between gap-4"><dt>Minimum order</dt><dd className="font-bold text-[#2E3138]">None</dd></div>
                </dl>
              </section>
              <section className="border-t border-[#E3E6E8] pt-4">
                <h3 className="font-bold text-[#2E3138]">Delivery and returns</h3>
                <p className="mt-2 text-[#6B7175] leading-relaxed">Delivery details are confirmed during checkout. Eligible unopened products can be exchanged within 7 days with the original invoice.</p>
              </section>
            </div>
            <div className="sticky bottom-0 bg-white border-t border-[#E3E6E8] p-4">
              <button type="button" onClick={() => setShowShopInfo(false)} className="w-full min-h-[44px] rounded-lg bg-[#E21B70] hover:bg-[#C91661] text-white text-sm font-bold">Got it</button>
            </div>
          </div>
        </div>
      )}

      {/* Receipt Modal (Upon Successful Sale) */}
      {showCameraScanner && (
        <CameraBasketScanner
          onCode={handleCameraCode}
          onClose={() => setShowCameraScanner(false)}
          basketCount={cart.reduce((s, c) => s + c.qty, 0)}
        />
      )}

      {completedOrder && (
        <ReceiptModal
          order={completedOrder}
          restaurant={restaurant}
          branch={activeBranch}
          invoiceNo={receiptInvoiceNo}
          changeDue={receiptChange}
          onClose={() => setCompletedOrder(null)}
          onNewSale={() => {
            setCompletedOrder(null);
            searchInputRef.current?.focus();
          }}
        />
      )}
    </div>
  );
};
