import React, { useEffect, useMemo, useState } from 'react';
import {
  Calendar,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  FileText,
  MapPin,
  Phone,
  Plus,
  Search,
  X,
} from 'lucide-react';
import {
  calcCommission30,
  getOrderTotal,
  getPaidCommission,
  getPendingCommission,
} from '../lib/api';
import { InvoiceModal } from './InvoiceModal';
import type {
  NewOrderPayload,
  Order,
  PaymentStatus,
  PortalConfig,
  UserPublic,
} from '../types';

interface VendorPaymentsProps {
  orders: Order[];
  config: PortalConfig;
  currentUser: UserPublic;
  onAddOrder: (payload: NewOrderPayload) => Promise<void>;
  onUpdateOrder: (id: string, patch: Partial<Order>) => Promise<void>;
  onBulkUpdatePayment: (ids: string[], paymentStatus: PaymentStatus) => Promise<void>;
  onBulkUpdatePartialPayments: (
    updates: Array<{ id: string; paidCommission: number; paymentNote?: string }>
  ) => Promise<void>;
  onNotify: (msg: string, type?: 'success' | 'error') => void;
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
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

function formatRupee(val: number): string {
  return val.toLocaleString('en-IN', {
    maximumFractionDigits: 2,
  });
}

function toDateStr(y: number, mZero: number, d: number): string {
  return `${y}-${String(mZero + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function todayStr(): string {
  const d = new Date();
  return toDateStr(d.getFullYear(), d.getMonth(), d.getDate());
}

function monthRange(year: number, monthZero: number): { from: string; to: string } {
  const lastDay = new Date(year, monthZero + 1, 0).getDate();
  return {
    from: toDateStr(year, monthZero, 1),
    to: toDateStr(year, monthZero, lastDay),
  };
}

function formatReadableDate(iso: string): string {
  if (!iso || iso === 'NO_DATE') return 'No Booking Date';
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  return `${String(d).padStart(2, '0')} ${MONTH_NAMES[m - 1].slice(0, 3)} ${y}`;
}

export const VendorPayments: React.FC<VendorPaymentsProps> = ({
  orders,
  config,
  currentUser,
  onAddOrder,
  onUpdateOrder,
  onBulkUpdatePayment,
  onBulkUpdatePartialPayments,
  onNotify,
}) => {
  const now = useMemo(() => new Date(), []);
  const initialMonth = useMemo(() => monthRange(now.getFullYear(), now.getMonth()), [now]);

  const [vendorSearch, setVendorSearch] = useState('');
  const [invoiceOrder, setInvoiceOrder] = useState<Order | null>(null);
  const [telecallerFilter, setTelecallerFilter] = useState('all');

  // Earning Date-to-Date Filter (defaults to This Month)
  const [earningFrom, setEarningFrom] = useState(initialMonth.from);
  const [earningTo, setEarningTo] = useState(initialMonth.to);

  const [viewYear, setViewYear] = useState(now.getFullYear());
  const [viewMonth, setViewMonth] = useState(now.getMonth());

  const [selectedVendor, setSelectedVendor] = useState<string>('');
  const [selectedDate, setSelectedDate] = useState<string>(() => todayStr());
  const [dayModalOpen, setDayModalOpen] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);

  // Day-level partial payment input inside popup
  const [dayReceivedInput, setDayReceivedInput] = useState('');
  const [dayPayNote, setDayPayNote] = useState('');

  // Inline extraAmount or paidCommission edit on an order inside popup
  const [editingExtraId, setEditingExtraId] = useState<string | null>(null);
  const [editingExtraVal, setEditingExtraVal] = useState('');
  const [editingPaidId, setEditingPaidId] = useState<string | null>(null);
  const [editingPaidVal, setEditingPaidVal] = useState('');

  // Inline "+ Extra / Pados Work" inside popup
  const [showExtraForm, setShowExtraForm] = useState(false);
  const [extraAmountInput, setExtraAmountInput] = useState('');
  const [extraService, setExtraService] = useState(config.services[0] || 'Water tank');
  const [extraCity, setExtraCity] = useState(config.cities[0] || 'Patiala');
  const [extraNote, setExtraNote] = useState('');
  const [savingExtra, setSavingExtra] = useState(false);

  useEffect(() => {
    if (!dayModalOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDayModalOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dayModalOpen]);

  const uniqueTelecallers = useMemo(() => {
    const map = new Map<string, string>();
    for (const o of orders) {
      if (o.createdById && o.createdByName) {
        map.set(o.createdById, o.createdByName);
      }
    }
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [orders]);

  // Orders scoped by Telecaller (used by calendar so browsing any month always works)
  const telecallerOrders = useMemo(() => {
    if (telecallerFilter === 'all') return orders;
    return orders.filter((o) => o.createdById === telecallerFilter);
  }, [orders, telecallerFilter]);

  // Orders scoped by Date-to-Date Earning filter (used for Earning Summary & Vendor Cards)
  const rangeOrders = useMemo(() => {
    return telecallerOrders.filter((o) => {
      if (earningFrom && (!o.bookingDate || o.bookingDate < earningFrom)) return false;
      if (earningTo && (!o.bookingDate || o.bookingDate > earningTo)) return false;
      return true;
    });
  }, [telecallerOrders, earningFrom, earningTo]);

  // Simple Vendor Directory: Cleaner Name + Phone Number + City + Pending 30% Commission
  const vendors = useMemo(() => {
    const names = new Set<string>(config.cleaners);
    for (const o of telecallerOrders) {
      if (o.cleanerName?.trim()) names.add(o.cleanerName.trim());
    }

    const list = Array.from(names).map((cleanerName) => {
      const vRangeOrders = rangeOrders.filter(
        (o) => o.cleanerName.trim().toLowerCase() === cleanerName.toLowerCase()
      );
      const vAllOrders = telecallerOrders.filter(
        (o) => o.cleanerName.trim().toLowerCase() === cleanerName.toLowerCase()
      );
      const profileKey = Object.keys(config.cleanerProfiles || {}).find(
        (k) => k.toLowerCase() === cleanerName.toLowerCase()
      );
      const profile = profileKey ? config.cleanerProfiles[profileKey] : undefined;

      const inferredCity = profile?.city || vAllOrders[0]?.city || '—';
      const phone = profile?.phone || '';

      let totalWork = 0;
      let totalComm = 0;
      let paidComm = 0;
      let pendingComm = 0;

      for (const o of vRangeOrders) {
        const w = getOrderTotal(o);
        const c = calcCommission30(w);
        const p = getPaidCommission(o);
        const rem = getPendingCommission(o);
        totalWork += w;
        totalComm += c;
        paidComm += p;
        pendingComm += rem;
      }

      const vendorEarning70 = Math.round((totalWork - totalComm) * 100) / 100;

      return {
        name: cleanerName,
        phone,
        city: inferredCity,
        rangeOrderCount: vRangeOrders.length,
        totalWork,
        vendorEarning70,
        totalComm: Math.round(totalComm * 100) / 100,
        paidComm: Math.round(paidComm * 100) / 100,
        pendingComm: Math.round(pendingComm * 100) / 100,
      };
    });

    return list.sort(
      (a, b) =>
        b.pendingComm - a.pendingComm ||
        b.totalWork - a.totalWork ||
        a.name.localeCompare(b.name)
    );
  }, [config.cleaners, config.cleanerProfiles, telecallerOrders, rangeOrders]);

  const filteredVendors = useMemo(() => {
    const q = vendorSearch.trim().toLowerCase();
    if (!q) return vendors;
    return vendors.filter(
      (v) =>
        v.name.toLowerCase().includes(q) ||
        v.phone.toLowerCase().includes(q) ||
        v.city.toLowerCase().includes(q)
    );
  }, [vendors, vendorSearch]);

  useEffect(() => {
    if (!selectedVendor && vendors.length > 0) {
      setSelectedVendor(vendors[0].name);
    }
  }, [vendors, selectedVendor]);

  const activeVendorInfo = useMemo(
    () =>
      vendors.find((v) => v.name.toLowerCase() === selectedVendor.toLowerCase()) ||
      vendors[0] ||
      null,
    [vendors, selectedVendor]
  );

  const vendorCalendarOrders = useMemo(() => {
    if (!activeVendorInfo) return [];
    return telecallerOrders.filter(
      (o) => o.cleanerName.trim().toLowerCase() === activeVendorInfo.name.toLowerCase()
    );
  }, [telecallerOrders, activeVendorInfo]);

  const ordersByDate = useMemo(() => {
    const map = new Map<
      string,
      {
        orders: Order[];
        totalWork: number;
        totalComm: number;
        paidComm: number;
        pendingComm: number;
      }
    >();

    for (const o of vendorCalendarOrders) {
      const key =
        o.bookingDate && /^\d{4}-\d{2}-\d{2}$/.test(o.bookingDate) ? o.bookingDate : 'NO_DATE';
      const entry = map.get(key) || {
        orders: [],
        totalWork: 0,
        totalComm: 0,
        paidComm: 0,
        pendingComm: 0,
      };
      const w = getOrderTotal(o);
      const c = calcCommission30(w);
      const p = getPaidCommission(o);
      const rem = getPendingCommission(o);

      entry.orders.push(o);
      entry.totalWork += w;
      entry.totalComm = Math.round((entry.totalComm + c) * 100) / 100;
      entry.paidComm = Math.round((entry.paidComm + p) * 100) / 100;
      entry.pendingComm = Math.round((entry.pendingComm + rem) * 100) / 100;
      map.set(key, entry);
    }
    return map;
  }, [vendorCalendarOrders]);

  const handleSelectVendor = (vendorName: string) => {
    setSelectedVendor(vendorName);
    setDayModalOpen(false);
    setShowExtraForm(false);

    const vOrders = telecallerOrders.filter(
      (o) => o.cleanerName.trim().toLowerCase() === vendorName.toLowerCase()
    );
    const pendingDated = vOrders
      .filter((o) => getPendingCommission(o) > 0 && /^\d{4}-\d{2}-\d{2}$/.test(o.bookingDate))
      .sort((a, b) => b.bookingDate.localeCompare(a.bookingDate));
    const anyDated = vOrders
      .filter((o) => /^\d{4}-\d{2}-\d{2}$/.test(o.bookingDate))
      .sort((a, b) => b.bookingDate.localeCompare(a.bookingDate));

    const targetDate = pendingDated[0]?.bookingDate || anyDated[0]?.bookingDate || todayStr();
    setSelectedDate(targetDate);
    const [y, m] = targetDate.split('-').map(Number);
    if (y && m) {
      setViewYear(y);
      setViewMonth(m - 1);
    }
  };

  const applyEarningPreset = (preset: 'this_month' | 'last_month' | 'all') => {
    if (preset === 'all') {
      setEarningFrom('');
      setEarningTo('');
      return;
    }
    const base = new Date();
    const target =
      preset === 'this_month'
        ? new Date(base.getFullYear(), base.getMonth(), 1)
        : new Date(base.getFullYear(), base.getMonth() - 1, 1);
    const range = monthRange(target.getFullYear(), target.getMonth());
    setEarningFrom(range.from);
    setEarningTo(range.to);
    setViewYear(target.getFullYear());
    setViewMonth(target.getMonth());
  };

  const calendarCells = useMemo(() => {
    const firstDay = new Date(viewYear, viewMonth, 1);
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const startOffset = (firstDay.getDay() + 6) % 7;

    const cells: ({ day: number; dateStr: string } | null)[] = [];
    for (let i = 0; i < startOffset; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) {
      cells.push({ day: d, dateStr: toDateStr(viewYear, viewMonth, d) });
    }
    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
  }, [viewYear, viewMonth]);

  const selectedDayData = useMemo(() => {
    const entry = ordersByDate.get(selectedDate);
    if (!entry) {
      return {
        orders: [],
        totalWork: 0,
        totalComm: 0,
        paidComm: 0,
        pendingComm: 0,
      };
    }
    return entry;
  }, [ordersByDate, selectedDate]);

  // Sync partial payment input when opening/updating selected day
  useEffect(() => {
    if (dayModalOpen) {
      setDayReceivedInput(String(selectedDayData.paidComm));
      const existingNote = selectedDayData.orders.find((o) => o.paymentNote)?.paymentNote || '';
      setDayPayNote(existingNote);
    }
  }, [dayModalOpen, selectedDate, selectedDayData.paidComm]);

  const noDateData = ordersByDate.get('NO_DATE');

  const changeMonth = (delta: number) => {
    const next = new Date(viewYear, viewMonth + delta, 1);
    setViewYear(next.getFullYear());
    setViewMonth(next.getMonth());
  };

  const handleOpenDatePopup = (dateStr: string) => {
    setSelectedDate(dateStr);
    setShowExtraForm(false);
    setDayModalOpen(true);
  };

  const handleSetDayPayment = async (ids: string[], nextStatus: PaymentStatus) => {
    if (ids.length === 0) return;
    setBulkBusy(true);
    try {
      await onBulkUpdatePayment(ids, nextStatus);
    } finally {
      setBulkBusy(false);
    }
  };

  // Save partial / custom lump-sum received amount for the whole day (e.g. 2800 out of 3000 -> 200 held)
  const handleSaveDayPartialPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedDayData.orders.length === 0) return;

    const raw = Number(dayReceivedInput);
    if (!Number.isFinite(raw) || raw < 0) {
      onNotify('Enter valid received amount (₹).', 'error');
      return;
    }

    let remainingToDistribute = Math.min(selectedDayData.totalComm, raw);
    const updates: Array<{ id: string; paidCommission: number; paymentNote?: string }> = [];

    selectedDayData.orders.forEach((order, index) => {
      const orderComm30 = calcCommission30(getOrderTotal(order));
      const allocated = Math.min(
        orderComm30,
        Math.max(0, Math.round(remainingToDistribute * 100) / 100)
      );
      remainingToDistribute = Math.max(0, Math.round((remainingToDistribute - allocated) * 100) / 100);
      updates.push({
        id: order.id,
        paidCommission: allocated,
        paymentNote: index === 0 ? dayPayNote.trim() : undefined,
      });
    });

    setBulkBusy(true);
    try {
      await onBulkUpdatePartialPayments(updates);
    } finally {
      setBulkBusy(false);
    }
  };

  const handleSaveExtraAmount = async (order: Order) => {
    const raw = editingExtraVal.trim();
    setEditingExtraId(null);
    const num = raw === '' ? 0 : Number(raw);
    if (!Number.isFinite(num) || num < 0 || num === Number(order.extraAmount || 0)) return;
    await onUpdateOrder(order.id, { extraAmount: num });
  };

  const handleSaveOrderPaidComm = async (order: Order) => {
    const raw = editingPaidVal.trim();
    setEditingPaidId(null);
    const num = raw === '' ? 0 : Number(raw);
    if (!Number.isFinite(num) || num < 0) return;
    const comm30 = calcCommission30(getOrderTotal(order));
    const clamped = Math.min(comm30, num);
    if (clamped === getPaidCommission(order)) return;
    await onUpdateOrder(order.id, { paidCommission: clamped });
  };

  const handleAddExtraWorkOnDate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeVendorInfo) return;
    const amount = Number(extraAmountInput);
    if (!Number.isFinite(amount) || amount <= 0) {
      onNotify('Enter valid work amount (₹).', 'error');
      return;
    }

    setSavingExtra(true);
    try {
      await onAddOrder({
        name: extraNote.trim() || 'Pados / Extra Work',
        number: '',
        bookingDate: selectedDate === 'NO_DATE' ? todayStr() : selectedDate,
        address: extraNote.trim(),
        serviceName: extraService,
        city: activeVendorInfo.city !== '—' ? activeVendorInfo.city : extraCity,
        qty: 1,
        price: amount,
        extraAmount: 0,
        cleanerName: activeVendorInfo.name,
        notes: extraNote.trim() || 'Pados / Extra on-site work',
        status: 'completed',
        paymentStatus: 'pending',
        paidCommission: 0,
        isExtraWork: true,
      });
      setExtraAmountInput('');
      setExtraNote('');
      setShowExtraForm(false);
    } finally {
      setSavingExtra(false);
    }
  };

  const thisMonthRange = monthRange(now.getFullYear(), now.getMonth());
  const prevMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonthRange = monthRange(prevMonthDate.getFullYear(), prevMonthDate.getMonth());

  const liveDayBalance = useMemo(() => {
    const val = Number(dayReceivedInput);
    if (!Number.isFinite(val) || val < 0) return selectedDayData.totalComm;
    return Math.max(0, Math.round((selectedDayData.totalComm - Math.min(selectedDayData.totalComm, val)) * 100) / 100);
  }, [dayReceivedInput, selectedDayData.totalComm]);

  return (
    <div className="flex flex-col lg:flex-row gap-5 items-start">
      {/* Left Column: Simple Vendor List (Cleaner Name + Phone + City) */}
      <aside className="w-full lg:w-[340px] shrink-0 bg-white border border-[#DCE4E0] rounded-xl overflow-hidden">
        <div className="px-4 py-3 bg-[#075E54] text-white">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-sm font-bold">Cleaners / Vendors</h2>
            <span className="text-[11px] text-white/80 font-mono-num">
              {vendors.length} vendors
            </span>
          </div>
          <p className="text-[11px] text-emerald-100/85 mt-0.5">
            Click cleaner → click date box for 30% commission popup
          </p>
        </div>

        <div className="p-3 border-b border-[#DCE4E0] space-y-2 bg-[#FAFDFB]">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={vendorSearch}
              onChange={(e) => setVendorSearch(e.target.value)}
              placeholder="Search cleaner, number, city..."
              className="w-full pl-7 pr-2.5 py-1.5 text-xs bg-white border border-[#DCE4E0] rounded-lg focus:outline-none focus:border-[#128C7E]"
            />
          </div>

          {currentUser.role === 'super_admin' && uniqueTelecallers.length > 0 && (
            <select
              aria-label="Filter by telecaller"
              value={telecallerFilter}
              onChange={(e) => setTelecallerFilter(e.target.value)}
              className="w-full px-2.5 py-1.5 text-xs bg-white border border-[#DCE4E0] rounded-lg text-slate-700 focus:outline-none focus:border-[#128C7E]"
            >
              <option value="all">All Telecallers</option>
              {uniqueTelecallers.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="divide-y divide-[#DCE4E0] max-h-[600px] overflow-y-auto">
          {filteredVendors.length === 0 ? (
            <div className="p-6 text-center text-xs text-slate-500">
              No matching cleaners found.
            </div>
          ) : (
            filteredVendors.map((v) => {
              const isSelected = activeVendorInfo?.name.toLowerCase() === v.name.toLowerCase();
              return (
                <button
                  key={v.name}
                  type="button"
                  onClick={() => handleSelectVendor(v.name)}
                  className={`w-full text-left px-4 py-3 transition-colors cursor-pointer ${
                    isSelected
                      ? 'bg-[#EAF7F0] border-l-4 border-l-[#075E54]'
                      : 'bg-white hover:bg-[#F7F9F8]'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-display text-sm font-bold text-slate-900 truncate">
                      {v.name}
                    </span>
                    {v.pendingComm > 0 ? (
                      <span className="px-2 py-0.5 rounded bg-red-50 border border-red-200 text-red-700 text-[11px] font-mono-num font-bold shrink-0">
                        Baaki: ₹{formatRupee(v.pendingComm)}
                      </span>
                    ) : v.rangeOrderCount > 0 ? (
                      <span className="px-2 py-0.5 rounded bg-emerald-50 border border-emerald-200 text-[#075E54] text-[11px] font-semibold shrink-0">
                        All Clear
                      </span>
                    ) : (
                      <span className="text-[11px] text-slate-400 shrink-0">No Orders</span>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-slate-600 mt-1">
                    <span className="inline-flex items-center gap-1 font-mono-num">
                      <Phone className="w-3 h-3 text-slate-400" />
                      {v.phone || 'No number'}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <MapPin className="w-3 h-3 text-slate-400" />
                      {v.city}
                    </span>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </aside>

      {/* Right Column: Date-to-Date Earning Filter + Vendor Payment Calendar */}
      <div className="flex-1 min-w-0 w-full space-y-4">
        {!activeVendorInfo ? (
          <div className="bg-white border border-[#DCE4E0] rounded-xl p-10 text-center text-sm text-slate-500">
            Select a cleaner on the left to view their earning & payment calendar.
          </div>
        ) : (
          <>
            {/* Date-to-Date / Monthly Earning Filter & Vendor Earning Summary */}
            <div className="bg-white border border-[#DCE4E0] rounded-xl p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2.5">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-display text-base font-bold text-slate-900">
                      {activeVendorInfo.name}
                    </h2>
                    {activeVendorInfo.phone && (
                      <span className="text-xs font-mono-num text-slate-600 inline-flex items-center gap-1">
                        <Phone className="w-3 h-3 text-slate-400" />
                        {activeVendorInfo.phone}
                      </span>
                    )}
                    <span className="text-xs text-slate-600 inline-flex items-center gap-1">
                      <MapPin className="w-3 h-3 text-slate-400" />
                      {activeVendorInfo.city}
                    </span>
                  </div>
                </div>

                {/* Date-to-Date Earning Filter Controls */}
                <div className="flex flex-wrap items-center gap-1.5 text-xs">
                  <button
                    type="button"
                    onClick={() => applyEarningPreset('this_month')}
                    className={`px-2.5 py-1 rounded border cursor-pointer font-medium ${
                      earningFrom === thisMonthRange.from && earningTo === thisMonthRange.to
                        ? 'bg-[#075E54] text-white border-[#075E54]'
                        : 'bg-white text-slate-700 border-[#DCE4E0] hover:bg-[#F7F9F8]'
                    }`}
                  >
                    This Month
                  </button>
                  <button
                    type="button"
                    onClick={() => applyEarningPreset('last_month')}
                    className={`px-2.5 py-1 rounded border cursor-pointer font-medium ${
                      earningFrom === lastMonthRange.from && earningTo === lastMonthRange.to
                        ? 'bg-[#075E54] text-white border-[#075E54]'
                        : 'bg-white text-slate-700 border-[#DCE4E0] hover:bg-[#F7F9F8]'
                    }`}
                  >
                    Last Month
                  </button>
                  <button
                    type="button"
                    onClick={() => applyEarningPreset('all')}
                    className={`px-2.5 py-1 rounded border cursor-pointer font-medium ${
                      !earningFrom && !earningTo
                        ? 'bg-[#075E54] text-white border-[#075E54]'
                        : 'bg-white text-slate-700 border-[#DCE4E0] hover:bg-[#F7F9F8]'
                    }`}
                  >
                    All Dates
                  </button>

                  <div className="flex items-center gap-1 ml-1">
                    <span className="text-slate-500">From</span>
                    <input
                      type="date"
                      aria-label="Earning from date"
                      value={earningFrom}
                      onChange={(e) => setEarningFrom(e.target.value)}
                      className="px-2 py-1 text-xs font-mono-num bg-white border border-[#DCE4E0] rounded text-slate-700 focus:outline-none focus:border-[#128C7E]"
                    />
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-slate-500">To</span>
                    <input
                      type="date"
                      aria-label="Earning to date"
                      value={earningTo}
                      onChange={(e) => setEarningTo(e.target.value)}
                      className="px-2 py-1 text-xs font-mono-num bg-white border border-[#DCE4E0] rounded text-slate-700 focus:outline-none focus:border-[#128C7E]"
                    />
                  </div>
                </div>
              </div>

              {/* Earning & Commission Summary Strip for Selected Date Range */}
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5 pt-1">
                <div className="bg-[#FAFDFB] border border-[#DCE4E0] rounded-lg p-2.5">
                  <div className="text-[11px] text-slate-500 font-medium">100% Total Kaam</div>
                  <div className="text-base font-display font-bold font-mono-num text-slate-900 mt-0.5">
                    ₹{formatRupee(activeVendorInfo.totalWork)}
                  </div>
                  <div className="text-[10px] text-slate-500">
                    {activeVendorInfo.rangeOrderCount} order(s)
                  </div>
                </div>

                <div className="bg-[#EAF7F0] border border-[#BFEAD1] rounded-lg p-2.5">
                  <div className="text-[11px] text-[#075E54] font-semibold">
                    Vendor Earning (70%)
                  </div>
                  <div className="text-base font-display font-bold font-mono-num text-[#075E54] mt-0.5">
                    ₹{formatRupee(activeVendorInfo.vendorEarning70)}
                  </div>
                  <div className="text-[10px] text-[#075E54]/80">Selected range</div>
                </div>

                <div className="bg-[#FFF7ED] border border-amber-200 rounded-lg p-2.5">
                  <div className="text-[11px] text-amber-900 font-semibold">30% Company Comm</div>
                  <div className="text-base font-display font-bold font-mono-num text-amber-900 mt-0.5">
                    ₹{formatRupee(activeVendorInfo.totalComm)}
                  </div>
                  <div className="text-[10px] text-amber-800/80">Total due</div>
                </div>

                <div className="bg-white border border-[#DCE4E0] rounded-lg p-2.5">
                  <div className="text-[11px] text-slate-500 font-medium">Received (Mil Gaya)</div>
                  <div className="text-base font-display font-bold font-mono-num text-[#128C7E] mt-0.5">
                    ₹{formatRupee(activeVendorInfo.paidComm)}
                  </div>
                  <div className="text-[10px] text-slate-500">Paid so far</div>
                </div>

                <div
                  className={`rounded-lg p-2.5 border ${
                    activeVendorInfo.pendingComm > 0
                      ? 'bg-red-50 border-red-300'
                      : 'bg-emerald-50 border-emerald-200'
                  }`}
                >
                  <div
                    className={`text-[11px] font-semibold ${
                      activeVendorInfo.pendingComm > 0 ? 'text-red-800' : 'text-[#075E54]'
                    }`}
                  >
                    Pending / Roka Hua
                  </div>
                  <div
                    className={`text-base font-display font-bold font-mono-num mt-0.5 ${
                      activeVendorInfo.pendingComm > 0 ? 'text-red-700' : 'text-[#075E54]'
                    }`}
                  >
                    ₹{formatRupee(activeVendorInfo.pendingComm)}
                  </div>
                  <div className="text-[10px] text-slate-600">Leni hai</div>
                </div>
              </div>
            </div>

            {/* Monthly Calendar Grid */}
            <div className="bg-white border border-[#DCE4E0] rounded-xl p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-4 text-xs">
                  <span className="inline-flex items-center gap-1.5 text-slate-700">
                    <span className="w-3.5 h-3.5 rounded bg-red-100 border border-red-400 inline-block" />
                    Red Box = Pending / Baaki (100, 200 Roka Hua)
                  </span>
                  <span className="inline-flex items-center gap-1.5 text-slate-700">
                    <span className="w-3.5 h-3.5 rounded bg-emerald-100 border border-emerald-400 inline-block" />
                    Green Box = Full Clear
                  </span>
                </div>

                {/* Month Navigation */}
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => changeMonth(-1)}
                    aria-label="Previous month"
                    className="p-1.5 bg-[#F7F9F8] hover:bg-[#EFF4F1] border border-[#DCE4E0] rounded-lg cursor-pointer"
                  >
                    <ChevronLeft className="w-4 h-4 text-slate-700" />
                  </button>
                  <div className="px-3 py-1.5 text-xs font-bold text-slate-900 bg-[#FAFDFB] border border-[#DCE4E0] rounded-lg min-w-[130px] text-center inline-flex items-center justify-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5 text-[#075E54]" />
                    {MONTH_NAMES[viewMonth]} {viewYear}
                  </div>
                  <button
                    type="button"
                    onClick={() => changeMonth(1)}
                    aria-label="Next month"
                    className="p-1.5 bg-[#F7F9F8] hover:bg-[#EFF4F1] border border-[#DCE4E0] rounded-lg cursor-pointer"
                  >
                    <ChevronRight className="w-4 h-4 text-slate-700" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const t = new Date();
                      setViewYear(t.getFullYear());
                      setViewMonth(t.getMonth());
                      setSelectedDate(todayStr());
                    }}
                    className="px-2.5 py-1.5 text-xs font-medium bg-white hover:bg-[#F7F9F8] border border-[#DCE4E0] rounded-lg text-slate-700 cursor-pointer"
                  >
                    Today
                  </button>
                </div>
              </div>

              {noDateData && noDateData.orders.length > 0 && (
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => handleOpenDatePopup('NO_DATE')}
                    className={`px-2.5 py-1 rounded text-xs font-semibold border cursor-pointer ${
                      noDateData.pendingComm > 0
                        ? 'bg-red-50 border-red-300 text-red-700'
                        : 'bg-emerald-50 border-emerald-300 text-[#075E54]'
                    }`}
                  >
                    No Date Orders ({noDateData.orders.length})
                  </button>
                </div>
              )}

              <div className="grid grid-cols-7 gap-1.5">
                {WEEKDAYS.map((wd) => (
                  <div
                    key={wd}
                    className="text-center text-[11px] font-semibold text-slate-500 py-1 uppercase"
                  >
                    {wd}
                  </div>
                ))}

                {calendarCells.map((cell, idx) => {
                  if (!cell) {
                    return <div key={`empty-${idx}`} className="h-24 rounded-lg bg-[#FAFDFB]" />;
                  }

                  const dayInfo = ordersByDate.get(cell.dateStr);
                  const hasOrders = Boolean(dayInfo && dayInfo.orders.length > 0);
                  const hasPending = Boolean(dayInfo && dayInfo.pendingComm > 0);
                  const isPartial = Boolean(
                    dayInfo && dayInfo.pendingComm > 0 && dayInfo.paidComm > 0
                  );
                  const isSelected = selectedDate === cell.dateStr && dayModalOpen;
                  const isToday = cell.dateStr === todayStr();

                  let boxStyle = 'bg-white border-[#E4EBE7] text-slate-700 hover:bg-slate-50';
                  if (hasPending) {
                    boxStyle = 'bg-red-50 border-red-400 text-red-950 hover:bg-red-100/80';
                  } else if (hasOrders) {
                    boxStyle =
                      'bg-emerald-50 border-emerald-400 text-[#075E54] hover:bg-emerald-100/70';
                  }

                  return (
                    <button
                      key={cell.dateStr}
                      type="button"
                      onClick={() => handleOpenDatePopup(cell.dateStr)}
                      className={`h-24 p-2 rounded-lg border text-left flex flex-col justify-between transition-all cursor-pointer ${boxStyle} ${
                        isSelected ? 'ring-2 ring-slate-900' : ''
                      }`}
                    >
                      <div className="flex items-center justify-between w-full">
                        <span
                          className={`text-xs font-mono-num font-bold ${
                            isToday ? 'underline decoration-2' : ''
                          }`}
                        >
                          {cell.day}
                        </span>
                        {hasOrders && dayInfo && (
                          <span className="text-[10px] font-mono-num font-semibold px-1 rounded bg-white/80">
                            {dayInfo.orders.length} ord
                          </span>
                        )}
                      </div>

                      {hasOrders && dayInfo ? (
                        <div className="w-full space-y-0.5">
                          <div className="text-[10px] font-mono-num opacity-80 truncate">
                            Work: ₹{formatRupee(dayInfo.totalWork)}
                          </div>
                          {hasPending ? (
                            <>
                              <div className="text-[11px] font-mono-num font-bold text-red-700 truncate">
                                Baaki: ₹{formatRupee(dayInfo.pendingComm)}
                              </div>
                              {isPartial && (
                                <div className="text-[9px] font-semibold text-amber-800 truncate">
                                  Paid ₹{formatRupee(dayInfo.paidComm)}
                                </div>
                              )}
                            </>
                          ) : (
                            <div className="text-[11px] font-mono-num font-bold text-[#075E54] truncate">
                              30%: ₹{formatRupee(dayInfo.totalComm)}
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="text-[10px] text-slate-300">—</div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Date Click Popup Modal: 100% Work, 30% Company Charge, Partial / Roka Hua Support */}
      {dayModalOpen && activeVendorInfo && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="day-payment-modal-title"
          onClick={() => setDayModalOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-[760px] bg-white border border-[#DCE4E0] rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]"
          >
            {/* Modal Header */}
            <div className="px-5 py-3.5 bg-[#075E54] text-white flex items-center justify-between gap-3">
              <div>
                <h3 id="day-payment-modal-title" className="font-display text-base font-bold">
                  {activeVendorInfo.name} — {formatReadableDate(selectedDate)}
                </h3>
                <p className="text-xs text-emerald-100/85">
                  {activeVendorInfo.phone ? `${activeVendorInfo.phone} · ` : ''}
                  {activeVendorInfo.city} · {selectedDayData.orders.length} Order(s)
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDayModalOpen(false)}
                aria-label="Close date popup"
                className="p-1.5 rounded-lg hover:bg-white/15 text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* 100% Work, 30% Commission, Received & Pending/Roka Hua */}
            <div className="p-4 bg-[#FAFDFB] border-b border-[#DCE4E0] space-y-3">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                <div className="bg-white border border-[#DCE4E0] rounded-lg p-2.5">
                  <div className="text-[11px] font-semibold text-slate-500">100% Total Kaam</div>
                  <div className="text-lg font-display font-bold font-mono-num text-slate-900 mt-0.5">
                    ₹{formatRupee(selectedDayData.totalWork)}
                  </div>
                  <div className="text-[10px] text-slate-500">
                    Vendor 70%: ₹{formatRupee(selectedDayData.totalWork - selectedDayData.totalComm)}
                  </div>
                </div>

                <div className="bg-[#FFF7ED] border border-amber-300 rounded-lg p-2.5">
                  <div className="text-[11px] font-bold text-amber-900">
                    30% Company Charge
                  </div>
                  <div className="text-lg font-display font-bold font-mono-num text-amber-900 mt-0.5">
                    ₹{formatRupee(selectedDayData.totalComm)}
                  </div>
                  <div className="text-[10px] text-amber-800">Total 30% leni hai</div>
                </div>

                <div className="bg-white border border-[#DCE4E0] rounded-lg p-2.5">
                  <div className="text-[11px] font-semibold text-slate-500">Received (Mil Gaya)</div>
                  <div className="text-lg font-display font-bold font-mono-num text-[#128C7E] mt-0.5">
                    ₹{formatRupee(selectedDayData.paidComm)}
                  </div>
                  <div className="text-[10px] text-slate-500">Vendor ne diya</div>
                </div>

                <div
                  className={`rounded-lg p-2.5 border ${
                    selectedDayData.pendingComm > 0
                      ? 'bg-red-50 border-red-300'
                      : 'bg-emerald-50 border-emerald-300'
                  }`}
                >
                  <div
                    className={`text-[11px] font-bold ${
                      selectedDayData.pendingComm > 0 ? 'text-red-800' : 'text-[#075E54]'
                    }`}
                  >
                    {selectedDayData.pendingComm > 0 ? 'Pending / Roka Hua' : 'Status'}
                  </div>
                  <div
                    className={`text-lg font-display font-bold font-mono-num mt-0.5 ${
                      selectedDayData.pendingComm > 0 ? 'text-red-700' : 'text-[#075E54]'
                    }`}
                  >
                    {selectedDayData.pendingComm > 0
                      ? `₹${formatRupee(selectedDayData.pendingComm)}`
                      : 'Full Clear'}
                  </div>
                  <div className="text-[10px] text-slate-600">
                    {selectedDayData.pendingComm > 0 ? 'Baaki lena hai' : '0 pending'}
                  </div>
                </div>
              </div>

              {/* Partial / Custom Day Payment Box (for 100 / 200 / 250 held back) */}
              {selectedDayData.orders.length > 0 && (
                <form
                  onSubmit={handleSaveDayPartialPayment}
                  className="bg-white border border-[#DCE4E0] rounded-lg p-3 flex flex-wrap items-end gap-2.5"
                >
                  <div className="w-36">
                    <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                      Received Today (₹)
                    </label>
                    <input
                      type="number"
                      min={0}
                      max={selectedDayData.totalComm}
                      step="any"
                      value={dayReceivedInput}
                      onChange={(e) => setDayReceivedInput(e.target.value)}
                      className="w-full px-2.5 py-1.5 text-xs font-mono-num bg-[#F7F9F8] border border-[#DCE4E0] rounded-lg focus:bg-white focus:outline-none focus:border-[#128C7E]"
                    />
                  </div>

                  <div className="flex-1 min-w-[160px]">
                    <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                      Hold / Payment Note (e.g. 200 roka hai)
                    </label>
                    <input
                      type="text"
                      value={dayPayNote}
                      onChange={(e) => setDayPayNote(e.target.value)}
                      placeholder="Optional note..."
                      className="w-full px-2.5 py-1.5 text-xs bg-[#F7F9F8] border border-[#DCE4E0] rounded-lg focus:bg-white focus:outline-none focus:border-[#128C7E]"
                    />
                  </div>

                  <div className="text-[11px] font-mono-num pb-1.5">
                    <span className="text-slate-500">Baaki: </span>
                    <strong className={liveDayBalance > 0 ? 'text-red-700' : 'text-[#075E54]'}>
                      ₹{formatRupee(liveDayBalance)}
                    </strong>
                  </div>

                  <button
                    type="submit"
                    disabled={bulkBusy}
                    className="px-3 py-1.5 text-xs font-semibold bg-[#075E54] hover:bg-[#054A42] disabled:opacity-50 text-white rounded-lg cursor-pointer whitespace-nowrap"
                  >
                    Save Received
                  </button>
                </form>
              )}

              {/* Day-level Quick Actions + Extra / Pados Work */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  {selectedDayData.orders.length > 0 && (
                    <>
                      <button
                        type="button"
                        disabled={bulkBusy || selectedDayData.pendingComm === 0}
                        onClick={() =>
                          handleSetDayPayment(
                            selectedDayData.orders.map((o) => o.id),
                            'clear'
                          )
                        }
                        className="px-3 py-1.5 text-xs font-semibold bg-[#128C7E] hover:bg-[#075E54] disabled:opacity-45 text-white rounded-lg inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Full Payment Done
                      </button>

                      <button
                        type="button"
                        disabled={bulkBusy || selectedDayData.paidComm === 0}
                        onClick={() =>
                          handleSetDayPayment(
                            selectedDayData.orders.map((o) => o.id),
                            'pending'
                          )
                        }
                        className="px-3 py-1.5 text-xs font-semibold bg-red-50 hover:bg-red-100 disabled:opacity-45 text-red-700 border border-red-200 rounded-lg inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                      >
                        <Clock className="w-3.5 h-3.5" />
                        Set All Pending
                      </button>
                    </>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => setShowExtraForm((p) => !p)}
                  className="px-3 py-1.5 text-xs font-semibold bg-white hover:bg-slate-50 border border-[#DCE4E0] text-slate-800 rounded-lg inline-flex items-center gap-1 cursor-pointer whitespace-nowrap"
                >
                  <Plus className="w-3.5 h-3.5 text-[#128C7E]" />
                  Add Extra / Pados Work
                </button>
              </div>
            </div>

            {/* Inline Extra / Pados Work Form inside Popup */}
            {showExtraForm && (
              <form
                onSubmit={handleAddExtraWorkOnDate}
                className="p-3.5 bg-[#EFF4F1] border-b border-[#DCE4E0] grid grid-cols-1 sm:grid-cols-12 gap-2 items-end"
              >
                <div className="sm:col-span-3">
                  <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                    100% Work Amount (₹) *
                  </label>
                  <input
                    type="number"
                    required
                    min={1}
                    value={extraAmountInput}
                    onChange={(e) => setExtraAmountInput(e.target.value)}
                    placeholder="e.g. 1200"
                    className="w-full px-2.5 py-1.5 text-xs font-mono-num bg-white border border-[#DCE4E0] rounded-lg focus:outline-none focus:border-[#128C7E]"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                    Service
                  </label>
                  <select
                    value={extraService}
                    onChange={(e) => setExtraService(e.target.value)}
                    className="w-full px-2 py-1.5 text-xs bg-white border border-[#DCE4E0] rounded-lg focus:outline-none focus:border-[#128C7E]"
                  >
                    {config.services.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                    City
                  </label>
                  <select
                    value={extraCity}
                    onChange={(e) => setExtraCity(e.target.value)}
                    className="w-full px-2 py-1.5 text-xs bg-white border border-[#DCE4E0] rounded-lg focus:outline-none focus:border-[#128C7E]"
                  >
                    {config.cities.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="sm:col-span-3">
                  <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                    Note / Pados Address
                  </label>
                  <input
                    type="text"
                    value={extraNote}
                    onChange={(e) => setExtraNote(e.target.value)}
                    placeholder="Pados me extra kaam"
                    className="w-full px-2.5 py-1.5 text-xs bg-white border border-[#DCE4E0] rounded-lg focus:outline-none focus:border-[#128C7E]"
                  />
                </div>
                <div className="sm:col-span-2">
                  <button
                    type="submit"
                    disabled={savingExtra}
                    className="w-full py-1.5 px-2.5 bg-[#128C7E] hover:bg-[#075E54] text-white text-xs font-semibold rounded-lg cursor-pointer"
                  >
                    {savingExtra ? 'Saving...' : 'Save Extra'}
                  </button>
                </div>
              </form>
            )}

            {/* Orders List Inside Popup */}
            <div className="overflow-y-auto flex-1 divide-y divide-[#DCE4E0]">
              {selectedDayData.orders.length === 0 ? (
                <div className="p-8 text-center text-xs text-slate-500">
                  No orders on {formatReadableDate(selectedDate)} for {activeVendorInfo.name}.
                </div>
              ) : (
                selectedDayData.orders.map((order, i) => {
                  const workTotal = getOrderTotal(order);
                  const comm30 = calcCommission30(workTotal);
                  const paid = getPaidCommission(order);
                  const pending = getPendingCommission(order);
                  const isClear = pending === 0;
                  const isPartial = paid > 0 && pending > 0;

                  return (
                    <div
                      key={order.id}
                      className="px-4 py-3 flex flex-wrap items-center justify-between gap-3 hover:bg-[#FAFDFB]"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <span className="font-mono-num text-slate-400 font-semibold">
                            {i + 1}.
                          </span>
                          <span className="font-bold text-slate-900">
                            {order.name ||
                              (order.isExtraWork ? 'Pados / Extra Work' : order.number)}
                          </span>
                          {order.number && (
                            <span className="font-mono-num text-slate-600">{order.number}</span>
                          )}
                          <span className="px-1.5 py-0.5 rounded bg-[#EFF4F1] text-[#075E54] font-medium text-[11px]">
                            {order.serviceName}
                          </span>
                          {order.isExtraWork && (
                            <span className="px-1.5 py-0.5 rounded bg-blue-50 border border-blue-200 text-blue-700 text-[10px] font-semibold">
                              Extra Work
                            </span>
                          )}
                          {isPartial && (
                            <span className="px-1.5 py-0.5 rounded bg-amber-50 border border-amber-300 text-amber-900 text-[10px] font-semibold">
                              ₹{formatRupee(pending)} Baaki (Partial)
                            </span>
                          )}
                        </div>
                        {(order.address || order.notes || order.paymentNote) && (
                          <div className="text-[11px] text-slate-500 mt-0.5 truncate">
                            {[order.address, order.notes, order.paymentNote]
                              .filter(Boolean)
                              .join(' · ')}
                          </div>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-3 shrink-0">
                        <div className="text-right font-mono-num">
                          <div className="text-xs text-slate-700">
                            100%: <strong>₹{formatRupee(workTotal)}</strong> · 30%:{' '}
                            <strong className="text-amber-900">₹{formatRupee(comm30)}</strong>
                          </div>

                          <div className="text-[11px] flex items-center justify-end gap-1.5 mt-0.5">
                            {editingPaidId === order.id ? (
                              <input
                                type="number"
                                min={0}
                                max={comm30}
                                step="any"
                                autoFocus
                                value={editingPaidVal}
                                onChange={(e) => setEditingPaidVal(e.target.value)}
                                onBlur={() => handleSaveOrderPaidComm(order)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') handleSaveOrderPaidComm(order);
                                  if (e.key === 'Escape') setEditingPaidId(null);
                                }}
                                className="w-16 px-1 py-0 text-[11px] border border-[#128C7E] rounded bg-white text-right"
                              />
                            ) : (
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingPaidId(order.id);
                                  setEditingPaidVal(String(paid));
                                }}
                                title="Click to enter partial commission paid"
                                className="text-[#075E54] hover:underline cursor-pointer"
                              >
                                Paid ₹{formatRupee(paid)}
                              </button>
                            )}
                            <span>·</span>
                            {editingExtraId === order.id ? (
                              <input
                                type="number"
                                min={0}
                                autoFocus
                                value={editingExtraVal}
                                onChange={(e) => setEditingExtraVal(e.target.value)}
                                onBlur={() => handleSaveExtraAmount(order)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') handleSaveExtraAmount(order);
                                  if (e.key === 'Escape') setEditingExtraId(null);
                                }}
                                className="w-14 px-1 py-0 text-[11px] border border-[#128C7E] rounded bg-white text-right"
                              />
                            ) : (
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingExtraId(order.id);
                                  setEditingExtraVal(String(order.extraAmount || 0));
                                }}
                                title="Click to add extra increased amount"
                                className="text-blue-700 hover:underline cursor-pointer"
                              >
                                +Extra ₹{order.extraAmount || 0}
                              </button>
                            )}
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => setInvoiceOrder(order)}
                          title="Generate Company Invoice / Bill"
                          className="px-2 py-1 text-[11px] font-semibold bg-white hover:bg-slate-50 text-[#075E54] border border-[#DCE4E0] rounded-lg inline-flex items-center gap-1 cursor-pointer"
                        >
                          <FileText className="w-3 h-3" />
                          Bill
                        </button>

                        <div className="inline-flex rounded-lg border border-[#DCE4E0] overflow-hidden">
                          <button
                            type="button"
                            onClick={() => onUpdateOrder(order.id, { paymentStatus: 'clear' })}
                            className={`px-2.5 py-1 text-[11px] font-semibold cursor-pointer ${
                              isClear
                                ? 'bg-[#128C7E] text-white'
                                : 'bg-white text-slate-600 hover:bg-emerald-50'
                            }`}
                          >
                            Payment Done
                          </button>
                          <button
                            type="button"
                            onClick={() => onUpdateOrder(order.id, { paymentStatus: 'pending' })}
                            className={`px-2.5 py-1 text-[11px] font-semibold cursor-pointer border-l border-[#DCE4E0] ${
                              !isClear
                                ? 'bg-red-600 text-white'
                                : 'bg-white text-slate-600 hover:bg-red-50'
                            }`}
                          >
                            Pending
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

      <InvoiceModal
        order={invoiceOrder}
        onClose={() => setInvoiceOrder(null)}
        onNotify={onNotify}
      />
    </div>
  );
};
