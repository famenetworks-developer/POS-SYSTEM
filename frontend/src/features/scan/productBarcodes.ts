import { api } from '../../lib/api';
import { buildBarcodePdf } from '../../lib/barcodePdf';
import { canEncodeCode128 } from '../../lib/code128';
import { toMajorUnits } from '../../lib/money';
import { MenuItem } from '../../types';

// The code a product is looked up by: its barcode, or its SKU when it has no barcode.
export const productCode = (item: MenuItem): { code: string; kind: 'Barcode' | 'SKU' } | null => {
  const barcode = item.barcode?.trim();
  if (barcode) return { code: barcode, kind: 'Barcode' };
  const sku = item.sku?.trim();
  return sku ? { code: sku, kind: 'SKU' } : null;
};

// Active products, sorted by name.
export const loadActiveProducts = async (): Promise<MenuItem[]> => {
  const rows = await api.get<MenuItem[]>('/items');
  return (rows || []).filter((it) => it.is_active).sort((a, b) => a.name_en.localeCompare(b.name_en));
};

/** Downloads a printable PDF of barcode labels for every active product. Returns how many labels it holds. */
export const downloadAllBarcodes = async (): Promise<number> => {
  const labels = (await loadActiveProducts()).flatMap((it) => {
    const code = productCode(it);
    if (!code || !canEncodeCode128(code.code)) return [];
    const price = `Tk ${toMajorUnits(it.base_price_minor).toFixed(2)}`;
    return [{ name: it.name_en, code: code.code, detail: [it.brand, it.package_size, price].filter(Boolean).join(' - ') }];
  });
  if (!labels.length) return 0;

  const url = URL.createObjectURL(buildBarcodePdf(labels, 'NovaMart - Product barcodes'));
  const link = document.createElement('a');
  link.href = url;
  link.download = `novamart-barcodes-${new Date().toISOString().slice(0, 10)}.pdf`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return labels.length;
};
