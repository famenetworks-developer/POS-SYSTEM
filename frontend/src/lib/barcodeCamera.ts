// Camera barcode scanning. Uses the browser's native BarcodeDetector when it is
// available (Chrome on Android) and falls back to ZXing everywhere else. Both
// are configured to read every symbology they support, 1D and 2D.

import type { BarcodeFormat as ZXingFormat, DecodeHintType as ZXingHint } from '@zxing/library';

export interface DetectedBarcode {
  text: string;
  format: string; // Human-readable, e.g. "EAN-13", "QR Code"
}

export interface BarcodeCamera {
  stop: () => void;
  engine: 'native' | 'zxing';
}

// Minimal typings: BarcodeDetector is not in TypeScript's DOM lib yet.
interface NativeDetectedBarcode {
  rawValue: string;
  format: string;
}
interface NativeBarcodeDetector {
  detect(source: CanvasImageSource): Promise<NativeDetectedBarcode[]>;
}
interface NativeBarcodeDetectorConstructor {
  new (options?: { formats?: string[] }): NativeBarcodeDetector;
  getSupportedFormats(): Promise<string[]>;
}

const NATIVE_SCAN_INTERVAL_MS = 120;

const FORMAT_LABELS: Record<string, string> = {
  AZTEC: 'Aztec',
  CODABAR: 'Codabar',
  CODE_39: 'Code 39',
  CODE_93: 'Code 93',
  CODE_128: 'Code 128',
  DATA_MATRIX: 'Data Matrix',
  EAN_8: 'EAN-8',
  EAN_13: 'EAN-13',
  ITF: 'ITF',
  MAXICODE: 'MaxiCode',
  PDF_417: 'PDF417',
  PDF417: 'PDF417',
  QR_CODE: 'QR Code',
  MICRO_QR_CODE: 'Micro QR',
  RSS_14: 'GS1 DataBar',
  RSS_EXPANDED: 'GS1 DataBar Expanded',
  UPC_A: 'UPC-A',
  UPC_E: 'UPC-E',
};

export const formatLabel = (format: string): string => {
  const key = format.toUpperCase();
  return FORMAT_LABELS[key] || key.replace(/_/g, ' ');
};

// Some decoders keep Codabar's start/stop characters (A-D), which are framing, not data.
const normalizeBarcode = (barcode: DetectedBarcode): DetectedBarcode =>
  barcode.format === 'Codabar' ? { ...barcode, text: barcode.text.replace(/^[A-D](.*)[A-D]$/i, '$1') } : barcode;

const openCameraStream = (deviceId?: string): Promise<MediaStream> =>
  navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      // Rear camera by default on phones; higher resolution helps with small or dense codes.
      ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: { ideal: 'environment' } }),
      width: { ideal: 1920 },
      height: { ideal: 1080 },
    },
  });

const getNativeDetector = async (): Promise<NativeBarcodeDetector | null> => {
  const Detector = (window as unknown as { BarcodeDetector?: NativeBarcodeDetectorConstructor }).BarcodeDetector;
  if (!Detector) return null;
  try {
    const formats = await Detector.getSupportedFormats();
    return formats.length ? new Detector({ formats }) : null;
  } catch {
    return null;
  }
};

export async function startBarcodeCamera(
  video: HTMLVideoElement,
  onDetect: (barcode: DetectedBarcode) => void,
  deviceId?: string
): Promise<BarcodeCamera> {
  const stream = await openCameraStream(deviceId);
  const emit = (barcode: DetectedBarcode) => onDetect(normalizeBarcode(barcode));
  const stopTracks = () => stream.getTracks().forEach((track) => track.stop());

  try {
    video.srcObject = stream;
    await video.play();

    const nativeDetector = await getNativeDetector();
    if (nativeDetector) {
      let stopped = false;
      let timer: ReturnType<typeof setTimeout>;
      const tick = async () => {
        if (stopped) return;
        try {
          if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
            const [first] = await nativeDetector.detect(video);
            if (first?.rawValue && !stopped) emit({ text: first.rawValue, format: formatLabel(first.format) });
          }
        } catch {
          // A frame can fail to decode; keep scanning.
        }
        if (!stopped) timer = setTimeout(tick, NATIVE_SCAN_INTERVAL_MS);
      };
      void tick();
      return {
        engine: 'native',
        stop: () => {
          stopped = true;
          clearTimeout(timer);
          stopTracks();
          video.srcObject = null;
        },
      };
    }

    const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] = await Promise.all([
      import('@zxing/browser'),
      import('@zxing/library'),
    ]);
    const hints = new Map<ZXingHint, unknown>([
      [
        DecodeHintType.POSSIBLE_FORMATS,
        Object.values(BarcodeFormat).filter((value): value is ZXingFormat => typeof value === 'number'),
      ],
      [DecodeHintType.TRY_HARDER, true],
    ]);
    const reader = new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 100 });
    const controls = await reader.decodeFromStream(stream, video, (result) => {
      if (result) emit({ text: result.getText(), format: formatLabel(BarcodeFormat[result.getBarcodeFormat()]) });
    });
    return {
      engine: 'zxing',
      stop: () => {
        controls.stop();
        stopTracks();
        video.srcObject = null;
      },
    };
  } catch (err) {
    stopTracks();
    video.srcObject = null;
    throw err;
  }
}

export const listCameras = async (): Promise<MediaDeviceInfo[]> => {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter((d) => d.kind === 'videoinput');
};

// A message a cashier can act on when the camera cannot start.
export const cameraErrorMessage = (err: unknown): string => {
  const name = (err as { name?: string })?.name;
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    return 'Camera access needs a secure connection. Open this page over HTTPS (or on localhost) to scan with the camera.';
  }
  if (name === 'NotAllowedError') return 'Camera permission was denied. Allow camera access in your browser settings and try again.';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No camera was found on this device.';
  if (name === 'NotReadableError') return 'The camera is being used by another app. Close it and try again.';
  return 'Could not start the camera.';
};
