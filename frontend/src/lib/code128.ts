// Code 128 barcode encoder. Code 128 can encode any printable ASCII text exactly,
// so it works for every product barcode and SKU, and scanners read back the same text.

// Bar/space widths for each symbol value 0-106 (106 is the stop pattern).
const PATTERNS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
];

const START_B = 104;
const START_C = 105;
const CODE_B = 100;
const CODE_C = 99;
const STOP = 106;

/** Quiet zone (blank space) required on each side of the bars, in modules. */
export const CODE128_QUIET_ZONE = 10;

const isDigit = (c: string) => c >= '0' && c <= '9';

/** Whether text can be drawn as Code 128 (printable ASCII only). */
export const canEncodeCode128 = (text: string) => text.length > 0 && /^[\x20-\x7E]+$/.test(text);

// Symbol values: runs of 4+ digits use set C (two digits per symbol, shorter barcode), everything else set B.
const encodeValues = (text: string): number[] => {
  const values: number[] = [];
  let set: 'B' | 'C' | null = null;
  let i = 0;
  while (i < text.length) {
    let digitRun = 0;
    while (i + digitRun < text.length && isDigit(text[i + digitRun])) digitRun++;
    // Set C only pays off for 4+ digits, or 2+ digits that finish the text; it needs an even count.
    const useC = digitRun >= 4 || (digitRun >= 2 && i + digitRun === text.length && set === 'C');
    if (useC) {
      const pairs = Math.floor(digitRun / 2);
      if (set !== 'C') values.push(set === null ? START_C : CODE_C);
      set = 'C';
      for (let p = 0; p < pairs; p++, i += 2) values.push(Number(text.slice(i, i + 2)));
      // An odd leftover digit is written in set B on the next pass.
      if (digitRun % 2 === 1) {
        values.push(CODE_B);
        set = 'B';
        values.push(text.charCodeAt(i) - 32);
        i++;
      }
    } else {
      if (set !== 'B') values.push(set === null ? START_B : CODE_B);
      set = 'B';
      values.push(text.charCodeAt(i) - 32);
      i++;
    }
  }
  const checksum = values.reduce((sum, v, idx) => sum + v * (idx === 0 ? 1 : idx), 0) % 103;
  values.push(checksum, STOP);
  return values;
};

/**
 * Encodes text as Code 128 and returns the bars as [x, width] pairs in modules,
 * plus the total width including the quiet zones.
 */
export function encodeCode128(text: string): { bars: Array<[number, number]>; width: number } {
  if (!canEncodeCode128(text)) throw new Error('Code 128 can only encode printable ASCII text');
  const bars: Array<[number, number]> = [];
  let x = CODE128_QUIET_ZONE;
  for (const value of encodeValues(text)) {
    const pattern = PATTERNS[value];
    for (let k = 0; k < pattern.length; k++) {
      const w = Number(pattern[k]);
      if (k % 2 === 0) bars.push([x, w]); // even positions are bars, odd are spaces
      x += w;
    }
  }
  return { bars, width: x + CODE128_QUIET_ZONE };
}
