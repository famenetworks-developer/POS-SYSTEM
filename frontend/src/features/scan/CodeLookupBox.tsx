import React, { useEffect, useRef, useState } from 'react';
import { Keyboard, Search } from 'lucide-react';
import { api } from '../../lib/api';
import { formatMoney } from '../../lib/money';
import { isTouchDevice } from '../../lib/barcodeCamera';

// One product whose barcode or SKU starts with what was typed (GET /items/suggest).
interface CodeSuggestion {
  product_id: string;
  name_en: string;
  code: string;
  code_type: 'barcode' | 'sku';
  base_price_minor: number;
}

const SUGGEST_DELAY_MS = 200;
const SUGGEST_LIMIT = 8;

interface CodeLookupBoxProps {
  // Called with the code to look up, either typed in full or picked from the list.
  onLookup: (code: string) => void;
}

// Text box for typing a barcode or SKU (or receiving one from a USB scanner).
// As the user types, products whose code starts with the text are listed; picking one looks it up.
export const CodeLookupBox: React.FC<CodeLookupBoxProps> = ({ onLookup }) => {
  const [code, setCode] = useState('');
  const [suggestions, setSuggestions] = useState<CodeSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  // -1 means nothing highlighted, so Enter looks up exactly what was typed (as a USB scanner expects).
  const [highlighted, setHighlighted] = useState(-1);
  const requestRef = useRef(0);

  const prefix = code.trim();

  useEffect(() => {
    const requestId = ++requestRef.current;
    if (!prefix) {
      setSuggestions([]);
      return;
    }
    const timer = setTimeout(() => {
      api
        .get<CodeSuggestion[]>(`/items/suggest?q=${encodeURIComponent(prefix)}&limit=${SUGGEST_LIMIT}`)
        .then((rows) => {
          // Ignore answers to older keystrokes that arrive late.
          if (requestId !== requestRef.current) return;
          setSuggestions(rows || []);
          setHighlighted(-1);
        })
        .catch(() => {
          if (requestId === requestRef.current) setSuggestions([]);
        });
    }, SUGGEST_DELAY_MS);
    return () => clearTimeout(timer);
  }, [prefix]);

  const submit = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    requestRef.current++; // drop any suggestion request still in flight
    onLookup(trimmed);
    setCode('');
    setSuggestions([]);
    setOpen(false);
    setHighlighted(-1);
  };

  const showList = open && prefix !== '' && suggestions.length > 0;

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' && suggestions.length) {
      e.preventDefault();
      setOpen(true);
      setHighlighted((i) => (i + 1) % suggestions.length);
    } else if (e.key === 'ArrowUp' && suggestions.length) {
      e.preventDefault();
      setOpen(true);
      setHighlighted((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
    } else if (e.key === 'Escape') {
      setOpen(false);
      setHighlighted(-1);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const picked = showList && highlighted >= 0 ? suggestions[highlighted] : null;
    submit(picked ? picked.code : code);
  };

  return (
    <form onSubmit={handleSubmit} className="rounded-2xl border border-[#E3E6E8] bg-white p-4 shadow-sm">
      <label htmlFor="manual-barcode" className="flex items-center gap-2 text-xs font-bold text-[#334155] mb-2">
        <Keyboard className="w-4 h-4" /> Type a code or use a USB scanner
      </label>
      <div className="flex gap-2">
        <div className="relative flex-1 min-w-0">
          <input
            id="manual-barcode"
            value={code}
            onChange={(e) => {
              setCode(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => setOpen(false)}
            onKeyDown={handleKeyDown}
            autoComplete="off"
            // Desktop: ready for a USB scanner. Phones: no focus, so the keyboard stays hidden.
            autoFocus={!isTouchDevice()}
            role="combobox"
            aria-expanded={showList}
            aria-controls="manual-barcode-suggestions"
            aria-activedescendant={showList && highlighted >= 0 ? `code-suggestion-${highlighted}` : undefined}
            placeholder="Barcode, SKU or any code"
            className="min-h-[44px] w-full rounded-lg border border-[#CBD5E1] px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#E21B70]"
          />
          {showList && (
            <ul
              id="manual-barcode-suggestions"
              role="listbox"
              className="absolute left-0 right-0 top-full z-20 mt-1 max-h-80 overflow-y-auto rounded-lg border border-[#E3E6E8] bg-white py-1 shadow-lg"
            >
              {suggestions.map((s, i) => (
                <li
                  key={s.product_id}
                  id={`code-suggestion-${i}`}
                  role="option"
                  aria-selected={i === highlighted}
                  // mousedown (not click) so the input does not blur and close the list first.
                  onMouseDown={(e) => {
                    e.preventDefault();
                    submit(s.code);
                  }}
                  onMouseEnter={() => setHighlighted(i)}
                  className={`flex cursor-pointer items-center gap-3 px-3 py-2 ${i === highlighted ? 'bg-[#FFF0F6]' : ''}`}
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-mono text-sm text-[#0F172A] truncate">
                      <span className="font-bold text-[#E21B70]">{s.code.slice(0, prefix.length)}</span>
                      {s.code.slice(prefix.length)}
                      {s.code_type === 'sku' && <span className="ml-2 font-sans text-[10px] font-bold uppercase text-[#64748B]">SKU</span>}
                    </p>
                    <p className="text-xs text-[#64748B] truncate">{s.name_en}</p>
                  </div>
                  <span className="shrink-0 text-xs font-bold text-[#0F172A]">{formatMoney(s.base_price_minor)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <button
          type="submit"
          disabled={!prefix}
          className="inline-flex items-center gap-1.5 min-h-[44px] px-4 rounded-lg bg-[#2E3138] text-white text-xs font-bold disabled:opacity-40"
        >
          <Search className="w-4 h-4" /> Look up
        </button>
      </div>
    </form>
  );
};
