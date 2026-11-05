import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { api, ApiError } from '../../lib/api';
import { BarcodeCamera, DetectedBarcode, listCameras, startBarcodeCamera } from '../../lib/barcodeCamera';
import { formatMoney } from '../../lib/money';
import { wsHub } from '../../lib/ws';
import { getProductImage } from '../../lib/productImages';
import { MenuItem, ScanLogEntry } from '../../types';
import { ScanActivityLog } from './ScanActivityLog';
import { CodeLookupBox } from './CodeLookupBox';
import { BarcodeCatalogPanel } from './BarcodeCatalogPanel';
import { downloadAllBarcodes } from './productBarcodes';
import {
  Barcode,
  Camera,
  CameraOff,
  Check,
  Copy,
  Download,
  MapPin,
  Package,
  ScanBarcode,
  TriangleAlert,
  X,
} from 'lucide-react';

// After a successful read the camera stays open this long before closing.
const CAMERA_CLOSE_DELAY_MS = 3000;
// The camera must read the same value this many times in a row before it is accepted,
// which filters out partial misreads (e.g. a fragment of a long barcode read as EAN-8).
const REQUIRED_MATCHING_READS = 2;
// Codes that cannot be a product barcode or SKU (e.g. URLs in QR codes) are shown without a product lookup.
const MAX_PRODUCT_CODE_LENGTH = 64;

type LookupState =
  | { status: 'idle' }
  | { status: 'loading'; scan: DetectedBarcode }
  | { status: 'found'; scan: DetectedBarcode; item: MenuItem }
  | { status: 'not_found'; scan: DetectedBarcode }
  | { status: 'error'; scan: DetectedBarcode; message: string };

interface ToastState {
  kind: 'success' | 'error';
  message: string;
}

const TOAST_DURATION_MS = 2500;
const ACTIVITY_LIMIT = 50;

const isProductCode = (code: string) => code.length <= MAX_PRODUCT_CODE_LENGTH && !/[\s/]/.test(code);

const cameraErrorMessage = (err: unknown): string => {
  const name = (err as { name?: string })?.name;
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    return 'Camera access needs a secure connection. Open this page over HTTPS (or on localhost) to scan with the camera.';
  }
  if (name === 'NotAllowedError') return 'Camera permission was denied. Allow camera access in your browser settings and try again.';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No camera was found on this device.';
  if (name === 'NotReadableError') return 'The camera is being used by another app. Close it and try again.';
  return 'Could not start the camera.';
};

export const BarcodeScanView: React.FC = () => {
  const { user, restaurant, activeBranch } = useAuth();
  const videoRef = useRef<HTMLVideoElement>(null);
  const cameraRef = useRef<BarcodeCamera | null>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [cameraOn, setCameraOn] = useState(false);
  const [codeRead, setCodeRead] = useState(false);
  const [cameraStarting, setCameraStarting] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState('');
  const [lookup, setLookup] = useState<LookupState>({ status: 'idle' });
  const [toast, setToast] = useState<ToastState | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [popupItem, setPopupItem] = useState<MenuItem | null>(null);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const closePopup = useCallback(() => setPopupItem(null), []);
  const branchId = activeBranch?.id || '';
  const [activity, setActivity] = useState<ScanLogEntry[]>([]);
  const [activityLoading, setActivityLoading] = useState(true);
  const [activityError, setActivityError] = useState('');

  const loadActivity = useCallback(async () => {
    try {
      setActivity(await api.get<ScanLogEntry[]>(`/scans?limit=${ACTIVITY_LIMIT}`));
      setActivityError('');
    } catch {
      setActivityError('Could not load scan activity.');
    } finally {
      setActivityLoading(false);
    }
  }, []);

  const addActivity = useCallback((entry: ScanLogEntry) => {
    setActivity((prev) => [entry, ...prev.filter((e) => e.id !== entry.id)].slice(0, ACTIVITY_LIMIT));
  }, []);

  // Live updates: the server pushes each new scan over the WebSocket. The list is
  // reloaded only when the connection (re)opens, to pick up anything missed while offline.
  const [liveConnected, setLiveConnected] = useState(wsHub.isConnected());
  useEffect(() => {
    void loadActivity();
    wsHub.connect(branchId);
    const offScan = wsHub.subscribe('scan.logged', (entry: ScanLogEntry) => addActivity(entry));
    const offStatus = wsHub.subscribe('connection', (connected: boolean) => {
      setLiveConnected(connected);
      if (connected) void loadActivity();
    });
    return () => {
      offScan();
      offStatus();
    };
  }, [branchId, loadActivity, addActivity]);

  // The server stores the scan and fills in the product name and price itself.
  const recordScan = useCallback(async (scan: DetectedBarcode, item?: MenuItem) => {
    try {
      const entry = await api.post<ScanLogEntry>('/scans', {
        code: scan.text,
        format: scan.format,
        branch_id: branchId,
        product_id: item?.id || '',
      });
      addActivity(entry);
    } catch {
      // Logging must never block scanning.
    }
  }, [branchId, addActivity]);

  const showToast = useCallback((kind: ToastState['kind'], message: string) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast({ kind, message });
    toastTimerRef.current = setTimeout(() => setToast(null), TOAST_DURATION_MS);
  }, []);

  useEffect(() => () => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
  }, []);

  const lookupCode = useCallback(async (scan: DetectedBarcode) => {
    const text = scan.text.trim();
    if (!text) return;
    scan = { ...scan, text };
    navigator.vibrate?.(60);

    if (!isProductCode(text)) {
      setLookup({ status: 'not_found', scan });
      showToast('error', 'Scanned, but this is not a product code');
      void recordScan(scan);
      return;
    }

    setLookup({ status: 'loading', scan });
    try {
      const item = await api.get<MenuItem>(`/items/barcode/${encodeURIComponent(text)}`);
      setLookup({ status: 'found', scan, item });
      setPopupItem(item);
      showToast('success', 'Scan successful · product found');
      void recordScan(scan, item);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'NOT_FOUND') {
        setLookup({ status: 'not_found', scan });
        showToast('error', 'Scanned, but no product has this code');
        void recordScan(scan);
      } else {
        setLookup({ status: 'error', scan, message: (err as Error).message || 'Lookup failed' });
        showToast('error', 'Scan failed · could not look up the product');
      }
    }
  }, [showToast, recordScan]);

  const stopCamera = useCallback(() => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    closeTimerRef.current = null;
    cameraRef.current?.stop();
    cameraRef.current = null;
    setCameraOn(false);
    setCodeRead(false);
  }, []);

  const startCamera = useCallback(async (selectedDeviceId?: string) => {
    setCameraError('');
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setCameraError(cameraErrorMessage(null));
      return;
    }

    stopCamera();
    setCameraStarting(true);
    try {
      // On the first successful read, show the result right away, keep the camera
      // open for CAMERA_CLOSE_DELAY_MS, then close it and bring the result into view.
      let detected = false;
      let candidate = '';
      let matchingReads = 0;
      const camera = await startBarcodeCamera(
        videoRef.current!,
        (scan) => {
          if (detected) return;
          matchingReads = scan.text === candidate ? matchingReads + 1 : 1;
          candidate = scan.text;
          if (matchingReads < REQUIRED_MATCHING_READS) return;
          detected = true;
          setCodeRead(true);
          void lookupCode(scan);
          closeTimerRef.current = setTimeout(() => {
            stopCamera();
            resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }, CAMERA_CLOSE_DELAY_MS);
        },
        selectedDeviceId
      );
      cameraRef.current = camera;
      setCameraOn(true);

      // Device labels are only available after permission has been granted.
      setDevices(await listCameras());
    } catch (err) {
      setCameraError(cameraErrorMessage(err));
      setCameraOn(false);
    } finally {
      setCameraStarting(false);
    }
  }, [lookupCode, stopCamera]);

  useEffect(() => stopCamera, [stopCamera]);

  const closeCatalog = useCallback(() => setCatalogOpen(false), []);

  const handleDownloadBarcodes = async () => {
    setDownloading(true);
    try {
      const count = await downloadAllBarcodes();
      if (count) showToast('success', `Downloaded barcodes for ${count} products`);
      else showToast('error', 'No products with a barcode to download');
    } catch {
      showToast('error', 'Could not download barcodes');
    } finally {
      setDownloading(false);
    }
  };

  const handleDeviceChange = (id: string) => {
    setDeviceId(id);
    if (cameraOn) void startCamera(id || undefined);
  };

  return (
    // While the barcode panel is open on a wide screen, the page makes room for it on the right.
    <div className={`transition-[padding] duration-300 ease-out ${catalogOpen ? 'xl:pr-[420px]' : ''}`}>
    <main className="max-w-[1200px] w-full mx-auto px-3 sm:px-6 py-5 sm:py-8">
      <div className="flex items-center gap-3 mb-5">
        <div className="w-10 h-10 rounded-lg bg-[#FFF0F6] text-[#E21B70] flex items-center justify-center shrink-0">
          <ScanBarcode className="w-5 h-5" />
        </div>
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold text-[#0F172A]">Scan barcode</h1>
          <p className="text-xs text-[#64748B] truncate">
            {activeBranch?.name || restaurant?.name || 'NovaMart'} · Scan any barcode or QR code · Products show price, stock and shelf
          </p>
        </div>
        {restaurant && (
          <div className="ml-auto flex shrink-0 flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={() => void handleDownloadBarcodes()}
            disabled={downloading}
            title="Download a printable PDF with the barcodes of all products"
            className="inline-flex shrink-0 items-center gap-2 min-h-[40px] px-3 sm:px-4 rounded-lg bg-[#E21B70] hover:bg-[#C91661] text-white text-xs font-bold disabled:opacity-60 disabled:cursor-wait"
          >
            <Download className="w-4 h-4" /> {downloading ? 'Preparing…' : 'Download Barcodes'}
          </button>
          <button
            type="button"
            onClick={() => setCatalogOpen((v) => !v)}
            aria-expanded={catalogOpen}
            className="inline-flex shrink-0 items-center gap-2 min-h-[40px] px-3 sm:px-4 rounded-lg border border-[#E21B70] text-[#E21B70] text-xs font-bold hover:bg-[#FFF0F6]"
          >
            <Barcode className="w-4 h-4" /> See barcodes
          </button>
          </div>
        )}
      </div>

      {!restaurant && (
        <div className="mb-5 flex gap-2.5 items-start rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-xs text-amber-900">
          <TriangleAlert className="w-4 h-4 shrink-0 mt-0.5" />
          <span>
            This account is not linked to a store, so no products can be found. Sign in with a store account
            (for example a cashier) to look up products.
          </span>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {/* Scanner */}
        <section className="space-y-4">
          <div className="rounded-2xl border border-[#E3E6E8] bg-white p-4 shadow-sm">
            <div className="relative aspect-[4/3] w-full overflow-hidden rounded-xl bg-[#0F172A]">
              <video ref={videoRef} className={`h-full w-full object-cover ${cameraOn ? '' : 'invisible'}`} muted playsInline />
              {cameraOn ? (
                <>
                  <div
                    className={`pointer-events-none absolute inset-x-[10%] inset-y-[18%] rounded-lg border-2 shadow-[0_0_0_9999px_rgba(15,23,42,0.35)] ${
                      codeRead ? 'border-[#22C55E]' : 'border-white/80'
                    }`}
                  />
                  {codeRead && (
                    <div className="absolute inset-x-0 bottom-3 flex justify-center">
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-[#0D5C3A] px-3 py-1.5 text-xs font-bold text-white shadow">
                        <Check className="w-3.5 h-3.5" /> Code read · closing camera…
                      </span>
                    </div>
                  )}
                </>
              ) : (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center text-white/80">
                  <Camera className="w-10 h-10" />
                  <p className="text-sm font-semibold">Use this device's camera to scan</p>
                  <p className="text-xs text-white/60">On a phone, open this page and point the rear camera at any barcode or QR code.</p>
                </div>
              )}
            </div>

            {cameraError && (
              <p role="alert" className="mt-3 rounded-lg bg-rose-50 border border-rose-200 px-3 py-2 text-xs text-rose-800">
                {cameraError}
              </p>
            )}

            <div className="mt-3 flex flex-wrap items-center gap-2">
              {cameraOn ? (
                <button
                  type="button"
                  onClick={stopCamera}
                  className="inline-flex items-center gap-2 min-h-[40px] px-4 rounded-lg border border-[#2E3138] text-xs font-bold hover:bg-[#F7F7F7]"
                >
                  <CameraOff className="w-4 h-4" /> Stop camera
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void startCamera(deviceId || undefined)}
                  disabled={cameraStarting}
                  className="inline-flex items-center gap-2 min-h-[40px] px-4 rounded-lg bg-[#E21B70] hover:bg-[#C91661] text-white text-xs font-bold disabled:opacity-60 disabled:cursor-wait"
                >
                  <Camera className="w-4 h-4" /> {cameraStarting ? 'Starting camera…' : lookup.status === 'idle' ? 'Scan with camera' : 'Scan again'}
                </button>
              )}

              {devices.length > 1 && (
                <select
                  value={deviceId}
                  onChange={(e) => handleDeviceChange(e.target.value)}
                  aria-label="Camera"
                  className="min-h-[40px] max-w-full flex-1 rounded-lg border border-[#CBD5E1] bg-white px-3 text-xs"
                >
                  <option value="">Rear camera (default)</option>
                  {devices.map((d, i) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label || `Camera ${i + 1}`}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>

          <CodeLookupBox onLookup={(code) => void lookupCode({ text: code, format: 'Typed' })} />
        </section>

        {/* Result */}
        <section className="space-y-4">
          <div ref={resultRef} className="scroll-mt-28 rounded-2xl border border-[#E3E6E8] bg-white p-4 shadow-sm min-h-[220px]" aria-live="polite">
            {lookup.status === 'idle' && (
              <div className="h-full min-h-[190px] flex flex-col items-center justify-center text-center text-[#64748B]">
                <ScanBarcode className="w-10 h-10 mb-2 text-[#CBD5E1]" />
                <p className="text-sm font-semibold">Nothing scanned yet</p>
                <p className="text-xs">Scan or type a code to see it here.</p>
              </div>
            )}
            {lookup.status !== 'idle' && <ScannedCode scan={lookup.scan} />}
            {lookup.status === 'loading' && (
              <div className="min-h-[120px] flex items-center justify-center text-sm text-[#64748B]">Looking up product…</div>
            )}
            {lookup.status === 'not_found' && (
              <div className="min-h-[120px] flex flex-col items-center justify-center text-center">
                <Package className="w-10 h-10 mb-2 text-[#CBD5E1]" />
                <p className="text-sm font-bold text-[#0F172A]">Not a product in this store</p>
                <p className="text-xs text-[#64748B] mt-1">The code was read, but no product has this barcode or SKU.</p>
              </div>
            )}
            {lookup.status === 'error' && (
              <div role="alert" className="min-h-[120px] flex flex-col items-center justify-center text-center text-rose-800">
                <TriangleAlert className="w-8 h-8 mb-2" />
                <p className="text-sm font-bold">Lookup failed</p>
                <p className="text-xs mt-1">{lookup.message}</p>
              </div>
            )}
            {lookup.status === 'found' && <ProductDetails item={lookup.item} />}
          </div>

          <ScanActivityLog
            entries={activity}
            loading={activityLoading}
            error={activityError}
            showUser={user?.role === 'super_admin'}
            live={liveConnected}
          />
        </section>
      </div>

      {toast && (
        <div
          role="status"
          className={`fixed left-1/2 top-24 z-[60] -translate-x-1/2 inline-flex max-w-[90vw] items-center gap-2 rounded-full px-4 py-2.5 text-sm font-bold text-white shadow-lg ${
            toast.kind === 'success' ? 'bg-[#0D5C3A]' : 'bg-[#DC2626]'
          }`}
        >
          {toast.kind === 'success' ? <Check className="w-4 h-4 shrink-0" /> : <TriangleAlert className="w-4 h-4 shrink-0" />}
          <span>{toast.message}</span>
        </div>
      )}

      {popupItem && (
        <ProductPopup
          item={popupItem}
          onClose={closePopup}
          onScanNext={() => {
            setPopupItem(null);
            void startCamera(deviceId || undefined);
          }}
        />
      )}
    </main>
    <BarcodeCatalogPanel open={catalogOpen} onClose={closeCatalog} />
    </div>
  );
};

const ProductPopup: React.FC<{ item: MenuItem; onClose: () => void; onScanNext: () => void }> = ({ item, onClose, onScanNext }) => {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-[#0F172A]/60 sm:p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={item.name_en}
        onClick={(e) => e.stopPropagation()}
        className="relative w-full sm:max-w-md max-h-[92vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl bg-white p-4 sm:p-5 shadow-2xl"
      >
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-3 top-3 z-10 rounded-full bg-white/90 p-2 text-[#334155] shadow hover:bg-[#F1F5F9]"
        >
          <X className="w-5 h-5" />
        </button>
        <ProductDetails item={item} layout="popup" />
        <button
          type="button"
          onClick={onScanNext}
          className="mt-5 w-full inline-flex items-center justify-center gap-2 min-h-[48px] rounded-xl bg-[#E21B70] hover:bg-[#C91661] text-white text-sm font-bold"
        >
          <ScanBarcode className="w-5 h-5" /> Scan next item
        </button>
      </div>
    </div>
  );
};

const ScannedCode: React.FC<{ scan: DetectedBarcode }> = ({ scan }) => {
  const [copied, setCopied] = useState(false);
  const isLink = /^https?:\/\//i.test(scan.text);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(scan.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard can be unavailable (permissions or insecure context); the value stays visible.
    }
  };

  return (
    <div className="mb-4 flex items-start gap-3 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-bold uppercase tracking-wide text-[#64748B]">Scanned · {scan.format}</p>
        {isLink ? (
          <a href={scan.text} target="_blank" rel="noopener noreferrer" className="block font-mono text-sm text-[#E21B70] underline break-all">
            {scan.text}
          </a>
        ) : (
          <p className="font-mono text-sm text-[#0F172A] break-all whitespace-pre-wrap">{scan.text}</p>
        )}
      </div>
      <button
        type="button"
        onClick={() => void copy()}
        title="Copy"
        aria-label="Copy scanned value"
        className="shrink-0 p-2 rounded-lg text-[#64748B] hover:bg-[#E2E8F0]"
      >
        {copied ? <Check className="w-4 h-4 text-[#0D5C3A]" /> : <Copy className="w-4 h-4" />}
      </button>
    </div>
  );
};

const ProductDetails: React.FC<{ item: MenuItem; layout?: 'card' | 'popup' }> = ({ item, layout = 'card' }) => {
  const popup = layout === 'popup';
  const onSale = !!item.regular_price_minor && item.regular_price_minor > item.base_price_minor;
  const lowStock = item.track_stock !== false && (item.stock_quantity ?? 0) <= (item.reorder_level ?? 0);

  return (
    <div className={popup ? 'flex flex-col gap-4' : 'flex flex-col sm:flex-row gap-4'}>
      <img
        src={getProductImage(item)}
        alt=""
        className={`rounded-xl object-cover bg-[#F1F5F9] shrink-0 ${popup ? 'w-full h-56 sm:h-64' : 'w-full sm:w-32 h-40 sm:h-32'}`}
      />
      <div className="min-w-0 flex-1 space-y-2">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[#64748B]">
            {[item.brand, item.category_name].filter(Boolean).join(' · ')}
          </p>
          <h2 className={`font-bold text-[#0F172A] leading-tight ${popup ? 'text-2xl' : 'text-lg'}`}>{item.name_en}</h2>
          {item.name_bn && <p className="text-sm text-[#475569]">{item.name_bn}</p>}
          <p className="text-xs text-[#64748B]">{item.package_size}{item.is_weighted ? ' · sold by weight' : ''}</p>
        </div>

        <div className="flex items-baseline gap-2">
          <span className={`font-bold text-[#E21B70] ${popup ? 'text-3xl' : 'text-2xl'}`}>{formatMoney(item.base_price_minor)}</span>
          {onSale && <span className="text-sm text-[#94A3B8] line-through">{formatMoney(item.regular_price_minor!)}</span>}
        </div>

        <dl className={`grid grid-cols-2 gap-x-4 gap-y-1.5 ${popup ? 'text-sm' : 'text-xs'}`}>
          <dt className="text-[#64748B]">Stock</dt>
          <dd className={`font-bold ${lowStock ? 'text-rose-700' : 'text-[#0D5C3A]'}`}>
            {item.track_stock === false ? 'Not tracked' : `${item.stock_quantity ?? 0} ${item.unit || ''}`}
            {lowStock && ' (low)'}
          </dd>
          {item.shelf_location && (
            <>
              <dt className="text-[#64748B]">Shelf</dt>
              <dd className="font-bold inline-flex items-center gap-1"><MapPin className="w-3 h-3" />{item.shelf_location}</dd>
            </>
          )}
          {item.sku && (
            <>
              <dt className="text-[#64748B]">SKU</dt>
              <dd className="font-mono">{item.sku}</dd>
            </>
          )}
          {item.barcode && (
            <>
              <dt className="text-[#64748B]">Barcode</dt>
              <dd className="font-mono">{item.barcode}</dd>
            </>
          )}
          <dt className="text-[#64748B]">Status</dt>
          <dd className={`font-bold ${item.is_available ? 'text-[#0D5C3A]' : 'text-rose-700'}`}>
            {item.is_available ? 'Available' : 'Unavailable'}
          </dd>
        </dl>
      </div>
    </div>
  );
};
