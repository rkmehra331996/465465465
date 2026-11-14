import React, { useEffect, useMemo, useState } from 'react';
import {
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Copy,
  Languages,
  Loader2,
  MessageCircle,
  Send,
} from 'lucide-react';
import {
  buildCleanerWhatsAppMessage,
  formatIndianDate,
  toOrderNumberEmoji,
  translateMessage,
} from '../lib/api';
import type { Order, TranslateTarget } from '../types';

function localTodayStr(offsetDays = 0): string {
  const d = new Date(Date.now() + offsetDays * 86400000);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function shiftIsoDate(isoDate: string, deltaDays: number): string {
  const base = /^\d{4}-\d{2}-\d{2}$/.test(isoDate) ? isoDate : localTodayStr(0);
  const [y, m, d] = base.split('-').map(Number);
  const dt = new Date(y, m - 1, d + deltaDays);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

interface WhatsAppDispatchProps {
  orders: Order[];
  initialCleaner?: string;
  initialSelectedIds?: string[];
  onBulkComplete: (ids: string[]) => Promise<void>;
  onNotify: (msg: string, type?: 'success' | 'error') => void;
}

const LANGUAGE_OPTIONS: { id: TranslateTarget; label: string }[] = [
  { id: 'english', label: 'English (Original)' },
  { id: 'hindi', label: 'Hindi (हिन्दी)' },
  { id: 'punjabi', label: 'Punjabi (ਪੰਜਾਬੀ)' },
  { id: 'bilingual_hi', label: 'English + Hindi' },
  { id: 'bilingual_pa', label: 'English + Punjabi' },
];

export const WhatsAppDispatch: React.FC<WhatsAppDispatchProps> = ({
  orders,
  initialCleaner,
  initialSelectedIds,
  onBulkComplete,
  onNotify,
}) => {
  const activeOrders = useMemo(
    () => orders.filter((o) => o.status === 'active'),
    [orders]
  );

  const today = localTodayStr(0);
  const yesterday = localTodayStr(-1);
  const tomorrow = localTodayStr(1);

  const [dateFilter, setDateFilter] = useState<string>(() =>
    initialSelectedIds && initialSelectedIds.length > 0 ? '' : localTodayStr(0)
  );

  const dateFilteredOrders = useMemo(() => {
    if (!dateFilter) return activeOrders;
    return activeOrders.filter((o) => o.bookingDate === dateFilter);
  }, [activeOrders, dateFilter]);

  const cleanerSummaries = useMemo(() => {
    const map = new Map<string, { name: string; count: number; totalAmount: number }>();
    for (const o of dateFilteredOrders) {
      const key = o.cleanerName.trim().toLowerCase();
      if (!key) continue;
      const existing = map.get(key);
      if (existing) {
        existing.count += 1;
        existing.totalAmount += Number(o.price || 0);
      } else {
        map.set(key, {
          name: o.cleanerName.trim(),
          count: 1,
          totalAmount: Number(o.price || 0),
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => b.count - a.count);
  }, [dateFilteredOrders]);

  const [selectedCleaner, setSelectedCleaner] = useState<string>(
    initialCleaner || cleanerSummaries[0]?.name || ''
  );
  const [checkedIds, setCheckedIds] = useState<string[]>([]);
  const [targetLang, setTargetLang] = useState<TranslateTarget>('english');
  const [messageText, setMessageText] = useState<string>('');
  const [translating, setTranslating] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);
  const [completing, setCompleting] = useState<boolean>(false);

  useEffect(() => {
    if (initialSelectedIds && initialSelectedIds.length > 0) {
      setDateFilter('');
    }
  }, [initialSelectedIds]);

  useEffect(() => {
    if (initialCleaner) {
      setSelectedCleaner(initialCleaner);
    } else if (!selectedCleaner && cleanerSummaries.length > 0 && !initialSelectedIds?.length) {
      setSelectedCleaner(cleanerSummaries[0].name);
    }
  }, [initialCleaner, initialSelectedIds]);

  useEffect(() => {
    if (
      cleanerSummaries.length > 0 &&
      (!selectedCleaner ||
        !cleanerSummaries.some(
          (c) => c.name.trim().toLowerCase() === selectedCleaner.trim().toLowerCase()
        ))
    ) {
      setSelectedCleaner(cleanerSummaries[0].name);
    }
  }, [dateFilter, cleanerSummaries, selectedCleaner]);

  const matchingOrders = useMemo(() => {
    if (!selectedCleaner) return [];
    return dateFilteredOrders.filter(
      (o) => o.cleanerName.trim().toLowerCase() === selectedCleaner.trim().toLowerCase()
    );
  }, [dateFilteredOrders, selectedCleaner]);

  useEffect(() => {
    if (initialSelectedIds && initialSelectedIds.length > 0) {
      const valid = matchingOrders
        .filter((o) => initialSelectedIds.includes(o.id))
        .map((o) => o.id);
      setCheckedIds(valid.length > 0 ? valid : matchingOrders.map((o) => o.id));
    } else {
      setCheckedIds(matchingOrders.map((o) => o.id));
    }
  }, [selectedCleaner, dateFilter, matchingOrders.length]);

  const includedOrders = useMemo(
    () => matchingOrders.filter((o) => checkedIds.includes(o.id)),
    [matchingOrders, checkedIds]
  );

  const baseMessage = useMemo(() => {
    return buildCleanerWhatsAppMessage(selectedCleaner || 'Cleaner', includedOrders, false);
  }, [selectedCleaner, includedOrders]);

  useEffect(() => {
    if (targetLang === 'english') {
      setMessageText(baseMessage);
      return;
    }

    if (!baseMessage) {
      setMessageText('');
      return;
    }

    let cancelled = false;
    const runTranslate = async () => {
      setTranslating(true);
      try {
        const translated = await translateMessage(baseMessage, targetLang);
        if (!cancelled) {
          setMessageText(translated);
        }
      } catch (err) {
        if (!cancelled) {
          onNotify(
            err instanceof Error ? err.message : 'Auto-translate failed, showing English text',
            'error'
          );
          setMessageText(baseMessage);
        }
      } finally {
        if (!cancelled) setTranslating(false);
      }
    };

    runTranslate();
    return () => {
      cancelled = true;
    };
  }, [baseMessage, targetLang]);

  const toggleOrderId = (id: string) => {
    setCheckedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const handleCopy = async () => {
    if (!messageText.trim()) return;
    try {
      await navigator.clipboard.writeText(messageText);
      setCopied(true);
      onNotify('WhatsApp message copied! Paste directly in your group.');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      onNotify('Could not copy automatically. Please copy from the text box.', 'error');
    }
  };

  const handleMarkDispatchedComplete = async () => {
    if (checkedIds.length === 0) return;
    setCompleting(true);
    try {
      await onBulkComplete(checkedIds);
      onNotify(`${checkedIds.length} orders moved to Completed List.`);
    } finally {
      setCompleting(false);
    }
  };

  const whatsappShareUrl = `https://api.whatsapp.com/send?text=${encodeURIComponent(messageText)}`;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
      <div className="lg:col-span-5 bg-white border border-[#DCE4E0] rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-[#DCE4E0] bg-[#EFF4F1]">
          <h2 className="font-display text-sm font-bold text-slate-900">
            1. Select Cleaner & Orders
          </h2>
        </div>

        <div className="p-4 space-y-4">
          <div className="space-y-3">
            <div>
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <label className="text-xs font-semibold text-slate-700">
                  Filter by Date
                </label>
                <span className="text-[11px] font-mono-num font-semibold text-[#075E54]">
                  {dateFilter ? formatIndianDate(dateFilter) : 'All Dates'}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                {(() => {
                  const backDateTarget = dateFilter ? shiftIsoDate(dateFilter, -1) : yesterday;
                  const nextDateTarget = dateFilter ? shiftIsoDate(dateFilter, 1) : tomorrow;
                  const backDay = backDateTarget.slice(8, 10);
                  const todayDay = today.slice(8, 10);
                  const nextDay = nextDateTarget.slice(8, 10);

                  return (
                    <>
                      <button
                        type="button"
                        onClick={() => setDateFilter(backDateTarget)}
                        title={`Back to ${formatIndianDate(backDateTarget)}`}
                        className={`px-2.5 py-1.5 text-xs font-semibold rounded-lg border inline-flex items-center gap-1 transition-colors cursor-pointer whitespace-nowrap ${
                          dateFilter && dateFilter < today
                            ? 'bg-[#075E54] text-white border-[#075E54]'
                            : 'bg-[#F7F9F8] text-slate-800 border-[#DCE4E0] hover:bg-[#EFF4F1]'
                        }`}
                      >
                        <ChevronLeft className="w-3.5 h-3.5" />
                        Back Date ({backDay})
                      </button>

                      <button
                        type="button"
                        onClick={() => setDateFilter(today)}
                        title={`Today (${formatIndianDate(today)})`}
                        className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors cursor-pointer whitespace-nowrap ${
                          dateFilter === today
                            ? 'bg-purple-800 text-white border-purple-900 ring-2 ring-purple-300'
                            : 'bg-purple-600 text-white border-purple-700 hover:bg-purple-700'
                        }`}
                      >
                        Today ({todayDay})
                      </button>

                      <button
                        type="button"
                        onClick={() => setDateFilter(nextDateTarget)}
                        title={`Next to ${formatIndianDate(nextDateTarget)}`}
                        className={`px-2.5 py-1.5 text-xs font-semibold rounded-lg border inline-flex items-center gap-1 transition-colors cursor-pointer whitespace-nowrap ${
                          dateFilter && dateFilter > today
                            ? 'bg-[#075E54] text-white border-[#075E54]'
                            : 'bg-[#F7F9F8] text-slate-800 border-[#DCE4E0] hover:bg-[#EFF4F1]'
                        }`}
                      >
                        Next Date ({nextDay})
                        <ChevronRight className="w-3.5 h-3.5" />
                      </button>
                    </>
                  );
                })()}
              </div>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-2">
              Active Cleaners ({dateFilter ? formatIndianDate(dateFilter) : 'All Dates'})
            </label>
            {cleanerSummaries.length === 0 ? (
              <div className="text-xs text-slate-500 p-3 bg-[#F7F9F8] rounded-lg border border-[#DCE4E0]">
                {dateFilter
                  ? `No active orders scheduled for ${formatIndianDate(dateFilter)}. Pick another date above.`
                  : 'No active orders found. Add orders in the Active Orders sheet first.'}
              </div>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {cleanerSummaries.map((c) => {
                  const isActive =
                    selectedCleaner.toLowerCase() === c.name.toLowerCase();
                  return (
                    <button
                      key={c.name}
                      type="button"
                      onClick={() => setSelectedCleaner(c.name)}
                      className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors cursor-pointer whitespace-nowrap ${
                        isActive
                          ? 'bg-[#075E54] text-white border-[#075E54]'
                          : 'bg-[#F7F9F8] text-slate-800 border-[#DCE4E0] hover:bg-[#EFF4F1]'
                      }`}
                    >
                      {c.name} ({c.count})
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="border border-[#DCE4E0] rounded-lg overflow-hidden">
            <div className="px-3 py-2 bg-[#F7F9F8] border-b border-[#DCE4E0] flex items-center justify-between text-xs">
              <span className="font-semibold text-slate-700">
                Included Orders ({includedOrders.length} / {matchingOrders.length})
              </span>
              <button
                type="button"
                onClick={() =>
                  setCheckedIds(
                    checkedIds.length === matchingOrders.length
                      ? []
                      : matchingOrders.map((o) => o.id)
                  )
                }
                className="text-[#128C7E] font-medium hover:underline cursor-pointer"
              >
                {checkedIds.length === matchingOrders.length
                  ? 'Unselect All'
                  : 'Select All'}
              </button>
            </div>

            <div className="max-h-[340px] overflow-y-auto divide-y divide-[#DCE4E0]">
              {matchingOrders.length === 0 ? (
                <div className="p-6 text-center text-xs text-slate-500">
                  No active orders for this cleaner/date filter.
                </div>
              ) : (
                matchingOrders.map((o, idx) => {
                  const checked = checkedIds.includes(o.id);
                  return (
                    <label
                      key={o.id}
                      className={`flex items-start gap-2.5 p-3 cursor-pointer transition-colors ${
                        checked ? 'bg-[#F2FBF6]' : 'hover:bg-slate-50'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleOrderId(o.id)}
                        className="mt-0.5 rounded border-slate-300 accent-[#128C7E]"
                      />
                      <div className="min-w-0 flex-1 text-xs">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold text-slate-900 truncate">
                            {toOrderNumberEmoji(idx + 1)} {o.name || o.number} ({o.serviceName})
                          </span>
                          <span className="font-mono-num font-semibold text-[#075E54] shrink-0">
                            ₹{o.price}
                          </span>
                        </div>
                        <div className="text-slate-500 font-mono-num mt-0.5">
                          {o.number} · {o.city}
                          {o.bookingDate ? ` · ${formatIndianDate(o.bookingDate)}` : ''}
                          {o.qty ? ` · Qty: ${o.qty}` : ''}
                        </div>
                        {o.address && (
                          <div className="text-slate-600 truncate mt-0.5">{o.address}</div>
                        )}
                      </div>
                    </label>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="lg:col-span-7 bg-white border border-[#DCE4E0] rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-[#DCE4E0] bg-[#075E54] text-white flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <MessageCircle className="w-5 h-5 text-[#25D366]" />
            <div>
              <h2 className="font-display text-sm font-bold">
                2. Auto-Typed WhatsApp Group Message
              </h2>
              <p className="text-xs text-emerald-100/80">
                Translate to Hindi or Punjabi and share straight to WhatsApp
              </p>
            </div>
          </div>
        </div>

        <div className="p-4 space-y-4">
          <div>
            <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 mb-2">
              <Languages className="w-4 h-4 text-[#128C7E]" />
              <span>Auto-Translate Language</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {LANGUAGE_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  disabled={translating}
                  onClick={() => setTargetLang(opt.id)}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors cursor-pointer whitespace-nowrap ${
                    targetLang === opt.id
                      ? 'bg-[#128C7E] text-white border-[#128C7E]'
                      : 'bg-[#F7F9F8] text-slate-700 border-[#DCE4E0] hover:bg-[#EFF4F1]'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div className="bg-[#EFEAE2] border border-[#DCE4E0] rounded-xl p-4 relative">
            {translating && (
              <div className="absolute inset-0 bg-white/80 backdrop-blur-[1px] rounded-xl flex items-center justify-center gap-2 z-10 text-xs font-semibold text-[#075E54]">
                <Loader2 className="w-4 h-4 animate-spin" />
                Translating {includedOrders.length} orders into{' '}
                {LANGUAGE_OPTIONS.find((l) => l.id === targetLang)?.label}...
              </div>
            )}

            <div className="bg-[#D9FDD3] border border-[#C3EAB9] rounded-lg p-3 shadow-xs">
              <textarea
                aria-label="WhatsApp dispatch message preview"
                rows={14}
                value={messageText}
                onChange={(e) => setMessageText(e.target.value)}
                placeholder="Select a cleaner on the left to auto-generate numbered orders..."
                className="w-full bg-transparent text-[13px] leading-relaxed text-slate-900 font-sans resize-y focus:outline-none"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <div className="flex flex-wrap items-center gap-2.5">
              <a
                href={messageText.trim() ? whatsappShareUrl : undefined}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => {
                  if (!messageText.trim()) e.preventDefault();
                }}
                className={`px-4 py-2.5 text-sm font-semibold rounded-lg flex items-center gap-2 transition-colors whitespace-nowrap ${
                  messageText.trim()
                    ? 'bg-[#25D366] hover:bg-[#1ebe5d] text-white cursor-pointer'
                    : 'bg-slate-200 text-slate-400 cursor-not-allowed'
                }`}
              >
                <Send className="w-4 h-4" />
                Share to WhatsApp Group
              </a>

              <button
                type="button"
                disabled={!messageText.trim()}
                onClick={handleCopy}
                className="px-4 py-2.5 text-sm font-semibold bg-white border border-[#DCE4E0] hover:bg-[#F7F9F8] disabled:opacity-50 text-slate-800 rounded-lg flex items-center gap-2 transition-colors cursor-pointer whitespace-nowrap"
              >
                {copied ? (
                  <>
                    <Check className="w-4 h-4 text-[#128C7E]" />
                    Copied!
                  </>
                ) : (
                  <>
                    <Copy className="w-4 h-4" />
                    Copy Message
                  </>
                )}
              </button>
            </div>

            {checkedIds.length > 0 && (
              <button
                type="button"
                disabled={completing}
                onClick={handleMarkDispatchedComplete}
                className="px-3.5 py-2.5 text-xs font-semibold bg-[#EFF4F1] hover:bg-[#DCE4E0] text-[#075E54] rounded-lg flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
              >
                <CheckCircle2 className="w-4 h-4" />
                {completing
                  ? 'Moving...'
                  : `Mark ${checkedIds.length} Orders Complete`}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
