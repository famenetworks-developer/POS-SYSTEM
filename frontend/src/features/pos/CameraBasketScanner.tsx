import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { BarcodeCamera, cameraErrorMessage, startBarcodeCamera } from '../../lib/barcodeCamera';

// The camera must read the same value this many times in a row before it is accepted,
// which filters out partial misreads.
const REQUIRED_MATCHING_READS = 2;
// A code that was not found is not reported again for this long, so the message stays readable.
const SAME_CODE_PAUSE_MS = 2000;

export interface BasketScanResult {
  ok: boolean;
  message: string;
}

interface CameraBasketScannerProps {
  // Looks up the code and adds the product to the basket.
  onCode: (code: string) => Promise<BasketScanResult>;
  // Called when the camera should close: after an item was added, or when the cashier taps Cancel.
  onClose: () => void;
}

// Full-screen camera that scans one item: once a product is read and added, it closes.
// If the code is not a product, it says so and keeps scanning.
export const CameraBasketScanner: React.FC<CameraBasketScannerProps> = ({ onCode, onClose }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const onCodeRef = useRef(onCode);
  const onCloseRef = useRef(onClose);
  const [error, setError] = useState('');
  const [starting, setStarting] = useState(true);
  const [last, setLast] = useState<BasketScanResult | null>(null);

  useEffect(() => {
    onCodeRef.current = onCode;
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    let camera: BarcodeCamera | null = null;
    let cancelled = false;
    let candidate = '';
    let matchingReads = 0;
    let busy = false;
    let lastAccepted = '';
    let lastAcceptedAt = 0;

    const handleRead = async (text: string) => {
      matchingReads = text === candidate ? matchingReads + 1 : 1;
      candidate = text;
      if (matchingReads < REQUIRED_MATCHING_READS || busy) return;
      if (text === lastAccepted && Date.now() - lastAcceptedAt < SAME_CODE_PAUSE_MS) return;

      busy = true;
      lastAccepted = text;
      lastAcceptedAt = Date.now();
      const result = await onCodeRef.current(text);
      busy = false;
      if (cancelled) return;
      if (!result.ok) setLast(result);
      if (result.ok) {
        // One item per scan: stop reading and close.
        cancelled = true;
        camera?.stop();
        navigator.vibrate?.(60);
        onCloseRef.current();
      }
    };

    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setError(cameraErrorMessage(null));
      setStarting(false);
      return;
    }
    startBarcodeCamera(videoRef.current!, (scan) => void handleRead(scan.text))
      .then((cam) => {
        if (cancelled) cam.stop();
        else camera = cam;
      })
      .catch((err) => {
        if (!cancelled) setError(cameraErrorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setStarting(false);
      });

    return () => {
      cancelled = true;
      camera?.stop();
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#0F172A]" role="dialog" aria-modal="true" aria-label="Scan an item into the basket">
      <div className="flex items-center gap-3 px-4 py-3 text-white">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold">Scan an item</p>
          <p className="text-xs text-white/70">It is added to the basket and the camera closes.</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex items-center gap-1.5 min-h-[40px] rounded-lg bg-white px-4 text-sm font-bold text-[#0F172A]"
        >
          <X className="w-4 h-4" /> Cancel
        </button>
      </div>

      <div className="relative flex-1 overflow-hidden">
        <video ref={videoRef} className="h-full w-full object-cover" muted playsInline />
        {!error && (
          <div className="pointer-events-none absolute inset-x-[10%] inset-y-[25%] rounded-lg border-2 border-white/80 shadow-[0_0_0_9999px_rgba(15,23,42,0.35)]" />
        )}
        {starting && !error && <p className="absolute inset-x-0 top-1/2 text-center text-sm text-white/80">Starting camera…</p>}
        {error && (
          <p role="alert" className="absolute inset-x-4 top-1/3 rounded-lg bg-rose-50 border border-rose-200 px-3 py-2 text-sm text-rose-800">
            {error}
          </p>
        )}
      </div>

      <div className="min-h-[72px] px-4 py-3" aria-live="polite">
        {last ? (
          <div className="flex items-center gap-2 rounded-xl bg-amber-100 px-3 py-2.5 text-sm font-bold text-amber-900">
            <AlertTriangle className="w-5 h-5 shrink-0" />
            <span className="min-w-0 flex-1 truncate">{last.message}</span>
          </div>
        ) : (
          <p className="text-center text-xs text-white/70">Point the camera at the barcode.</p>
        )}
      </div>
    </div>
  );
};
