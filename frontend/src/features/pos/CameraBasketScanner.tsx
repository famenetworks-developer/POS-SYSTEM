import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, X } from 'lucide-react';
import { BarcodeCamera, cameraErrorMessage, startBarcodeCamera } from '../../lib/barcodeCamera';

// The camera must read the same value this many times in a row before it is accepted,
// which filters out partial misreads.
const REQUIRED_MATCHING_READS = 2;
// After a code is accepted, the same code is ignored for this long, so holding an item
// in front of the camera adds it once. Scan it again after the pause to add another.
const SAME_CODE_PAUSE_MS = 2000;

export interface BasketScanResult {
  ok: boolean;
  message: string;
  // Stop the camera, e.g. when the cashier must enter a weight first.
  close?: boolean;
}

interface CameraBasketScannerProps {
  // Looks up the code and adds the product to the basket.
  onCode: (code: string) => Promise<BasketScanResult>;
  onClose: () => void;
  basketCount: number;
}

// Full-screen camera that keeps scanning and adds every product it reads to the basket.
export const CameraBasketScanner: React.FC<CameraBasketScannerProps> = ({ onCode, onClose, basketCount }) => {
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
      setLast(result);
      if (result.ok) navigator.vibrate?.(60);
      if (result.close) onCloseRef.current();
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
    <div className="fixed inset-0 z-50 flex flex-col bg-[#0F172A]" role="dialog" aria-modal="true" aria-label="Scan items into the basket">
      <div className="flex items-center gap-3 px-4 py-3 text-white">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold">Scan items into the basket</p>
          <p className="text-xs text-white/70">Basket: {basketCount} {basketCount === 1 ? 'item' : 'items'}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex items-center gap-1.5 min-h-[40px] rounded-lg bg-white px-4 text-sm font-bold text-[#0F172A]"
        >
          <X className="w-4 h-4" /> Done
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
          <div
            className={`flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-bold ${
              last.ok ? 'bg-[#0D5C3A] text-white' : 'bg-amber-100 text-amber-900'
            }`}
          >
            {last.ok ? <CheckCircle2 className="w-5 h-5 shrink-0" /> : <AlertTriangle className="w-5 h-5 shrink-0" />}
            <span className="min-w-0 flex-1 truncate">{last.message}</span>
          </div>
        ) : (
          <p className="text-center text-xs text-white/70">Point the camera at a barcode. Each item is added as soon as it is read.</p>
        )}
      </div>
    </div>
  );
};
