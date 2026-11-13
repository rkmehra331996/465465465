import React, { useMemo, useState } from 'react';
import {
  ArrowRightLeft,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Copy,
  FileText,
  MessageCircle,
  RotateCcw,
  Trash2,
  X,
} from 'lucide-react';
import {
  buildCleanerWhatsAppMessage,
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

  // Inline cell editing state
  const [editingCell, setEditingCell] = useState<{ id: string; field: InlineField } | null>(null);
  const [editingValue, setEditingValue] = useState('');
  const [editingCustomDate, setEditingCustomDate] = useState(false);

  const [invoiceOrder, setInvoiceOrder] = useState<Order | null>(null);
  const [serviceEditOrder, setServiceEditOrder] = useState<Order | null>(null);
  const [transferTargetIds, setTransferTargetIds] = useState<string[] | null>(null);
  const [deleteTargetOrder, setDeleteTargetOrder] = useState<Order | null>(null);
  const [deleting, setDeleting] = useState(false);
  const transferTargetOrders = useMemo(() => {
    if (!transferTargetIds || transferTargetIds.length === 0) return [];
    const idSet = new Set(transferTargetIds);
    return orders.filter((o) => idSet.has(o.id));
  }, [orders, transferTargetIds]);

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
          <button
            type="button"
            onClick={() => setSelectedDate(today)}
            className={`px-3 py-1 text-xs font-semibold rounded border cursor-pointer whitespace-nowrap ${
              selectedDate === today
                ? 'bg-red-600 text-white border-red-600'
                : 'bg-white text-slate-700 border-[#DCE4E0] hover:bg-slate-50'
            }`}
          >
            Today
          </button>

          <IndianDateInput
            ariaLabel="Filter by date"
            title="Select Booking Date (DD/MM/YY)"
            value={selectedDate}
            onChange={setSelectedDate}
            allowClear
            className="min-w-[106px]"
          />

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
                    <span
                      title="Calculated from completed orders only"
                      className="text-xs font-mono-num text-slate-700"
                    >
                      · 100%: <strong>₹{vendor.totalWork.toLocaleString('en-IN')}</strong>
                    </span>
                    <span
                      title="Calculated from completed orders only"
                      className="text-xs font-mono-num text-amber-800 font-semibold"
                    >
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
                    <table className="w-full text-left border-collapse min-w-[1060px]">
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
                          <th className="py-2 px-2.5 w-28">Cleaner</th>
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
                          const isSentTransfer = isSentTransferOrder(order);
                          const isReceivedTransfer = isReceivedTransferOrder(order);
                          const isOtherTransfer =
                            !isSentTransfer &&
                            !isReceivedTransfer &&
                            Boolean(order.transferredFromName);

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
                              'bg-red-100 hover:bg-red-200/75 text-red-950 border-l-4 border-l-red-600';
                          }

                          return (
                            <tr key={order.id} className={`transition-colors ${rowClass}`}>
                              <td
                                className={`py-2 px-2.5 text-center font-mono-num font-semibold ${
                                  isSentTransfer
                                    ? 'text-purple-800'
                                    : isReceivedTransfer
                                      ? 'text-pink-900'
                                      : isCompleted
                                        ? 'text-red-800'
                                        : 'text-slate-500'
                                }`}
                              >
                                {idx + 1}
                              </td>

                              <td
                                onClick={() => !isEditing('bookingDate') && startInlineEdit(order, 'bookingDate')}
                                className="py-2 px-2.5 font-mono-num text-slate-700 whitespace-nowrap cursor-pointer"
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
                                      <span className="ml-1 text-[10px] font-semibold text-[#075E54]">
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
                                className="py-2 px-2.5 font-mono-num text-slate-800 cursor-text group"
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
                                    className="w-full px-1.5 py-0.5 text-xs border border-[#128C7E] rounded bg-white"
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
                                      className="w-full px-1.5 py-0.5 text-[11px] border border-[#128C7E] rounded bg-white"
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
                                        className="text-[11px] text-slate-500 hover:text-[#075E54] cursor-pointer"
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
                                          className="hidden group-hover:block text-[10px] font-sans font-semibold text-[#128C7E] hover:underline cursor-pointer"
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
                                className="py-2 px-2.5 text-slate-800 cursor-pointer hover:text-[#075E54] hover:underline"
                                title="Click to edit Services & Quantities"
                              >
                                {order.serviceName}
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

                              <td
                                onClick={() => !isEditing('cleanerName') && startInlineEdit(order, 'cleanerName')}
                                className="py-2 px-2.5 font-medium text-[#075E54] cursor-pointer whitespace-nowrap"
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
                                        onClick={() => setTransferTargetIds([order.id])}
                                        title="Transfer order to another telecaller"
                                        aria-label="Transfer order to another telecaller"
                                        className="p-1.5 bg-white border border-[#DCE4E0] hover:bg-[#E9F7F0] text-[#075E54] rounded inline-flex items-center justify-center cursor-pointer"
                                      >
                                        <ArrowRightLeft className="w-3.5 h-3.5 text-[#075E54]" />
                                      </button>

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
                                    <span className="px-2 py-1 text-[11px] font-semibold bg-purple-700 text-white rounded">
                                      Sent ({order.createdByName})
                                    </span>
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
    </div>
  );
};
