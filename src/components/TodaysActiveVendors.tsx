import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRightLeft,
  Calendar,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Copy,
  FileText,
  Pencil,
  RotateCcw,
  Trash2,
  Undo2,
  X,
} from 'lucide-react';
import {
  calcCommission30,
  formatIndianDate,
  getIndianDayTag,
  getOrderTotal,
  getPendingCommission,
  toOrderNumberEmoji,
} from '../lib/api';
import { ConfirmDialog } from './ConfirmDialog';
import { IndianDateInput } from './IndianDateInput';
import { InvoiceModal } from './InvoiceModal';
import { OrderEditModal } from './OrderEditModal';
import { ServiceEditModal } from './ServiceEditModal';
import { TransferOrderModal } from './TransferOrderModal';
import type { Order, PortalConfig, UserPublic } from '../types';

interface TodaysActiveVendorsProps {
  orders: Order[];
  config: PortalConfig;
  currentUser: UserPublic;
  onUpdateOrder: (id: string, patch: Partial<Order>) => Promise<void>;
  onDeleteOrder: (id: string) => Promise<void>;
  onBulkComplete: (ids: string[]) => Promise<void>;
  onTransferOrders: (ids: string[], targetUserId: string) => Promise<void>;
  onUntransferOrders: (ids: string[]) => Promise<void>;
  onOpenWhatsAppForCleaner: (cleanerName: string, selectedIds?: string[]) => void;
  onNotify: (msg: string, type?: 'success' | 'error') => void;
}

type InlineField =
  | 'bookingDate'
  | 'name'
  | 'number'
  | 'altNumber'
  | 'serviceName'
  | 'city'
  | 'address'
  | 'qty'
  | 'price'
  | 'cleanerName'
  | 'notes';

function dateOffsetStr(offsetDays = 0): string {
  const d = new Date(Date.now() + offsetDays * 86400000);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function shiftIsoDate(isoDate: string, deltaDays: number): string {
  const base = /^\d{4}-\d{2}-\d{2}$/.test(isoDate) ? isoDate : dateOffsetStr(0);
  const [y, m, d] = base.split('-').map(Number);
  const dt = new Date(y, m - 1, d + deltaDays);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function buildMonthCells(year: number, month: number): Array<{ day: number; dateStr: string } | null> {
  const firstDayOfWeek = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: Array<{ day: number; dateStr: string } | null> = [];
  for (let i = 0; i < firstDayOfWeek; i++) {
    cells.push(null);
  }
  const mm = String(month + 1).padStart(2, '0');
  for (let d = 1; d <= daysInMonth; d++) {
    const dd = String(d).padStart(2, '0');
    cells.push({ day: d, dateStr: `${year}-${mm}-${dd}` });
  }
  return cells;
}

function formatSingleOrderForWhatsApp(order: Order, indexNumber = 1): string {
  const serial = toOrderNumberEmoji(indexNumber);
  const total = getOrderTotal(order);
  const customer = order.name || (order.isExtraWork ? 'Extra / On-Site Work' : 'Customer');
  const lines = [
    `${serial} *${customer}*`,
    ...(order.number
      ? [`Phone: ${order.number}${order.altNumber ? ` | Alt: ${order.altNumber}` : ''}`]
      : []),
    `Service: ${order.serviceName} | City: ${order.city}`,
    ...(order.bookingDate ? [`Date: ${formatIndianDate(order.bookingDate)}`] : []),
    ...(order.address ? [`Address: ${order.address}`] : []),
    `Price: ₹${total}${order.extraAmount > 0 ? ` (+₹${order.extraAmount} Extra)` : ''}${
      order.qty ? ` | Qty: ${order.qty}` : ''
    }`,
    `Cleaner: ${order.cleanerName}`,
    ...(order.notes ? [`Note: ${order.notes}`] : []),
  ];
  return lines.join('\n');
}

export const TodaysActiveVendors: React.FC<TodaysActiveVendorsProps> = ({
  orders,
  config,
  currentUser,
  onUpdateOrder,
  onDeleteOrder,
  onBulkComplete,
  onTransferOrders,
  onUntransferOrders,
  onOpenWhatsAppForCleaner,
  onNotify,
}) => {
  const today = useMemo(() => dateOffsetStr(0), []);
  const tomorrow = useMemo(() => dateOffsetStr(1), []);

  const [selectedDate, setSelectedDate] = useState<string>(today);
  const [cleanerFilter, setCleanerFilter] = useState<string>('all');
  const [statusMode, setStatusMode] = useState<'all' | 'active' | 'completed'>('all');
  const [collapsedVendors, setCollapsedVendors] = useState<Record<string, boolean>>({});
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Calendar popover state for filter bar
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [calendarYear, setCalendarYear] = useState<number>(() => new Date().getFullYear());
  const [calendarMonth, setCalendarMonth] = useState<number>(() => new Date().getMonth());
  const calendarRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!calendarOpen) return;
    const handleOutside = (e: MouseEvent) => {
      if (calendarRef.current && !calendarRef.current.contains(e.target as Node)) {
        setCalendarOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setCalendarOpen(false);
    };
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('keydown', handleKey);
    };
  }, [calendarOpen]);

  const dateOrderCounts = useMemo(() => {
    const map = new Map<string, { total: number; active: number; completed: number }>();
    for (const o of orders) {
      if (!o.bookingDate || !o.bookingDate.trim()) continue;
      if (statusMode === 'active' && o.status !== 'active') continue;
      if (statusMode === 'completed' && o.status !== 'completed') continue;
      if (
        cleanerFilter !== 'all' &&
        (o.cleanerName || '').trim().toLowerCase() !== cleanerFilter.toLowerCase()
      ) {
        continue;
      }
      const key = o.bookingDate.trim();
      const entry = map.get(key) || { total: 0, active: 0, completed: 0 };
      entry.total += 1;
      if (o.status === 'active') entry.active += 1;
      else entry.completed += 1;
      map.set(key, entry);
    }
    return map;
  }, [orders, cleanerFilter, statusMode]);

  const calendarCells = useMemo(
    () => buildMonthCells(calendarYear, calendarMonth),
    [calendarYear, calendarMonth]
  );

  const changeCalendarMonth = (delta: number) => {
    const d = new Date(calendarYear, calendarMonth + delta, 1);
    setCalendarYear(d.getFullYear());
    setCalendarMonth(d.getMonth());
  };

  const openCalendar = () => {
    const refDate =
      selectedDate && /^\d{4}-\d{2}-\d{2}$/.test(selectedDate) ? selectedDate : today;
    const [y, m] = refDate.split('-').map(Number);
    setCalendarYear(y);
    setCalendarMonth(m - 1);
    setCalendarOpen((prev) => !prev);
  };

  // Inline cell editing state
  const [editingCell, setEditingCell] = useState<{ id: string; field: InlineField } | null>(null);
  const [editingValue, setEditingValue] = useState('');
  const [editingCustomDate, setEditingCustomDate] = useState(false);

  const [invoiceOrder, setInvoiceOrder] = useState<Order | null>(null);
  const [serviceEditOrder, setServiceEditOrder] = useState<Order | null>(null);
  const [editTargetOrder, setEditTargetOrder] = useState<Order | null>(null);
  const [transferTargetIds, setTransferTargetIds] = useState<string[] | null>(null);
  const [unsendingId, setUnsendingId] = useState<string | null>(null);
  const [deleteTargetOrder, setDeleteTargetOrder] = useState<Order | null>(null);
  const [deleting, setDeleting] = useState(false);
  const transferTargetOrders = useMemo(() => {
    if (!transferTargetIds || transferTargetIds.length === 0) return [];
    const idSet = new Set(transferTargetIds);
    return orders.filter((o) => idSet.has(o.id));
  }, [orders, transferTargetIds]);

  const handleQuickUnsend = async (id: string) => {
    if (unsendingId) return;
    setUnsendingId(id);
    try {
      await onUntransferOrders([id]);
    } catch {
      // Notification handled by parent
    } finally {
      setUnsendingId(null);
    }
  };

  const cleanerOptions = useMemo(() => {
    const set = new Set<string>(config.cleaners);
    for (const o of orders) {
      if (o.cleanerName && o.cleanerName.trim()) {
        set.add(o.cleanerName.trim());
      }
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [config.cleaners, orders]);

  const filteredOrders = useMemo(() => {
    return orders.filter((o) => {
      if (!o.bookingDate || !o.bookingDate.trim()) return false;
      if (statusMode === 'active' && o.status !== 'active') return false;
      if (statusMode === 'completed' && o.status !== 'completed') return false;
      if (selectedDate && o.bookingDate !== selectedDate) return false;
      if (
        cleanerFilter !== 'all' &&
        (o.cleanerName || '').trim().toLowerCase() !== cleanerFilter.toLowerCase()
      ) {
        return false;
      }
      return true;
    });
  }, [orders, statusMode, selectedDate, cleanerFilter]);

  const vendorGroups = useMemo(() => {
    const map = new Map<
      string,
      {
        name: string;
        phone: string;
        city: string;
        orders: Order[];
        totalWork: number;
        pendingComm30: number;
        activeIds: string[];
      }
    >();

    for (const o of filteredOrders) {
      const cleanerName = (o.cleanerName || 'Unassigned').trim();
      const key = cleanerName.toLowerCase();
      const profileKey = Object.keys(config.cleanerProfiles || {}).find(
        (k) => k.toLowerCase() === key
      );
      const profile = profileKey ? config.cleanerProfiles[profileKey] : undefined;

      const existing = map.get(key) || {
        name: cleanerName,
        phone: profile?.phone || '',
        city: profile?.city || o.city || '',
        orders: [],
        totalWork: 0,
        pendingComm30: 0,
        activeIds: [],
      };

      existing.orders.push(o);
      if (o.status === 'completed') {
        existing.totalWork += getOrderTotal(o);
      }
      existing.pendingComm30 += getPendingCommission(o);
      const isSentAway =
        Boolean(o.transferredFromId) &&
        o.transferredFromId === currentUser.id &&
        o.createdById !== currentUser.id &&
        currentUser.role !== 'super_admin';
      if (o.status === 'active' && !isSentAway) {
        existing.activeIds.push(o.id);
      }
      map.set(key, existing);
    }

    return Array.from(map.values())
      .map((g) => ({
        ...g,
        orders: [...g.orders].sort((a, b) => {
          if (a.bookingDate !== b.bookingDate) {
            return (b.bookingDate || '').localeCompare(a.bookingDate || '');
          }
          return b.createdAt.localeCompare(a.createdAt);
        }),
      }))
      .sort((a, b) => b.orders.length - a.orders.length || a.name.localeCompare(b.name));
  }, [filteredOrders, config.cleanerProfiles]);

  const totalWorkAll = useMemo(
    () => vendorGroups.reduce((sum, g) => sum + g.totalWork, 0),
    [vendorGroups]
  );

  const copyText = async (text: string, key: string, toastMsg: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      onNotify(toastMsg);
      setTimeout(() => {
        setCopiedKey((curr) => (curr === key ? null : curr));
      }, 1600);
    } catch {
      onNotify('Copy failed — please allow clipboard access.', 'error');
    }
  };

  const isSentTransferOrder = (order: Order) =>
    Boolean(order.transferredFromId) &&
    order.transferredFromId === currentUser.id &&
    order.createdById !== currentUser.id;

  const isReceivedTransferOrder = (order: Order) =>
    Boolean(order.transferredFromId || order.transferredFromName) &&
    order.createdById === currentUser.id;

  const startInlineEdit = (order: Order, field: InlineField) => {
    if (isSentTransferOrder(order) && currentUser.role !== 'super_admin') {
      return;
    }
    setEditingCell({ id: order.id, field });
    setEditingValue(String(order[field] ?? ''));
    setEditingCustomDate(false);
  };

  const commitInlineEdit = async (order: Order, overrideValue?: string) => {
    if (!editingCell || editingCell.id !== order.id) return;
    const { field } = editingCell;
    const raw = (overrideValue ?? editingValue).trim();
    setEditingCell(null);
    setEditingCustomDate(false);

    if (field === 'qty') {
      if (!raw) {
        if (order.qty === null) return;
        await onUpdateOrder(order.id, { qty: null });
        return;
      }
      const num = Number(raw);
      if (!Number.isFinite(num) || num <= 0 || num === order.qty) return;
      await onUpdateOrder(order.id, { qty: num });
      return;
    }

    if (field === 'price') {
      const num = Number(raw);
      if (!Number.isFinite(num) || num < 0 || num === order.price) return;
      await onUpdateOrder(order.id, { price: num });
      return;
    }

    if (field === 'number') {
      const cleanPhone = raw.replace(/\D/g, '');
      if (!cleanPhone) return;
      if (cleanPhone.length !== 10) {
        onNotify('Phone Number must be exactly 10 digits.', 'error');
        return;
      }
      if (cleanPhone === order.number) return;
      await onUpdateOrder(order.id, { number: cleanPhone });
      return;
    }
    if (field === 'altNumber') {
      const cleanAlt = raw.replace(/\D/g, '');
      if (!cleanAlt) {
        if (!order.altNumber) return;
        await onUpdateOrder(order.id, { altNumber: '' });
        return;
      }
      if (cleanAlt.length !== 10) {
        onNotify('Alternate Number must be 10 digits (or leave empty to clear).', 'error');
        return;
      }
      if (cleanAlt === order.altNumber) return;
      await onUpdateOrder(order.id, { altNumber: cleanAlt });
      return;
    }
    if ((field === 'serviceName' || field === 'city' || field === 'cleanerName') && !raw) return;
    if (raw === String(order[field] ?? '')) return;
    await onUpdateOrder(order.id, { [field]: raw });
  };

  const toggleCollapse = (vendorName: string) => {
    setCollapsedVendors((prev) => ({
      ...prev,
      [vendorName]: !prev[vendorName],
    }));
  };

  return (
    <div className="space-y-3">
      {/* Clean Flat Filter Bar: Today + Date, Cleaner, All (Processing + Complete) */}
      <div className="flex flex-wrap items-center justify-between gap-2 py-2 border-y border-[#DCE4E0]">
        <div className="flex flex-wrap items-center gap-2">
          {(() => {
            const yesterday = dateOffsetStr(-1);
            const backDateTarget = selectedDate ? shiftIsoDate(selectedDate, -1) : yesterday;
            const nextDateTarget = selectedDate ? shiftIsoDate(selectedDate, 1) : tomorrow;
            const backDay = backDateTarget.slice(8, 10);
            const todayDay = today.slice(8, 10);
            const nextDay = nextDateTarget.slice(8, 10);

            return (
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setSelectedDate(backDateTarget)}
                  title={`Back to ${formatIndianDate(backDateTarget)}`}
                  className={`px-2.5 py-1 text-xs font-semibold rounded border inline-flex items-center gap-0.5 cursor-pointer whitespace-nowrap transition-colors ${
                    selectedDate && selectedDate < today
                      ? 'bg-[#075E54] text-white border-[#075E54]'
                      : 'bg-white text-slate-700 border-[#DCE4E0] hover:bg-[#EFF4F1]'
                  }`}
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                  Back Date ({backDay})
                </button>

                <button
                  type="button"
                  onClick={() => setSelectedDate(today)}
                  title={`Today (${formatIndianDate(today)})`}
                  className={`px-3 py-1 text-xs font-semibold rounded border inline-flex items-center gap-1 cursor-pointer whitespace-nowrap transition-colors ${
                    selectedDate === today
                      ? 'bg-purple-700 text-white border-purple-950 ring-2 ring-purple-300 shadow-sm'
                      : 'bg-purple-600 text-white border-purple-700 hover:bg-purple-700 opacity-85 hover:opacity-100'
                  }`}
                >
                  {selectedDate === today && <Check className="w-3.5 h-3.5" />}
                  Today ({todayDay})
                </button>

                <button
                  type="button"
                  onClick={() => setSelectedDate(nextDateTarget)}
                  title={`Next to ${formatIndianDate(nextDateTarget)}`}
                  className={`px-2.5 py-1 text-xs font-semibold rounded border inline-flex items-center gap-0.5 cursor-pointer whitespace-nowrap transition-colors ${
                    selectedDate && selectedDate > today
                      ? 'bg-[#075E54] text-white border-[#075E54]'
                      : 'bg-white text-slate-700 border-[#DCE4E0] hover:bg-[#EFF4F1]'
                  }`}
                >
                  Next Date ({nextDay})
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            );
          })()}

          <div ref={calendarRef} className="relative">
            <div className="inline-flex items-center bg-white border border-[#DCE4E0] rounded hover:border-slate-400">
              <button
                type="button"
                onClick={openCalendar}
                aria-label="Open order dates calendar"
                title="Calendar — click to view dates with orders"
                className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-mono-num font-medium text-slate-700 cursor-pointer whitespace-nowrap"
              >
                <Calendar className="w-3.5 h-3.5 text-[#075E54]" />
                <span>{selectedDate ? formatIndianDate(selectedDate) : 'All Dates'}</span>
              </button>
              {selectedDate && (
                <button
                  type="button"
                  onClick={() => {
                    setSelectedDate('');
                    setCalendarOpen(false);
                  }}
                  aria-label="Clear date filter"
                  title="Show all dates"
                  className="pr-1.5 pl-0.5 py-1 text-slate-400 hover:text-red-600 cursor-pointer"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>

            {calendarOpen && (
              <div className="absolute left-0 top-full mt-1.5 z-40 w-[300px] sm:w-[320px] bg-white border border-[#DCE4E0] rounded-xl shadow-xl p-3 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => changeCalendarMonth(-1)}
                    aria-label="Previous month"
                    className="p-1 bg-[#F7F9F8] hover:bg-[#EFF4F1] border border-[#DCE4E0] rounded cursor-pointer"
                  >
                    <ChevronLeft className="w-4 h-4 text-slate-700" />
                  </button>
                  <div className="text-xs font-bold text-slate-900">
                    {MONTH_NAMES[calendarMonth]} {calendarYear}
                  </div>
                  <button
                    type="button"
                    onClick={() => changeCalendarMonth(1)}
                    aria-label="Next month"
                    className="p-1 bg-[#F7F9F8] hover:bg-[#EFF4F1] border border-[#DCE4E0] rounded cursor-pointer"
                  >
                    <ChevronRight className="w-4 h-4 text-slate-700" />
                  </button>
                </div>

                <div className="grid grid-cols-7 gap-1">
                  {WEEKDAYS.map((wd) => (
                    <div
                      key={wd}
                      className="text-center text-[10px] font-semibold text-slate-400 uppercase py-0.5"
                    >
                      {wd}
                    </div>
                  ))}

                  {calendarCells.map((cell, idx) => {
                    if (!cell) {
                      return <div key={`cal-empty-${idx}`} className="h-10 rounded bg-[#FAFDFB]" />;
                    }
                    const info = dateOrderCounts.get(cell.dateStr);
                    const hasOrders = Boolean(info && info.total > 0);
                    const isSelected = selectedDate === cell.dateStr;
                    const isTodayCell = cell.dateStr === today;

                    return (
                      <button
                        key={cell.dateStr}
                        type="button"
                        onClick={() => {
                          setSelectedDate(cell.dateStr);
                          setCalendarOpen(false);
                        }}
                        title={
                          hasOrders && info
                            ? `${formatIndianDate(cell.dateStr)} — ${info.total} order(s)`
                            : formatIndianDate(cell.dateStr)
                        }
                        className={`h-10 rounded-md border flex flex-col items-center justify-center relative transition-colors cursor-pointer ${
                          isSelected
                            ? 'bg-purple-700 text-white border-purple-900 ring-2 ring-purple-300 font-bold'
                            : hasOrders
                            ? 'bg-emerald-50 border-emerald-400 text-[#075E54] hover:bg-emerald-100 font-bold'
                            : isTodayCell
                            ? 'bg-purple-50 border-purple-300 text-purple-800 hover:bg-purple-100 font-semibold'
                            : 'bg-white border-[#E4EBE7] text-slate-600 hover:bg-slate-50'
                        }`}
                      >
                        <span className="text-[11px] font-mono-num leading-none">
                          {cell.day}
                        </span>
                        {hasOrders && info && (
                          <span
                            className={`mt-0.5 px-1 rounded text-[9px] font-mono-num font-bold leading-tight ${
                              isSelected
                                ? 'bg-white text-purple-800'
                                : 'bg-[#075E54] text-white'
                            }`}
                          >
                            {info.total}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>

                <div className="pt-2 border-t border-[#DCE4E0] flex items-center justify-between gap-2 text-[10px]">
                  <div className="flex items-center gap-2 text-slate-600">
                    <span className="inline-flex items-center gap-1">
                      <span className="w-2.5 h-2.5 rounded bg-emerald-100 border border-emerald-500 inline-block" />
                      Order Marked
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <span className="w-2.5 h-2.5 rounded bg-purple-700 inline-block" />
                      Selected
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedDate(today);
                        setCalendarOpen(false);
                      }}
                      className="px-2 py-0.5 rounded bg-purple-600 hover:bg-purple-700 text-white font-semibold cursor-pointer"
                    >
                      Today
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedDate('');
                        setCalendarOpen(false);
                      }}
                      className="px-2 py-0.5 rounded bg-[#F7F9F8] hover:bg-[#EFF4F1] border border-[#DCE4E0] text-slate-700 font-semibold cursor-pointer"
                    >
                      All
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          <select
            aria-label="Filter by cleaner"
            value={cleanerFilter}
            onChange={(e) => setCleanerFilter(e.target.value)}
            className="px-2 py-1 text-xs bg-white border border-[#DCE4E0] rounded text-slate-700 focus:outline-none focus:border-slate-400"
          >
            <option value="all">All Cleaners</option>
            {cleanerOptions.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>

          <select
            aria-label="Filter status"
            value={statusMode}
            onChange={(e) => setStatusMode(e.target.value as 'all' | 'active' | 'completed')}
            className="px-2 py-1 text-xs bg-white border border-[#DCE4E0] rounded text-slate-700 focus:outline-none focus:border-slate-400"
          >
            <option value="all">All (Processing + Complete)</option>
            <option value="active">Under Processing</option>
            <option value="completed">Complete</option>
          </select>

          {(selectedDate !== today ||
            cleanerFilter !== 'all' ||
            statusMode !== 'all') && (
            <button
              type="button"
              onClick={() => {
                setSelectedDate(today);
                setCleanerFilter('all');
                setStatusMode('all');
              }}
              className="px-2 py-1 text-xs text-slate-600 hover:text-slate-900 inline-flex items-center gap-1 cursor-pointer"
            >
              <RotateCcw className="w-3 h-3" />
              Reset
            </button>
          )}
        </div>

        <div className="text-xs font-mono-num text-slate-600">
          Vendors: <strong className="text-red-700">{vendorGroups.length}</strong> · Orders:{' '}
          <strong className="text-slate-900">{filteredOrders.length}</strong> ·{' '}
          <span title="Calculated from completed orders only">
            100%: <strong className="text-[#075E54]">₹{totalWorkAll.toLocaleString('en-IN')}</strong> · 30%:{' '}
            <strong className="text-amber-800">
              ₹{calcCommission30(totalWorkAll).toLocaleString('en-IN')}
            </strong>
          </span>
        </div>
      </div>

      {/* Vendor List */}
      {vendorGroups.length === 0 ? (
        <div className="bg-white border border-[#DCE4E0] rounded-xl p-8 text-center">
          <div className="text-sm font-semibold text-slate-800">
            No orders found for {selectedDate ? formatIndianDate(selectedDate) : 'All Dates'}.
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Change the date, cleaner, or status filter above to see vendor orders.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {vendorGroups.map((vendor) => {
            const isCollapsed = Boolean(collapsedVendors[vendor.name]);
            const comm30 = calcCommission30(vendor.totalWork);
            const share70 = Math.max(0, Math.round((vendor.totalWork - comm30) * 100) / 100);

            return (
              <section
                key={vendor.name}
                className="bg-white border border-slate-300 rounded-xl overflow-hidden shadow-2xs"
              >
                {/* Dark Highlighted Vendor Header */}
                <div
                  onClick={() => toggleCollapse(vendor.name)}
                  className={`px-4 py-2 bg-slate-800 text-white flex items-center justify-between gap-2 cursor-pointer select-none ${
                    !isCollapsed ? 'border-b border-slate-700' : ''
                  }`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-display text-sm sm:text-base font-bold text-white">
                      {vendor.name}
                    </h2>
                    <span className="text-xs font-mono-num font-semibold text-slate-300">
                      ({vendor.orders.length} order{vendor.orders.length > 1 ? 's' : ''})
                    </span>
                    <button
                      type="button"
                      onClick={(e) => e.stopPropagation()}
                      title="Total completed work (100%)"
                      className="px-2.5 py-0.5 rounded-md bg-white/15 border border-white/25 text-white text-xs font-mono-num font-semibold"
                    >
                      100%: ₹{vendor.totalWork.toLocaleString('en-IN')}
                    </button>
                    <button
                      type="button"
                      onClick={(e) => e.stopPropagation()}
                      title={`Vendor Share 70% (from completed total ₹${vendor.totalWork.toLocaleString('en-IN')})`}
                      className="px-2.5 py-0.5 rounded-md bg-emerald-500/20 border border-emerald-400/50 text-emerald-200 text-xs font-mono-num font-semibold"
                    >
                      70%: ₹{share70.toLocaleString('en-IN')}
                    </button>
                    <button
                      type="button"
                      onClick={(e) => e.stopPropagation()}
                      title={`Company Share 30% (from completed total ₹${vendor.totalWork.toLocaleString('en-IN')})`}
                      className="px-2.5 py-0.5 rounded-md bg-amber-500/20 border border-amber-400/50 text-amber-200 text-xs font-mono-num font-semibold"
                    >
                      30%: ₹{comm30.toLocaleString('en-IN')}
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleCollapse(vendor.name);
                    }}
                    aria-label={isCollapsed ? `Expand ${vendor.name}` : `Collapse ${vendor.name}`}
                    className="p-1 text-slate-300 hover:text-white cursor-pointer shrink-0"
                  >
                    {isCollapsed ? (
                      <ChevronDown className="w-4 h-4" />
                    ) : (
                      <ChevronUp className="w-4 h-4" />
                    )}
                  </button>
                </div>

                {/* Cleaner's Orders Table */}
                {!isCollapsed && (
                  <div className="overflow-x-auto sheet-scroll">
                    <table className="w-full text-left border-collapse min-w-[1060px] [&_td]:border-y [&_td]:border-r [&_td]:border-[#DCE4E0] [&_tr:first-child_td]:border-t-0 [&_tr:last-child_td]:border-b-0 [&_td:last-child]:border-r-0">
                      <colgroup>
                        <col className="w-10" />
                        <col className="w-24" />
                        <col />
                        <col className="w-28" />
                        <col className="w-28" />
                        <col className="w-24" />
                        <col />
                        <col className="w-12" />
                        <col className="w-24" />
                        <col className="w-28" />
                        <col className="w-48" />
                      </colgroup>
                      <tbody className="text-xs">
                        {vendor.orders.map((order, idx) => {
                          const total = getOrderTotal(order);
                          const isEditing = (field: InlineField) =>
                            editingCell?.id === order.id && editingCell.field === field;
                          const rowCopyKey = `row-${order.id}`;
                          const isRowCopied = copiedKey === rowCopyKey;

                          const isCompleted = order.status === 'completed';
                          const isSentTransfer = isSentTransferOrder(order);
                          const isReceivedTransfer = isReceivedTransferOrder(order);
                          const isOtherTransfer =
                            !isSentTransfer &&
                            !isReceivedTransfer &&
                            Boolean(order.transferredFromName);

                          const isPureRedRow =
                            isCompleted && !isSentTransfer && !isReceivedTransfer && !isOtherTransfer;

                          let rowClass = 'hover:bg-[#FAFDFB]';
                          if (isSentTransfer) {
                            rowClass =
                              'bg-purple-100 hover:bg-purple-200/80 text-purple-950 border-l-4 border-l-purple-700';
                          } else if (isReceivedTransfer) {
                            rowClass =
                              'bg-pink-200 hover:bg-pink-300/80 text-pink-950 border-l-4 border-l-pink-700';
                          } else if (isOtherTransfer) {
                            rowClass =
                              'bg-purple-50 hover:bg-purple-100/75 text-purple-950 border-l-4 border-l-purple-500';
                          } else if (isCompleted) {
                            rowClass =
                              'bg-red-600 hover:bg-red-700 text-white border-l-4 border-l-red-900 [&_td]:border-red-500';
                          }

                          return (
                            <tr key={order.id} className={`transition-colors ${rowClass}`}>
                              <td
                                className={`py-2 px-2.5 text-center font-mono-num font-semibold ${
                                  isSentTransfer
                                    ? 'text-purple-800'
                                    : isReceivedTransfer
                                      ? 'text-pink-900'
                                      : isPureRedRow
                                        ? 'text-white'
                                        : 'text-slate-500'
                                }`}
                              >
                                {idx + 1}
                              </td>

                              <td
                                onClick={() => !isEditing('bookingDate') && startInlineEdit(order, 'bookingDate')}
                                className={`py-2 px-2.5 font-mono-num whitespace-nowrap cursor-pointer ${
                                  isPureRedRow ? 'text-white' : 'text-slate-700'
                                }`}
                                title="Click to pick Aj / Kal / Parso / Date"
                              >
                                {isEditing('bookingDate') ? (
                                  <div
                                    className="space-y-1 min-w-[152px]"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    <div className="grid grid-cols-4 gap-1">
                                      {[
                                        { label: 'Aj', date: today },
                                        { label: 'Kal', date: tomorrow },
                                        { label: 'Parso', date: dateOffsetStr(2) },
                                      ].map((opt) => (
                                        <button
                                          key={opt.label}
                                          type="button"
                                          onClick={() => commitInlineEdit(order, opt.date)}
                                          className={`px-1 py-0.5 text-[10px] font-semibold rounded border cursor-pointer ${
                                            order.bookingDate === opt.date
                                              ? 'bg-[#075E54] text-white border-[#075E54]'
                                              : 'bg-white text-slate-700 border-[#DCE4E0] hover:bg-slate-50'
                                          }`}
                                        >
                                          {opt.label}
                                        </button>
                                      ))}
                                      <button
                                        type="button"
                                        onClick={() => setEditingCustomDate(true)}
                                        className={`px-1 py-0.5 text-[10px] font-semibold rounded border cursor-pointer ${
                                          editingCustomDate || !getIndianDayTag(order.bookingDate)
                                            ? 'bg-[#075E54] text-white border-[#075E54]'
                                            : 'bg-white text-slate-700 border-[#DCE4E0] hover:bg-slate-50'
                                        }`}
                                      >
                                        Date
                                      </button>
                                    </div>
                                    {(editingCustomDate || !getIndianDayTag(order.bookingDate)) && (
                                      <div className="flex items-center gap-1">
                                        <IndianDateInput
                                          ariaLabel="Pick custom booking date"
                                          title="Pick Date (DD/MM/YY)"
                                          value={editingValue}
                                          onChange={(val) => {
                                            if (val) commitInlineEdit(order, val);
                                          }}
                                          className="flex-1 border-[#128C7E]"
                                        />
                                        <button
                                          type="button"
                                          onClick={() => setEditingCell(null)}
                                          aria-label="Close date editor"
                                          className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
                                        >
                                          <X className="w-3 h-3" />
                                        </button>
                                      </div>
                                    )}
                                  </div>
                                ) : order.bookingDate ? (
                                  <div>
                                    <span>{formatIndianDate(order.bookingDate)}</span>
                                    {getIndianDayTag(order.bookingDate) && (
                                      <span
                                        className={`ml-1 text-[10px] font-semibold ${
                                          isPureRedRow ? 'text-red-100' : 'text-[#075E54]'
                                        }`}
                                      >
                                        ({getIndianDayTag(order.bookingDate)})
                                      </span>
                                    )}
                                  </div>
                                ) : (
                                  '—'
                                )}
                              </td>

                              <td
                                onClick={() => !isEditing('name') && startInlineEdit(order, 'name')}
                                className={`py-2 px-2.5 font-semibold cursor-text ${
                                  isPureRedRow ? 'text-white' : 'text-slate-900'
                                }`}
                                title="Click to edit customer name"
                              >
                                {isEditing('name') ? (
                                  <input
                                    autoFocus
                                    type="text"
                                    value={editingValue}
                                    onChange={(e) => setEditingValue(e.target.value)}
                                    onBlur={() => commitInlineEdit(order)}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') commitInlineEdit(order);
                                      if (e.key === 'Escape') setEditingCell(null);
                                    }}
                                    className="w-full px-1.5 py-0.5 text-xs border border-[#128C7E] rounded bg-white text-slate-900"
                                  />
                                ) : (
                                  <div>
                                    <div className="flex flex-wrap items-center gap-1.5">
                                      <span>
                                        {order.name || (order.isExtraWork ? 'Extra Work' : '—')}
                                      </span>
                                      {isCompleted && (isSentTransfer || isReceivedTransfer || isOtherTransfer) && (
                                        <span className="px-1.5 py-0.5 rounded bg-red-600 text-white text-[9px] font-semibold uppercase">
                                          Done
                                        </span>
                                      )}
                                    </div>
                                    {isSentTransfer && (
                                      <span className="inline-block mt-0.5 px-1.5 py-0.5 rounded bg-purple-700 text-white text-[10px] font-semibold">
                                        Sent to {order.createdByName}
                                      </span>
                                    )}
                                    {isReceivedTransfer && order.transferredFromName && (
                                      <span className="inline-block mt-0.5 px-1.5 py-0.5 rounded bg-pink-700 text-white text-[10px] font-semibold">
                                        Received from {order.transferredFromName}
                                      </span>
                                    )}
                                    {isOtherTransfer && order.transferredFromName && (
                                      <span className="inline-block mt-0.5 px-1.5 py-0.5 rounded bg-purple-700 text-white text-[10px] font-semibold">
                                        {order.transferredFromName} → {order.createdByName}
                                      </span>
                                    )}
                                  </div>
                                )}
                              </td>

                              <td
                                onClick={() =>
                                  !isEditing('number') &&
                                  !isEditing('altNumber') &&
                                  startInlineEdit(order, 'number')
                                }
                                className={`py-2 px-2.5 font-mono-num cursor-text group ${
                                  isPureRedRow ? 'text-white' : 'text-slate-800'
                                }`}
                                title="Click to edit phone"
                              >
                                {isEditing('number') ? (
                                  <input
                                    autoFocus
                                    type="text"
                                    inputMode="numeric"
                                    minLength={10}
                                    maxLength={10}
                                    pattern="\d{10}"
                                    title="Minimum 10, maximum 10 digits"
                                    value={editingValue}
                                    onChange={(e) =>
                                      setEditingValue(
                                        e.target.value.replace(/\D/g, '').slice(0, 10)
                                      )
                                    }
                                    onBlur={() => commitInlineEdit(order)}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') commitInlineEdit(order);
                                      if (e.key === 'Escape') setEditingCell(null);
                                    }}
                                    className="w-full px-1.5 py-0.5 text-xs border border-[#128C7E] rounded bg-white text-slate-900"
                                  />
                                ) : isEditing('altNumber') ? (
                                  <div className="space-y-1" onClick={(e) => e.stopPropagation()}>
                                    <div>{order.number || '—'}</div>
                                    <input
                                      autoFocus
                                      type="text"
                                      inputMode="numeric"
                                      maxLength={10}
                                      placeholder="Alt 10-digit"
                                      title="10-digit Alternate Number (clear to remove)"
                                      value={editingValue}
                                      onChange={(e) =>
                                        setEditingValue(
                                          e.target.value.replace(/\D/g, '').slice(0, 10)
                                        )
                                      }
                                      onBlur={() => commitInlineEdit(order)}
                                      onKeyDown={(e) => {
                                        if (e.key === 'Enter') commitInlineEdit(order);
                                        if (e.key === 'Escape') setEditingCell(null);
                                      }}
                                      className="w-full px-1.5 py-0.5 text-[11px] border border-[#128C7E] rounded bg-white text-slate-900"
                                    />
                                  </div>
                                ) : (
                                  <div>
                                    <span>{order.number || '—'}</span>
                                    {order.altNumber ? (
                                      <div
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          startInlineEdit(order, 'altNumber');
                                        }}
                                        title="Click to edit Alternate Number"
                                        className={`text-[11px] cursor-pointer ${
                                          isPureRedRow
                                            ? 'text-red-100 hover:text-white'
                                            : 'text-slate-500 hover:text-[#075E54]'
                                        }`}
                                      >
                                        Alt: {order.altNumber}
                                      </div>
                                    ) : (
                                      order.number && (
                                        <button
                                          type="button"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            startInlineEdit(order, 'altNumber');
                                          }}
                                          className={`hidden group-hover:block text-[10px] font-sans font-semibold hover:underline cursor-pointer ${
                                            isPureRedRow ? 'text-white' : 'text-[#128C7E]'
                                          }`}
                                        >
                                          + Alt No.
                                        </button>
                                      )
                                    )}
                                  </div>
                                )}
                              </td>

                              <td
                                onClick={() => {
                                  if (isSentTransfer && currentUser.role !== 'super_admin') {
                                    onNotify(
                                      'This order was transferred to another telecaller and cannot be edited here.',
                                      'error'
                                    );
                                    return;
                                  }
                                  setEditingCell(null);
                                  setServiceEditOrder(order);
                                }}
                                className={`py-2 px-2.5 cursor-pointer hover:underline ${
                                  isPureRedRow
                                    ? 'text-white hover:text-red-100'
                                    : 'text-slate-800 hover:text-[#075E54]'
                                }`}
                                title="Click to edit Services & Quantities"
                              >
                                {order.serviceName}
                              </td>

                              <td
                                onClick={() => !isEditing('city') && startInlineEdit(order, 'city')}
                                className={`py-2 px-2.5 cursor-pointer ${
                                  isPureRedRow ? 'text-white' : 'text-slate-700'
                                }`}
                                title="Click to change city"
                              >
                                {isEditing('city') ? (
                                  <select
                                    autoFocus
                                    value={editingValue}
                                    onChange={(e) => commitInlineEdit(order, e.target.value)}
                                    onBlur={() => commitInlineEdit(order)}
                                    className="w-full px-1 py-0.5 text-xs border border-[#128C7E] rounded bg-white text-slate-900"
                                  >
                                    {config.cities.map((c) => (
                                      <option key={c} value={c}>
                                        {c}
                                      </option>
                                    ))}
                                  </select>
                                ) : (
                                  order.city
                                )}
                              </td>

                              <td
                                onClick={() => !isEditing('address') && startInlineEdit(order, 'address')}
                                className={`py-2 px-2.5 max-w-[260px] cursor-text ${
                                  isPureRedRow ? 'text-white' : 'text-slate-600'
                                }`}
                                title="Click to edit address"
                              >
                                {isEditing('address') ? (
                                  <input
                                    autoFocus
                                    type="text"
                                    value={editingValue}
                                    onChange={(e) => setEditingValue(e.target.value)}
                                    onBlur={() => commitInlineEdit(order)}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') commitInlineEdit(order);
                                      if (e.key === 'Escape') setEditingCell(null);
                                    }}
                                    className="w-full px-1.5 py-0.5 text-xs border border-[#128C7E] rounded bg-white text-slate-900"
                                  />
                                ) : (
                                  <div>
                                    <div className="truncate">{order.address || '—'}</div>
                                    {order.notes && (
                                      <div
                                        className={`text-[11px] truncate ${
                                          isPureRedRow ? 'text-red-100' : 'text-slate-500'
                                        }`}
                                      >
                                        {order.notes}
                                      </div>
                                    )}
                                  </div>
                                )}
                              </td>

                              <td
                                onClick={() => !isEditing('qty') && startInlineEdit(order, 'qty')}
                                className={`py-2 px-2 text-right font-mono-num cursor-text ${
                                  isPureRedRow ? 'text-white' : 'text-slate-800'
                                }`}
                                title="Click to edit quantity"
                              >
                                {isEditing('qty') ? (
                                  <input
                                    autoFocus
                                    type="number"
                                    min={1}
                                    value={editingValue}
                                    onChange={(e) => setEditingValue(e.target.value)}
                                    onBlur={() => commitInlineEdit(order)}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') commitInlineEdit(order);
                                      if (e.key === 'Escape') setEditingCell(null);
                                    }}
                                    className="w-12 px-1 py-0.5 text-right text-xs border border-[#128C7E] rounded bg-white text-slate-900"
                                  />
                                ) : (
                                  order.qty ?? '—'
                                )}
                              </td>

                              <td
                                onClick={() => !isEditing('price') && startInlineEdit(order, 'price')}
                                className={`py-2 px-2.5 text-right font-mono-num font-bold cursor-text ${
                                  isPureRedRow ? 'text-white' : 'text-slate-900'
                                }`}
                                title="Click to edit price"
                              >
                                {isEditing('price') ? (
                                  <input
                                    autoFocus
                                    type="number"
                                    min={0}
                                    value={editingValue}
                                    onChange={(e) => setEditingValue(e.target.value)}
                                    onBlur={() => commitInlineEdit(order)}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') commitInlineEdit(order);
                                      if (e.key === 'Escape') setEditingCell(null);
                                    }}
                                    className="w-20 px-1 py-0.5 text-right text-xs border border-[#128C7E] rounded bg-white text-slate-900"
                                  />
                                ) : (
                                  <div>
                                    <span>₹{total.toLocaleString('en-IN')}</span>
                                    {order.extraAmount > 0 && (
                                      <div
                                        className={`text-[10px] font-normal ${
                                          isPureRedRow ? 'text-red-100' : 'text-blue-700'
                                        }`}
                                      >
                                        +₹{order.extraAmount}
                                      </div>
                                    )}
                                  </div>
                                )}
                              </td>

                              <td
                                onClick={() => !isEditing('cleanerName') && startInlineEdit(order, 'cleanerName')}
                                className={`py-2 px-2.5 font-medium cursor-pointer whitespace-nowrap ${
                                  isPureRedRow ? 'text-white' : 'text-[#075E54]'
                                }`}
                                title="Click to change or replace cleaner"
                              >
                                {isEditing('cleanerName') ? (
                                  <select
                                    autoFocus
                                    value={editingValue}
                                    onChange={(e) => commitInlineEdit(order, e.target.value)}
                                    onBlur={() => commitInlineEdit(order)}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Escape') setEditingCell(null);
                                    }}
                                    className="w-full px-1.5 py-0.5 text-xs border border-[#128C7E] rounded bg-white text-slate-800"
                                  >
                                    {cleanerOptions.map((cl) => (
                                      <option key={cl} value={cl}>
                                        {cl}
                                      </option>
                                    ))}
                                    {order.cleanerName && !cleanerOptions.includes(order.cleanerName) && (
                                      <option value={order.cleanerName}>{order.cleanerName}</option>
                                    )}
                                  </select>
                                ) : (
                                  <span>{order.cleanerName || 'Unassigned'}</span>
                                )}
                              </td>

                              <td className="py-2 px-2.5 text-right whitespace-nowrap">
                                <div className="inline-flex items-center gap-1">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      copyText(
                                        formatSingleOrderForWhatsApp(order, idx + 1),
                                        rowCopyKey,
                                        'Order WhatsApp ke liye copy ho gaya!'
                                      )
                                    }
                                    title={isRowCopied ? 'Copied' : 'Copy order for WhatsApp'}
                                    aria-label="Copy order for WhatsApp"
                                    className="p-1.5 bg-white border border-[#DCE4E0] hover:bg-slate-50 text-slate-700 rounded inline-flex items-center justify-center cursor-pointer"
                                  >
                                    {isRowCopied ? (
                                      <Check className="w-3.5 h-3.5 text-[#128C7E]" />
                                    ) : (
                                      <Copy className="w-3.5 h-3.5 text-slate-500" />
                                    )}
                                  </button>

                                  <button
                                    type="button"
                                    onClick={() => setInvoiceOrder(order)}
                                    title="Generate Invoice / Bill"
                                    aria-label="Generate Invoice / Bill"
                                    className="p-1.5 bg-white border border-[#DCE4E0] hover:bg-slate-50 text-[#075E54] rounded inline-flex items-center justify-center cursor-pointer"
                                  >
                                    <FileText className="w-3.5 h-3.5 text-[#075E54]" />
                                  </button>

                                  {!(isSentTransfer && currentUser.role !== 'super_admin') ? (
                                    <>
                                      <button
                                        type="button"
                                        onClick={() => setEditTargetOrder(order)}
                                        title="Edit order"
                                        aria-label="Edit order"
                                        className="p-1.5 bg-white border border-[#DCE4E0] hover:bg-slate-50 text-slate-700 rounded inline-flex items-center justify-center cursor-pointer"
                                      >
                                        <Pencil className="w-3.5 h-3.5 text-slate-600" />
                                      </button>

                                      <button
                                        type="button"
                                        onClick={() => setTransferTargetIds([order.id])}
                                        title="Send / Transfer order to another telecaller"
                                        aria-label="Transfer order to another telecaller"
                                        className="p-1.5 bg-white border border-[#DCE4E0] hover:bg-[#E9F7F0] text-[#075E54] rounded inline-flex items-center justify-center cursor-pointer"
                                      >
                                        <ArrowRightLeft className="w-3.5 h-3.5 text-[#075E54]" />
                                      </button>

                                      {Boolean(order.transferredFromId) &&
                                        (currentUser.role === 'super_admin' ||
                                          order.transferredFromId === currentUser.id) && (
                                          <button
                                            type="button"
                                            disabled={unsendingId === order.id}
                                            onClick={() => handleQuickUnsend(order.id)}
                                            title={`Unsend transfer back to ${order.transferredFromName || 'original owner'}`}
                                            aria-label="Unsend transfer"
                                            className="px-2 py-1 text-[11px] font-semibold bg-white hover:bg-purple-50 text-purple-800 border border-purple-300 rounded inline-flex items-center gap-1 cursor-pointer disabled:opacity-50"
                                          >
                                            <Undo2 className="w-3 h-3" />
                                            {unsendingId === order.id ? 'Unsending...' : 'Unsend'}
                                          </button>
                                        )}

                                      {order.status === 'active' ? (
                                        <button
                                          type="button"
                                          onClick={() =>
                                            onUpdateOrder(order.id, { status: 'completed' })
                                          }
                                          title="Mark order as done"
                                          aria-label="Mark order as done"
                                          className="p-1.5 bg-[#128C7E] hover:bg-[#075E54] text-white rounded inline-flex items-center justify-center cursor-pointer"
                                        >
                                          <CheckCircle2 className="w-3.5 h-3.5" />
                                        </button>
                                      ) : (
                                        <button
                                          type="button"
                                          onClick={() =>
                                            onUpdateOrder(order.id, { status: 'active' })
                                          }
                                          title="Reopen order"
                                          aria-label="Reopen order"
                                          className="p-1.5 bg-white border border-[#DCE4E0] hover:bg-slate-50 text-slate-700 rounded inline-flex items-center justify-center cursor-pointer"
                                        >
                                          <RotateCcw className="w-3.5 h-3.5" />
                                        </button>
                                      )}

                                      <button
                                        type="button"
                                        onClick={() => setDeleteTargetOrder(order)}
                                        title="Delete order"
                                        aria-label="Delete order"
                                        className="p-1.5 bg-white border border-red-200 hover:bg-red-50 text-red-600 rounded inline-flex items-center justify-center cursor-pointer"
                                      >
                                        <Trash2 className="w-3.5 h-3.5" />
                                      </button>
                                    </>
                                  ) : (
                                    <div className="inline-flex items-center gap-1">
                                      <span className="px-2 py-1 text-[11px] font-semibold bg-purple-700 text-white rounded">
                                        Sent ({order.createdByName})
                                      </span>
                                      <button
                                        type="button"
                                        disabled={unsendingId === order.id}
                                        onClick={() => handleQuickUnsend(order.id)}
                                        title={`Unsend transfer from ${order.createdByName} back to your dashboard`}
                                        aria-label="Unsend transfer"
                                        className="px-2 py-1 text-[11px] font-semibold bg-white hover:bg-purple-50 text-purple-800 border border-purple-300 rounded inline-flex items-center gap-1 cursor-pointer disabled:opacity-50"
                                      >
                                        <Undo2 className="w-3 h-3" />
                                        {unsendingId === order.id ? 'Unsending...' : 'Unsend'}
                                      </button>
                                    </div>
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}

      {/* Auto Bill & Invoice Modal */}
      <InvoiceModal
        order={invoiceOrder}
        onClose={() => setInvoiceOrder(null)}
        onNotify={onNotify}
      />

      {/* Pass Order to Another Telecaller Modal */}
      <TransferOrderModal
        ordersToTransfer={transferTargetOrders}
        staffMembers={config.telecallers || []}
        currentUser={currentUser}
        onClose={() => setTransferTargetIds(null)}
        onTransfer={onTransferOrders}
        onUntransfer={onUntransferOrders}
      />

      {/* Delete Yes / No Confirmation Popup */}
      <ConfirmDialog
        open={Boolean(deleteTargetOrder)}
        title="Delete this order?"
        message={
          deleteTargetOrder
            ? `Are you sure you want to delete booking for ${deleteTargetOrder.name || deleteTargetOrder.number} (${deleteTargetOrder.serviceName} - ₹${deleteTargetOrder.price})?`
            : ''
        }
        confirmLabel="Yes, Delete"
        cancelLabel="No, Keep"
        loading={deleting}
        onCancel={() => setDeleteTargetOrder(null)}
        onConfirm={async () => {
          if (!deleteTargetOrder) return;
          setDeleting(true);
          try {
            await onDeleteOrder(deleteTargetOrder.id);
            setDeleteTargetOrder(null);
          } finally {
            setDeleting(false);
          }
        }}
      />
      {/* Edit Services & Quantities Modal */}
      <ServiceEditModal
        order={serviceEditOrder}
        services={config.services}
        onClose={() => setServiceEditOrder(null)}
        onSave={onUpdateOrder}
      />

      {/* Full Order Edit Modal */}
      <OrderEditModal
        order={editTargetOrder}
        config={config}
        onClose={() => setEditTargetOrder(null)}
        onSave={onUpdateOrder}
      />
    </div>
  );
};
