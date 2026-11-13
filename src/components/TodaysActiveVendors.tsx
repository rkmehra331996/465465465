import React, { useMemo, useState } from 'react';
import {
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Copy,
  FileText,
  MessageCircle,
  Pencil,
  RotateCcw,
  Search,
  X,
} from 'lucide-react';
import {
  buildCleanerWhatsAppMessage,
  calcCommission30,
  getOrderTotal,
  getPendingCommission,
  toOrderNumberEmoji,
} from '../lib/api';
import { InvoiceModal } from './InvoiceModal';
import type { Order, PortalConfig, UserPublic } from '../types';

interface TodaysActiveVendorsProps {
  orders: Order[];
  config: PortalConfig;
  currentUser: UserPublic;
  onUpdateOrder: (id: string, patch: Partial<Order>) => Promise<void>;
  onBulkComplete: (ids: string[]) => Promise<void>;
  onOpenWhatsAppForCleaner: (cleanerName: string, selectedIds?: string[]) => void;
  onNotify: (msg: string, type?: 'success' | 'error') => void;
}

type InlineField =
  | 'bookingDate'
  | 'name'
  | 'number'
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

function formatSingleOrderForWhatsApp(order: Order, indexNumber = 1): string {
  const serial = toOrderNumberEmoji(indexNumber);
  const total = getOrderTotal(order);
  const customer = order.name || (order.isExtraWork ? 'Extra / On-Site Work' : 'Customer');
  const lines = [
    `${serial} *${customer}*`,
    ...(order.number ? [`Phone: ${order.number}`] : []),
    `Service: ${order.serviceName} | City: ${order.city}`,
    ...(order.bookingDate ? [`Date: ${order.bookingDate}`] : []),
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
  onBulkComplete,
  onOpenWhatsAppForCleaner,
  onNotify,
}) => {
  const today = useMemo(() => dateOffsetStr(0), []);
  const yesterday = useMemo(() => dateOffsetStr(-1), []);
  const tomorrow = useMemo(() => dateOffsetStr(1), []);

  const [selectedDate, setSelectedDate] = useState<string>(today);
  const [statusMode, setStatusMode] = useState<'all' | 'active' | 'completed'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [telecallerFilter, setTelecallerFilter] = useState('all');
  const [collapsedVendors, setCollapsedVendors] = useState<Record<string, boolean>>({});
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Inline cell editing state
  const [editingCell, setEditingCell] = useState<{ id: string; field: InlineField } | null>(null);
  const [editingValue, setEditingValue] = useState('');

  // Full Edit Modal state
  const [editModalOrder, setEditModalOrder] = useState<Order | null>(null);
  const [editForm, setEditForm] = useState({
    name: '',
    number: '',
    bookingDate: '',
    serviceName: '',
    city: '',
    cleanerName: '',
    address: '',
    qty: '',
    price: '',
    extraAmount: '',
    notes: '',
  });
  const [savingModal, setSavingModal] = useState(false);
  const [invoiceOrder, setInvoiceOrder] = useState<Order | null>(null);

  const uniqueTelecallers = useMemo(() => {
    const map = new Map<string, string>();
    for (const o of orders) {
      if (o.createdById && o.createdByName) {
        map.set(o.createdById, o.createdByName);
      }
    }
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [orders]);

  const filteredOrders = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return orders.filter((o) => {
      if (statusMode === 'active' && o.status !== 'active') return false;
      if (statusMode === 'completed' && o.status !== 'completed') return false;
      if (selectedDate && o.bookingDate !== selectedDate) return false;
      if (telecallerFilter !== 'all' && o.createdById !== telecallerFilter) return false;
      if (q) {
        const hay = `${o.cleanerName} ${o.name} ${o.number} ${o.serviceName} ${o.city} ${o.address} ${o.notes ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [orders, statusMode, selectedDate, telecallerFilter, searchQuery]);

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
      existing.totalWork += getOrderTotal(o);
      existing.pendingComm30 += getPendingCommission(o);
      if (o.status === 'active') {
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

  const startInlineEdit = (order: Order, field: InlineField) => {
    setEditingCell({ id: order.id, field });
    setEditingValue(String(order[field] ?? ''));
  };

  const commitInlineEdit = async (order: Order, overrideValue?: string) => {
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

  const openEditModal = (order: Order) => {
    setEditModalOrder(order);
    setEditForm({
      name: order.name || '',
      number: order.number || '',
      bookingDate: order.bookingDate || '',
      serviceName: order.serviceName || config.services[0] || '',
      city: order.city || config.cities[0] || '',
      cleanerName: order.cleanerName || config.cleaners[0] || '',
      address: order.address || '',
      qty: order.qty !== null && order.qty !== undefined ? String(order.qty) : '',
      price: String(order.price ?? 0),
      extraAmount: String(order.extraAmount ?? 0),
      notes: order.notes || '',
    });
  };

  const handleSaveModal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editModalOrder) return;
    setSavingModal(true);
    try {
      const parsedQty = editForm.qty.trim() ? Number(editForm.qty) : null;
      await onUpdateOrder(editModalOrder.id, {
        name: editForm.name.trim(),
        number: editForm.number.trim(),
        bookingDate: editForm.bookingDate.trim(),
        serviceName: editForm.serviceName,
        city: editForm.city,
        cleanerName: editForm.cleanerName,
        address: editForm.address.trim(),
        qty: parsedQty && Number.isFinite(parsedQty) && parsedQty > 0 ? parsedQty : null,
        price: Math.max(0, Number(editForm.price) || 0),
        extraAmount: Math.max(0, Number(editForm.extraAmount) || 0),
        notes: editForm.notes.trim(),
      });
      setEditModalOrder(null);
    } finally {
      setSavingModal(false);
    }
  };

  const toggleCollapse = (vendorName: string) => {
    setCollapsedVendors((prev) => ({
      ...prev,
      [vendorName]: !prev[vendorName],
    }));
  };

  return (
    <div className="space-y-3">
      {/* Clean Flat Filter Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 py-2 border-y border-[#DCE4E0]">
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded border border-[#DCE4E0] bg-white overflow-hidden text-xs">
            {[
              { label: 'Today', val: today },
              { label: 'Yesterday', val: yesterday },
              { label: 'Tomorrow', val: tomorrow },
              { label: 'All Dates', val: '' },
            ].map((btn, idx) => (
              <button
                key={btn.label}
                type="button"
                onClick={() => setSelectedDate(btn.val)}
                className={`px-2.5 py-1 font-medium cursor-pointer whitespace-nowrap ${
                  idx > 0 ? 'border-l border-[#DCE4E0]' : ''
                } ${
                  selectedDate === btn.val
                    ? 'bg-red-600 text-white'
                    : 'bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                {btn.label}
              </button>
            ))}
          </div>

          <input
            type="date"
            aria-label="Filter by date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="px-2 py-1 text-xs font-mono-num bg-white border border-[#DCE4E0] rounded text-slate-700 focus:outline-none focus:border-slate-400"
          />

          <select
            aria-label="Filter status"
            value={statusMode}
            onChange={(e) => setStatusMode(e.target.value as 'all' | 'active' | 'completed')}
            className="px-2 py-1 text-xs bg-white border border-[#DCE4E0] rounded text-slate-700 focus:outline-none focus:border-slate-400"
          >
            <option value="all">All (Active + Done)</option>
            <option value="active">Active Only</option>
            <option value="completed">Completed Only</option>
          </select>

          {uniqueTelecallers.length > 0 && (
            <select
              aria-label="Filter by telecaller"
              value={telecallerFilter}
              onChange={(e) => setTelecallerFilter(e.target.value)}
              className="px-2 py-1 text-xs bg-white border border-[#DCE4E0] rounded text-slate-700 focus:outline-none focus:border-slate-400"
            >
              <option value="all">All Telecallers</option>
              {uniqueTelecallers.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          )}

          {(selectedDate !== today ||
            statusMode !== 'all' ||
            searchQuery ||
            telecallerFilter !== 'all') && (
            <button
              type="button"
              onClick={() => {
                setSelectedDate(today);
                setStatusMode('all');
                setSearchQuery('');
                setTelecallerFilter('all');
              }}
              className="px-2 py-1 text-xs text-slate-600 hover:text-slate-900 inline-flex items-center gap-1 cursor-pointer"
            >
              <RotateCcw className="w-3 h-3" />
              Reset
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search cleaner, customer..."
              className="pl-7 pr-2.5 py-1 text-xs bg-white border border-[#DCE4E0] rounded w-44 text-slate-700 focus:outline-none focus:border-slate-400"
            />
          </div>

          <div className="text-xs font-mono-num text-slate-600">
            Vendors: <strong className="text-red-700">{vendorGroups.length}</strong> · Orders:{' '}
            <strong className="text-slate-900">{filteredOrders.length}</strong> · 100%:{' '}
            <strong className="text-[#075E54]">₹{totalWorkAll.toLocaleString('en-IN')}</strong> · 30%:{' '}
            <strong className="text-amber-800">
              ₹{calcCommission30(totalWorkAll).toLocaleString('en-IN')}
            </strong>
          </div>
        </div>
      </div>

      {/* Vendor List */}
      {vendorGroups.length === 0 ? (
        <div className="bg-white border border-[#DCE4E0] rounded-xl p-8 text-center">
          <div className="text-sm font-semibold text-slate-800">
            No orders found for {selectedDate || 'All Dates'}.
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Change the date filter above (Today, Tomorrow, Yesterday, or All Dates) to see vendor orders.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {vendorGroups.map((vendor) => {
            const isCollapsed = Boolean(collapsedVendors[vendor.name]);
            const comm30 = calcCommission30(vendor.totalWork);
            const vendorCopyKey = `vendor-${vendor.name}`;
            const isVendorCopied = copiedKey === vendorCopyKey;

            const allVendorDone = vendor.orders.length > 0 && vendor.activeIds.length === 0;

            return (
              <section
                key={vendor.name}
                className={`bg-white border rounded-xl overflow-hidden ${
                  allVendorDone ? 'border-red-300' : 'border-[#DCE4E0]'
                }`}
              >
                {/* Simple Clean Vendor Header */}
                <div
                  className={`px-4 py-2.5 border-b flex flex-wrap items-center justify-between gap-2 ${
                    allVendorDone
                      ? 'bg-red-50 border-red-200'
                      : 'bg-[#FAFDFB] border-[#DCE4E0]'
                  }`}
                >
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <h2 className="font-display text-sm sm:text-base font-bold text-slate-900">
                      {vendor.name}
                    </h2>
                    <span className="text-xs font-mono-num font-semibold text-red-700">
                      ({vendor.orders.length} order{vendor.orders.length > 1 ? 's' : ''})
                    </span>
                    {allVendorDone && (
                      <span className="px-1.5 py-0.5 rounded bg-red-600 text-white text-[10px] font-semibold uppercase">
                        All Done
                      </span>
                    )}
                    {vendor.phone && (
                      <span className="text-xs font-mono-num text-slate-500">{vendor.phone}</span>
                    )}
                    {vendor.city && (
                      <span className="text-xs text-slate-500">· {vendor.city}</span>
                    )}
                    <span className="text-xs font-mono-num text-slate-700">
                      · 100%: <strong>₹{vendor.totalWork.toLocaleString('en-IN')}</strong>
                    </span>
                    <span className="text-xs font-mono-num text-amber-800 font-semibold">
                      · 30%: ₹{comm30.toLocaleString('en-IN')}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() =>
                        copyText(
                          buildCleanerWhatsAppMessage(vendor.name, vendor.orders),
                          vendorCopyKey,
                          `${vendor.name} ke ${vendor.orders.length} orders copy ho gaye!`
                        )
                      }
                      className="px-2.5 py-1 text-xs font-semibold bg-white hover:bg-slate-50 text-slate-800 border border-[#DCE4E0] rounded-lg inline-flex items-center gap-1 cursor-pointer whitespace-nowrap"
                    >
                      {isVendorCopied ? (
                        <Check className="w-3.5 h-3.5 text-[#128C7E]" />
                      ) : (
                        <Copy className="w-3.5 h-3.5 text-slate-600" />
                      )}
                      {isVendorCopied ? 'Copied!' : 'Copy Orders'}
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        onOpenWhatsAppForCleaner(
                          vendor.name,
                          vendor.orders.map((o) => o.id)
                        )
                      }
                      className="px-2.5 py-1 text-xs font-semibold bg-[#25D366] hover:bg-[#1ebe5d] text-white rounded-lg inline-flex items-center gap-1 cursor-pointer whitespace-nowrap"
                    >
                      <MessageCircle className="w-3.5 h-3.5" />
                      WhatsApp
                    </button>

                    {vendor.activeIds.length > 0 && (
                      <button
                        type="button"
                        onClick={() => onBulkComplete(vendor.activeIds)}
                        className="px-2.5 py-1 text-xs font-semibold bg-[#128C7E] hover:bg-[#075E54] text-white rounded-lg inline-flex items-center gap-1 cursor-pointer whitespace-nowrap"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        All Done
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => toggleCollapse(vendor.name)}
                      aria-label={isCollapsed ? `Expand ${vendor.name}` : `Collapse ${vendor.name}`}
                      className="p-1 text-slate-500 hover:text-slate-800 cursor-pointer"
                    >
                      {isCollapsed ? (
                        <ChevronDown className="w-4 h-4" />
                      ) : (
                        <ChevronUp className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                </div>

                {/* Cleaner's Orders Table */}
                {!isCollapsed && (
                  <div className="overflow-x-auto sheet-scroll">
                    <table className="w-full text-left border-collapse min-w-[980px]">
                      <thead>
                        <tr className="bg-white border-b border-[#DCE4E0] text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                          <th className="py-2 px-2.5 w-10 text-center">No</th>
                          <th className="py-2 px-2.5 w-24">Date</th>
                          <th className="py-2 px-2.5">Customer</th>
                          <th className="py-2 px-2.5 w-28">Phone</th>
                          <th className="py-2 px-2.5 w-28">Service</th>
                          <th className="py-2 px-2.5 w-24">City</th>
                          <th className="py-2 px-2.5">Address / Note</th>
                          <th className="py-2 px-2 w-12 text-right">Qty</th>
                          <th className="py-2 px-2.5 w-24 text-right">Price</th>
                          <th className="py-2 px-2.5 w-48 text-right">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#DCE4E0] text-xs">
                        {vendor.orders.map((order, idx) => {
                          const total = getOrderTotal(order);
                          const isEditing = (field: InlineField) =>
                            editingCell?.id === order.id && editingCell.field === field;
                          const rowCopyKey = `row-${order.id}`;
                          const isRowCopied = copiedKey === rowCopyKey;

                          const isCompleted = order.status === 'completed';

                          return (
                            <tr
                              key={order.id}
                              className={`transition-colors ${
                                isCompleted
                                  ? 'bg-red-100 hover:bg-red-200/75 text-red-950 border-l-4 border-l-red-600'
                                  : 'hover:bg-[#FAFDFB]'
                              }`}
                            >
                              <td
                                className={`py-2 px-2.5 text-center font-mono-num font-semibold ${
                                  isCompleted ? 'text-red-800' : 'text-slate-500'
                                }`}
                              >
                                {idx + 1}
                              </td>

                              <td
                                onClick={() => !isEditing('bookingDate') && startInlineEdit(order, 'bookingDate')}
                                className="py-2 px-2.5 font-mono-num text-slate-700 whitespace-nowrap cursor-pointer"
                                title="Click to edit date"
                              >
                                {isEditing('bookingDate') ? (
                                  <input
                                    autoFocus
                                    type="date"
                                    value={editingValue}
                                    onChange={(e) => setEditingValue(e.target.value)}
                                    onBlur={() => commitInlineEdit(order)}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') commitInlineEdit(order);
                                      if (e.key === 'Escape') setEditingCell(null);
                                    }}
                                    className="w-full px-1 py-0.5 text-xs border border-[#128C7E] rounded bg-white"
                                  />
                                ) : (
                                  order.bookingDate || '—'
                                )}
                              </td>

                              <td
                                onClick={() => !isEditing('name') && startInlineEdit(order, 'name')}
                                className="py-2 px-2.5 font-semibold text-slate-900 cursor-text"
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
                                    className="w-full px-1.5 py-0.5 text-xs border border-[#128C7E] rounded bg-white"
                                  />
                                ) : (
                                  order.name || (order.isExtraWork ? 'Extra Work' : '—')
                                )}
                              </td>

                              <td
                                onClick={() => !isEditing('number') && startInlineEdit(order, 'number')}
                                className="py-2 px-2.5 font-mono-num text-slate-800 cursor-text"
                                title="Click to edit phone"
                              >
                                {isEditing('number') ? (
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
                                    className="w-full px-1.5 py-0.5 text-xs border border-[#128C7E] rounded bg-white"
                                  />
                                ) : (
                                  order.number || '—'
                                )}
                              </td>

                              <td
                                onClick={() => !isEditing('serviceName') && startInlineEdit(order, 'serviceName')}
                                className="py-2 px-2.5 text-slate-800 cursor-pointer"
                                title="Click to change service"
                              >
                                {isEditing('serviceName') ? (
                                  <select
                                    autoFocus
                                    value={editingValue}
                                    onChange={(e) => commitInlineEdit(order, e.target.value)}
                                    onBlur={() => commitInlineEdit(order)}
                                    className="w-full px-1 py-0.5 text-xs border border-[#128C7E] rounded bg-white"
                                  >
                                    {config.services.map((s) => (
                                      <option key={s} value={s}>
                                        {s}
                                      </option>
                                    ))}
                                  </select>
                                ) : (
                                  order.serviceName
                                )}
                              </td>

                              <td
                                onClick={() => !isEditing('city') && startInlineEdit(order, 'city')}
                                className="py-2 px-2.5 text-slate-700 cursor-pointer"
                                title="Click to change city"
                              >
                                {isEditing('city') ? (
                                  <select
                                    autoFocus
                                    value={editingValue}
                                    onChange={(e) => commitInlineEdit(order, e.target.value)}
                                    onBlur={() => commitInlineEdit(order)}
                                    className="w-full px-1 py-0.5 text-xs border border-[#128C7E] rounded bg-white"
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
                                className="py-2 px-2.5 text-slate-600 max-w-[260px] cursor-text"
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
                                    className="w-full px-1.5 py-0.5 text-xs border border-[#128C7E] rounded bg-white"
                                  />
                                ) : (
                                  <div>
                                    <div className="truncate">{order.address || '—'}</div>
                                    {order.notes && (
                                      <div className="text-[11px] text-slate-500 truncate">
                                        {order.notes}
                                      </div>
                                    )}
                                  </div>
                                )}
                              </td>

                              <td
                                onClick={() => !isEditing('qty') && startInlineEdit(order, 'qty')}
                                className="py-2 px-2 text-right font-mono-num text-slate-800 cursor-text"
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
                                    className="w-12 px-1 py-0.5 text-right text-xs border border-[#128C7E] rounded bg-white"
                                  />
                                ) : (
                                  order.qty ?? '—'
                                )}
                              </td>

                              <td
                                onClick={() => !isEditing('price') && startInlineEdit(order, 'price')}
                                className="py-2 px-2.5 text-right font-mono-num font-bold text-slate-900 cursor-text"
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
                                    className="w-20 px-1 py-0.5 text-right text-xs border border-[#128C7E] rounded bg-white"
                                  />
                                ) : (
                                  <div>
                                    <span>₹{total.toLocaleString('en-IN')}</span>
                                    {order.extraAmount > 0 && (
                                      <div className="text-[10px] font-normal text-blue-700">
                                        +₹{order.extraAmount}
                                      </div>
                                    )}
                                  </div>
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
                                    title="Copy order for WhatsApp"
                                    className="px-2 py-1 text-[11px] font-medium bg-white border border-[#DCE4E0] hover:bg-slate-50 text-slate-700 rounded inline-flex items-center gap-1 cursor-pointer"
                                  >
                                    {isRowCopied ? (
                                      <Check className="w-3 h-3 text-[#128C7E]" />
                                    ) : (
                                      <Copy className="w-3 h-3 text-slate-500" />
                                    )}
                                    {isRowCopied ? 'Copied' : 'Copy'}
                                  </button>

                                  <button
                                    type="button"
                                    onClick={() => openEditModal(order)}
                                    title="Edit full order"
                                    className="px-2 py-1 text-[11px] font-medium bg-white border border-[#DCE4E0] hover:bg-slate-50 text-slate-700 rounded inline-flex items-center gap-1 cursor-pointer"
                                  >
                                    <Pencil className="w-3 h-3 text-slate-500" />
                                    Edit
                                  </button>

                                  <button
                                    type="button"
                                    onClick={() => setInvoiceOrder(order)}
                                    title="Generate Invoice / Bill"
                                    className="px-2 py-1 text-[11px] font-semibold bg-white border border-[#DCE4E0] hover:bg-slate-50 text-[#075E54] rounded inline-flex items-center gap-1 cursor-pointer"
                                  >
                                    <FileText className="w-3 h-3 text-[#075E54]" />
                                    Bill
                                  </button>

                                  {order.status === 'active' ? (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        onUpdateOrder(order.id, { status: 'completed' })
                                      }
                                      className="px-2 py-1 text-[11px] font-semibold bg-[#128C7E] hover:bg-[#075E54] text-white rounded inline-flex items-center gap-1 cursor-pointer"
                                    >
                                      <CheckCircle2 className="w-3 h-3" />
                                      Done
                                    </button>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        onUpdateOrder(order.id, { status: 'active' })
                                      }
                                      className="px-2 py-1 text-[11px] font-medium bg-white border border-[#DCE4E0] hover:bg-slate-50 text-slate-700 rounded cursor-pointer"
                                    >
                                      Reopen
                                    </button>
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

      {/* Clean Edit Order Modal */}
      {editModalOrder && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-slate-900/45 flex items-center justify-center p-4"
          onClick={() => setEditModalOrder(null)}
        >
          <div
            className="bg-white border border-[#DCE4E0] rounded-xl w-full max-w-lg overflow-hidden shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 py-3 bg-[#075E54] text-white flex items-center justify-between">
              <h3 className="font-display text-sm font-bold">
                Edit Order — {editModalOrder.name || editModalOrder.number}
              </h3>
              <button
                type="button"
                onClick={() => setEditModalOrder(null)}
                aria-label="Close edit modal"
                className="p-1 hover:bg-white/15 rounded cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveModal} className="p-4 space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">City</label>
                  <select
                    value={editForm.city}
                    onChange={(e) => setEditForm((f) => ({ ...f, city: e.target.value }))}
                    className="w-full px-2.5 py-1.5 border border-[#DCE4E0] rounded bg-[#F7F9F8] focus:bg-white focus:outline-none focus:border-[#128C7E]"
                  >
                    {config.cities.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                    {!config.cities.includes(editForm.city) && editForm.city && (
                      <option value={editForm.city}>{editForm.city}</option>
                    )}
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Phone Number</label>
                  <input
                    type="text"
                    required
                    value={editForm.number}
                    onChange={(e) => setEditForm((f) => ({ ...f, number: e.target.value }))}
                    className="w-full px-2.5 py-1.5 font-mono-num border border-[#DCE4E0] rounded bg-[#F7F9F8] focus:bg-white focus:outline-none focus:border-[#128C7E]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Customer Name</label>
                  <input
                    type="text"
                    value={editForm.name}
                    onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                    className="w-full px-2.5 py-1.5 border border-[#DCE4E0] rounded bg-[#F7F9F8] focus:bg-white focus:outline-none focus:border-[#128C7E]"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Service</label>
                  <select
                    value={editForm.serviceName}
                    onChange={(e) => setEditForm((f) => ({ ...f, serviceName: e.target.value }))}
                    className="w-full px-2.5 py-1.5 border border-[#DCE4E0] rounded bg-[#F7F9F8] focus:bg-white focus:outline-none focus:border-[#128C7E]"
                  >
                    {config.services.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                    {!config.services.includes(editForm.serviceName) && editForm.serviceName && (
                      <option value={editForm.serviceName}>{editForm.serviceName}</option>
                    )}
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Address</label>
                <input
                  type="text"
                  value={editForm.address}
                  onChange={(e) => setEditForm((f) => ({ ...f, address: e.target.value }))}
                  className="w-full px-2.5 py-1.5 border border-[#DCE4E0] rounded bg-[#F7F9F8] focus:bg-white focus:outline-none focus:border-[#128C7E]"
                />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Qty</label>
                  <input
                    type="number"
                    min={1}
                    value={editForm.qty}
                    onChange={(e) => setEditForm((f) => ({ ...f, qty: e.target.value }))}
                    className="w-full px-2.5 py-1.5 font-mono-num border border-[#DCE4E0] rounded bg-[#F7F9F8] focus:bg-white focus:outline-none focus:border-[#128C7E]"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Price (₹)</label>
                  <input
                    type="number"
                    min={0}
                    value={editForm.price}
                    onChange={(e) => setEditForm((f) => ({ ...f, price: e.target.value }))}
                    className="w-full px-2.5 py-1.5 font-mono-num border border-[#DCE4E0] rounded bg-[#F7F9F8] focus:bg-white focus:outline-none focus:border-[#128C7E]"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Extra Work (₹)</label>
                  <input
                    type="number"
                    min={0}
                    value={editForm.extraAmount}
                    onChange={(e) => setEditForm((f) => ({ ...f, extraAmount: e.target.value }))}
                    className="w-full px-2.5 py-1.5 font-mono-num border border-[#DCE4E0] rounded bg-[#F7F9F8] focus:bg-white focus:outline-none focus:border-[#128C7E]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Booking Date</label>
                  <input
                    type="date"
                    value={editForm.bookingDate}
                    onChange={(e) => setEditForm((f) => ({ ...f, bookingDate: e.target.value }))}
                    className="w-full px-2.5 py-1.5 font-mono-num border border-[#DCE4E0] rounded bg-[#F7F9F8] focus:bg-white focus:outline-none focus:border-[#128C7E]"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Assign Cleaner</label>
                  <select
                    value={editForm.cleanerName}
                    onChange={(e) => setEditForm((f) => ({ ...f, cleanerName: e.target.value }))}
                    className="w-full px-2.5 py-1.5 border border-[#DCE4E0] rounded bg-[#F7F9F8] focus:bg-white focus:outline-none focus:border-[#128C7E]"
                  >
                    {config.cleaners.map((cl) => (
                      <option key={cl} value={cl}>
                        {cl}
                      </option>
                    ))}
                    {!config.cleaners.includes(editForm.cleanerName) && editForm.cleanerName && (
                      <option value={editForm.cleanerName}>{editForm.cleanerName}</option>
                    )}
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Message / Note</label>
                <input
                  type="text"
                  value={editForm.notes}
                  onChange={(e) => setEditForm((f) => ({ ...f, notes: e.target.value }))}
                  className="w-full px-2.5 py-1.5 border border-[#DCE4E0] rounded bg-[#F7F9F8] focus:bg-white focus:outline-none focus:border-[#128C7E]"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#DCE4E0]">
                <button
                  type="button"
                  onClick={() => setEditModalOrder(null)}
                  className="px-3 py-1.5 border border-[#DCE4E0] rounded-lg text-slate-700 hover:bg-slate-50 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingModal}
                  className="px-4 py-1.5 bg-[#128C7E] hover:bg-[#075E54] disabled:opacity-50 text-white font-semibold rounded-lg cursor-pointer"
                >
                  {savingModal ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* Auto Bill & Invoice Modal */}
      <InvoiceModal
        order={invoiceOrder}
        onClose={() => setInvoiceOrder(null)}
        onNotify={onNotify}
      />
    </div>
  );
};
