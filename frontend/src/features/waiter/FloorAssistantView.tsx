import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { MenuItem as Product } from '../../types';
import { api } from '../../lib/api';
import { formatMoney } from '../../lib/money';
import { Barcode, Package, MapPin } from 'lucide-react';

export const FloorAssistantView: React.FC = () => {
  const { user, restaurant, activeBranch } = useAuth();
  const [query, setQuery] = useState<string>('');
  const [products, setProducts] = useState<Product[]>([]);
  const [scannedProduct, setScannedProduct] = useState<Product | null>(null);
  const [recentLookups, setRecentLookups] = useState<Product[]>([]);

  useEffect(() => {
    api
      .get('/items')
      .then((data) => {
        if (Array.isArray(data)) {
          setProducts(data);
          if (data.length > 0) {
            setRecentLookups(data.slice(0, 5));
          }
        }
      })
      .catch(console.error);
  }, [activeBranch]);

  const handleSearch = (codeOrName: string) => {
    setQuery(codeOrName);
    if (!codeOrName.trim()) {
      setScannedProduct(null);
      return;
    }

    const clean = codeOrName.trim().toLowerCase();
    const found = products.find(
      (p) =>
        (p.barcode && p.barcode.toLowerCase() === clean) ||
        (p.sku && p.sku.toLowerCase() === clean) ||
        p.name_en.toLowerCase().includes(clean) ||
        (p.name_bn && p.name_bn.includes(clean))
    );

    if (found) {
      setScannedProduct(found);
      setRecentLookups((prev) => [found, ...prev.filter((x) => x.id !== found.id)].slice(0, 5));
    }
  };

  return (
    <div className="flex-1 flex flex-col h-[calc(100dvh-4rem)] bg-[#F8FAFC] max-w-lg mx-auto w-full border-x border-[#E2E8F0]">
      {/* Top Header */}
      <div className="p-4 bg-white border-b border-[#E2E8F0] shadow-xs shrink-0 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-[#E6F4EA] text-[#0D5C3A] flex items-center justify-center font-bold">
            <Barcode className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-sm font-black text-[#0F172A]">Aisle Price & Stock Checker</h1>
            <p className="text-[11px] text-[#64748B]">{activeBranch?.name || 'NovaMart Banani Flagship'}</p>
          </div>
        </div>
        <span className="text-xs font-bold text-[#0D5C3A] bg-[#E6F4EA] px-2.5 py-1 rounded-full">
          {user?.name?.split(' ')[0] || 'Associate'}
        </span>
      </div>

      {/* Barcode Input Section */}
      <div className="p-4 bg-white border-b border-[#E2E8F0] space-y-2 shrink-0">
        <label className="text-xs font-extrabold text-[#0F172A] block">
          Scan Barcode or Enter Product Name:
        </label>
        <div className="relative">
          <Barcode className="w-5 h-5 text-[#0D5C3A] absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            autoFocus
            value={query}
            onChange={(e) => handleSearch(e.target.value)}
            placeholder="Scan barcode (e.g. 894110010001) or type..."
            className="w-full bg-[#F8FAFC] border-2 border-[#0D5C3A]/30 focus:border-[#0D5C3A] rounded-2xl pl-10 pr-4 py-3 text-sm font-mono font-bold text-[#0F172A] focus:outline-none shadow-sm"
          />
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {scannedProduct ? (
          <div className="bg-white border-2 border-[#0D5C3A] rounded-3xl p-5 shadow-lg space-y-4">
            <div className="flex items-center justify-between">
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-[#E6F4EA] text-[#0D5C3A]">
                {scannedProduct.category_name || 'Grocery'}
              </span>
              <span className="font-mono text-xs font-bold text-[#64748B]">
                {scannedProduct.barcode || scannedProduct.sku}
              </span>
            </div>

            <div>
              <h2 className="text-lg font-black text-[#0F172A] leading-tight">{scannedProduct.name_en}</h2>
              {scannedProduct.name_bn && (
                <p className="text-sm text-[#64748B] mt-0.5">{scannedProduct.name_bn}</p>
              )}
              <p className="text-xs text-[#0D5C3A] font-bold mt-1">
                {scannedProduct.brand} • {scannedProduct.package_size || '1 pc'}
              </p>
            </div>

            {/* Price Box */}
            <div className="bg-[#E6F4EA] p-4 rounded-2xl border border-[#C6E6D2] flex items-center justify-between">
              <div>
                <span className="text-[11px] font-bold text-[#64748B] uppercase tracking-wider block">
                  Retail Shelf Price
                </span>
                <span className="text-3xl font-black text-[#0D5C3A]">
                  {formatMoney(scannedProduct.base_price_minor, restaurant?.currency)}
                </span>
                <span className="text-[10px] text-[#64748B] block mt-0.5">Includes 5% Super Shop VAT</span>
              </div>

              {(scannedProduct.regular_price_minor ?? scannedProduct.base_price_minor) >
                scannedProduct.base_price_minor && (
                <div className="text-right">
                  <span className="text-xs text-[#94A3B8] line-through block font-bold">
                    {formatMoney(scannedProduct.regular_price_minor || 0, restaurant?.currency)}
                  </span>
                  <span className="px-2 py-0.5 rounded-lg text-xs font-black bg-rose-600 text-white">
                    PROMO DEAL
                  </span>
                </div>
              )}
            </div>

            {/* Shelf Location & Stock */}
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="p-3 bg-[#F8FAFC] rounded-2xl border border-[#E2E8F0]">
                <div className="flex items-center gap-1.5 text-[#64748B] mb-1 font-bold">
                  <MapPin className="w-3.5 h-3.5 text-[#0D5C3A]" />
                  <span>Shelf Location</span>
                </div>
                <div className="text-sm font-black text-[#0F172A]">
                  {scannedProduct.shelf_location || 'Aisle 1, Rack A'}
                </div>
              </div>

              <div className="p-3 bg-[#F8FAFC] rounded-2xl border border-[#E2E8F0]">
                <div className="flex items-center gap-1.5 text-[#64748B] mb-1 font-bold">
                  <Package className="w-3.5 h-3.5 text-[#0D5C3A]" />
                  <span>Branch Stock</span>
                </div>
                <div className="text-sm font-black text-[#0D5C3A]">
                  {scannedProduct.stock_quantity ?? 100} {scannedProduct.unit || 'pcs'}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="text-center py-6 space-y-4">
            <div className="w-16 h-16 rounded-full bg-[#E6F4EA] text-[#0D5C3A] mx-auto flex items-center justify-center">
              <Barcode className="w-8 h-8" />
            </div>
            <div>
              <h3 className="text-sm font-black text-[#0F172A]">Ready to Scan</h3>
              <p className="text-xs text-[#64748B] mt-0.5 max-w-xs mx-auto">
                Scan any supermarket product barcode to immediately check its price, promo discount, and shelf aisle location.
              </p>
            </div>
          </div>
        )}

        {/* Quick Sample Lookups */}
        <div className="space-y-2 pt-2">
          <span className="text-xs font-bold text-[#64748B] uppercase tracking-wider block">
            Popular Items to Check:
          </span>
          <div className="space-y-2">
            {recentLookups.map((p) => (
              <button
                key={p.id}
                onClick={() => handleSearch(p.barcode || p.name_en)}
                className="w-full text-left p-3 rounded-2xl bg-white border border-[#E2E8F0] hover:border-[#0D5C3A]/50 transition-all flex items-center justify-between"
              >
                <div>
                  <h4 className="text-xs font-black text-[#0F172A]">{p.name_en}</h4>
                  <div className="text-[11px] text-[#64748B] font-mono">
                    {p.barcode} • {p.brand}
                  </div>
                </div>
                <span className="text-xs font-black text-[#0D5C3A]">
                  {formatMoney(p.base_price_minor, restaurant?.currency)}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
export default FloorAssistantView;
