import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileText,
  MessageCircle,
  Plus,
  RotateCcw,
  Search,
  Send,
  Trash2,
  Upload,
} from 'lucide-react';
import {
  calcCommission30,
  checkDuplicateNumber,
  getOrderTotal,
  getPaidCommission,
  getPendingCommission,
} from '../lib/api';
import { exportOrdersToExcel } from '../lib/excel';
import { ClientConfirmModal } from './ClientConfirmModal';
import { ConfirmDialog } from './ConfirmDialog';
import { ExcelImportModal } from './ExcelImportModal';
import { InvoiceModal } from './InvoiceModal';
import type {
  BulkImportOrderRow,
  DuplicateOrderMatch,
  NewOrderPayload,
  Order,
  OrderStatus,
  PortalConfig,
  UserPublic,
} from '../types';

interface OrderSheetProps {
  mode: OrderStatus;
  orders: Order[];
  config: PortalConfig;
  currentUser: UserPublic;
  loading: boolean;
  onAddOrder: (payload: NewOrderPayload) => Promise<void>;
  onUpdateOrder: (id: string, patch: Partial<Order>) => Promise<void>;
  onDeleteOrder: (id: string) => Promise<void>;
  onBulkComplete: (ids: string[]) => Promise<void>;
  onBulkImport: (payload: {
    rows: BulkImportOrderRow[];
    autoAddDropdowns: boolean;
    skipDuplicateNumbers: boolean;
  }) => Promise<void>;
  onOpenWhatsAppForCleaner: (cleanerName: string, selectedIds?: string[]) => void;
  onNotify: (msg: string, type?: 'success' | 'error') => void;
}

type EditableField =
  | 'name'
  | 'number'
  | 'bookingDate'
  | 'serviceName'
  | 'city'
  | 'address'
  | 'qty'
  | 'price'
  | 'cleanerName'
  | 'notes';

function todayStr(offsetDays = 0): string {
  const d = new Date(Date.now() + offsetDays * 86400000);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const TANK_TYPES = [
  { key: '500L', label: '500 Ltr' },
  { key: '750L', label: '750 Ltr' },
  { key: '1000L', label: '1000 Ltr' },
  { key: '1500L', label: '1500 Ltr' },
  { key: '2000L', label: '2000 Ltr' },
  { key: 'Cement Tank', label: 'Cement Tank' },
] as const;

export const OrderSheet: React.FC<OrderSheetProps> = ({
  mode,
  orders,
  config,
  currentUser,
  loading,
  onAddOrder,
  onUpdateOrder,
  onDeleteOrder,
  onBulkComplete,
  onBulkImport,
  onOpenWhatsAppForCleaner,
  onNotify,
}) => {
  // Left-side New Order entry state
  const [newCity, setNewCity] = useState(config.cities[0] || 'Patiala');
  const [newNumber, setNewNumber] = useState('');
  const [newName, setNewName] = useState('');
  const [newService, setNewService] = useState(config.services[0] || 'Water tank');
  const [newAddress, setNewAddress] = useState('');
  const [newQty, setNewQty] = useState('');
  const [tankCounts, setTankCounts] = useState<Record<string, number>>({});
  const [newPrice, setNewPrice] = useState('');
  const [newDate, setNewDate] = useState(() => todayStr(1));
  const [newCleaner, setNewCleaner] = useState(config.cleaners[0] || 'Jagdish');
  const [newNotes, setNewNotes] = useState('');
  const [adding, setAdding] = useState(false);

  // Live duplicate phone check across all telecallers
  const [duplicateMatches, setDuplicateMatches] = useState<DuplicateOrderMatch[]>([]);
  const [checkingDuplicate, setCheckingDuplicate] = useState(false);
  const [pendingDuplicateSubmit, setPendingDuplicateSubmit] = useState(false);

  // Sync defaults if admin modifies config lists
  useEffect(() => {
    if (config.cities.length > 0 && !config.cities.includes(newCity)) {
      setNewCity(config.cities[0]);
    }
  }, [config.cities]);

  useEffect(() => {
    if (config.cleaners.length > 0 && !config.cleaners.includes(newCleaner)) {
      setNewCleaner(config.cleaners[0]);
    }
  }, [config.cleaners]);

  useEffect(() => {
    if (mode !== 'active') return;
    const digits = newNumber.replace(/\D/g, '');
    if (digits.length < 8) {
      setDuplicateMatches([]);
      setCheckingDuplicate(false);
      return;
    }

    let cancelled = false;
    setCheckingDuplicate(true);
    const timer = setTimeout(async () => {
      try {
        const matches = await checkDuplicateNumber(newNumber.trim());
        if (!cancelled) {
          setDuplicateMatches(matches);
        }
      } catch {
        if (!cancelled) {
          setDuplicateMatches([]);
        }
      } finally {
        if (!cancelled) {
          setCheckingDuplicate(false);
        }
      }
    }, 180);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [newNumber, mode]);

  // Filters & Show Entries pagination
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [cleanerFilter, setCleanerFilter] = useState('all');
  const [cityFilter, setCityFilter] = useState('all');
  const [serviceFilter, setServiceFilter] = useState('all');
  const [telecallerFilter, setTelecallerFilter] = useState('all');
  const [completedByFilter, setCompletedByFilter] = useState('all');
  const [paymentFilter, setPaymentFilter] = useState<'all' | 'pending' | 'clear'>('all');
  const [showVendorSummary, setShowVendorSummary] = useState(true);
  const [showEntries, setShowEntries] = useState<number>(25);
  const [currentPage, setCurrentPage] = useState<number>(1);

  // Inline editing state
  const [editingCell, setEditingCell] = useState<{ id: string; field: EditableField } | null>(null);
  const [editingValue, setEditingValue] = useState<string>('');

  // Row selection
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  // Client WhatsApp confirmation modal target
  const [confirmOrder, setConfirmOrder] = useState<Order | null>(null);

  // Delete Yes/No confirmation modal target
  const [deleteTargetOrder, setDeleteTargetOrder] = useState<Order | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Excel import modal
  const [importModalOpen, setImportModalOpen] = useState(false);

  // Auto Bill / Invoice modal target
  const [invoiceOrder, setInvoiceOrder] = useState<Order | null>(null);

  const modeOrders = useMemo(
    () => orders.filter((o) => o.status === mode),
    [orders, mode]
  );

  const uniqueTelecallers = useMemo(() => {
    const map = new Map<string, string>();
    for (const o of orders) {
      if (o.createdById && o.createdByName) {
        map.set(o.createdById, o.createdByName);
      }
    }
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [orders]);

  const uniqueCompletedBy = useMemo(() => {
    const set = new Set<string>();
    for (const o of modeOrders) {
      if (o.completedByName) {
        set.add(o.completedByName);
      }
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [modeOrders]);

  const filteredOrders = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return modeOrders.filter((o) => {
      if (fromDate && (!o.bookingDate || o.bookingDate < fromDate)) return false;
      if (toDate && (!o.bookingDate || o.bookingDate > toDate)) return false;
      if (cleanerFilter !== 'all' && o.cleanerName.toLowerCase() !== cleanerFilter.toLowerCase()) {
        return false;
      }
      if (cityFilter !== 'all' && o.city.toLowerCase() !== cityFilter.toLowerCase()) {
        return false;
      }
      if (serviceFilter !== 'all' && o.serviceName.toLowerCase() !== serviceFilter.toLowerCase()) {
        return false;
      }
      if (telecallerFilter !== 'all' && o.createdById !== telecallerFilter) {
        return false;
      }
      if (mode === 'completed') {
        if (completedByFilter !== 'all' && (o.completedByName || '') !== completedByFilter) {
          return false;
        }
        if (paymentFilter === 'pending' && getPendingCommission(o) <= 0) {
          return false;
        }
        if (paymentFilter === 'clear' && getPendingCommission(o) > 0) {
          return false;
        }
      }
      if (q) {
        const hay = `${o.name} ${o.number} ${o.serviceName} ${o.city} ${o.address} ${o.cleanerName} ${o.notes ?? ''} ${o.createdByName} ${o.completedByName ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [
    modeOrders,
    mode,
    fromDate,
    toDate,
    cleanerFilter,
    cityFilter,
    serviceFilter,
    telecallerFilter,
    completedByFilter,
    paymentFilter,
    searchQuery,
  ]);

  const totalPages = useMemo(() => {
    if (showEntries === -1) return 1;
    return Math.max(1, Math.ceil(filteredOrders.length / showEntries));
  }, [filteredOrders.length, showEntries]);

  const safePage = Math.min(currentPage, totalPages);

  const visibleOrders = useMemo(() => {
    if (showEntries === -1) return filteredOrders;
    const start = (safePage - 1) * showEntries;
    return filteredOrders.slice(start, start + showEntries);
  }, [filteredOrders, showEntries, safePage]);

  const totals = useMemo(() => {
    const totalQty = filteredOrders.reduce((sum, o) => sum + Number(o.qty || 0), 0);
    const totalPrice = filteredOrders.reduce((sum, o) => sum + getOrderTotal(o), 0);
    return { totalQty, totalPrice };
  }, [filteredOrders]);

  const completedSummary = useMemo(() => {
    if (mode !== 'completed') {
      return {
        totalWork100: 0,
        totalComm30: 0,
        totalPaid: 0,
        totalPending: 0,
        vendorRows: [] as Array<{
          cleanerName: string;
          count: number;
          work100: number;
          vendorShare70: number;
          comm30: number;
          paid: number;
          pending: number;
        }>,
      };
    }

    let totalWork100 = 0;
    let totalComm30 = 0;
    let totalPaid = 0;
    let totalPending = 0;
    const byCleaner = new Map<
      string,
      {
        cleanerName: string;
        count: number;
        work100: number;
        comm30: number;
        paid: number;
        pending: number;
      }
    >();

    for (const o of filteredOrders) {
      const work = getOrderTotal(o);
      const comm = calcCommission30(work);
      const paid = getPaidCommission(o);
      const pending = getPendingCommission(o);

      totalWork100 += work;
      totalComm30 += comm;
      totalPaid += paid;
      totalPending += pending;

      const name = (o.cleanerName || 'Unassigned').trim();
      const key = name.toLowerCase();
      const row = byCleaner.get(key) || {
        cleanerName: name,
        count: 0,
        work100: 0,
        comm30: 0,
        paid: 0,
        pending: 0,
      };
      row.count += 1;
      row.work100 += work;
      row.comm30 += comm;
      row.paid += paid;
      row.pending += pending;
      byCleaner.set(key, row);
    }

    const vendorRows = Array.from(byCleaner.values())
      .map((r) => ({
        ...r,
        vendorShare70: Math.max(0, Math.round((r.work100 - r.comm30) * 100) / 100),
      }))
      .sort((a, b) => b.pending - a.pending || b.work100 - a.work100);

    return {
      totalWork100,
      totalComm30: Math.round(totalComm30 * 100) / 100,
      totalPaid: Math.round(totalPaid * 100) / 100,
      totalPending: Math.round(totalPending * 100) / 100,
      vendorRows,
    };
  }, [filteredOrders, mode]);

  const tankSummary = useMemo(() => {
    const parts: string[] = [];
    let totalTanks = 0;
    for (const t of TANK_TYPES) {
      const cnt = tankCounts[t.key] || 0;
      if (cnt > 0) {
        parts.push(`${t.label} × ${cnt}`);
        totalTanks += cnt;
      }
    }
    return { text: parts.join(', '), totalTanks };
  }, [tankCounts]);

  const adjustTankCount = (key: string, delta: number) => {
    setTankCounts((prev) => {
      const nextVal = Math.max(0, (prev[key] || 0) + delta);
      if (nextVal === 0) {
        const copy = { ...prev };
        delete copy[key];
        return copy;
      }
      return { ...prev, [key]: nextVal };
    });
  };

  const submitOrderEntry = async () => {
    setAdding(true);
    try {
      const isWaterTank = newService.toLowerCase() === 'water tank';
      const parsedManualQty = newQty.trim() ? Number(newQty) : null;
      const finalQty =
        isWaterTank && tankSummary.totalTanks > 0
          ? tankSummary.totalTanks
          : parsedManualQty && Number.isFinite(parsedManualQty) && parsedManualQty > 0
          ? parsedManualQty
          : null;

      const noteParts = [
        isWaterTank && tankSummary.text ? tankSummary.text : '',
        newNotes.trim(),
      ].filter(Boolean);

      await onAddOrder({
        name: newName.trim(),
        number: newNumber.trim(),
        bookingDate: newDate.trim(),
        serviceName: newService,
        city: newCity,
        address: newAddress.trim(),
        qty: finalQty,
        price: Math.max(0, Number(newPrice) || 0),
        cleanerName: newCleaner,
        notes: noteParts.length > 0 ? noteParts.join(' | ') : undefined,
      });

      setNewName('');
      setNewNumber('');
      setNewAddress('');
      setNewQty('');
      setTankCounts({});
      setNewPrice('');
      setNewDate(todayStr(1));
      setNewNotes('');
      setDuplicateMatches([]);
      setPendingDuplicateSubmit(false);
      setCurrentPage(1);
    } finally {
      setAdding(false);
    }
  };

  const handleQuickAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newNumber.trim()) {
      onNotify('Customer Phone Number is required.', 'error');
      return;
    }

    let matchesToCheck = duplicateMatches;
    const digits = newNumber.replace(/\D/g, '');
    if (digits.length >= 8 && (checkingDuplicate || duplicateMatches.length === 0)) {
      try {
        matchesToCheck = await checkDuplicateNumber(newNumber.trim());
        setDuplicateMatches(matchesToCheck);
      } catch {
        // Proceed if duplicate check fails transiently
      }
    }

    if (matchesToCheck.some((m) => m.status === 'active')) {
      setPendingDuplicateSubmit(true);
      return;
    }

    await submitOrderEntry();
  };

  const startEdit = (order: Order, field: EditableField) => {
    setEditingCell({ id: order.id, field });
    setEditingValue(String(order[field] ?? ''));
  };

  const commitEdit = async (order: Order, overrideValue?: string) => {
    if (!editingCell || editingCell.id !== order.id) return;
    const { field } = editingCell;
    const raw = (overrideValue ?? editingValue).trim();
    setEditingCell(null);

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

    if (field === 'number' && !raw) return;
    if ((field === 'serviceName' || field === 'city' || field === 'cleanerName') && !raw) return;
    if (raw === String(order[field] ?? '')) return;
    await onUpdateOrder(order.id, { [field]: raw });
  };

  const handleCellKeyDown = (e: React.KeyboardEvent, order: Order) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitEdit(order);
    } else if (e.key === 'Escape') {
      setEditingCell(null);
    }
  };

  const toggleSelectAllVisible = () => {
    const visibleIds = visibleOrders.map((o) => o.id);
    const allChecked = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.includes(id));
    if (allChecked) {
      setSelectedIds((prev) => prev.filter((id) => !visibleIds.includes(id)));
    } else {
      setSelectedIds((prev) => Array.from(new Set([...prev, ...visibleIds])));
    }
  };

  const toggleRow = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const applyDatePreset = (preset: 'all' | 'today' | '7days' | 'month') => {
    setCurrentPage(1);
    if (preset === 'all') {
      setFromDate('');
      setToDate('');
      return;
    }
    if (preset === 'today') {
      const t = todayStr(0);
      setFromDate(t);
      setToDate(t);
      return;
    }
    if (preset === '7days') {
      setFromDate(todayStr(-6));
      setToDate(todayStr(0));
      return;
    }
    const now = new Date();
    const first = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    setFromDate(first);
    setToDate(todayStr(0));
  };

  const handleBulkCompleteClick = async () => {
    if (selectedIds.length === 0) return;
    await onBulkComplete(selectedIds);
    setSelectedIds([]);
  };

  const handleSendSelectedToWhatsApp = () => {
    if (selectedIds.length === 0) return;
    const first = filteredOrders.find((o) => selectedIds.includes(o.id));
    onOpenWhatsAppForCleaner(first?.cleanerName || 'Selected Orders', selectedIds);
  };

  const startEntryIndex =
    filteredOrders.length === 0
      ? 0
      : (safePage - 1) * (showEntries === -1 ? filteredOrders.length : showEntries) + 1;
  const endEntryIndex =
    showEntries === -1
      ? filteredOrders.length
      : Math.min(filteredOrders.length, safePage * showEntries);

  const totalCols =
    13 +
    (currentUser.role === 'super_admin' ? 1 : 0) +
    (mode === 'completed' ? 2 : 0);

  const isWaterTankSelected = newService.toLowerCase() === 'water tank';

  return (
    <div
      className={
        mode === 'active'
          ? 'flex flex-col lg:flex-row gap-5 items-start'
          : 'space-y-4'
      }
    >
      {mode === 'active' && (
        <aside className="w-full lg:w-[395px] xl:w-[415px] shrink-0 bg-white border border-[#DCE4E0] rounded-xl overflow-hidden">
          <div className="px-4 py-3 bg-[#075E54] text-white flex items-center justify-between">
            <h2 className="font-display text-sm font-bold">New Order</h2>
            <span className="text-[11px] text-white/80 font-mono-num">
              {newDate === todayStr(1) ? 'Next Day Selected' : newDate || 'No Date'}
            </span>
          </div>

          <form onSubmit={handleQuickAdd} className="p-4 space-y-3">
            {/* Row 1: Left City Name | Right Phone Number */}
            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  City Name
                </label>
                <select
                  value={newCity}
                  onChange={(e) => setNewCity(e.target.value)}
                  className="w-full px-2.5 py-2 text-sm bg-[#F7F9F8] border border-[#DCE4E0] rounded-lg focus:bg-white focus:outline-none focus:border-[#128C7E]"
                >
                  {config.cities.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Phone Number <span className="text-red-600">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={newNumber}
                  onChange={(e) => setNewNumber(e.target.value)}
                  placeholder="10-digit number"
                  className={`w-full px-2.5 py-2 text-sm font-mono-num border rounded-lg focus:bg-white focus:outline-none ${
                    duplicateMatches.some((m) => m.status === 'active')
                      ? 'bg-red-50 border-red-400 focus:border-red-500'
                      : duplicateMatches.length > 0
                      ? 'bg-amber-50 border-amber-400 focus:border-amber-500'
                      : 'bg-[#F7F9F8] border-[#DCE4E0] focus:border-[#128C7E]'
                  }`}
                />
              </div>
            </div>

            {/* Live Telecaller Duplicate Number Alert */}
            {checkingDuplicate && (
              <div className="text-[11px] text-slate-500 px-2.5 py-1.5 bg-[#F7F9F8] border border-[#DCE4E0] rounded-lg">
                Checking central records for this phone number...
              </div>
            )}

            {!checkingDuplicate && duplicateMatches.length > 0 && (
              <div
                role="alert"
                className={`rounded-lg border p-2.5 text-xs space-y-1.5 ${
                  duplicateMatches.some((m) => m.status === 'active')
                    ? 'bg-red-50 border-red-300 text-red-950'
                    : 'bg-amber-50 border-amber-300 text-amber-950'
                }`}
              >
                <div className="flex items-center gap-1.5 font-bold">
                  <AlertTriangle
                    className={`w-4 h-4 shrink-0 ${
                      duplicateMatches.some((m) => m.status === 'active')
                        ? 'text-red-600'
                        : 'text-amber-600'
                    }`}
                  />
                  <span>
                    {duplicateMatches.some((m) => m.status === 'active')
                      ? `Order Already Taken! (${duplicateMatches.length} match)`
                      : `Previous Order History (${duplicateMatches.length})`}
                  </span>
                </div>

                <div className="space-y-1.5 max-h-40 overflow-y-auto">
                  {duplicateMatches.slice(0, 4).map((m) => {
                    const takenDate = m.createdAt
                      ? new Date(m.createdAt).toLocaleDateString('en-IN', {
                          day: '2-digit',
                          month: 'short',
                          year: 'numeric',
                        })
                      : '';
                    return (
                      <div
                        key={m.id}
                        className="bg-white/90 border border-black/10 rounded p-2 text-[11px] leading-snug"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-bold text-slate-900">
                            Telecaller: {m.createdByName}
                            {m.createdById === currentUser.id ? ' (You)' : ''}
                          </span>
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase ${
                              m.status === 'active'
                                ? 'bg-red-100 text-red-700'
                                : 'bg-slate-200 text-slate-700'
                            }`}
                          >
                            {m.status}
                          </span>
                        </div>
                        <div className="text-slate-700 mt-0.5">
                          Name: <strong>{m.name || 'No Name'}</strong> · Booking Date:{' '}
                          <strong className="font-mono-num">{m.bookingDate || 'No Date'}</strong>
                        </div>
                        <div className="text-slate-600 mt-0.5">
                          {m.serviceName} · {m.city} · ₹{m.price} · Cleaner: {m.cleanerName}
                        </div>
                        {m.address && (
                          <div className="text-slate-500 truncate mt-0.5">Addr: {m.address}</div>
                        )}
                        {takenDate && (
                          <div className="text-[10px] text-slate-400 mt-0.5">
                            Entered on: {takenDate}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {duplicateMatches.length > 4 && (
                    <div className="text-[10px] font-medium opacity-80">
                      +{duplicateMatches.length - 4} more previous order(s) on this number
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Row 2: Left Customer Name | Right Service */}
            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Customer Name
                </label>
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Optional"
                  className="w-full px-2.5 py-2 text-sm bg-[#F7F9F8] border border-[#DCE4E0] rounded-lg focus:bg-white focus:outline-none focus:border-[#128C7E]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Service
                </label>
                <select
                  value={newService}
                  onChange={(e) => setNewService(e.target.value)}
                  className="w-full px-2.5 py-2 text-sm bg-[#F7F9F8] border border-[#DCE4E0] rounded-lg focus:bg-white focus:outline-none focus:border-[#128C7E]"
                >
                  {config.services.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Row 3: Full Address (Full Width) */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Full Address
              </label>
              <textarea
                rows={2}
                value={newAddress}
                onChange={(e) => setNewAddress(e.target.value)}
                placeholder="House no., Sector, Landmark (optional)"
                className="w-full px-3 py-2 text-sm bg-[#F7F9F8] border border-[#DCE4E0] rounded-lg focus:bg-white focus:outline-none focus:border-[#128C7E] resize-none"
              />
            </div>

            {/* Row 4: Quantity (Full Width) */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Quantity {isWaterTankSelected ? '(Tank Size & Count)' : ''}
              </label>

              {isWaterTankSelected ? (
                <div className="bg-[#F7F9F8] border border-[#DCE4E0] rounded-lg p-2.5 space-y-2">
                  <div className="grid grid-cols-2 gap-1.5">
                    {TANK_TYPES.map((t) => {
                      const count = tankCounts[t.key] || 0;
                      return (
                        <div
                          key={t.key}
                          className={`flex items-center justify-between px-2 py-1.5 rounded border text-xs ${
                            count > 0
                              ? 'bg-white border-[#128C7E] text-[#075E54] font-semibold'
                              : 'bg-white border-[#DCE4E0] text-slate-700'
                          }`}
                        >
                          <span className="truncate mr-1">{t.label}</span>
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              type="button"
                              onClick={() => adjustTankCount(t.key, -1)}
                              className="w-5 h-5 rounded bg-[#EFF4F1] hover:bg-[#DCE4E0] text-slate-700 font-bold flex items-center justify-center cursor-pointer"
                            >
                              -
                            </button>
                            <span className="w-4 text-center font-mono-num">{count}</span>
                            <button
                              type="button"
                              onClick={() => adjustTankCount(t.key, 1)}
                              className="w-5 h-5 rounded bg-[#128C7E] hover:bg-[#075E54] text-white font-bold flex items-center justify-center cursor-pointer"
                            >
                              +
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {tankSummary.totalTanks > 0 && (
                    <div className="text-[11px] text-[#075E54] font-medium pt-1 border-t border-[#DCE4E0]">
                      Selected ({tankSummary.totalTanks}): {tankSummary.text}
                    </div>
                  )}
                </div>
              ) : (
                <input
                  type="number"
                  min={1}
                  value={newQty}
                  onChange={(e) => setNewQty(e.target.value)}
                  placeholder="Optional (e.g. 1, 2)"
                  className="w-full px-3 py-2 text-sm font-mono-num bg-[#F7F9F8] border border-[#DCE4E0] rounded-lg focus:bg-white focus:outline-none focus:border-[#128C7E]"
                />
              )}
            </div>

            {/* Row 5: Left Price (₹) | Right Booking Day & Date (Next day auto-selected) */}
            <div className="grid grid-cols-2 gap-2.5 items-start">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Price (₹)
                </label>
                <input
                  type="number"
                  min={0}
                  value={newPrice}
                  onChange={(e) => setNewPrice(e.target.value)}
                  placeholder="Amount"
                  className="w-full px-2.5 py-2 text-sm font-mono-num bg-[#F7F9F8] border border-[#DCE4E0] rounded-lg focus:bg-white focus:outline-none focus:border-[#128C7E]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Booking Day / Date
                </label>
                <input
                  type="date"
                  value={newDate}
                  onChange={(e) => setNewDate(e.target.value)}
                  className="w-full px-2.5 py-2 text-xs font-mono-num bg-[#F7F9F8] border border-[#DCE4E0] rounded-lg focus:bg-white focus:outline-none focus:border-[#128C7E]"
                />
                <div className="grid grid-cols-4 gap-1 mt-1.5">
                  {[
                    { label: 'Kal', date: todayStr(1) },
                    { label: 'Aaj', date: todayStr(0) },
                    { label: 'Parso', date: todayStr(2) },
                    { label: 'Yest', date: todayStr(-1) },
                  ].map((opt) => (
                    <button
                      key={opt.label}
                      type="button"
                      onClick={() => setNewDate(opt.date)}
                      className={`py-1 px-0.5 text-[10px] font-medium rounded border cursor-pointer whitespace-nowrap ${
                        newDate === opt.date
                          ? 'bg-[#075E54] text-white border-[#075E54]'
                          : 'bg-[#F7F9F8] text-slate-700 border-[#DCE4E0] hover:bg-[#EFF4F1]'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Row 6: Niche Cleaner (Full Width) */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Assign Cleaner
              </label>
              <select
                value={newCleaner}
                onChange={(e) => setNewCleaner(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-[#F7F9F8] border border-[#DCE4E0] rounded-lg focus:bg-white focus:outline-none focus:border-[#128C7E]"
              >
                {config.cleaners.map((cl) => (
                  <option key={cl} value={cl}>
                    {cl}
                  </option>
                ))}
              </select>
            </div>

            {/* Optional Message / Work Note */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Message / Note (Optional)
              </label>
              <input
                type="text"
                value={newNotes}
                onChange={(e) => setNewNotes(e.target.value)}
                placeholder="Any extra instruction..."
                className="w-full px-3 py-2 text-sm bg-[#F7F9F8] border border-[#DCE4E0] rounded-lg focus:bg-white focus:outline-none focus:border-[#128C7E]"
              />
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={adding}
              className="w-full py-2.5 px-4 bg-[#128C7E] hover:bg-[#075E54] disabled:opacity-60 text-white text-sm font-semibold rounded-lg flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              {adding ? 'Adding Order...' : 'Add Order Entry'}
            </button>
          </form>
        </aside>
      )}

      <div className={mode === 'active' ? 'flex-1 min-w-0 w-full space-y-3' : 'space-y-3'}>

      {/* Simple Flat Filter Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2.5 py-2 border-y border-[#DCE4E0]">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5 text-xs text-slate-600">
            <span>From</span>
            <input
              type="date"
              aria-label="From date"
              value={fromDate}
              onChange={(e) => {
                setFromDate(e.target.value);
                setCurrentPage(1);
              }}
              className="px-2 py-1 text-xs font-mono-num bg-white border border-[#DCE4E0] rounded text-slate-700 focus:outline-none focus:border-slate-400"
            />
          </div>

          <div className="flex items-center gap-1.5 text-xs text-slate-600">
            <span>To</span>
            <input
              type="date"
              aria-label="To date"
              value={toDate}
              onChange={(e) => {
                setToDate(e.target.value);
                setCurrentPage(1);
              }}
              className="px-2 py-1 text-xs font-mono-num bg-white border border-[#DCE4E0] rounded text-slate-700 focus:outline-none focus:border-slate-400"
            />
          </div>

          <button
            type="button"
            onClick={() => applyDatePreset('today')}
            className="px-2 py-1 text-xs text-slate-600 hover:text-slate-900 border border-[#DCE4E0] bg-white rounded cursor-pointer whitespace-nowrap"
          >
            Today
          </button>

          {(fromDate ||
            toDate ||
            cleanerFilter !== 'all' ||
            cityFilter !== 'all' ||
            serviceFilter !== 'all' ||
            telecallerFilter !== 'all' ||
            completedByFilter !== 'all' ||
            paymentFilter !== 'all' ||
            searchQuery) && (
            <button
              type="button"
              onClick={() => {
                setFromDate('');
                setToDate('');
                setCleanerFilter('all');
                setCityFilter('all');
                setServiceFilter('all');
                setTelecallerFilter('all');
                setCompletedByFilter('all');
                setPaymentFilter('all');
                setSearchQuery('');
                setCurrentPage(1);
              }}
              className="px-2 py-1 text-xs text-slate-500 hover:text-slate-900 underline cursor-pointer whitespace-nowrap"
            >
              Reset
            </button>
          )}

          <select
            aria-label="Filter by service"
            value={serviceFilter}
            onChange={(e) => {
              setServiceFilter(e.target.value);
              setCurrentPage(1);
            }}
            className="px-2 py-1 text-xs bg-white border border-[#DCE4E0] rounded text-slate-700 focus:outline-none focus:border-slate-400"
          >
            <option value="all">All Services</option>
            {config.services.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>

          <select
            aria-label="Filter by city"
            value={cityFilter}
            onChange={(e) => {
              setCityFilter(e.target.value);
              setCurrentPage(1);
            }}
            className="px-2 py-1 text-xs bg-white border border-[#DCE4E0] rounded text-slate-700 focus:outline-none focus:border-slate-400"
          >
            <option value="all">All Cities</option>
            {config.cities.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>

          <select
            aria-label="Filter by cleaner"
            value={cleanerFilter}
            onChange={(e) => {
              setCleanerFilter(e.target.value);
              setCurrentPage(1);
            }}
            className="px-2 py-1 text-xs bg-white border border-[#DCE4E0] rounded text-slate-700 focus:outline-none focus:border-slate-400"
          >
            <option value="all">All Cleaners</option>
            {config.cleaners.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>

          {(currentUser.role === 'super_admin' || mode === 'completed') &&
            uniqueTelecallers.length > 0 && (
              <select
                aria-label="Filter by telecaller"
                value={telecallerFilter}
                onChange={(e) => {
                  setTelecallerFilter(e.target.value);
                  setCurrentPage(1);
                }}
                className="px-2 py-1 text-xs bg-white border border-[#DCE4E0] rounded text-slate-700 focus:outline-none focus:border-slate-400"
              >
                <option value="all">All Telecallers</option>
                {uniqueTelecallers.map((tc) => (
                  <option key={tc.id} value={tc.id}>
                    Booked: {tc.name}
                  </option>
                ))}
              </select>
            )}

          {mode === 'completed' && uniqueCompletedBy.length > 0 && (
            <select
              aria-label="Filter by who completed"
              value={completedByFilter}
              onChange={(e) => {
                setCompletedByFilter(e.target.value);
                setCurrentPage(1);
              }}
              className="px-2 py-1 text-xs bg-white border border-[#DCE4E0] rounded text-slate-700 focus:outline-none focus:border-slate-400"
            >
              <option value="all">Done By: All</option>
              {uniqueCompletedBy.map((name) => (
                <option key={name} value={name}>
                  Done By: {name}
                </option>
              ))}
            </select>
          )}

          {mode === 'completed' && (
            <select
              aria-label="Filter by payment status"
              value={paymentFilter}
              onChange={(e) => {
                setPaymentFilter(e.target.value as 'all' | 'pending' | 'clear');
                setCurrentPage(1);
              }}
              className="px-2 py-1 text-xs bg-white border border-[#DCE4E0] rounded text-slate-700 focus:outline-none focus:border-slate-400"
            >
              <option value="all">All Payments</option>
              <option value="pending">30% Pending</option>
              <option value="clear">Payment Clear</option>
            </select>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 text-xs text-slate-600">
            <span>Show</span>
            <select
              aria-label="Show entries"
              value={showEntries}
              onChange={(e) => {
                setShowEntries(Number(e.target.value));
                setCurrentPage(1);
              }}
              className="px-1.5 py-1 text-xs font-mono-num bg-white border border-[#DCE4E0] rounded text-slate-700 focus:outline-none focus:border-slate-400"
            >
              <option value={10}>10</option>
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
              <option value={-1}>All</option>
            </select>
          </div>

          <div className="relative w-48">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setCurrentPage(1);
              }}
              placeholder="Search..."
              className="w-full pl-7 pr-2.5 py-1 text-xs bg-white border border-[#DCE4E0] rounded text-slate-700 focus:outline-none focus:border-slate-400"
            />
          </div>

          <button
            type="button"
            onClick={() => setImportModalOpen(true)}
            className="px-2.5 py-1 text-xs font-medium bg-white hover:bg-slate-50 border border-[#DCE4E0] text-slate-700 rounded flex items-center gap-1 cursor-pointer whitespace-nowrap"
          >
            <Upload className="w-3.5 h-3.5 text-[#128C7E]" />
            Import Excel
          </button>

          <button
            type="button"
            onClick={() =>
              exportOrdersToExcel(
                filteredOrders,
                `orderdesk-${mode}-${todayStr(0)}.xlsx`
              )
            }
            className="px-2.5 py-1 text-xs font-medium bg-white hover:bg-slate-50 border border-[#DCE4E0] text-slate-700 rounded flex items-center gap-1 cursor-pointer whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5 text-slate-500" />
            Export Excel
          </button>
        </div>

        {selectedIds.length > 0 && (
          <div className="w-full pt-2 border-t border-[#DCE4E0] flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-medium text-slate-700">
              {selectedIds.length} selected
            </span>
            <div className="flex items-center gap-2">
              {mode === 'active' && (
                <>
                  <button
                    type="button"
                    onClick={handleSendSelectedToWhatsApp}
                    className="px-3 py-1 text-xs font-semibold bg-[#25D366] hover:bg-[#1ebe5d] text-white rounded flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                  >
                    <MessageCircle className="w-3.5 h-3.5" />
                    Send to WhatsApp
                  </button>
                  <button
                    type="button"
                    onClick={handleBulkCompleteClick}
                    className="px-3 py-1 text-xs font-semibold bg-[#128C7E] hover:bg-[#075E54] text-white rounded flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Mark Complete
                  </button>
                </>
              )}
              <button
                type="button"
                onClick={() => setSelectedIds([])}
                className="px-2 py-1 text-xs text-slate-600 hover:text-slate-900 cursor-pointer"
              >
                Clear
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Completed Mode: Vendor Payment Breakdown (100% Work vs 30% Commission Leni Hai) */}
      {mode === 'completed' && filteredOrders.length > 0 && (
        <div className="bg-white border border-[#DCE4E0] rounded-xl overflow-hidden">
          <div className="px-4 py-2.5 bg-[#FAFDFB] border-b border-[#DCE4E0] flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
              <span className="font-display font-bold text-slate-900">
                Vendor Payment Summary (100% vs 30%)
              </span>
              <span className="font-mono-num text-slate-700">
                100% Work:{' '}
                <strong className="text-slate-900">
                  ₹{completedSummary.totalWork100.toLocaleString('en-IN')}
                </strong>
              </span>
              <span className="font-mono-num text-amber-800">
                30% Company Comm:{' '}
                <strong>₹{completedSummary.totalComm30.toLocaleString('en-IN')}</strong>
              </span>
              <span className="font-mono-num text-[#075E54]">
                Received:{' '}
                <strong>₹{completedSummary.totalPaid.toLocaleString('en-IN')}</strong>
              </span>
              <span className="font-mono-num text-red-700">
                Baaki Leni Hai:{' '}
                <strong>₹{completedSummary.totalPending.toLocaleString('en-IN')}</strong>
              </span>
            </div>

            <button
              type="button"
              onClick={() => setShowVendorSummary((v) => !v)}
              className="text-xs font-medium text-slate-600 hover:text-slate-900 cursor-pointer"
            >
              {showVendorSummary ? 'Hide Breakdown' : 'Show Breakdown'}
            </button>
          </div>

          {showVendorSummary && (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-[#EFF4F1] border-b border-[#DCE4E0] text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                    <th className="py-2 px-3">Cleaner / Vendor</th>
                    <th className="py-2 px-3 text-center">Orders</th>
                    <th className="py-2 px-3 text-right">100% Work (₹)</th>
                    <th className="py-2 px-3 text-right">70% Vendor (₹)</th>
                    <th className="py-2 px-3 text-right">30% Comm Leni (₹)</th>
                    <th className="py-2 px-3 text-right">Received (₹)</th>
                    <th className="py-2 px-3 text-right">Pending / Baaki (₹)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#DCE4E0]">
                  {completedSummary.vendorRows.map((v) => {
                    const isActiveCleaner =
                      cleanerFilter.toLowerCase() === v.cleanerName.toLowerCase();
                    return (
                      <tr
                        key={v.cleanerName}
                        onClick={() => {
                          setCleanerFilter(isActiveCleaner ? 'all' : v.cleanerName);
                          setCurrentPage(1);
                        }}
                        title="Click to filter completed orders for this vendor"
                        className={`cursor-pointer transition-colors ${
                          isActiveCleaner ? 'bg-[#E9F7F0]' : 'hover:bg-[#FAFDFB]'
                        }`}
                      >
                        <td className="py-2 px-3 font-semibold text-[#075E54]">
                          {v.cleanerName}
                          {isActiveCleaner && (
                            <span className="ml-1.5 text-[10px] font-normal text-slate-500">
                              (Filtered)
                            </span>
                          )}
                        </td>
                        <td className="py-2 px-3 text-center font-mono-num text-slate-700">
                          {v.count}
                        </td>
                        <td className="py-2 px-3 text-right font-mono-num font-semibold text-slate-900">
                          ₹{v.work100.toLocaleString('en-IN')}
                        </td>
                        <td className="py-2 px-3 text-right font-mono-num text-slate-600">
                          ₹{v.vendorShare70.toLocaleString('en-IN')}
                        </td>
                        <td className="py-2 px-3 text-right font-mono-num font-semibold text-amber-800">
                          ₹{v.comm30.toLocaleString('en-IN')}
                        </td>
                        <td className="py-2 px-3 text-right font-mono-num text-[#075E54]">
                          ₹{v.paid.toLocaleString('en-IN')}
                        </td>
                        <td
                          className={`py-2 px-3 text-right font-mono-num font-bold ${
                            v.pending > 0 ? 'text-red-700' : 'text-[#075E54]'
                          }`}
                        >
                          {v.pending > 0
                            ? `₹${v.pending.toLocaleString('en-IN')}`
                            : 'Clear'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Excel-Style Spreadsheet Grid */}
      <div className="bg-white border border-[#DCE4E0] rounded-xl overflow-hidden">
        <div className="overflow-x-auto sheet-scroll">
          <table className="w-full text-left border-collapse min-w-[1260px]">
            <thead>
              <tr className="bg-[#EFF4F1] border-b border-[#DCE4E0] text-xs font-semibold text-slate-700">
                <th className="py-2.5 px-3 w-10 border-r border-[#DCE4E0] text-center">
                  <input
                    type="checkbox"
                    aria-label="Select all visible rows"
                    checked={
                      visibleOrders.length > 0 &&
                      visibleOrders.every((o) => selectedIds.includes(o.id))
                    }
                    onChange={toggleSelectAllVisible}
                    className="rounded border-slate-300 accent-[#128C7E] cursor-pointer"
                  />
                </th>
                <th className="py-2.5 px-2.5 w-14 border-r border-[#DCE4E0] text-center">
                  S.No.
                </th>
                <th className="py-2.5 px-3 border-r border-[#DCE4E0] min-w-[125px]">Name</th>
                <th className="py-2.5 px-3 border-r border-[#DCE4E0] w-28">Number</th>
                <th className="py-2.5 px-3 border-r border-[#DCE4E0] w-28">
                  Date
                </th>
                <th className="py-2.5 px-3 border-r border-[#DCE4E0] w-32">Service</th>
                <th className="py-2.5 px-3 border-r border-[#DCE4E0] w-28">City</th>
                <th className="py-2.5 px-3 border-r border-[#DCE4E0] min-w-[180px]">Address</th>
                <th className="py-2.5 px-2.5 border-r border-[#DCE4E0] w-14 text-right">Qty</th>
                <th className="py-2.5 px-3 border-r border-[#DCE4E0] w-24 text-right">
                  Price (₹)
                </th>
                {mode === 'completed' && (
                  <th className="py-2.5 px-3 border-r border-[#DCE4E0] w-28 text-right">
                    30% Comm
                  </th>
                )}
                <th className="py-2.5 px-3 border-r border-[#DCE4E0] w-28">
                  Cleaner
                </th>
                <th className="py-2.5 px-3 border-r border-[#DCE4E0] min-w-[140px]">
                  Message
                </th>
                {currentUser.role === 'super_admin' && (
                  <th className="py-2.5 px-3 border-r border-[#DCE4E0] w-24">Telecaller</th>
                )}
                {mode === 'completed' && (
                  <th className="py-2.5 px-3 border-r border-[#DCE4E0] w-28">Done By</th>
                )}
                <th className="py-2.5 px-3 w-52 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#DCE4E0] text-[13px]">
              {loading ? (
                <tr>
                  <td
                    colSpan={totalCols}
                    className="py-10 text-center text-sm text-slate-500"
                  >
                    Loading spreadsheet rows...
                  </td>
                </tr>
              ) : visibleOrders.length === 0 ? (
                <tr>
                  <td colSpan={totalCols} className="py-12 text-center">
                    <div className="text-sm font-medium text-slate-700">
                      {mode === 'active'
                        ? 'No active orders match your current filters.'
                        : 'No completed orders match your current filters.'}
                    </div>
                    <div className="text-xs text-slate-500 mt-1">
                      {mode === 'active'
                        ? 'Use the Quick Data Entry Row above to add a booking, or clear filters.'
                        : 'Orders marked as Done from Active Orders will appear here automatically.'}
                    </div>
                  </td>
                </tr>
              ) : (
                visibleOrders.map((order, idx) => {
                  const serialNo =
                    (showEntries === -1 ? 0 : (safePage - 1) * showEntries) + idx + 1;
                  const isChecked = selectedIds.includes(order.id);
                  const isEditing = (field: EditableField) =>
                    editingCell?.id === order.id && editingCell.field === field;

                  return (
                    <tr
                      key={order.id}
                      className={`transition-colors ${
                        isChecked ? 'bg-[#E9F7F0]' : 'hover:bg-[#F2F8F5]'
                      }`}
                    >
                      <td className="py-2 px-3 border-r border-[#DCE4E0] text-center">
                        <input
                          type="checkbox"
                          aria-label={`Select order ${serialNo}`}
                          checked={isChecked}
                          onChange={() => toggleRow(order.id)}
                          className="rounded border-slate-300 accent-[#128C7E] cursor-pointer"
                        />
                      </td>

                      <td className="py-2 px-2.5 border-r border-[#DCE4E0] text-center font-mono-num text-xs font-semibold text-slate-500 bg-[#FAFDFB]">
                        {serialNo}
                      </td>

                      {/* Name (Optional) */}
                      <td
                        onClick={() => !isEditing('name') && startEdit(order, 'name')}
                        className="py-2 px-3 border-r border-[#DCE4E0] font-medium text-slate-900 cursor-text"
                        title="Click to edit Name"
                      >
                        {isEditing('name') ? (
                          <input
                            autoFocus
                            type="text"
                            value={editingValue}
                            onChange={(e) => setEditingValue(e.target.value)}
                            onBlur={() => commitEdit(order)}
                            onKeyDown={(e) => handleCellKeyDown(e, order)}
                            className="w-full px-1.5 py-0.5 text-[13px] border border-[#128C7E] rounded bg-white focus:outline-none"
                          />
                        ) : (
                          <span>{order.name || <span className="text-slate-400">—</span>}</span>
                        )}
                      </td>

                      {/* Number */}
                      <td
                        onClick={() => !isEditing('number') && startEdit(order, 'number')}
                        className="py-2 px-3 border-r border-[#DCE4E0] font-mono-num text-xs text-slate-800 cursor-text"
                        title="Click to edit Number"
                      >
                        {isEditing('number') ? (
                          <input
                            autoFocus
                            type="text"
                            value={editingValue}
                            onChange={(e) => setEditingValue(e.target.value)}
                            onBlur={() => commitEdit(order)}
                            onKeyDown={(e) => handleCellKeyDown(e, order)}
                            className="w-full px-1.5 py-0.5 text-xs font-mono-num border border-[#128C7E] rounded bg-white focus:outline-none"
                          />
                        ) : (
                          <span>{order.number}</span>
                        )}
                      </td>

                      {/* Date of Booking (Optional) */}
                      <td
                        onClick={() => !isEditing('bookingDate') && startEdit(order, 'bookingDate')}
                        className="py-2 px-3 border-r border-[#DCE4E0] font-mono-num text-xs text-slate-700 cursor-text"
                        title="Click to edit Booking Date"
                      >
                        {isEditing('bookingDate') ? (
                          <input
                            autoFocus
                            type="date"
                            value={editingValue}
                            onChange={(e) => setEditingValue(e.target.value)}
                            onBlur={() => commitEdit(order)}
                            onKeyDown={(e) => handleCellKeyDown(e, order)}
                            className="w-full px-1 py-0.5 text-xs font-mono-num border border-[#128C7E] rounded bg-white focus:outline-none"
                          />
                        ) : (
                          <span>{order.bookingDate || <span className="text-slate-400">—</span>}</span>
                        )}
                      </td>

                      {/* Service Name Dropdown */}
                      <td
                        onClick={() => !isEditing('serviceName') && startEdit(order, 'serviceName')}
                        className="py-2 px-3 border-r border-[#DCE4E0] text-slate-800 cursor-pointer"
                        title="Click to change Service"
                      >
                        {isEditing('serviceName') ? (
                          <select
                            autoFocus
                            value={editingValue}
                            onChange={(e) => {
                              setEditingValue(e.target.value);
                              commitEdit(order, e.target.value);
                            }}
                            onBlur={() => commitEdit(order)}
                            className="w-full px-1 py-0.5 text-xs border border-[#128C7E] rounded bg-white focus:outline-none"
                          >
                            {config.services.map((s) => (
                              <option key={s} value={s}>
                                {s}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span>{order.serviceName}</span>
                        )}
                      </td>

                      {/* City Dropdown */}
                      <td
                        onClick={() => !isEditing('city') && startEdit(order, 'city')}
                        className="py-2 px-3 border-r border-[#DCE4E0] text-slate-800 cursor-pointer"
                        title="Click to change City"
                      >
                        {isEditing('city') ? (
                          <select
                            autoFocus
                            value={editingValue}
                            onChange={(e) => {
                              setEditingValue(e.target.value);
                              commitEdit(order, e.target.value);
                            }}
                            onBlur={() => commitEdit(order)}
                            className="w-full px-1 py-0.5 text-xs border border-[#128C7E] rounded bg-white focus:outline-none"
                          >
                            {config.cities.map((c) => (
                              <option key={c} value={c}>
                                {c}
                              </option>
                            ))}
                            {!config.cities.includes(order.city) && (
                              <option value={order.city}>{order.city}</option>
                            )}
                          </select>
                        ) : (
                          <span>{order.city}</span>
                        )}
                      </td>

                      {/* Address (Optional) */}
                      <td
                        onClick={() => !isEditing('address') && startEdit(order, 'address')}
                        className="py-2 px-3 border-r border-[#DCE4E0] text-slate-700 cursor-text"
                        title="Click to edit Address"
                      >
                        {isEditing('address') ? (
                          <input
                            autoFocus
                            type="text"
                            value={editingValue}
                            onChange={(e) => setEditingValue(e.target.value)}
                            onBlur={() => commitEdit(order)}
                            onKeyDown={(e) => handleCellKeyDown(e, order)}
                            className="w-full px-1.5 py-0.5 text-[13px] border border-[#128C7E] rounded bg-white focus:outline-none"
                          />
                        ) : (
                          <span className="leading-snug">
                            {order.address || <span className="text-slate-400">—</span>}
                          </span>
                        )}
                      </td>

                      {/* Qty (Optional) */}
                      <td
                        onClick={() => !isEditing('qty') && startEdit(order, 'qty')}
                        className="py-2 px-2.5 border-r border-[#DCE4E0] text-right font-mono-num text-slate-900 cursor-text"
                        title="Click to edit Qty"
                      >
                        {isEditing('qty') ? (
                          <input
                            autoFocus
                            type="number"
                            min={1}
                            value={editingValue}
                            onChange={(e) => setEditingValue(e.target.value)}
                            onBlur={() => commitEdit(order)}
                            onKeyDown={(e) => handleCellKeyDown(e, order)}
                            className="w-12 px-1 py-0.5 text-right text-xs font-mono-num border border-[#128C7E] rounded bg-white focus:outline-none"
                          />
                        ) : (
                          <span>{order.qty ?? <span className="text-slate-400">—</span>}</span>
                        )}
                      </td>

                      {/* Price (Manual ₹) */}
                      <td
                        onClick={() => !isEditing('price') && startEdit(order, 'price')}
                        className="py-2 px-3 border-r border-[#DCE4E0] text-right font-mono-num font-semibold text-slate-900 cursor-text"
                        title="Click to edit Price"
                      >
                        {isEditing('price') ? (
                          <input
                            autoFocus
                            type="number"
                            min={0}
                            value={editingValue}
                            onChange={(e) => setEditingValue(e.target.value)}
                            onBlur={() => commitEdit(order)}
                            onKeyDown={(e) => handleCellKeyDown(e, order)}
                            className="w-20 px-1 py-0.5 text-right text-xs font-mono-num border border-[#128C7E] rounded bg-white focus:outline-none"
                          />
                        ) : (
                          <div>
                            <span>₹{order.price.toLocaleString('en-IN')}</span>
                            {Number(order.extraAmount || 0) > 0 && (
                              <div className="text-[10px] text-blue-700 font-medium">
                                +₹{Number(order.extraAmount).toLocaleString('en-IN')} extra
                              </div>
                            )}
                          </div>
                        )}
                      </td>

                      {mode === 'completed' && (() => {
                        const orderTotal = getOrderTotal(order);
                        const comm30 = calcCommission30(orderTotal);
                        const pending = getPendingCommission(order);
                        return (
                          <td className="py-2 px-3 border-r border-[#DCE4E0] text-right font-mono-num">
                            <div className="font-semibold text-amber-800">
                              ₹{comm30.toLocaleString('en-IN')}
                            </div>
                            <div
                              className={`text-[10px] font-semibold ${
                                pending > 0 ? 'text-red-600' : 'text-[#075E54]'
                              }`}
                            >
                              {pending > 0
                                ? `Due ₹${pending.toLocaleString('en-IN')}`
                                : 'Clear'}
                            </div>
                          </td>
                        );
                      })()}

                      {/* Cleaner Name Dropdown */}
                      <td
                        onClick={() => !isEditing('cleanerName') && startEdit(order, 'cleanerName')}
                        className="py-2 px-3 border-r border-[#DCE4E0] font-medium text-[#075E54] cursor-pointer"
                        title="Click to change Cleaner"
                      >
                        {isEditing('cleanerName') ? (
                          <select
                            autoFocus
                            value={editingValue}
                            onChange={(e) => {
                              setEditingValue(e.target.value);
                              commitEdit(order, e.target.value);
                            }}
                            onBlur={() => commitEdit(order)}
                            className="w-full px-1 py-0.5 text-xs border border-[#128C7E] rounded bg-white focus:outline-none"
                          >
                            {config.cleaners.map((cl) => (
                              <option key={cl} value={cl}>
                                {cl}
                              </option>
                            ))}
                            {!config.cleaners.includes(order.cleanerName) && (
                              <option value={order.cleanerName}>{order.cleanerName}</option>
                            )}
                          </select>
                        ) : (
                          <span>{order.cleanerName}</span>
                        )}
                      </td>

                      {/* Message / Notes */}
                      <td
                        onClick={() => !isEditing('notes') && startEdit(order, 'notes')}
                        className="py-2 px-3 border-r border-[#DCE4E0] text-xs text-slate-600 cursor-text"
                        title="Click to edit Message"
                      >
                        {isEditing('notes') ? (
                          <input
                            autoFocus
                            type="text"
                            value={editingValue}
                            onChange={(e) => setEditingValue(e.target.value)}
                            onBlur={() => commitEdit(order)}
                            onKeyDown={(e) => handleCellKeyDown(e, order)}
                            className="w-full px-1.5 py-0.5 text-xs border border-[#128C7E] rounded bg-white focus:outline-none"
                          />
                        ) : (
                          <span>{order.notes || <span className="text-slate-400">—</span>}</span>
                        )}
                      </td>

                      {currentUser.role === 'super_admin' && (
                        <td className="py-2 px-3 border-r border-[#DCE4E0] text-xs text-slate-600">
                          {order.createdByName}
                        </td>
                      )}

                      {mode === 'completed' && (
                        <td className="py-2 px-3 border-r border-[#DCE4E0] text-xs text-slate-700">
                          <div>{order.completedByName || order.createdByName || '—'}</div>
                          {order.completedAt && (
                            <div className="text-[10px] font-mono-num text-slate-400">
                              {new Date(order.completedAt).toLocaleDateString('en-IN', {
                                day: '2-digit',
                                month: 'short',
                              })}
                            </div>
                          )}
                        </td>
                      )}

                      {/* Actions */}
                      <td className="py-2 px-3 text-right whitespace-nowrap">
                        <div className="inline-flex items-center justify-end gap-1">
                          {order.number && (
                            <button
                              type="button"
                              onClick={() => setConfirmOrder(order)}
                              title="Send Booking Confirmation to Client via WhatsApp"
                              className="px-2 py-1 text-xs font-semibold bg-[#E7F8EE] hover:bg-[#D1F2DF] text-[#075E54] border border-[#BFEAD1] rounded flex items-center gap-1 cursor-pointer"
                            >
                              <Send className="w-3.5 h-3.5 text-[#128C7E]" />
                              Client
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() => setInvoiceOrder(order)}
                            title="Generate Auto Bill & Invoice (City Clean Company)"
                            className="px-2 py-1 text-xs font-semibold bg-white hover:bg-slate-50 text-slate-800 border border-[#DCE4E0] rounded flex items-center gap-1 cursor-pointer"
                          >
                            <FileText className="w-3.5 h-3.5 text-[#075E54]" />
                            Invoice
                          </button>

                          {mode === 'active' ? (
                            <>
                              <button
                                type="button"
                                onClick={() => onOpenWhatsAppForCleaner(order.cleanerName)}
                                title={`Send all ${order.cleanerName} orders to WhatsApp Group`}
                                className="p-1.5 text-[#128C7E] hover:bg-[#E7F5EE] rounded cursor-pointer"
                              >
                                <MessageCircle className="w-4 h-4" />
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  onUpdateOrder(order.id, { status: 'completed' })
                                }
                                title="Mark order complete"
                                className="px-2 py-1 text-xs font-semibold bg-[#128C7E] hover:bg-[#075E54] text-white rounded flex items-center gap-1 cursor-pointer"
                              >
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                Done
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              onClick={() => onUpdateOrder(order.id, { status: 'active' })}
                              title="Move back to Active Orders"
                              className="px-2 py-1 text-xs font-medium bg-white border border-[#DCE4E0] hover:bg-slate-50 text-slate-700 rounded flex items-center gap-1 cursor-pointer"
                            >
                              <RotateCcw className="w-3 h-3" />
                              Reopen
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() => setDeleteTargetOrder(order)}
                            title="Delete order"
                            className="px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 border border-transparent hover:border-red-200 rounded inline-flex items-center gap-1 cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>

            {filteredOrders.length > 0 && (
              <tfoot>
                <tr className="bg-[#EFF4F1] border-t-2 border-[#DCE4E0] text-xs font-bold text-slate-900">
                  <td colSpan={8} className="py-2.5 px-4 text-right border-r border-[#DCE4E0]">
                    Filtered Totals ({filteredOrders.length} orders):
                  </td>
                  <td className="py-2.5 px-2.5 text-right font-mono-num border-r border-[#DCE4E0]">
                    {totals.totalQty}
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono-num text-[#075E54] border-r border-[#DCE4E0]">
                    ₹{totals.totalPrice.toLocaleString('en-IN')}
                  </td>
                  {mode === 'completed' && (
                    <td className="py-2.5 px-3 text-right font-mono-num text-amber-800 border-r border-[#DCE4E0]">
                      ₹{completedSummary.totalComm30.toLocaleString('en-IN')}
                    </td>
                  )}
                  <td
                    colSpan={
                      3 +
                      (currentUser.role === 'super_admin' ? 1 : 0) +
                      (mode === 'completed' ? 1 : 0)
                    }
                    className="py-2.5 px-3 text-xs font-normal text-slate-500"
                  >
                    {mode === 'completed'
                      ? `Pending Leni Hai: ₹${completedSummary.totalPending.toLocaleString('en-IN')}`
                      : 'Click any cell above to edit inline'}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>

        {/* Pagination Footer */}
        <div className="px-4 py-3 border-t border-[#DCE4E0] bg-[#FAFDFB] flex flex-wrap items-center justify-between gap-3 text-xs text-slate-600">
          <div>
            Showing <span className="font-mono-num font-semibold text-slate-900">{startEntryIndex}</span> to{' '}
            <span className="font-mono-num font-semibold text-slate-900">{endEntryIndex}</span> of{' '}
            <span className="font-mono-num font-semibold text-slate-900">{filteredOrders.length}</span> entries
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={safePage <= 1}
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              className="px-3 py-1 bg-white border border-[#DCE4E0] rounded hover:bg-slate-50 disabled:opacity-40 cursor-pointer"
            >
              Prev
            </button>
            <span className="px-2 font-mono-num">
              Page {safePage} / {totalPages}
            </span>
            <button
              type="button"
              disabled={safePage >= totalPages}
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              className="px-3 py-1 bg-white border border-[#DCE4E0] rounded hover:bg-slate-50 disabled:opacity-40 cursor-pointer"
            >
              Next
            </button>
          </div>
        </div>
      </div>
      </div>

      {/* Client WhatsApp Confirmation Modal */}
      <ClientConfirmModal
        order={confirmOrder}
        onClose={() => setConfirmOrder(null)}
        onNotify={onNotify}
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

      {/* Duplicate Active Order Confirmation Popup */}
      <ConfirmDialog
        open={pendingDuplicateSubmit}
        title="Duplicate Order Alert!"
        message={(() => {
          const firstActive =
            duplicateMatches.find((m) => m.status === 'active') || duplicateMatches[0];
          if (!firstActive) return 'This phone number already has an active order. Book anyway?';
          return `This number (${firstActive.number}) already has an Active order taken by ${firstActive.createdByName} for "${firstActive.name || 'Customer'}" on Booking Date ${firstActive.bookingDate || 'N/A'} (${firstActive.serviceName}, ₹${firstActive.price}). Do you still want to add a new order?`;
        })()}
        confirmLabel="Yes, Book Anyway"
        cancelLabel="No, Cancel"
        loadingLabel="Adding..."
        loading={adding}
        onCancel={() => setPendingDuplicateSubmit(false)}
        onConfirm={async () => {
          await submitOrderEntry();
        }}
      />
      {/* Excel Import Modal */}
      <ExcelImportModal
        open={importModalOpen}
        config={config}
        onClose={() => setImportModalOpen(false)}
        onImport={onBulkImport}
        onNotify={onNotify}
      />

      {/* Auto Bill & Invoice Modal */}
      <InvoiceModal
        order={invoiceOrder}
        onClose={() => setInvoiceOrder(null)}
        onNotify={onNotify}
      />
    </div>
  );
};
