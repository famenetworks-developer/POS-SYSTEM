import React from 'react';
import { CircleCheck, CircleX, ClipboardList } from 'lucide-react';
import { formatMoney } from '../../lib/money';
import { ScanLogEntry } from '../../types';

const formatScanTime = (iso: string) => {
  const date = new Date(iso);
  const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  return date.toDateString() === new Date().toDateString()
    ? time
    : `${date.toLocaleDateString([], { day: 'numeric', month: 'short' })}, ${time}`;
};

interface ScanActivityLogProps {
  entries: ScanLogEntry[];
  loading: boolean;
  error: string;
  showUser: boolean;
  live: boolean;
}

export const ScanActivityLog: React.FC<ScanActivityLogProps> = ({ entries, loading, error, showUser, live }) => (
  <div className="rounded-2xl border border-[#E3E6E8] bg-white shadow-sm">
    <div className="flex items-center justify-between gap-2 border-b border-[#F1F5F9] px-4 py-3">
      <h2 className="flex items-center gap-2 text-sm font-bold text-[#0F172A]">
        <ClipboardList className="w-4 h-4 text-[#E21B70]" /> Scan activity
        <span className="text-xs font-semibold text-[#94A3B8]">{showUser ? 'all users' : 'your scans'}</span>
      </h2>
      {live ? (
        <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-[#0D5C3A]" title="New scans appear automatically">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#22C55E] opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-[#22C55E]" />
          </span>
          Live
        </span>
      ) : (
        <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-[#94A3B8]" title="Reconnecting; scans from other devices will appear when the connection is back">
          <span className="inline-flex h-2 w-2 rounded-full bg-[#CBD5E1]" />
          Connecting…
        </span>
      )}
    </div>

    {error ? (
      <p role="alert" className="px-4 py-6 text-center text-xs text-rose-700">{error}</p>
    ) : entries.length === 0 ? (
      <p className="px-4 py-6 text-center text-xs text-[#64748B]">
        {loading ? 'Loading scan activity…' : 'No scans yet. Every scan will be listed here with its time.'}
      </p>
    ) : (
      <ul className="max-h-[420px] overflow-y-auto divide-y divide-[#F1F5F9]">
        {entries.map((entry) => (
          <li key={entry.id} className="flex items-start gap-3 px-4 py-2.5 text-xs">
            {entry.found ? (
              <CircleCheck className="w-4 h-4 mt-0.5 shrink-0 text-[#0D5C3A]" aria-label="Product found" />
            ) : (
              <CircleX className="w-4 h-4 mt-0.5 shrink-0 text-[#DC2626]" aria-label="Not a store product" />
            )}
            <div className="min-w-0 flex-1">
              <p className={`truncate font-semibold ${entry.found ? 'text-[#0F172A]' : 'text-[#64748B]'}`}>
                {entry.product_name || 'Not a store product'}
              </p>
              <p className="truncate font-mono text-[#94A3B8]" title={entry.code}>
                {entry.format || 'Unknown'} · {entry.code}
              </p>
              {showUser && entry.user_name && <p className="truncate text-[#94A3B8]">by {entry.user_name}</p>}
            </div>
            <div className="shrink-0 text-right">
              {entry.price_minor != null && <p className="font-bold text-[#0F172A]">{formatMoney(entry.price_minor)}</p>}
              <time dateTime={entry.scanned_at} className="text-[#94A3B8]">{formatScanTime(entry.scanned_at)}</time>
            </div>
          </li>
        ))}
      </ul>
    )}
  </div>
);
