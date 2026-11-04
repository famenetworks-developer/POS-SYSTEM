import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { MenuItem as Product, Category } from '../../types';
import { api, API_BASE } from '../../lib/api';
import { formatMoney, toMinorUnits } from '../../lib/money';
import {
  Plus,
  Download,
  ToggleLeft,
  ToggleRight,
  Search,
  Barcode as BarcodeIcon,
  Printer,
  Sparkles,
  Flame,
  Award,
  Scale,
  Package,
  Layers,
  Check,
  X,
  AlertCircle,
  Eye,
} from 'lucide-react';

export const ProductManager: React.FC = () => {
  const { restaurant } = useAuth();
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedCat, setSelectedCat] = useState<string>('all');
  const [selectedFilter, setSelectedFilter] = useState<'all' | 'hot_deal' | 'popular' | 'new_arrival' | 'weighted' | 'low_stock'>('all');
  const [search, setSearch] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // Add Product Modal
  const [showAddModal, setShowAddModal] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [nameEN, setNameEN] = useState<string>('');
  const [nameBN, setNameBN] = useState<string>('');
  const [categoryID, setCategoryID] = useState<string>('');
  const [brand, setBrand] = useState<string>('');
  const [unit, setUnit] = useState<string>('pcs');
  const [packageSize, setPackageSize] = useState<string>('1 pc');
  const [salePriceTaka, setSalePriceTaka] = useState<string>('');
  const [regularPriceTaka, setRegularPriceTaka] = useState<string>('');
  const [costPriceTaka, setCostPriceTaka] = useState<string>('');
  const [barcode, setBarcode] = useState<string>('');
  const [sku, setSku] = useState<string>('');
  const [shelfLocation, setShelfLocation] = useState<string>('');
  const [stockQty, setStockQty] = useState<string>('100');
  const [reorderLevel, setReorderLevel] = useState<string>('15');
  const [isWeighted, setIsWeighted] = useState<boolean>(false);
  const [isHotDeal, setIsHotDeal] = useState<boolean>(false);
  const [isPopular, setIsPopular] = useState<boolean>(false);
  const [isNewArrival, setIsNewArrival] = useState<boolean>(false);

  // Barcode Label Print Modal
  const [labelProduct, setLabelProduct] = useState<Product | null>(null);

  const loadCatalogue = async () => {
    setIsLoading(true);
    try {
      const [cats, items] = await Promise.all([
        api.get('/categories'),
        api.get('/items'),
      ]);
      setCategories(cats || []);
      setProducts(items || []);
      if (cats && cats.length > 0 && !categoryID) {
        setCategoryID(cats[0].id);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadCatalogue();
  }, []);

  const handleToggleAvailability = async (product: Product) => {
    const nextState = !product.is_available;
    try {
      await api.patch(`/items/${product.id}/availability`, { is_available: nextState });
      setProducts((prev) =>
        prev.map((it) => (it.id === product.id ? { ...it, is_available: nextState } : it))
      );
    } catch (e: any) {
      alert('Error updating stock status: ' + e.message);
    }
  };

  const handleCreateProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nameEN || !categoryID || !salePriceTaka) {
      alert('Please fill in required fields (Name, Category, Sale Price)');
      return;
    }

    setIsSubmitting(true);
    try {
      const saleMinor = toMinorUnits(salePriceTaka);
      const regMinor = regularPriceTaka ? toMinorUnits(regularPriceTaka) : saleMinor;
      const costMinor = costPriceTaka ? toMinorUnits(costPriceTaka) : Math.round(saleMinor * 0.75);

      const generatedBarcode = barcode || `894${Math.floor(100000000 + Math.random() * 900000000)}`;
      const generatedSKU = sku || `SKU-${Date.now().toString().slice(-6)}`;

      const payload = {
        name_en: nameEN,
        name_bn: nameBN,
        category_id: categoryID,
        brand: brand || 'NovaMart Essentials',
        unit,
        package_size: packageSize,
        base_price_minor: saleMinor,
        regular_price_minor: regMinor,
        cost_price_minor: costMinor,
        barcode: generatedBarcode,
        sku: generatedSKU,
        shelf_location: shelfLocation || 'Aisle 1',
        stock_quantity: parseFloat(stockQty) || 100,
        reorder_level: parseFloat(reorderLevel) || 15,
        is_weighted: isWeighted,
        is_hot_deal: isHotDeal,
        is_popular: isPopular,
        is_new_arrival: isNewArrival,
        track_stock: true,
      };

      await api.post('/items', payload);
      setShowAddModal(false);
      resetForm();
      await loadCatalogue();
    } catch (e: any) {
      alert('Failed to create product: ' + e.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const resetForm = () => {
    setNameEN('');
    setNameBN('');
    setBrand('');
    setUnit('pcs');
    setPackageSize('1 pc');
    setSalePriceTaka('');
    setRegularPriceTaka('');
    setCostPriceTaka('');
    setBarcode('');
    setSku('');
    setShelfLocation('');
    setStockQty('100');
    setReorderLevel('15');
    setIsWeighted(false);
    setIsHotDeal(false);
    setIsPopular(false);
    setIsNewArrival(false);
  };

  const handleExportCSV = async () => {
    try {
      const token = localStorage.getItem('restoflow_token');
      const response = await fetch(`${API_BASE}/items/export`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!response.ok) throw new Error(`Export failed (${response.status})`);

      const objectUrl = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = 'novamart_products.csv';
      link.click();
      URL.revokeObjectURL(objectUrl);
    } catch (error) {
      console.error('[Products] CSV export failed', error);
    }
  };

  const filteredProducts = products.filter((p) => {
    const matchCat = selectedCat === 'all' || p.category_id === selectedCat;
    const matchSearch =
      !search ||
      p.name_en.toLowerCase().includes(search.toLowerCase()) ||
      (p.name_bn && p.name_bn.includes(search)) ||
      (p.barcode && p.barcode.includes(search)) ||
      (p.sku && p.sku.toLowerCase().includes(search.toLowerCase())) ||
      (p.brand && p.brand.toLowerCase().includes(search.toLowerCase()));

    let matchFilter = true;
    if (selectedFilter === 'hot_deal') matchFilter = !!p.is_hot_deal;
    if (selectedFilter === 'popular') matchFilter = !!p.is_popular;
    if (selectedFilter === 'new_arrival') matchFilter = !!p.is_new_arrival;
    if (selectedFilter === 'weighted') matchFilter = !!p.is_weighted;
    if (selectedFilter === 'low_stock') matchFilter = (p.stock_quantity ?? 100) <= (p.reorder_level ?? 15);

    return matchCat && matchSearch && matchFilter;
  });

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-[10px] font-black uppercase tracking-wider text-[#0D5C3A] bg-[#E6F4EA] px-2 py-0.5 rounded-full">
              Retail Catalogue
            </span>
            <span className="text-xs text-[#64748B]">• {products.length} Products registered</span>
          </div>
          <h1 className="text-xl sm:text-2xl font-black text-[#0F172A]">Products & Grocery Catalogue</h1>
          <p className="text-xs text-[#64748B] mt-0.5">
            Configure barcode tags, package sizes, promotional pricing, margins, and shelf locations
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={handleExportCSV}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white border border-[#E2E8F0] hover:bg-[#F8FAFC] text-xs font-bold text-[#475569] shadow-sm transition-all"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export CSV</span>
          </button>
          <button
            onClick={() => {
              resetForm();
              setShowAddModal(true);
            }}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#0D5C3A] hover:bg-[#0A472D] text-white text-xs font-black shadow-sm transition-all"
          >
            <Plus className="w-4 h-4" />
            <span>Add New Product</span>
          </button>
        </div>
      </div>

      {/* Filter Tabs & Search Controls */}
      <div className="bg-white border border-[#E2E8F0] rounded-2xl p-4 shadow-sm space-y-3">
        {/* Quick Badge Filters */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none text-xs font-bold">
          {[
            { id: 'all', label: 'All Items', icon: Package },
            { id: 'hot_deal', label: 'Hot Deals', icon: Flame, badge: 'Promo' },
            { id: 'popular', label: 'Popular', icon: Award },
            { id: 'new_arrival', label: 'New Arrivals', icon: Sparkles },
            { id: 'weighted', label: 'Scale / Weighted', icon: Scale },
            { id: 'low_stock', label: 'Low Stock Alert', icon: AlertCircle },
          ].map((f) => {
            const Icon = f.icon;
            const active = selectedFilter === f.id;
            return (
              <button
                key={f.id}
                onClick={() => setSelectedFilter(f.id as any)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl whitespace-nowrap transition-all ${
                  active
                    ? 'bg-[#0D5C3A] text-white shadow-sm'
                    : 'bg-[#F1F5F9] text-[#475569] hover:bg-[#E2E8F0]'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{f.label}</span>
                {f.id === 'low_stock' && (
                  <span className="ml-1 px-1.5 py-0.2 rounded-full text-[9px] bg-rose-500 text-white">
                    {products.filter((p) => (p.stock_quantity ?? 100) <= (p.reorder_level ?? 15)).length}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Search Bar & Department Selector */}
        <div className="flex flex-col sm:flex-row items-center gap-3">
          <div className="relative flex-1 w-full">
            <Search className="w-4 h-4 text-[#94A3B8] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by Barcode (e.g. 89411001...), SKU, Brand (Teer, Fresh), or English / Bangla name..."
              aria-label="Search products"
              className="w-full bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl pl-9 pr-4 py-2 text-xs text-[#0F172A] placeholder-[#94A3B8] focus:outline-none focus:ring-2 focus:ring-[#0D5C3A]"
            />
          </div>

          <div className="w-full sm:w-64">
            <select
              value={selectedCat}
              onChange={(e) => setSelectedCat(e.target.value)}
              className="w-full bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl px-3 py-2 text-xs text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-[#0D5C3A]"
            >
              <option value="all">All Departments ({categories.length} Categories)</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name_en} {c.name_bn ? `(${c.name_bn})` : ''}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Product List Table */}
      <div className="bg-white border border-[#E2E8F0] rounded-2xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs min-w-[900px]">
            <thead className="bg-[#F8FAFC] text-[#64748B] font-bold border-b border-[#E2E8F0]">
              <tr>
                <th className="py-3 px-4">Product & Brand</th>
                <th className="py-3 px-4">Barcode / SKU</th>
                <th className="py-3 px-4">Category</th>
                <th className="py-3 px-4">Package & Unit</th>
                <th className="py-3 px-4">Selling Price</th>
                <th className="py-3 px-4">Cost & Margin</th>
                <th className="py-3 px-4">Stock Level</th>
                <th className="py-3 px-4">Shelf / Aisle</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F1F5F9] text-[#0F172A]">
              {filteredProducts.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-8 text-center text-[#94A3B8] text-xs">
                    No products matched your search or department filter.
                  </td>
                </tr>
              ) : (
                filteredProducts.map((p) => {
                  const hasDiscount = (p.regular_price_minor ?? p.base_price_minor) > p.base_price_minor;
                  const discountPct = hasDiscount
                    ? Math.round(
                        (((p.regular_price_minor ?? p.base_price_minor) - p.base_price_minor) /
                          (p.regular_price_minor ?? p.base_price_minor)) *
                          100
                      )
                    : 0;

                  const costMinor = p.cost_price_minor || Math.round(p.base_price_minor * 0.75);
                  const marginPct =
                    p.base_price_minor > 0
                      ? Math.round(((p.base_price_minor - costMinor) / p.base_price_minor) * 100)
                      : 0;

                  const isLow = (p.stock_quantity ?? 100) <= (p.reorder_level ?? 15);

                  return (
                    <tr key={p.id} className="hover:bg-[#F8FAFC] transition-colors">
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2.5">
                          <div className="w-9 h-9 rounded-xl bg-[#E6F4EA] text-[#0D5C3A] font-bold flex items-center justify-center shrink-0 border border-[#C6E6D2]">
                            <Package className="w-4 h-4" />
                          </div>
                          <div>
                            <div className="font-extrabold text-[#0F172A] flex items-center gap-1.5">
                              <span>{p.name_en}</span>
                              {p.is_hot_deal && (
                                <span className="px-1.5 py-0.2 rounded text-[9px] font-black bg-rose-100 text-rose-700">
                                  HOT
                                </span>
                              )}
                              {p.is_weighted && (
                                <span className="px-1.5 py-0.2 rounded text-[9px] font-black bg-emerald-100 text-[#0D5C3A]">
                                  KG
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-[#64748B] flex items-center gap-1.5">
                              {p.name_bn && <span>{p.name_bn}</span>}
                              {p.brand && <span className="text-[#0D5C3A] font-bold">• {p.brand}</span>}
                            </div>
                          </div>
                        </div>
                      </td>

                      <td className="py-3 px-4">
                        <div className="font-mono text-xs font-bold text-[#0F172A]">
                          {p.barcode || '—'}
                        </div>
                        <div className="text-[10px] text-[#94A3B8] font-mono">{p.sku || 'No SKU'}</div>
                      </td>

                      <td className="py-3 px-4">
                        <span className="px-2 py-0.5 rounded-lg text-[10px] font-bold bg-[#F1F5F9] text-[#475569] border border-[#E2E8F0]">
                          {p.category_name || 'General'}
                        </span>
                      </td>

                      <td className="py-3 px-4">
                        <span className="font-semibold text-xs text-[#0F172A]">{p.package_size || '1 pc'}</span>
                        <div className="text-[10px] text-[#64748B]">Unit: {p.unit || 'pcs'}</div>
                      </td>

                      <td className="py-3 px-4">
                        <div className="font-black text-xs text-[#0D5C3A]">
                          {formatMoney(p.base_price_minor, restaurant?.currency)}
                        </div>
                        {hasDiscount && (
                          <div className="flex items-center gap-1 text-[10px]">
                            <span className="text-[#94A3B8] line-through">
                              {formatMoney(p.regular_price_minor || 0, restaurant?.currency)}
                            </span>
                            <span className="text-rose-600 font-bold">-{discountPct}%</span>
                          </div>
                        )}
                      </td>

                      <td className="py-3 px-4">
                        <div className="text-xs text-[#64748B]">{formatMoney(costMinor, restaurant?.currency)}</div>
                        <span className="text-[10px] font-bold text-emerald-700">{marginPct}% margin</span>
                      </td>

                      <td className="py-3 px-4">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-extrabold ${
                            isLow
                              ? 'bg-rose-50 text-rose-700 border border-rose-200'
                              : 'bg-emerald-50 text-[#0D5C3A] border border-emerald-200'
                          }`}
                        >
                          {p.stock_quantity ?? 100} {p.unit || 'pcs'}
                        </span>
                        {isLow && (
                          <div className="text-[9px] text-rose-600 font-bold mt-0.5">Reorder &lt; {p.reorder_level}</div>
                        )}
                      </td>

                      <td className="py-3 px-4 text-[#475569] text-xs font-semibold">
                        {p.shelf_location || 'Aisle 1'}
                      </td>

                      <td className="py-3 px-4">
                        <button
                          onClick={() => handleToggleAvailability(p)}
                          className="flex items-center gap-1 text-xs font-bold transition-all"
                        >
                          {p.is_available ? (
                            <span className="flex items-center gap-1 text-[#0D5C3A]">
                              <ToggleRight className="w-5 h-5 text-[#0D5C3A]" /> In Stock
                            </span>
                          ) : (
                            <span className="flex items-center gap-1 text-rose-600">
                              <ToggleLeft className="w-5 h-5 text-rose-400" /> Out of Stock
                            </span>
                          )}
                        </button>
                      </td>

                      <td className="py-3 px-4 text-right">
                        <button
                          onClick={() => setLabelProduct(p)}
                          title="Print Barcode Shelf Label"
                          className="p-1.5 rounded-lg bg-[#F1F5F9] hover:bg-[#E6F4EA] text-[#475569] hover:text-[#0D5C3A] transition-all inline-flex items-center gap-1 text-[11px] font-bold"
                        >
                          <BarcodeIcon className="w-3.5 h-3.5" />
                          <span>Label</span>
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal: Add New Retail Product */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-2xl w-full p-6 shadow-2xl space-y-4 my-8">
            <div className="flex items-center justify-between pb-3 border-b border-[#E2E8F0]">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-[#E6F4EA] text-[#0D5C3A] flex items-center justify-center font-bold">
                  <Plus className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-base font-black text-[#0F172A]">Add Super Shop Retail Product</h3>
                  <p className="text-xs text-[#64748B]">Complete product attributes, pricing, barcode, and inventory</p>
                </div>
              </div>
              <button
                onClick={() => setShowAddModal(false)}
                className="p-1 rounded-lg hover:bg-[#F1F5F9] text-[#64748B]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateProduct} className="space-y-4">
              {/* Names */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-[#0F172A] block mb-1">Product Name (English) *</label>
                  <input
                    type="text"
                    required
                    value={nameEN}
                    onChange={(e) => setNameEN(e.target.value)}
                    placeholder="e.g. Teer Fortified Soybean Oil"
                    className="w-full bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl px-3 py-2 text-xs text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-[#0D5C3A]"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-[#0F172A] block mb-1">Product Name (Bangla)</label>
                  <input
                    type="text"
                    value={nameBN}
                    onChange={(e) => setNameBN(e.target.value)}
                    placeholder="যেমন: তীর ফর্টিফাইড সয়াবিন তেল"
                    className="w-full bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl px-3 py-2 text-xs text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-[#0D5C3A]"
                  />
                </div>
              </div>

              {/* Category, Brand, Package Size */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="text-xs font-bold text-[#0F172A] block mb-1">Category / Department *</label>
                  <select
                    value={categoryID}
                    onChange={(e) => setCategoryID(e.target.value)}
                    className="w-full bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl px-3 py-2 text-xs text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-[#0D5C3A]"
                  >
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name_en}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-bold text-[#0F172A] block mb-1">Brand Name</label>
                  <input
                    type="text"
                    value={brand}
                    onChange={(e) => setBrand(e.target.value)}
                    placeholder="e.g. Teer, Fresh, Aarong"
                    className="w-full bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl px-3 py-2 text-xs text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-[#0D5C3A]"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-[#0F172A] block mb-1">Package Size</label>
                  <input
                    type="text"
                    value={packageSize}
                    onChange={(e) => setPackageSize(e.target.value)}
                    placeholder="e.g. 5 Ltr, 1 Kg, 500 gm"
                    className="w-full bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl px-3 py-2 text-xs text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-[#0D5C3A]"
                  />
                </div>
              </div>

              {/* Unit & Barcode */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="text-xs font-bold text-[#0F172A] block mb-1">Measure Unit</label>
                  <select
                    value={unit}
                    onChange={(e) => setUnit(e.target.value)}
                    className="w-full bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl px-3 py-2 text-xs text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-[#0D5C3A]"
                  >
                    <option value="pcs">Pieces (pcs)</option>
                    <option value="kg">Kilogram (kg)</option>
                    <option value="gm">Gram (gm)</option>
                    <option value="ltr">Liter (ltr)</option>
                    <option value="ml">Milliliter (ml)</option>
                    <option value="pack">Pack</option>
                    <option value="box">Box</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs font-bold text-[#0F172A] block mb-1">Barcode (EAN-13)</label>
                  <input
                    type="text"
                    value={barcode}
                    onChange={(e) => setBarcode(e.target.value)}
                    placeholder="Auto-generated if empty"
                    className="w-full bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl px-3 py-2 text-xs text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-[#0D5C3A]"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-[#0F172A] block mb-1">SKU Code</label>
                  <input
                    type="text"
                    value={sku}
                    onChange={(e) => setSku(e.target.value)}
                    placeholder="e.g. OIL-TEER-5L"
                    className="w-full bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl px-3 py-2 text-xs text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-[#0D5C3A]"
                  />
                </div>
              </div>

              {/* Pricing (Sale, Regular, Cost) */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-3 bg-[#F8FAFC] rounded-xl border border-[#E2E8F0]">
                <div>
                  <label className="text-xs font-bold text-[#0D5C3A] block mb-1">Sale Price (BDT ৳) *</label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    value={salePriceTaka}
                    onChange={(e) => setSalePriceTaka(e.target.value)}
                    placeholder="e.g. 910"
                    className="w-full bg-white border border-[#CBD5E1] rounded-xl px-3 py-2 text-xs font-bold text-[#0D5C3A] focus:outline-none focus:ring-2 focus:ring-[#0D5C3A]"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-[#64748B] block mb-1">Regular MRP (৳)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={regularPriceTaka}
                    onChange={(e) => setRegularPriceTaka(e.target.value)}
                    placeholder="Leave empty if no discount"
                    className="w-full bg-white border border-[#CBD5E1] rounded-xl px-3 py-2 text-xs text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-[#0D5C3A]"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-[#64748B] block mb-1">Cost Price (৳)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={costPriceTaka}
                    onChange={(e) => setCostPriceTaka(e.target.value)}
                    placeholder="Purchase cost"
                    className="w-full bg-white border border-[#CBD5E1] rounded-xl px-3 py-2 text-xs text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-[#0D5C3A]"
                  />
                </div>
              </div>

              {/* Stock & Shelf */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="text-xs font-bold text-[#0F172A] block mb-1">Initial Stock Qty</label>
                  <input
                    type="number"
                    step="any"
                    value={stockQty}
                    onChange={(e) => setStockQty(e.target.value)}
                    className="w-full bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl px-3 py-2 text-xs text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-[#0D5C3A]"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-[#0F172A] block mb-1">Reorder Point</label>
                  <input
                    type="number"
                    step="any"
                    value={reorderLevel}
                    onChange={(e) => setReorderLevel(e.target.value)}
                    className="w-full bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl px-3 py-2 text-xs text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-[#0D5C3A]"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-[#0F172A] block mb-1">Shelf / Aisle Location</label>
                  <input
                    type="text"
                    value={shelfLocation}
                    onChange={(e) => setShelfLocation(e.target.value)}
                    placeholder="e.g. Aisle 3, Rack B"
                    className="w-full bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl px-3 py-2 text-xs text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-[#0D5C3A]"
                  />
                </div>
              </div>

              {/* Badges / Checkboxes */}
              <div className="flex flex-wrap gap-4 pt-2">
                <label className="flex items-center gap-2 text-xs font-bold text-[#0F172A] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isWeighted}
                    onChange={(e) => setIsWeighted(e.target.checked)}
                    className="rounded text-[#0D5C3A] focus:ring-[#0D5C3A]"
                  />
                  <span>Weighted Product (Scale decimal kg)</span>
                </label>
                <label className="flex items-center gap-2 text-xs font-bold text-[#0F172A] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isHotDeal}
                    onChange={(e) => setIsHotDeal(e.target.checked)}
                    className="rounded text-rose-600 focus:ring-rose-500"
                  />
                  <span>Hot Deal Badge</span>
                </label>
                <label className="flex items-center gap-2 text-xs font-bold text-[#0F172A] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isPopular}
                    onChange={(e) => setIsPopular(e.target.checked)}
                    className="rounded text-amber-600 focus:ring-amber-500"
                  />
                  <span>Popular Item</span>
                </label>
                <label className="flex items-center gap-2 text-xs font-bold text-[#0F172A] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isNewArrival}
                    onChange={(e) => setIsNewArrival(e.target.checked)}
                    className="rounded text-emerald-600 focus:ring-emerald-500"
                  />
                  <span>New Arrival</span>
                </label>
              </div>

              {/* Actions */}
              <div className="flex justify-end gap-2.5 pt-3 border-t border-[#E2E8F0]">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 rounded-xl border border-[#CBD5E1] text-xs font-bold text-[#64748B] hover:bg-[#F1F5F9]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-5 py-2 rounded-xl bg-[#0D5C3A] hover:bg-[#0A472D] text-white text-xs font-black shadow-sm disabled:opacity-50"
                >
                  {isSubmitting ? 'Saving...' : 'Save Product to Catalogue'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Printable Barcode Shelf Tag */}
      {labelProduct && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-sm w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-[#E2E8F0]">
              <div className="flex items-center gap-2">
                <BarcodeIcon className="w-5 h-5 text-[#0D5C3A]" />
                <h3 className="text-sm font-black text-[#0F172A]">Barcode Shelf Tag</h3>
              </div>
              <button
                onClick={() => setLabelProduct(null)}
                className="p-1 rounded-lg hover:bg-[#F1F5F9] text-[#64748B]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Shelf Tag Preview */}
            <div className="border-2 border-dashed border-[#0D5C3A] rounded-xl p-4 text-center bg-[#FAFBF9] space-y-2">
              <div className="text-[10px] font-black uppercase tracking-wider text-[#0D5C3A]">NovaMart Super Shop</div>
              <h4 className="font-extrabold text-sm text-[#0F172A] leading-tight">{labelProduct.name_en}</h4>
              {labelProduct.name_bn && (
                <p className="text-xs text-[#64748B]">{labelProduct.name_bn}</p>
              )}
              <div className="text-xs text-[#475569] font-medium">
                {labelProduct.brand || 'NovaMart'} • {labelProduct.package_size || '1 pc'}
              </div>

              {/* Price Banner */}
              <div className="py-2 bg-[#E6F4EA] rounded-lg border border-[#C6E6D2]">
                <span className="text-xs font-bold text-[#64748B] block">Retail Price:</span>
                <span className="text-2xl font-black text-[#0D5C3A]">
                  {formatMoney(labelProduct.base_price_minor, restaurant?.currency)}
                </span>
                <span className="text-[10px] text-[#64748B] block mt-0.5">(Includes 5% Super Shop VAT)</span>
              </div>

              {/* Barcode Visual */}
              <div className="pt-2 flex flex-col items-center">
                <div className="h-12 w-48 bg-gradient-to-r from-black via-white to-black flex items-center justify-center font-mono text-[9px] tracking-[4px] bg-repeat-x border border-slate-300">
                  ||||| | |||| ||| |||||
                </div>
                <span className="font-mono text-xs font-extrabold tracking-widest text-[#0F172A] mt-1">
                  {labelProduct.barcode || '894110010001'}
                </span>
                <span className="text-[9px] text-[#64748B] font-mono">Location: {labelProduct.shelf_location || 'Aisle 1'}</span>
              </div>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => setLabelProduct(null)}
                className="flex-1 py-2 rounded-xl border border-[#CBD5E1] text-xs font-bold text-[#64748B]"
              >
                Close
              </button>
              <button
                onClick={() => {
                  window.print();
                }}
                className="flex-1 py-2 rounded-xl bg-[#0D5C3A] hover:bg-[#0A472D] text-white text-xs font-black flex items-center justify-center gap-1.5 shadow-sm"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>Print Tag</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
export default ProductManager;
