import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRightLeft,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  FileText,
  MessageCircle,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  Undo2,
  Upload,
  X,
} from 'lucide-react';
import {
  calcCommission30,
  checkDuplicateNumber,
  formatIndianDate,
  getIndianDayTag,
  getOrderTotal,
  getPaidCommission,
  getPendingCommission,
} from '../lib/api';
import { exportOrdersToExcel } from '../lib/excel';
import { ConfirmDialog } from './ConfirmDialog';
import { ExcelImportModal } from './ExcelImportModal';
import { IndianDateInput } from './IndianDateInput';
import { InvoiceModal } from './InvoiceModal';
import { OrderEditModal } from './OrderEditModal';
import { ServiceEditModal } from './ServiceEditModal';
import { TransferOrderModal } from './TransferOrderModal';
import {
  DRY_CLEAN_ITEMS,
  HOME_CLEANING_ITEMS,
  getDefaultServicePrice,
  type BulkImportOrderRow,
  type DuplicateOrderMatch,
  type NewOrderPayload,
  type Order,
  type OrderStatus,
  type PortalConfig,
  type UserPublic,
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
  onTransferOrders: (ids: string[], targetUserId: string) => Promise<void>;
  onUntransferOrders: (ids: string[]) => Promise<void>;
  onOpenWhatsAppForCleaner: (cleanerName: string, selectedIds?: string[]) => void;
  onNotify: (msg: string, type?: 'success' | 'error') => void;
  newOrderOpen?: boolean;
  onNewOrderOpenChange?: (open: boolean) => void;
}

type EditableField =
  | 'name'
  | 'number'
  | 'altNumber'
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

function shiftIsoDate(isoDate: string, deltaDays: number): string {
  const base = /^\d{4}-\d{2}-\d{2}$/.test(isoDate) ? isoDate : todayStr(0);
  const [y, m, d] = base.split('-').map(Number);
  const dt = new Date(y, m - 1, d + deltaDays);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

const TANK_TYPES = [
  { key: '500L', label: '500 Ltr', defaultPrice: 500 },
  { key: '750L', label: '750 Ltr', defaultPrice: 550 },
  { key: '1000L', label: '1000 Ltr', defaultPrice: 600 },
  { key: '1500L', label: '1500 Ltr', defaultPrice: 700 },
  { key: '2000L', label: '2000 Ltr', defaultPrice: 800 },
  { key: 'Cement Tank', label: 'Cement Tank', defaultPrice: 0 },
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
  onTransferOrders,
  onUntransferOrders,
  onOpenWhatsAppForCleaner,
  onNotify,
  newOrderOpen: controlledNewOrderOpen,
  onNewOrderOpenChange,
}) => {
  // New Order entry modal state
  const [newCity, setNewCity] = useState(config.cities[0] || 'Patiala');
  const [newNumber, setNewNumber] = useState('');
  const [newAltNumber, setNewAltNumber] = useState('');
  const [newName, setNewName] = useState('');
  const [newServices, setNewServices] = useState<string[]>([
    config.services[0] || 'Water tank',
  ]);
  const [newAddress, setNewAddress] = useState('');
  const [serviceQuantities, setServiceQuantities] = useState<Record<string, number>>({});
  const [servicePrices, setServicePrices] = useState<Record<string, number>>({});
  const [tankCounts, setTankCounts] = useState<Record<string, number>>({});
  const [tankPrices, setTankPrices] = useState<Record<string, number>>({});
  const [dryCleanCounts, setDryCleanCounts] = useState<Record<string, number>>({});
  const [dryCleanPrices, setDryCleanPrices] = useState<Record<string, number>>({});
  const [homeCleaningCounts, setHomeCleaningCounts] = useState<Record<string, number>>({});
  const [homeCleaningPrices, setHomeCleaningPrices] = useState<Record<string, number>>({});
  const [newPrice, setNewPrice] = useState('');
  const [newLessPrice, setNewLessPrice] = useState('');
  const [priceManuallyEdited, setPriceManuallyEdited] = useState(false);
  const [newDate, setNewDate] = useState('');
  const [dateSelectionMode, setDateSelectionMode] = useState<'none' | 'date' | 'not_confirm'>('none');
  const [customDateOpen, setCustomDateOpen] = useState(false);
  const [newCleaner, setNewCleaner] = useState(config.cleaners[0] || 'Jagdish');
  const [newNotes, setNewNotes] = useState('');
  const [adding, setAdding] = useState(false);
  const [internalNewOrderOpen, setInternalNewOrderOpen] = useState(false);
  const newOrderOpen = controlledNewOrderOpen ?? internalNewOrderOpen;
  const setNewOrderOpen = (open: boolean) => {
    if (onNewOrderOpenChange) {
      onNewOrderOpenChange(open);
    } else {
      setInternalNewOrderOpen(open);
    }
  };

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
    if (config.services.length > 0) {
      setNewServices((prev) => {
        const valid = prev.filter((s) => config.services.includes(s));
        return valid.length > 0 ? valid : [config.services[0]];
      });
    }
  }, [config.services]);

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
  const [quickDateScope, setQuickDateScope] = useState<'all' | 'not_confirmed'>('all');
  const [dateSort, setDateSort] = useState<'newest' | 'oldest'>('newest');
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
  const [editingCustomDate, setEditingCustomDate] = useState<boolean>(false);

  // Row selection
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  // Copied order feedback
  const [copiedOrderId, setCopiedOrderId] = useState<string | null>(null);

  // Delete Yes/No confirmation modal target
  const [deleteTargetOrder, setDeleteTargetOrder] = useState<Order | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Excel import modal
  const [importModalOpen, setImportModalOpen] = useState(false);

  // Auto Bill / Invoice modal target
  const [invoiceOrder, setInvoiceOrder] = useState<Order | null>(null);

  // Edit Services & Quantities modal target
  const [serviceEditOrder, setServiceEditOrder] = useState<Order | null>(null);

  // Full Order Edit modal target
  const [editTargetOrder, setEditTargetOrder] = useState<Order | null>(null);

  // Pass / Transfer Order modal targets
  const [transferTargetIds, setTransferTargetIds] = useState<string[] | null>(null);
  const [unsendingId, setUnsendingId] = useState<string | null>(null);
  const transferTargetOrders = useMemo(() => {
    if (!transferTargetIds || transferTargetIds.length === 0) return [];
    const idSet = new Set(transferTargetIds);
    return orders.filter((o) => idSet.has(o.id));
  }, [orders, transferTargetIds]);

  const handleQuickUnsend = async (ids: string[], key: string) => {
    if (unsendingId || ids.length === 0) return;
    setUnsendingId(key);
    try {
      await onUntransferOrders(ids);
      const idSet = new Set(ids);
      setSelectedIds((prev) => prev.filter((id) => !idSet.has(id)));
    } catch {
      // Notification already handled by parent
    } finally {
      setUnsendingId(null);
    }
  };

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
    const list = modeOrders.filter((o) => {
      if (mode === 'active' && quickDateScope === 'not_confirmed') {
        const bd = (o.bookingDate || '').trim();
        const isNotConfirm = !bd || bd.toLowerCase() === 'not confirm';
        if (!isNotConfirm) return false;
      }
      if (fromDate && (!o.bookingDate || o.bookingDate < fromDate)) return false;
      if (toDate && (!o.bookingDate || o.bookingDate > toDate)) return false;
      if (cleanerFilter !== 'all' && o.cleanerName.toLowerCase() !== cleanerFilter.toLowerCase()) {
        return false;
      }
      if (cityFilter !== 'all' && o.city.toLowerCase() !== cityFilter.toLowerCase()) {
        return false;
      }
      if (
        serviceFilter !== 'all' &&
        !o.serviceName
          .split('+')
          .map((s) => s.trim().toLowerCase())
          .includes(serviceFilter.toLowerCase())
      ) {
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
        const hay = `${o.name} ${o.number} ${o.altNumber ?? ''} ${o.serviceName} ${o.city} ${o.address} ${o.cleanerName} ${o.notes ?? ''} ${o.createdByName} ${o.completedByName ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    const getValidIsoDate = (o: Order) => {
      const bd = (o.bookingDate || '').trim();
      return /^\d{4}-\d{2}-\d{2}$/.test(bd) ? bd : '';
    };

    return list.sort((a, b) => {
      const da = getValidIsoDate(a);
      const db = getValidIsoDate(b);
      if (da && !db) return -1;
      if (!da && db) return 1;
      if (da && db && da !== db) {
        return dateSort === 'newest' ? db.localeCompare(da) : da.localeCompare(db);
      }
      return dateSort === 'newest'
        ? b.createdAt.localeCompare(a.createdAt)
        : a.createdAt.localeCompare(b.createdAt);
    });
  }, [
    modeOrders,
    mode,
    quickDateScope,
    dateSort,
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
    let totalPrice = 0;
    for (const t of TANK_TYPES) {
      const cnt = tankCounts[t.key] || 0;
      const rate = tankPrices[t.key] || 0;
      if (cnt > 0) {
        parts.push(rate > 0 ? `${t.label} × ${cnt} @ ₹${rate}` : `${t.label} × ${cnt}`);
        totalTanks += cnt;
        if (rate > 0) totalPrice += cnt * rate;
      }
    }
    return { text: parts.join(', '), totalTanks, totalPrice };
  }, [tankCounts, tankPrices]);

  const setTankCountDirect = (key: string, rawVal: string) => {
    const digits = rawVal.replace(/\D/g, '');
    const num = digits ? Math.max(0, Math.min(999, Number(digits))) : 0;
    const prevCount = tankCounts[key] || 0;
    const tankDef = TANK_TYPES.find((t) => t.key === key);

    if (num === 0) {
      setTankCounts((prev) => {
        if (!(key in prev)) return prev;
        const copy = { ...prev };
        delete copy[key];
        return copy;
      });
      setTankPrices((pPrev) => {
        if (!(key in pPrev)) return pPrev;
        const pCopy = { ...pPrev };
        delete pCopy[key];
        return pCopy;
      });
      return;
    }

    setTankCounts((prev) => ({ ...prev, [key]: num }));
    if (prevCount === 0 && tankDef && tankDef.defaultPrice > 0) {
      setTankPrices((pPrev) =>
        pPrev[key] === undefined ? { ...pPrev, [key]: tankDef.defaultPrice } : pPrev
      );
    }
  };

  const setTankPriceDirect = (key: string, rawVal: string) => {
    const digits = rawVal.replace(/\D/g, '');
    const num = digits ? Math.max(0, Math.min(999999, Number(digits))) : 0;
    const count = tankCounts[key] || 0;

    if (num === 0) {
      setTankPrices((prev) => {
        if (count > 0) {
          return { ...prev, [key]: 0 };
        }
        if (!(key in prev)) return prev;
        const copy = { ...prev };
        delete copy[key];
        return copy;
      });
      return;
    }

    setTankPrices((prev) => ({ ...prev, [key]: num }));
    if (count === 0) {
      setTankCounts((prev) => ((prev[key] || 0) === 0 ? { ...prev, [key]: 1 } : prev));
    }
  };

  const dryCleanSummary = useMemo(() => {
    const parts: string[] = [];
    let totalItems = 0;
    let totalPrice = 0;
    for (const item of DRY_CLEAN_ITEMS) {
      const cnt = dryCleanCounts[item.key] || 0;
      const rate = dryCleanPrices[item.key] || 0;
      if (cnt > 0) {
        parts.push(rate > 0 ? `${item.label} × ${cnt} @ ₹${rate}` : `${item.label} × ${cnt}`);
        totalItems += cnt;
        if (rate > 0) totalPrice += cnt * rate;
      }
    }
    return { text: parts.join(', '), totalItems, totalPrice };
  }, [dryCleanCounts, dryCleanPrices]);

  const setDryCleanCountDirect = (key: string, rawVal: string) => {
    const digits = rawVal.replace(/\D/g, '');
    const num = digits ? Math.max(0, Math.min(999, Number(digits))) : 0;
    const prevCount = dryCleanCounts[key] || 0;
    const itemDef = DRY_CLEAN_ITEMS.find((item) => item.key === key);

    if (num === 0) {
      setDryCleanCounts((prev) => {
        if (!(key in prev)) return prev;
        const copy = { ...prev };
        delete copy[key];
        return copy;
      });
      setDryCleanPrices((pPrev) => {
        if (!(key in pPrev)) return pPrev;
        const pCopy = { ...pPrev };
        delete pCopy[key];
        return pCopy;
      });
      return;
    }

    setDryCleanCounts((prev) => ({ ...prev, [key]: num }));
    if (prevCount === 0 && itemDef && itemDef.defaultPrice > 0) {
      setDryCleanPrices((pPrev) =>
        pPrev[key] === undefined ? { ...pPrev, [key]: itemDef.defaultPrice } : pPrev
      );
    }
  };

  const setDryCleanPriceDirect = (key: string, rawVal: string) => {
    const digits = rawVal.replace(/\D/g, '');
    const num = digits ? Math.max(0, Math.min(999999, Number(digits))) : 0;
    const count = dryCleanCounts[key] || 0;

    if (num === 0) {
      setDryCleanPrices((prev) => {
        if (count > 0) {
          return { ...prev, [key]: 0 };
        }
        if (!(key in prev)) return prev;
        const copy = { ...prev };
        delete copy[key];
        return copy;
      });
      return;
    }

    setDryCleanPrices((prev) => ({ ...prev, [key]: num }));
    if (count === 0) {
      setDryCleanCounts((prev) => ((prev[key] || 0) === 0 ? { ...prev, [key]: 1 } : prev));
    }
  };

  const homeCleaningSummary = useMemo(() => {
    const parts: string[] = [];
    let totalItems = 0;
    let totalPrice = 0;
    for (const item of HOME_CLEANING_ITEMS) {
      const cnt = homeCleaningCounts[item.key] || 0;
      const rate = homeCleaningPrices[item.key] || 0;
      if (cnt > 0) {
        parts.push(rate > 0 ? `${item.label} × ${cnt} @ ₹${rate}` : `${item.label} × ${cnt}`);
        totalItems += cnt;
        if (rate > 0) totalPrice += cnt * rate;
      }
    }
    return { text: parts.join(', '), totalItems, totalPrice };
  }, [homeCleaningCounts, homeCleaningPrices]);

  const setHomeCleaningCountDirect = (key: string, rawVal: string) => {
    const digits = rawVal.replace(/\D/g, '');
    const num = digits ? Math.max(0, Math.min(999, Number(digits))) : 0;
    if (num === 0) {
      setHomeCleaningCounts((prev) => {
        if (!(key in prev)) return prev;
        const copy = { ...prev };
        delete copy[key];
        return copy;
      });
      setHomeCleaningPrices((pPrev) => {
        if (!(key in pPrev)) return pPrev;
        const pCopy = { ...pPrev };
        delete pCopy[key];
        return pCopy;
      });
      return;
    }
    setHomeCleaningCounts((prev) => ({ ...prev, [key]: num }));
  };

  const setHomeCleaningPriceDirect = (key: string, rawVal: string) => {
    const digits = rawVal.replace(/\D/g, '');
    const num = digits ? Math.max(0, Math.min(999999, Number(digits))) : 0;
    const count = homeCleaningCounts[key] || 0;

    if (num === 0) {
      setHomeCleaningPrices((prev) => {
        if (count > 0) {
          return { ...prev, [key]: 0 };
        }
        if (!(key in prev)) return prev;
        const copy = { ...prev };
        delete copy[key];
        return copy;
      });
      return;
    }

    setHomeCleaningPrices((prev) => ({ ...prev, [key]: num }));
    if (count === 0) {
      setHomeCleaningCounts((prev) => ((prev[key] || 0) === 0 ? { ...prev, [key]: 1 } : prev));
    }
  };

  const selectedNonTankServices = useMemo(
    () =>
      newServices.filter((s) => {
        const lower = s.toLowerCase();
        return lower !== 'water tank' && lower !== 'dry clean' && lower !== 'home cleaning';
      }),
    [newServices]
  );

  const serviceQtySummary = useMemo(() => {
    const parts: string[] = [];
    let totalQty = 0;
    let totalPrice = 0;
    for (const s of selectedNonTankServices) {
      const q = serviceQuantities[s] || 0;
      const rate = servicePrices[s] || 0;
      if (q > 0) {
        totalQty += q;
        if (rate > 0) totalPrice += q * rate;
        const priceSuffix = rate > 0 ? ` @ ₹${rate}` : '';
        if (s.toLowerCase() === 'sofa') {
          parts.push(`${s}: ${q} ${q === 1 ? 'Seat' : 'Seats'}${priceSuffix}`);
        } else {
          parts.push(`${s}: ${q}${priceSuffix}`);
        }
      }
    }
    return { text: parts.join(', '), totalQty, totalPrice };
  }, [selectedNonTankServices, serviceQuantities, servicePrices]);

  const autoCalculatedTotal = useMemo(() => {
    const hasWaterTank = newServices.some((s) => s.toLowerCase() === 'water tank');
    const hasDryClean = newServices.some((s) => s.toLowerCase() === 'dry clean');
    const hasHomeCleaning = newServices.some((s) => s.toLowerCase() === 'home cleaning');
    return (
      (hasWaterTank ? tankSummary.totalPrice : 0) +
      (hasDryClean ? dryCleanSummary.totalPrice : 0) +
      (hasHomeCleaning ? homeCleaningSummary.totalPrice : 0) +
      serviceQtySummary.totalPrice
    );
  }, [
    newServices,
    tankSummary.totalPrice,
    dryCleanSummary.totalPrice,
    homeCleaningSummary.totalPrice,
    serviceQtySummary.totalPrice,
  ]);

  useEffect(() => {
    if (!priceManuallyEdited) {
      setNewPrice(autoCalculatedTotal > 0 ? String(autoCalculatedTotal) : '');
    }
  }, [autoCalculatedTotal, priceManuallyEdited]);

  const setServiceQtyDirect = (service: string, rawVal: string) => {
    const digits = rawVal.replace(/\D/g, '');
    const num = digits ? Math.max(0, Math.min(999, Number(digits))) : 0;
    const prevQty = serviceQuantities[service] || 0;
    const defaultPrice = getDefaultServicePrice(service);

    if (num === 0) {
      setServiceQuantities((prev) => {
        if (!(service in prev)) return prev;
        const copy = { ...prev };
        delete copy[service];
        return copy;
      });
      setServicePrices((pPrev) => {
        if (!(service in pPrev)) return pPrev;
        const pCopy = { ...pPrev };
        delete pCopy[service];
        return pCopy;
      });
      return;
    }

    setServiceQuantities((prev) => ({ ...prev, [service]: num }));
    if (prevQty === 0 && defaultPrice > 0) {
      setServicePrices((pPrev) =>
        pPrev[service] === undefined ? { ...pPrev, [service]: defaultPrice } : pPrev
      );
    }
  };

  const setServicePriceDirect = (service: string, rawVal: string) => {
    const digits = rawVal.replace(/\D/g, '');
    const num = digits ? Math.max(0, Math.min(999999, Number(digits))) : 0;
    const qty = serviceQuantities[service] || 0;

    if (num === 0) {
      setServicePrices((prev) => {
        if (qty > 0) {
          return { ...prev, [service]: 0 };
        }
        if (!(service in prev)) return prev;
        const copy = { ...prev };
        delete copy[service];
        return copy;
      });
      return;
    }

    setServicePrices((prev) => ({ ...prev, [service]: num }));
    if (qty === 0) {
      setServiceQuantities((prev) => ((prev[service] || 0) === 0 ? { ...prev, [service]: 1 } : prev));
    }
  };

  const toggleNewService = (service: string) => {
    setNewServices((prev) => {
      const exists = prev.includes(service);
      if (exists) {
        if (prev.length === 1) return prev;
        if (service.toLowerCase() === 'water tank') {
          setTankCounts({});
          setTankPrices({});
        } else if (service.toLowerCase() === 'dry clean') {
          setDryCleanCounts({});
          setDryCleanPrices({});
        } else if (service.toLowerCase() === 'home cleaning') {
          setHomeCleaningCounts({});
          setHomeCleaningPrices({});
        } else {
          setServiceQuantities((qPrev) => {
            if (!(service in qPrev)) return qPrev;
            const copy = { ...qPrev };
            delete copy[service];
            return copy;
          });
          setServicePrices((pPrev) => {
            if (!(service in pPrev)) return pPrev;
            const copy = { ...pPrev };
            delete copy[service];
            return copy;
          });
        }
        return prev.filter((s) => s !== service);
      }
      const next = [...prev, service];
      return next.sort(
        (a, b) => config.services.indexOf(a) - config.services.indexOf(b)
      );
    });
  };

  const submitOrderEntry = async () => {
    setAdding(true);
    try {
      const hasWaterTank = newServices.some((s) => s.toLowerCase() === 'water tank');
      const hasDryClean = newServices.some((s) => s.toLowerCase() === 'dry clean');
      const hasHomeCleaning = newServices.some((s) => s.toLowerCase() === 'home cleaning');
      const tankQtyVal = hasWaterTank ? tankSummary.totalTanks : 0;
      const dryCleanQtyVal = hasDryClean ? dryCleanSummary.totalItems : 0;
      const homeCleaningQtyVal = hasHomeCleaning ? homeCleaningSummary.totalItems : 0;
      const otherQtyVal = serviceQtySummary.totalQty;
      const combinedQty = tankQtyVal + dryCleanQtyVal + homeCleaningQtyVal + otherQtyVal;
      const finalQty = combinedQty > 0 ? combinedQty : null;

      const grossTotal = Math.max(0, Number(newPrice) || 0);
      const lessAmount = Math.max(0, Number(newLessPrice) || 0);
      const netFinalPrice = Math.max(0, grossTotal - lessAmount);

      const noteParts = [
        hasWaterTank && tankSummary.text ? tankSummary.text : '',
        hasDryClean && dryCleanSummary.text ? dryCleanSummary.text : '',
        hasHomeCleaning && homeCleaningSummary.text ? homeCleaningSummary.text : '',
        serviceQtySummary.text ? serviceQtySummary.text : '',
        lessAmount > 0 ? `Less: ₹${lessAmount}` : '',
        newNotes.trim(),
      ].filter(Boolean);

      const finalServiceName =
        newServices.length > 0
          ? newServices.join(' + ')
          : config.services[0] || 'Water tank';

      await onAddOrder({
        name: newName.trim(),
        number: newNumber.trim(),
        altNumber: newAltNumber.trim() || undefined,
        bookingDate: newDate.trim(),
        serviceName: finalServiceName,
        city: newCity,
        address: newAddress.trim(),
        qty: finalQty,
        price: netFinalPrice,
        cleanerName: newCleaner,
        notes: noteParts.length > 0 ? noteParts.join(' | ') : undefined,
      });

      setNewName('');
      setNewNumber('');
      setNewAltNumber('');
      setNewServices([config.services[0] || 'Water tank']);
      setNewAddress('');
      setServiceQuantities({});
      setServicePrices({});
      setTankCounts({});
      setTankPrices({});
      setDryCleanCounts({});
      setDryCleanPrices({});
      setHomeCleaningCounts({});
      setHomeCleaningPrices({});
      setNewPrice('');
      setNewLessPrice('');
      setPriceManuallyEdited(false);
      setNewDate('');
      setDateSelectionMode('none');
      setCustomDateOpen(false);
      setNewNotes('');
      setDuplicateMatches([]);
      setPendingDuplicateSubmit(false);
      setNewOrderOpen(false);
      setCurrentPage(1);
    } finally {
      setAdding(false);
    }
  };

  const handleQuickAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanPhone = newNumber.replace(/\D/g, '');
    if (cleanPhone.length !== 10) {
      onNotify('Please enter a valid 10-digit Phone Number.', 'error');
      return;
    }
    const cleanAltPhone = newAltNumber.replace(/\D/g, '');
    if (cleanAltPhone && cleanAltPhone.length !== 10) {
      onNotify('Alternate Number must be 10 digits (or leave it empty).', 'error');
      return;
    }
    if (cleanAltPhone && cleanAltPhone === cleanPhone) {
      onNotify('Alternate Number must be different from Phone Number.', 'error');
      return;
    }
    if (dateSelectionMode === 'none' || (dateSelectionMode === 'date' && !newDate.trim())) {
      onNotify('Please select a Booking Date or choose Not Confirm.', 'error');
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

  const isSentTransferOrder = (order: Order) =>
    Boolean(order.transferredFromId) &&
    order.transferredFromId === currentUser.id &&
    order.createdById !== currentUser.id;

  const isReceivedTransferOrder = (order: Order) =>
    Boolean(order.transferredFromId || order.transferredFromName) &&
    order.createdById === currentUser.id;

  const startEdit = (order: Order, field: EditableField) => {
    if (isSentTransferOrder(order) && currentUser.role !== 'super_admin') {
      return;
    }
    setEditingCell({ id: order.id, field });
    setEditingValue(String(order[field] ?? ''));
    setEditingCustomDate(false);
  };

  const commitEdit = async (order: Order, overrideValue?: string) => {
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

  const handleCopyOrder = async (order: Order) => {
    const total = getOrderTotal(order);
    const lines = [
      `*Customer:* ${order.name || 'Customer'}`,
      ...(order.number
        ? [`Phone: ${order.number}${order.altNumber ? ` | Alt: ${order.altNumber}` : ''}`]
        : []),
      ...(order.bookingDate ? [`Booking Date: ${formatIndianDate(order.bookingDate)}`] : []),
      `Service: ${order.serviceName}${order.qty ? ` | Qty: ${order.qty}` : ''}`,
      `City: ${order.city}`,
      ...(order.address ? [`Address: ${order.address}`] : []),
      `Price: ₹${total.toLocaleString('en-IN')}${
        order.extraAmount > 0 ? ` (+₹${order.extraAmount} Extra)` : ''
      }`,
      `Cleaner: ${order.cleanerName}`,
      ...(order.notes ? [`Note: ${order.notes}`] : []),
    ];
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      setCopiedOrderId(order.id);
      onNotify('Order details copied!');
      setTimeout(() => {
        setCopiedOrderId((curr) => (curr === order.id ? null : curr));
      }, 1500);
    } catch {
      onNotify('Copy failed — please allow clipboard permission', 'error');
    }
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
    12 +
    (currentUser.role === 'super_admin' ? 1 : 0) +
    (mode === 'completed' ? 2 : 0);

  const hasWaterTankSelected = newServices.some((s) => s.toLowerCase() === 'water tank');
  const hasDryCleanSelected = newServices.some((s) => s.toLowerCase() === 'dry clean');
  const hasHomeCleaningSelected = newServices.some((s) => s.toLowerCase() === 'home cleaning');
  const hasOtherServiceSelected = selectedNonTankServices.length > 0;

  return (
    <div className="space-y-3 w-full">
      {/* Single-Line Inline Filter Toolbar: Left Search | Right Date-to-Date, Service, City, Cleaners, Import & Export */}
      <div className="flex flex-col xl:flex-row xl:items-center xl:justify-between gap-2 py-2 border-y border-[#DCE4E0]">
        {/* Left: Search Bar, Show entries & Reset */}
        <div className="flex items-center gap-2 shrink-0 flex-wrap sm:flex-nowrap">
          <div className="relative w-full sm:w-52">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setCurrentPage(1);
              }}
              placeholder="Search name, phone..."
              className="w-full pl-7 pr-2.5 py-1 text-xs bg-white border border-[#DCE4E0] rounded text-slate-700 focus:outline-none focus:border-[#128C7E]"
            />
          </div>

          <select
            aria-label="Show entries"
            title="Rows per page"
            value={showEntries}
            onChange={(e) => {
              setShowEntries(Number(e.target.value));
              setCurrentPage(1);
            }}
            className="px-1.5 py-1 text-xs font-mono-num bg-white border border-[#DCE4E0] rounded text-slate-700 focus:outline-none focus:border-slate-400 shrink-0"
          >
            <option value={10}>10</option>
            <option value={25}>25</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
            <option value={-1}>All</option>
          </select>

          {(quickDateScope !== 'all' ||
            dateSort !== 'newest' ||
            fromDate ||
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
                setQuickDateScope('all');
                setDateSort('newest');
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
              className="px-2 py-1 text-xs text-red-600 hover:text-red-700 font-medium underline cursor-pointer whitespace-nowrap shrink-0"
            >
              Reset
            </button>
          )}
        </div>

        {/* Right: All Data / Not Confirmed / Back Date / Next Date, Service, City, Cleaners, Import & Export */}
        <div className="flex items-center gap-1.5 overflow-x-auto sheet-scroll flex-nowrap min-w-0">
          {mode === 'active' && (() => {
            const today = todayStr(0);
            const yesterday = todayStr(-1);
            const tomorrow = todayStr(1);
            const isSingleDay = Boolean(fromDate) && fromDate === toDate;
            const backDateTarget = isSingleDay ? shiftIsoDate(fromDate, -1) : yesterday;
            const nextDateTarget = isSingleDay ? shiftIsoDate(fromDate, 1) : tomorrow;
            const backDay = backDateTarget.slice(8, 10);
            const nextDay = nextDateTarget.slice(8, 10);
            const isBackActive = isSingleDay && fromDate < today;
            const isNextActive = isSingleDay && fromDate > today;

            const isAllDataActive = quickDateScope === 'all' && !fromDate && !toDate;
            const isNotConfirmedActive = quickDateScope === 'not_confirmed' && !fromDate && !toDate;

            return (
              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    setFromDate('');
                    setToDate('');
                    setQuickDateScope('all');
                    setCurrentPage(1);
                  }}
                  title="All active orders (includes both dated and Not Confirmed orders; excludes Completed)"
                  className={`px-2.5 py-1 text-xs font-semibold rounded border cursor-pointer whitespace-nowrap transition-colors ${
                    isAllDataActive
                      ? 'bg-[#075E54] text-white border-[#075E54]'
                      : 'bg-white text-slate-700 border-[#DCE4E0] hover:bg-[#EFF4F1]'
                  }`}
                >
                  All Data
                </button>

                <button
                  type="button"
                  onClick={() => {
                    const hadDateRange = Boolean(fromDate || toDate);
                    setFromDate('');
                    setToDate('');
                    setQuickDateScope((prev) =>
                      hadDateRange || prev !== 'not_confirmed' ? 'not_confirmed' : 'all'
                    );
                    setCurrentPage(1);
                  }}
                  title="Show active orders with Not Confirm booking date"
                  className={`px-2.5 py-1 text-xs font-semibold rounded border cursor-pointer whitespace-nowrap transition-colors ${
                    isNotConfirmedActive
                      ? 'bg-amber-600 text-white border-amber-700'
                      : 'bg-white text-slate-700 border-[#DCE4E0] hover:bg-amber-50 hover:text-amber-800'
                  }`}
                >
                  Not Confirmed
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setQuickDateScope('all');
                    setFromDate(backDateTarget);
                    setToDate(backDateTarget);
                    setCurrentPage(1);
                  }}
                  title={`Back to ${formatIndianDate(backDateTarget)}`}
                  className={`px-2 py-1 text-xs font-semibold rounded border inline-flex items-center gap-0.5 cursor-pointer whitespace-nowrap transition-colors ${
                    isBackActive
                      ? 'bg-[#075E54] text-white border-[#075E54]'
                      : 'bg-white text-slate-700 border-[#DCE4E0] hover:bg-[#EFF4F1]'
                  }`}
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                  Back Date ({backDay})
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setQuickDateScope('all');
                    setFromDate(nextDateTarget);
                    setToDate(nextDateTarget);
                    setCurrentPage(1);
                  }}
                  title={`Next to ${formatIndianDate(nextDateTarget)}`}
                  className={`px-2 py-1 text-xs font-semibold rounded border inline-flex items-center gap-0.5 cursor-pointer whitespace-nowrap transition-colors ${
                    isNextActive
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

          <select
            aria-label="Date sorting"
            title="Date Sorting"
            value={dateSort}
            onChange={(e) => {
              setDateSort(e.target.value as 'newest' | 'oldest');
              setCurrentPage(1);
            }}
            className="px-2 py-1 text-xs bg-white border border-[#DCE4E0] rounded text-slate-700 focus:outline-none focus:border-slate-400 shrink-0"
          >
            <option value="newest">Date: New to Old</option>
            <option value="oldest">Date: Old to New</option>
          </select>

          <select
            aria-label="Filter by service"
            value={serviceFilter}
            onChange={(e) => {
              setServiceFilter(e.target.value);
              setCurrentPage(1);
            }}
            className="px-2 py-1 text-xs bg-white border border-[#DCE4E0] rounded text-slate-700 focus:outline-none focus:border-slate-400 shrink-0"
          >
            <option value="all">Service</option>
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
            className="px-2 py-1 text-xs bg-white border border-[#DCE4E0] rounded text-slate-700 focus:outline-none focus:border-slate-400 shrink-0"
          >
            <option value="all">City</option>
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
            className="px-2 py-1 text-xs bg-white border border-[#DCE4E0] rounded text-slate-700 focus:outline-none focus:border-slate-400 shrink-0"
          >
            <option value="all">Cleaners</option>
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
                className="px-2 py-1 text-xs bg-white border border-[#DCE4E0] rounded text-slate-700 focus:outline-none focus:border-slate-400 shrink-0"
              >
                <option value="all">Telecallers</option>
                {uniqueTelecallers.map((tc) => (
                  <option key={tc.id} value={tc.id}>
                    {tc.name}
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
              className="px-2 py-1 text-xs bg-white border border-[#DCE4E0] rounded text-slate-700 focus:outline-none focus:border-slate-400 shrink-0"
            >
              <option value="all">Done By</option>
              {uniqueCompletedBy.map((name) => (
                <option key={name} value={name}>
                  {name}
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
              className="px-2 py-1 text-xs bg-white border border-[#DCE4E0] rounded text-slate-700 focus:outline-none focus:border-slate-400 shrink-0"
            >
              <option value="all">Payments</option>
              <option value="pending">30% Pending</option>
              <option value="clear">Clear</option>
            </select>
          )}

          <button
            type="button"
            onClick={() => setImportModalOpen(true)}
            title="Import Excel"
            className="px-2 py-1 text-xs font-medium bg-white hover:bg-slate-50 border border-[#DCE4E0] text-slate-700 rounded inline-flex items-center gap-1 cursor-pointer whitespace-nowrap shrink-0"
          >
            <Upload className="w-3.5 h-3.5 text-[#128C7E]" />
            Import
          </button>

          <button
            type="button"
            onClick={() =>
              exportOrdersToExcel(
                filteredOrders,
                `orderdesk-${mode}-${todayStr(0)}.xlsx`
              )
            }
            title="Export Excel"
            className="px-2 py-1 text-xs font-medium bg-white hover:bg-slate-50 border border-[#DCE4E0] text-slate-700 rounded inline-flex items-center gap-1 cursor-pointer whitespace-nowrap shrink-0"
          >
            <Download className="w-3.5 h-3.5 text-slate-500" />
            Export
          </button>
        </div>

        {selectedIds.length > 0 && (() => {
          const selectedSet = new Set(selectedIds);
          const selectedOrderObjs = orders.filter((o) => selectedSet.has(o.id));
          const sendableIds = selectedOrderObjs
            .filter((o) => currentUser.role === 'super_admin' || o.createdById === currentUser.id)
            .map((o) => o.id);
          const unsendableIds = selectedOrderObjs
            .filter(
              (o) =>
                Boolean(o.transferredFromId) &&
                (currentUser.role === 'super_admin' || o.transferredFromId === currentUser.id)
            )
            .map((o) => o.id);

          return (
            <div className="w-full pt-2 border-t border-[#DCE4E0] flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-medium text-slate-700">
                {selectedIds.length} selected
              </span>
              <div className="flex flex-wrap items-center gap-2">
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
                      Confirm Orders
                    </button>
                  </>
                )}
                {sendableIds.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setTransferTargetIds(selectedIds)}
                    className="px-3 py-1 text-xs font-semibold bg-white hover:bg-slate-50 text-[#075E54] border border-[#128C7E] rounded flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                  >
                    <ArrowRightLeft className="w-3.5 h-3.5" />
                    Send Transfer
                  </button>
                )}
                {unsendableIds.length > 0 && (
                  <button
                    type="button"
                    disabled={unsendingId === 'bulk'}
                    onClick={() => handleQuickUnsend(unsendableIds, 'bulk')}
                    className="px-3 py-1 text-xs font-semibold bg-purple-700 hover:bg-purple-800 disabled:opacity-50 text-white rounded flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                  >
                    <Undo2 className="w-3.5 h-3.5" />
                    {unsendingId === 'bulk'
                      ? 'Unsending...'
                      : `Unsend Transfer (${unsendableIds.length})`}
                  </button>
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
          );
        })()}
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

      {/* Clean Table Matching Today's Active Vendors Style */}
      <div className="bg-white border border-[#DCE4E0] rounded-xl overflow-hidden">
        <div className="overflow-x-auto sheet-scroll">
          <table
            className={`w-full text-left border-collapse min-w-[1080px] [&_th]:border-b [&_th]:border-r [&_th]:border-[#DCE4E0] [&_th:last-child]:border-r-0 [&_td]:border-y [&_td]:border-r [&_td]:border-[#DCE4E0] [&_td:last-child]:border-r-0 [&_tbody_tr:first-child_td]:border-t-0 [&_tfoot_tr_td]:border-b-0 ${
              filteredOrders.length === 0 ? '[&_tbody_tr:last-child_td]:border-b-0' : ''
            }`}
          >
            <thead>
              <tr className="bg-[#FAFDFB] border-b border-[#DCE4E0] text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                <th className="py-2 px-2.5 w-9 text-center">
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
                <th className="py-2 px-2.5 w-10 text-center">No</th>
                <th className="py-2 px-2.5 w-24">Date</th>
                <th className="py-2 px-2.5">Customer</th>
                <th className="py-2 px-2.5 w-28">Phone</th>
                <th className="py-2 px-2.5 w-28">Service</th>
                <th className="py-2 px-2.5 w-24">City</th>
                <th className="py-2 px-2.5">Address / Note</th>
                <th className="py-2 px-2 w-12 text-right">Qty</th>
                <th className="py-2 px-2.5 w-24 text-right">Price</th>
                {mode === 'completed' && (
                  <th className="py-2 px-2.5 w-24 text-right">30% Comm</th>
                )}
                <th className="py-2 px-2.5 w-28">Cleaner</th>
                {currentUser.role === 'super_admin' && (
                  <th className="py-2 px-2.5 w-24">Telecaller</th>
                )}
                {mode === 'completed' && (
                  <th className="py-2 px-2.5 w-24">Done By</th>
                )}
                <th className="py-2 px-2.5 w-52 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="text-xs">
              {loading ? (
                <tr>
                  <td
                    colSpan={totalCols}
                    className="py-10 text-center text-sm text-slate-500"
                  >
                    Loading orders...
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
                        ? 'Click the red New Order Entry button above to add a booking, or reset filters.'
                        : 'Orders confirmed from Active Orders will appear here automatically.'}
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
                  const isSentTransfer = isSentTransferOrder(order);
                  const isReceivedTransfer = isReceivedTransferOrder(order);
                  const isOtherTransfer =
                    !isSentTransfer && !isReceivedTransfer && Boolean(order.transferredFromName);

                  let rowClass =
                    idx % 2 === 0
                      ? 'bg-white hover:bg-gray-50'
                      : 'bg-gray-100 hover:bg-gray-200/70';
                  if (isChecked) {
                    rowClass = 'bg-[#E9F7F0]';
                  } else if (isSentTransfer) {
                    rowClass =
                      'bg-purple-100 hover:bg-purple-200/80 text-purple-950 border-l-4 border-l-purple-700';
                  } else if (isReceivedTransfer) {
                    rowClass =
                      'bg-pink-200 hover:bg-pink-300/80 text-pink-950 border-l-4 border-l-pink-700';
                  } else if (isOtherTransfer) {
                    rowClass =
                      'bg-purple-50 hover:bg-purple-100/75 text-purple-950 border-l-4 border-l-purple-500';
                  }

                  return (
                    <tr
                      key={order.id}
                      className={`transition-colors ${rowClass}`}
                    >
                      <td className="py-2 px-2.5 text-center">
                        <input
                          type="checkbox"
                          aria-label={`Select order ${serialNo}`}
                          checked={isChecked}
                          onChange={() => toggleRow(order.id)}
                          className="rounded border-slate-300 accent-[#128C7E] cursor-pointer"
                        />
                      </td>

                      <td className="py-2 px-2.5 text-center font-mono-num font-semibold text-slate-500">
                        {serialNo}
                      </td>

                      {/* Date of Booking (Inline Indian Format: Aj, Kal, Parso, Date, Not Confirm) */}
                      <td
                        onClick={() => !isEditing('bookingDate') && startEdit(order, 'bookingDate')}
                        className="py-2 px-2.5 font-mono-num text-slate-700 cursor-pointer whitespace-nowrap"
                        title="Click to pick Aj / Kal / Parso / Date / Not Confirm"
                      >
                        {isEditing('bookingDate') ? (
                          <div
                            className="space-y-1 min-w-[240px]"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <div className="flex items-center gap-1">
                              {[
                                { label: 'Aj', date: todayStr(0) },
                                { label: 'Kal', date: todayStr(1) },
                                { label: 'Parso', date: todayStr(2) },
                              ].map((opt) => (
                                <button
                                  key={opt.label}
                                  type="button"
                                  onClick={() => commitEdit(order, opt.date)}
                                  className={`px-1.5 py-0.5 text-[10px] font-semibold rounded border cursor-pointer whitespace-nowrap ${
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
                                className={`px-1.5 py-0.5 text-[10px] font-semibold rounded border cursor-pointer whitespace-nowrap ${
                                  editingCustomDate ||
                                  (Boolean(order.bookingDate) && !getIndianDayTag(order.bookingDate))
                                    ? 'bg-[#075E54] text-white border-[#075E54]'
                                    : 'bg-white text-slate-700 border-[#DCE4E0] hover:bg-slate-50'
                                }`}
                              >
                                Date
                              </button>
                              <button
                                type="button"
                                onClick={() => commitEdit(order, '')}
                                className={`px-1.5 py-0.5 text-[10px] font-semibold rounded border cursor-pointer whitespace-nowrap ${
                                  !editingCustomDate && !order.bookingDate
                                    ? 'bg-amber-600 text-white border-amber-600'
                                    : 'bg-amber-50 text-amber-800 border-amber-300 hover:bg-amber-100'
                                }`}
                              >
                                Not Confirm
                              </button>
                            </div>
                            {(editingCustomDate ||
                              (Boolean(order.bookingDate) && !getIndianDayTag(order.bookingDate))) && (
                              <div className="flex items-center gap-1">
                                <IndianDateInput
                                  ariaLabel="Pick custom booking date"
                                  title="Pick Date (DD/MM/YY)"
                                  value={editingValue}
                                  onChange={(val) => {
                                    if (val) commitEdit(order, val);
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
                          <span className="inline-block px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 text-[11px] font-semibold">
                            Not Confirm
                          </span>
                        )}
                      </td>

                      {/* Customer Name (Optional) */}
                      <td
                        onClick={() => !isEditing('name') && startEdit(order, 'name')}
                        className="py-2 px-2.5 font-semibold text-slate-900 cursor-text"
                        title="Click to edit Customer Name"
                      >
                        {isEditing('name') ? (
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
                          <div>
                            <div>{order.name || <span className="text-slate-400 font-normal">—</span>}</div>
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

                      {/* Phone Number */}
                      <td
                        onClick={() =>
                          !isEditing('number') && !isEditing('altNumber') && startEdit(order, 'number')
                        }
                        className="py-2 px-2.5 font-mono-num text-slate-800 cursor-text whitespace-nowrap group"
                        title="Click to edit Phone"
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
                              setEditingValue(e.target.value.replace(/\D/g, '').slice(0, 10))
                            }
                            onBlur={() => commitEdit(order)}
                            onKeyDown={(e) => handleCellKeyDown(e, order)}
                            className="w-full px-1.5 py-0.5 text-xs font-mono-num border border-[#128C7E] rounded bg-white focus:outline-none"
                          />
                        ) : isEditing('altNumber') ? (
                          <div className="space-y-1" onClick={(e) => e.stopPropagation()}>
                            <div>{order.number}</div>
                            <input
                              autoFocus
                              type="text"
                              inputMode="numeric"
                              maxLength={10}
                              placeholder="Alt 10-digit"
                              title="10-digit Alternate Number (clear to remove)"
                              value={editingValue}
                              onChange={(e) =>
                                setEditingValue(e.target.value.replace(/\D/g, '').slice(0, 10))
                              }
                              onBlur={() => commitEdit(order)}
                              onKeyDown={(e) => handleCellKeyDown(e, order)}
                              className="w-full px-1.5 py-0.5 text-[11px] font-mono-num border border-[#128C7E] rounded bg-white focus:outline-none"
                            />
                          </div>
                        ) : (
                          <div>
                            <span>{order.number}</span>
                            {order.altNumber ? (
                              <div
                                onClick={(e) => {
                                  e.stopPropagation();
                                  startEdit(order, 'altNumber');
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
                                    startEdit(order, 'altNumber');
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

                      {/* Service Name & Quantities Modal Trigger */}
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
                        <span>{order.serviceName}</span>
                      </td>

                      {/* City Dropdown */}
                      <td
                        onClick={() => !isEditing('city') && startEdit(order, 'city')}
                        className="py-2 px-2.5 text-slate-700 cursor-pointer"
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

                      {/* Address / Note (Matching Today's Active Vendors combined cell, both inline-editable) */}
                      <td className="py-2 px-2.5 text-slate-600 max-w-[260px]">
                        {isEditing('address') ? (
                          <input
                            autoFocus
                            type="text"
                            value={editingValue}
                            onChange={(e) => setEditingValue(e.target.value)}
                            onBlur={() => commitEdit(order)}
                            onKeyDown={(e) => handleCellKeyDown(e, order)}
                            placeholder="Address..."
                            className="w-full px-1.5 py-0.5 text-xs border border-[#128C7E] rounded bg-white focus:outline-none"
                          />
                        ) : isEditing('notes') ? (
                          <input
                            autoFocus
                            type="text"
                            value={editingValue}
                            onChange={(e) => setEditingValue(e.target.value)}
                            onBlur={() => commitEdit(order)}
                            onKeyDown={(e) => handleCellKeyDown(e, order)}
                            placeholder="Note / Message..."
                            className="w-full px-1.5 py-0.5 text-xs border border-[#128C7E] rounded bg-white focus:outline-none"
                          />
                        ) : (
                          <div>
                            <div
                              onClick={() => startEdit(order, 'address')}
                              title="Click to edit Address"
                              className="truncate cursor-text hover:text-slate-900"
                            >
                              {order.address || '—'}
                            </div>
                            <div
                              onClick={() => startEdit(order, 'notes')}
                              title="Click to edit Note / Message"
                              className="text-[11px] text-slate-500 truncate cursor-text hover:text-slate-800"
                            >
                              {order.notes || <span className="text-slate-300">+ Note</span>}
                            </div>
                          </div>
                        )}
                      </td>

                      {/* Qty (Optional) */}
                      <td
                        onClick={() => !isEditing('qty') && startEdit(order, 'qty')}
                        className="py-2 px-2 text-right font-mono-num text-slate-800 cursor-text"
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
                          <span>{order.qty ?? '—'}</span>
                        )}
                      </td>

                      {/* Price (Manual ₹) */}
                      <td
                        onClick={() => !isEditing('price') && startEdit(order, 'price')}
                        className="py-2 px-2.5 text-right font-mono-num font-bold text-slate-900 cursor-text"
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
                              <div className="text-[10px] font-normal text-blue-700">
                                +₹{Number(order.extraAmount).toLocaleString('en-IN')}
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
                          <td className="py-2 px-2.5 text-right font-mono-num">
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
                        className="py-2 px-2.5 font-medium text-[#075E54] cursor-pointer whitespace-nowrap"
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
                            className="w-full px-1.5 py-0.5 text-xs border border-[#128C7E] rounded bg-white text-slate-800 focus:outline-none"
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
                          <span>{order.cleanerName || 'Unassigned'}</span>
                        )}
                      </td>

                      {currentUser.role === 'super_admin' && (
                        <td className="py-2 px-2.5 text-xs text-slate-600 whitespace-nowrap">
                          <div>{order.createdByName}</div>
                          {order.transferredFromName && (
                            <div
                              className={`text-[10px] font-semibold ${
                                isReceivedTransfer ? 'text-pink-800' : 'text-purple-800'
                              }`}
                            >
                              From {order.transferredFromName}
                            </div>
                          )}
                        </td>
                      )}

                      {mode === 'completed' && (
                        <td className="py-2 px-2.5 text-xs text-slate-700 whitespace-nowrap">
                          <div>{order.completedByName || order.createdByName || '—'}</div>
                          {order.completedAt && (
                            <div className="text-[10px] font-mono-num text-slate-400">
                              {new Date(order.completedAt).toLocaleDateString('en-IN', {
                                day: '2-digit',
                                month: '2-digit',
                                year: '2-digit',
                              })}
                            </div>
                          )}
                        </td>
                      )}

                      {/* Actions: Copy, Invoice PDF, Transfer, Delete */}
                      <td className="py-2 px-2.5 text-right whitespace-nowrap">
                        <div className="inline-flex items-center justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => handleCopyOrder(order)}
                            title={copiedOrderId === order.id ? 'Copied' : 'Copy order details'}
                            aria-label="Copy order details"
                            className="p-1.5 bg-white hover:bg-slate-50 text-slate-700 border border-[#DCE4E0] rounded inline-flex items-center justify-center cursor-pointer"
                          >
                            {copiedOrderId === order.id ? (
                              <Check className="w-3.5 h-3.5 text-[#128C7E]" />
                            ) : (
                              <Copy className="w-3.5 h-3.5 text-slate-500" />
                            )}
                          </button>

                          <button
                            type="button"
                            onClick={() => setInvoiceOrder(order)}
                            title="Generate Invoice PDF (City Clean Company)"
                            aria-label="Generate Invoice PDF"
                            className="p-1.5 bg-white hover:bg-slate-50 text-[#075E54] border border-[#DCE4E0] rounded inline-flex items-center justify-center cursor-pointer"
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
                                className="p-1.5 bg-white hover:bg-slate-50 text-slate-700 border border-[#DCE4E0] rounded inline-flex items-center justify-center cursor-pointer"
                              >
                                <Pencil className="w-3.5 h-3.5 text-slate-600" />
                              </button>

                              <button
                                type="button"
                                onClick={() => setTransferTargetIds([order.id])}
                                title="Send / Transfer this order to another telecaller dashboard"
                                aria-label="Transfer order"
                                className="p-1.5 bg-white hover:bg-[#E9F7F0] text-[#075E54] border border-[#DCE4E0] rounded inline-flex items-center justify-center cursor-pointer"
                              >
                                <ArrowRightLeft className="w-3.5 h-3.5 text-[#075E54]" />
                              </button>

                              {Boolean(order.transferredFromId) &&
                                (currentUser.role === 'super_admin' ||
                                  order.transferredFromId === currentUser.id) && (
                                  <button
                                    type="button"
                                    disabled={unsendingId === order.id}
                                    onClick={() => handleQuickUnsend([order.id], order.id)}
                                    title={`Unsend transfer back to ${order.transferredFromName || 'original owner'}`}
                                    aria-label="Unsend transfer"
                                    className="px-2 py-1 text-[11px] font-semibold bg-white hover:bg-purple-50 text-purple-800 border border-purple-300 rounded inline-flex items-center gap-1 cursor-pointer disabled:opacity-50"
                                  >
                                    <Undo2 className="w-3 h-3" />
                                    {unsendingId === order.id ? 'Unsending...' : 'Unsend'}
                                  </button>
                                )}

                              {mode !== 'active' && (
                                <button
                                  type="button"
                                  onClick={() => onUpdateOrder(order.id, { status: 'active' })}
                                  title="Move back to Active Orders"
                                  className="px-2 py-1 text-[11px] font-medium bg-white border border-[#DCE4E0] hover:bg-slate-50 text-slate-700 rounded inline-flex items-center gap-1 cursor-pointer"
                                >
                                  <RotateCcw className="w-3 h-3" />
                                  Reopen
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
                                onClick={() => handleQuickUnsend([order.id], order.id)}
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
                })
              )}
            </tbody>

            {filteredOrders.length > 0 && (
              <tfoot>
                <tr className="bg-[#FAFDFB] border-t border-[#DCE4E0] text-xs font-bold text-slate-900">
                  <td colSpan={8} className="py-2 px-3 text-right">
                    Filtered Totals ({filteredOrders.length} orders):
                  </td>
                  <td className="py-2 px-2 text-right font-mono-num">
                    {totals.totalQty}
                  </td>
                  <td className="py-2 px-2.5 text-right font-mono-num text-[#075E54]">
                    ₹{totals.totalPrice.toLocaleString('en-IN')}
                  </td>
                  {mode === 'completed' && (
                    <td className="py-2 px-2.5 text-right font-mono-num text-amber-800">
                      ₹{completedSummary.totalComm30.toLocaleString('en-IN')}
                    </td>
                  )}
                  <td
                    colSpan={
                      2 +
                      (currentUser.role === 'super_admin' ? 1 : 0) +
                      (mode === 'completed' ? 1 : 0)
                    }
                    className="py-2 px-2.5 text-xs font-normal text-slate-500"
                  >
                    {mode === 'completed'
                      ? `Pending Leni Hai: ₹${completedSummary.totalPending.toLocaleString('en-IN')}`
                      : 'Click any field above to edit inline'}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>

        {/* Pagination Footer */}
        <div className="px-4 py-3 border-t border-[#DCE4E0] bg-[#FAFDFB] flex flex-wrap items-center justify-between gap-3 text-xs text-slate-600">
          <div className="flex flex-wrap items-center gap-3">
            <div>
              Showing <span className="font-mono-num font-semibold text-slate-900">{startEntryIndex}</span> to{' '}
              <span className="font-mono-num font-semibold text-slate-900">{endEntryIndex}</span> of{' '}
              <span className="font-mono-num font-semibold text-slate-900">{filteredOrders.length}</span> entries
            </div>
            <div className="flex items-center gap-2.5 text-[11px]">
              <span className="inline-flex items-center gap-1 text-purple-900 font-medium">
                <span className="w-3 h-3 rounded bg-purple-600 inline-block" />
                Sent Transfer
              </span>
              <span className="inline-flex items-center gap-1 text-pink-900 font-medium">
                <span className="w-3 h-3 rounded bg-pink-700 inline-block" />
                Received Transfer
              </span>
            </div>
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
      {/* Compact Left-Right New Order Popup Modal */}
      {mode === 'active' && newOrderOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="new-order-modal-title"
          className="fixed inset-0 z-40 bg-slate-900/55 flex items-center justify-center p-2 sm:p-3 overflow-y-auto"
          onClick={() => setNewOrderOpen(false)}
        >
          <div
            className="w-full max-w-5xl bg-white border border-[#DCE4E0] rounded-xl shadow-2xl overflow-hidden my-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 py-2 bg-[#075E54] text-white flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <Plus className="w-3.5 h-3.5 text-[#25D366]" />
                <h2 id="new-order-modal-title" className="font-display text-sm font-bold">
                  New Order Entry
                </h2>
              </div>
              <div className="flex items-center gap-2.5">
                <span className="text-[11px] text-white/90 font-mono-num">
                  {(() => {
                    if (!newDate) return 'Not Confirm';
                    const tag = getIndianDayTag(newDate);
                    const formatted = formatIndianDate(newDate) || 'Not Confirm';
                    return tag ? `${tag} · ${formatted}` : formatted;
                  })()}
                </span>
                <button
                  type="button"
                  onClick={() => setNewOrderOpen(false)}
                  aria-label="Close new order popup"
                  className="p-1 rounded hover:bg-white/15 text-white cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            <form
              onSubmit={handleQuickAdd}
              className="p-3 max-h-[90vh] overflow-y-auto bg-white"
            >
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-2.5 items-stretch">
                {/* LEFT BOX: Customer & Booking Details */}
                <div className="lg:col-span-5 bg-[#F1F7F4] border border-[#CFE0D6] rounded-lg p-2.5 space-y-2 flex flex-col justify-between">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between border-b border-[#D9E7DF] pb-1">
                      <span className="text-[11px] font-bold uppercase tracking-wide text-[#075E54]">
                        1. Customer Details
                      </span>
                      <span className="text-[10px] text-slate-500">
                        * Required
                      </span>
                    </div>

                    {/* Phone & Alt Phone (Inline once 10-digit Phone Number is filled) */}
                    <div className={newNumber.length === 10 ? 'grid grid-cols-2 gap-2' : ''}>
                      <div>
                        <div className="flex items-center justify-between gap-1 mb-0.5">
                          <label className="text-[11px] font-medium text-slate-700 truncate">
                            Phone Number <span className="text-red-600">*</span>
                          </label>
                          <span
                            className={`text-[10px] font-mono-num font-semibold shrink-0 ${
                              newNumber.length === 10
                                ? 'text-[#075E54]'
                                : newNumber.length > 0
                                ? 'text-amber-700'
                                : 'text-slate-400'
                            }`}
                          >
                            {newNumber.length}/10
                          </span>
                        </div>
                        <input
                          autoFocus
                          type="text"
                          inputMode="numeric"
                          minLength={10}
                          maxLength={10}
                          pattern="\d{10}"
                          title="Minimum 10, maximum 10 digits"
                          required
                          value={newNumber}
                          onChange={(e) => {
                            const val = e.target.value.replace(/\D/g, '').slice(0, 10);
                            setNewNumber(val);
                            if (val.length < 10 && newAltNumber) {
                              setNewAltNumber('');
                            }
                          }}
                          placeholder="10-digit number"
                          className={`w-full px-2.5 py-1 text-xs font-mono-num border rounded-md focus:bg-white focus:outline-none ${
                            duplicateMatches.some((m) => m.status === 'active')
                              ? 'bg-red-50 border-red-400 focus:border-red-500'
                              : duplicateMatches.length > 0
                              ? 'bg-amber-50 border-amber-400 focus:border-amber-500'
                              : 'bg-white border-[#CFE0D6] focus:border-[#128C7E]'
                          }`}
                        />
                      </div>

                      {newNumber.length === 10 && (
                        <div>
                          <div className="flex items-center justify-between gap-1 mb-0.5">
                            <label className="text-[11px] font-medium text-slate-700 truncate">
                              Alternate Number (Optional)
                            </label>
                            <span
                              className={`text-[10px] font-mono-num font-semibold shrink-0 ${
                                newAltNumber.length === 10
                                  ? 'text-[#075E54]'
                                  : newAltNumber.length > 0
                                  ? 'text-amber-700'
                                  : 'text-slate-400'
                              }`}
                            >
                              {newAltNumber.length}/10
                            </span>
                          </div>
                          <input
                            type="text"
                            inputMode="numeric"
                            minLength={10}
                            maxLength={10}
                            pattern="\d{10}"
                            title="Minimum 10, maximum 10 digits"
                            value={newAltNumber}
                            onChange={(e) =>
                              setNewAltNumber(e.target.value.replace(/\D/g, '').slice(0, 10))
                            }
                            placeholder="Alternate 10-digit"
                            className="w-full px-2.5 py-1 text-xs font-mono-num bg-white border border-[#CFE0D6] rounded-md focus:outline-none focus:border-[#128C7E]"
                          />
                        </div>
                      )}
                    </div>

                    {/* Live Telecaller Duplicate Number Alert */}
                    {checkingDuplicate && (
                      <div className="text-[11px] text-slate-500 px-2 py-1 bg-white border border-[#CFE0D6] rounded">
                        Checking central records...
                      </div>
                    )}

                    {!checkingDuplicate && duplicateMatches.length > 0 && (
                      <div
                        role="alert"
                        className={`rounded-md border p-2 text-[11px] space-y-1 ${
                          duplicateMatches.some((m) => m.status === 'active')
                            ? 'bg-red-50 border-red-300 text-red-950'
                            : 'bg-amber-50 border-amber-300 text-amber-950'
                        }`}
                      >
                        <div className="flex items-center gap-1 font-bold">
                          <AlertTriangle
                            className={`w-3.5 h-3.5 shrink-0 ${
                              duplicateMatches.some((m) => m.status === 'active')
                                ? 'text-red-600'
                                : 'text-amber-600'
                            }`}
                          />
                          <span>
                            {duplicateMatches.some((m) => m.status === 'active')
                              ? `Order Already Taken! (${duplicateMatches.length})`
                              : `Previous History (${duplicateMatches.length})`}
                          </span>
                        </div>

                        <div className="space-y-1 max-h-24 overflow-y-auto">
                          {duplicateMatches.slice(0, 3).map((m) => (
                            <div
                              key={m.id}
                              className="bg-white/90 border border-black/10 rounded p-1.5 text-[10px] leading-tight"
                            >
                              <div className="flex items-center justify-between gap-1">
                                <span className="font-bold text-slate-900">
                                  {m.createdByName}
                                  {m.createdById === currentUser.id ? ' (You)' : ''}
                                </span>
                                <span
                                  className={`px-1 py-0.5 rounded text-[9px] font-semibold uppercase ${
                                    m.status === 'active'
                                      ? 'bg-red-100 text-red-700'
                                      : 'bg-slate-200 text-slate-700'
                                  }`}
                                >
                                  {m.status}
                                </span>
                              </div>
                              <div className="text-slate-700 mt-0.5">
                                {m.name || 'No Name'} ·{' '}
                                <span className="font-mono-num font-semibold">
                                  {formatIndianDate(m.bookingDate) || 'No Date'}
                                </span>{' '}
                                · {m.serviceName} · ₹{m.price}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Customer Name & City */}
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-[11px] font-medium text-slate-700 mb-0.5">
                          Customer Name
                        </label>
                        <input
                          type="text"
                          value={newName}
                          onChange={(e) => setNewName(e.target.value)}
                          placeholder="Optional"
                          className="w-full px-2.5 py-1 text-xs bg-white border border-[#CFE0D6] rounded-md focus:outline-none focus:border-[#128C7E]"
                        />
                      </div>

                      <div>
                        <label className="block text-[11px] font-medium text-slate-700 mb-0.5">
                          City Name
                        </label>
                        <select
                          value={newCity}
                          onChange={(e) => setNewCity(e.target.value)}
                          className="w-full px-2 py-1 text-xs bg-white border border-[#CFE0D6] rounded-md focus:outline-none focus:border-[#128C7E]"
                        >
                          {config.cities.map((c) => (
                            <option key={c} value={c}>
                              {c}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    {/* Full Address */}
                    <div>
                      <label className="block text-[11px] font-medium text-slate-700 mb-0.5">
                        Full Address
                      </label>
                      <input
                        type="text"
                        value={newAddress}
                        onChange={(e) => setNewAddress(e.target.value)}
                        placeholder="House no., Sector, Landmark (optional)"
                        className="w-full px-2.5 py-1 text-xs bg-white border border-[#CFE0D6] rounded-md focus:outline-none focus:border-[#128C7E]"
                      />
                    </div>

                    {/* Assign Cleaner & Message / Note */}
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-[11px] font-medium text-slate-700 mb-0.5">
                          Assign Cleaner
                        </label>
                        <select
                          value={newCleaner}
                          onChange={(e) => setNewCleaner(e.target.value)}
                          className="w-full px-2 py-1 text-xs bg-white border border-[#CFE0D6] rounded-md focus:outline-none focus:border-[#128C7E]"
                        >
                          {config.cleaners.map((cl) => (
                            <option key={cl} value={cl}>
                              {cl}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="block text-[11px] font-medium text-slate-700 mb-0.5">
                          Note (Optional)
                        </label>
                        <input
                          type="text"
                          value={newNotes}
                          onChange={(e) => setNewNotes(e.target.value)}
                          placeholder="Any instruction..."
                          className="w-full px-2.5 py-1 text-xs bg-white border border-[#CFE0D6] rounded-md focus:outline-none focus:border-[#128C7E]"
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {/* RIGHT BOX: Services, Qty, Price & Add Order Entry */}
                <div className="lg:col-span-7 bg-[#FAF6EC] border border-[#E5DABF] rounded-lg p-2.5 flex flex-col justify-between space-y-2">
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-1.5 border-b border-[#EAE0C8] pb-1">
                      <span className="text-[11px] font-bold uppercase tracking-wide text-amber-900">
                        2. Service, Qty &amp; Price
                      </span>
                      <span className="text-[11px] font-semibold text-[#075E54]">
                        {newServices.join(' + ')}
                      </span>
                    </div>

                    {/* Multi-Service Selector */}
                    <div className="flex flex-wrap gap-1">
                      {config.services.map((s) => {
                        const active = newServices.includes(s);
                        return (
                          <button
                            key={s}
                            type="button"
                            onClick={() => toggleNewService(s)}
                            className={`px-2 py-1 text-[11px] font-semibold rounded border inline-flex items-center gap-1 cursor-pointer transition-colors ${
                              active
                                ? 'bg-[#075E54] text-white border-[#075E54]'
                                : 'bg-white text-slate-700 border-[#DFD4B8] hover:bg-[#F5EEDB]'
                            }`}
                          >
                            {active ? (
                              <Check className="w-3 h-3 text-[#25D366]" />
                            ) : (
                              <Plus className="w-3 h-3 text-slate-400" />
                            )}
                            {s}
                          </button>
                        );
                      })}
                    </div>

                    {/* Water Tank Qty & Price */}
                    {hasWaterTankSelected && (
                      <div>
                        <div className="flex items-center justify-between gap-1 mb-1">
                          <span className="text-[11px] font-semibold text-slate-700">
                            Water Tank (Qty &amp; ₹/unit)
                          </span>
                          {tankSummary.totalTanks > 0 && (
                            <span className="text-[10px] text-[#075E54] font-semibold font-mono-num">
                              {tankSummary.totalTanks} tank{tankSummary.totalTanks > 1 ? 's' : ''}
                              {tankSummary.totalPrice > 0
                                ? ` · ₹${tankSummary.totalPrice.toLocaleString('en-IN')}`
                                : ''}
                            </span>
                          )}
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                          {TANK_TYPES.map((t) => {
                            const count = tankCounts[t.key] || 0;
                            const rate = tankPrices[t.key] || 0;
                            const lineTotal = count * rate;
                            return (
                              <div
                                key={t.key}
                                className={`flex items-center justify-between gap-2 px-2 py-1.5 rounded-md border text-[11px] ${
                                  count > 0 || rate > 0
                                    ? 'bg-white border-[#128C7E] text-[#075E54] font-semibold shadow-2xs'
                                    : 'bg-white/95 border-[#E5DABF] text-slate-700'
                                }`}
                              >
                                <div className="min-w-0 flex-1">
                                  <div className="leading-tight">{t.label}</div>
                                  {lineTotal > 0 && (
                                    <div className="text-[10px] font-mono-num text-[#128C7E]">
                                      = ₹{lineTotal.toLocaleString('en-IN')}
                                    </div>
                                  )}
                                </div>
                                <div className="flex items-center gap-1.5 shrink-0">
                                  <div className="inline-flex items-center border border-[#D4DDD8] rounded bg-[#F7F9F8] overflow-hidden focus-within:border-[#128C7E] focus-within:bg-white">
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setTankCountDirect(t.key, String(Math.max(0, count - 1)))
                                      }
                                      disabled={count === 0}
                                      aria-label={`Decrease ${t.label} qty`}
                                      className="w-5 h-6 flex items-center justify-center text-xs font-bold text-slate-600 hover:bg-[#E7F2EC] disabled:opacity-35 disabled:hover:bg-transparent cursor-pointer"
                                    >
                                      -
                                    </button>
                                    <input
                                      type="text"
                                      inputMode="numeric"
                                      value={count > 0 ? String(count) : ''}
                                      onChange={(e) => setTankCountDirect(t.key, e.target.value)}
                                      placeholder="Qty"
                                      aria-label={`${t.label} qty`}
                                      className="w-8 h-6 text-center font-mono-num text-[11px] bg-transparent border-x border-[#E2E8E5] focus:outline-none text-slate-800 placeholder:text-[10px] placeholder:text-slate-400"
                                    />
                                    <button
                                      type="button"
                                      onClick={() => setTankCountDirect(t.key, String(count + 1))}
                                      aria-label={`Increase ${t.label} qty`}
                                      className="w-5 h-6 flex items-center justify-center text-xs font-bold text-[#075E54] hover:bg-[#E7F2EC] cursor-pointer"
                                    >
                                      +
                                    </button>
                                  </div>
                                  <span className="text-[10px] text-slate-400">×</span>
                                  <div className="inline-flex items-center border border-[#D4DDD8] rounded bg-[#F7F9F8] px-1.5 h-6 focus-within:bg-white focus-within:border-[#128C7E]">
                                    <span className="text-[10px] font-semibold text-slate-500 mr-0.5">
                                      ₹
                                    </span>
                                    <input
                                      type="text"
                                      inputMode="numeric"
                                      value={rate > 0 ? String(rate) : ''}
                                      onChange={(e) => setTankPriceDirect(t.key, e.target.value)}
                                      placeholder={
                                        count === 0 && t.defaultPrice > 0
                                          ? String(t.defaultPrice)
                                          : 'Price'
                                      }
                                      aria-label={`${t.label} manual price`}
                                      className="w-14 text-right font-mono-num text-[11px] bg-transparent focus:outline-none text-slate-800 placeholder:text-[10px] placeholder:text-slate-400"
                                    />
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Dry Clean Qty & Price */}
                    {hasDryCleanSelected && (
                      <div>
                        <div className="flex items-center justify-between gap-1 mb-1">
                          <span className="text-[11px] font-semibold text-slate-700">
                            Dry Clean Items (Qty &amp; ₹/unit)
                          </span>
                          {dryCleanSummary.totalItems > 0 && (
                            <span className="text-[10px] text-[#075E54] font-semibold font-mono-num">
                              {dryCleanSummary.totalItems} item{dryCleanSummary.totalItems > 1 ? 's' : ''}
                              {dryCleanSummary.totalPrice > 0
                                ? ` · ₹${dryCleanSummary.totalPrice.toLocaleString('en-IN')}`
                                : ''}
                            </span>
                          )}
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                          {DRY_CLEAN_ITEMS.map((item) => {
                            const count = dryCleanCounts[item.key] || 0;
                            const rate = dryCleanPrices[item.key] || 0;
                            const lineTotal = count * rate;
                            return (
                              <div
                                key={item.key}
                                className={`flex items-center justify-between gap-2 px-2 py-1.5 rounded-md border text-[11px] ${
                                  count > 0 || rate > 0
                                    ? 'bg-white border-[#128C7E] text-[#075E54] font-semibold shadow-2xs'
                                    : 'bg-white/95 border-[#E5DABF] text-slate-700'
                                }`}
                              >
                                <div className="min-w-0 flex-1">
                                  <div className="leading-tight">{item.label}</div>
                                  {lineTotal > 0 && (
                                    <div className="text-[10px] font-mono-num text-[#128C7E]">
                                      = ₹{lineTotal.toLocaleString('en-IN')}
                                    </div>
                                  )}
                                </div>
                                <div className="flex items-center gap-1.5 shrink-0">
                                  <div className="inline-flex items-center border border-[#D4DDD8] rounded bg-[#F7F9F8] overflow-hidden focus-within:border-[#128C7E] focus-within:bg-white">
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setDryCleanCountDirect(
                                          item.key,
                                          String(Math.max(0, count - 1))
                                        )
                                      }
                                      disabled={count === 0}
                                      aria-label={`Decrease ${item.label} qty`}
                                      className="w-5 h-6 flex items-center justify-center text-xs font-bold text-slate-600 hover:bg-[#E7F2EC] disabled:opacity-35 disabled:hover:bg-transparent cursor-pointer"
                                    >
                                      -
                                    </button>
                                    <input
                                      type="text"
                                      inputMode="numeric"
                                      value={count > 0 ? String(count) : ''}
                                      onChange={(e) =>
                                        setDryCleanCountDirect(item.key, e.target.value)
                                      }
                                      placeholder="Qty"
                                      aria-label={`${item.label} qty`}
                                      className="w-8 h-6 text-center font-mono-num text-[11px] bg-transparent border-x border-[#E2E8E5] focus:outline-none text-slate-800 placeholder:text-[10px] placeholder:text-slate-400"
                                    />
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setDryCleanCountDirect(item.key, String(count + 1))
                                      }
                                      aria-label={`Increase ${item.label} qty`}
                                      className="w-5 h-6 flex items-center justify-center text-xs font-bold text-[#075E54] hover:bg-[#E7F2EC] cursor-pointer"
                                    >
                                      +
                                    </button>
                                  </div>
                                  <span className="text-[10px] text-slate-400">×</span>
                                  <div className="inline-flex items-center border border-[#D4DDD8] rounded bg-[#F7F9F8] px-1.5 h-6 focus-within:bg-white focus-within:border-[#128C7E]">
                                    <span className="text-[10px] font-semibold text-slate-500 mr-0.5">
                                      ₹
                                    </span>
                                    <input
                                      type="text"
                                      inputMode="numeric"
                                      value={rate > 0 ? String(rate) : ''}
                                      onChange={(e) =>
                                        setDryCleanPriceDirect(item.key, e.target.value)
                                      }
                                      placeholder={
                                        count === 0 && item.defaultPrice > 0
                                          ? String(item.defaultPrice)
                                          : 'Price'
                                      }
                                      aria-label={`${item.label} manual price`}
                                      className="w-14 text-right font-mono-num text-[11px] bg-transparent focus:outline-none text-slate-800 placeholder:text-[10px] placeholder:text-slate-400"
                                    />
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Home Cleaning Qty & Manual Price */}
                    {hasHomeCleaningSelected && (
                      <div>
                        <div className="flex items-center justify-between gap-1 mb-1">
                          <span className="text-[11px] font-semibold text-slate-700">
                            Home Cleaning Areas (Qty &amp; ₹/unit)
                          </span>
                          {homeCleaningSummary.totalItems > 0 && (
                            <span className="text-[10px] text-[#075E54] font-semibold font-mono-num">
                              {homeCleaningSummary.totalItems} item
                              {homeCleaningSummary.totalItems > 1 ? 's' : ''}
                              {homeCleaningSummary.totalPrice > 0
                                ? ` · ₹${homeCleaningSummary.totalPrice.toLocaleString('en-IN')}`
                                : ''}
                            </span>
                          )}
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                          {HOME_CLEANING_ITEMS.map((item) => {
                            const count = homeCleaningCounts[item.key] || 0;
                            const rate = homeCleaningPrices[item.key] || 0;
                            const lineTotal = count * rate;
                            return (
                              <div
                                key={item.key}
                                className={`flex items-center justify-between gap-2 px-2 py-1.5 rounded-md border text-[11px] ${
                                  count > 0 || rate > 0
                                    ? 'bg-white border-[#128C7E] text-[#075E54] font-semibold shadow-2xs'
                                    : 'bg-white/95 border-[#E5DABF] text-slate-700'
                                }`}
                              >
                                <div className="min-w-0 flex-1">
                                  <div className="leading-tight truncate">{item.label}</div>
                                  {lineTotal > 0 && (
                                    <div className="text-[10px] font-mono-num text-[#128C7E]">
                                      = ₹{lineTotal.toLocaleString('en-IN')}
                                    </div>
                                  )}
                                </div>
                                <div className="flex items-center gap-1.5 shrink-0">
                                  <div className="inline-flex items-center border border-[#D4DDD8] rounded bg-[#F7F9F8] overflow-hidden focus-within:border-[#128C7E] focus-within:bg-white">
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setHomeCleaningCountDirect(
                                          item.key,
                                          String(Math.max(0, count - 1))
                                        )
                                      }
                                      disabled={count === 0}
                                      aria-label={`Decrease ${item.label} qty`}
                                      className="w-5 h-6 flex items-center justify-center text-xs font-bold text-slate-600 hover:bg-[#E7F2EC] disabled:opacity-35 disabled:hover:bg-transparent cursor-pointer"
                                    >
                                      -
                                    </button>
                                    <input
                                      type="text"
                                      inputMode="numeric"
                                      value={count > 0 ? String(count) : ''}
                                      onChange={(e) =>
                                        setHomeCleaningCountDirect(item.key, e.target.value)
                                      }
                                      placeholder="Qty"
                                      aria-label={`${item.label} qty`}
                                      className="w-8 h-6 text-center font-mono-num text-[11px] bg-transparent border-x border-[#E2E8E5] focus:outline-none text-slate-800 placeholder:text-[10px] placeholder:text-slate-400"
                                    />
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setHomeCleaningCountDirect(item.key, String(count + 1))
                                      }
                                      aria-label={`Increase ${item.label} qty`}
                                      className="w-5 h-6 flex items-center justify-center text-xs font-bold text-[#075E54] hover:bg-[#E7F2EC] cursor-pointer"
                                    >
                                      +
                                    </button>
                                  </div>
                                  <span className="text-[10px] text-slate-400">×</span>
                                  <div className="inline-flex items-center border border-[#D4DDD8] rounded bg-[#F7F9F8] px-1.5 h-6 focus-within:bg-white focus-within:border-[#128C7E]">
                                    <span className="text-[10px] font-semibold text-slate-500 mr-0.5">
                                      ₹
                                    </span>
                                    <input
                                      type="text"
                                      inputMode="numeric"
                                      value={rate > 0 ? String(rate) : ''}
                                      onChange={(e) =>
                                        setHomeCleaningPriceDirect(item.key, e.target.value)
                                      }
                                      placeholder="Price"
                                      aria-label={`${item.label} manual price`}
                                      className="w-14 text-right font-mono-num text-[11px] bg-transparent focus:outline-none text-slate-800 placeholder:text-[10px] placeholder:text-slate-400"
                                    />
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Other Services Qty & Price */}
                    {hasOtherServiceSelected && (
                      <div>
                        <div className="flex items-center justify-between gap-1 mb-1">
                          <span className="text-[11px] font-semibold text-slate-700">
                            Service Qty &amp; ₹/unit
                          </span>
                          {serviceQtySummary.totalQty > 0 && (
                            <span className="text-[10px] text-[#075E54] font-semibold font-mono-num">
                              Qty: {serviceQtySummary.totalQty}
                              {serviceQtySummary.totalPrice > 0
                                ? ` · ₹${serviceQtySummary.totalPrice.toLocaleString('en-IN')}`
                                : ''}
                            </span>
                          )}
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                          {selectedNonTankServices.map((s) => {
                            const qtyVal = serviceQuantities[s] || 0;
                            const rate = servicePrices[s] || 0;
                            const defaultPrice = getDefaultServicePrice(s);
                            const lineTotal = qtyVal * rate;
                            const isSeats = s.toLowerCase() === 'sofa';
                            const unitLabel = isSeats ? `${s} (Seats)` : s;
                            return (
                              <div
                                key={s}
                                className={`flex items-center justify-between gap-2 px-2 py-1.5 rounded-md border text-[11px] ${
                                  qtyVal > 0 || rate > 0
                                    ? 'bg-white border-[#128C7E] text-[#075E54] font-semibold shadow-2xs'
                                    : 'bg-white/95 border-[#E5DABF] text-slate-700'
                                }`}
                              >
                                <div className="min-w-0 flex-1">
                                  <div className="leading-tight">{unitLabel}</div>
                                  {lineTotal > 0 && (
                                    <div className="text-[10px] font-mono-num text-[#128C7E]">
                                      = ₹{lineTotal.toLocaleString('en-IN')}
                                    </div>
                                  )}
                                </div>
                                <div className="flex items-center gap-1.5 shrink-0">
                                  <div className="inline-flex items-center border border-[#D4DDD8] rounded bg-[#F7F9F8] overflow-hidden focus-within:border-[#128C7E] focus-within:bg-white">
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setServiceQtyDirect(s, String(Math.max(0, qtyVal - 1)))
                                      }
                                      disabled={qtyVal === 0}
                                      aria-label={`Decrease ${unitLabel} qty`}
                                      className="w-5 h-6 flex items-center justify-center text-xs font-bold text-slate-600 hover:bg-[#E7F2EC] disabled:opacity-35 disabled:hover:bg-transparent cursor-pointer"
                                    >
                                      -
                                    </button>
                                    <input
                                      type="text"
                                      inputMode="numeric"
                                      value={qtyVal > 0 ? String(qtyVal) : ''}
                                      onChange={(e) => setServiceQtyDirect(s, e.target.value)}
                                      placeholder={isSeats ? 'Seats' : 'Qty'}
                                      aria-label={`${unitLabel} qty`}
                                      className="w-8 h-6 text-center font-mono-num text-[11px] bg-transparent border-x border-[#E2E8E5] focus:outline-none text-slate-800 placeholder:text-[10px] placeholder:text-slate-400"
                                    />
                                    <button
                                      type="button"
                                      onClick={() => setServiceQtyDirect(s, String(qtyVal + 1))}
                                      aria-label={`Increase ${unitLabel} qty`}
                                      className="w-5 h-6 flex items-center justify-center text-xs font-bold text-[#075E54] hover:bg-[#E7F2EC] cursor-pointer"
                                    >
                                      +
                                    </button>
                                  </div>
                                  <span className="text-[10px] text-slate-400">×</span>
                                  <div className="inline-flex items-center border border-[#D4DDD8] rounded bg-[#F7F9F8] px-1.5 h-6 focus-within:bg-white focus-within:border-[#128C7E]">
                                    <span className="text-[10px] font-semibold text-slate-500 mr-0.5">
                                      ₹
                                    </span>
                                    <input
                                      type="text"
                                      inputMode="numeric"
                                      value={rate > 0 ? String(rate) : ''}
                                      onChange={(e) => setServicePriceDirect(s, e.target.value)}
                                      placeholder={
                                        qtyVal === 0 && defaultPrice > 0
                                          ? String(defaultPrice)
                                          : 'Price'
                                      }
                                      aria-label={`${unitLabel} manual price`}
                                      className="w-14 text-right font-mono-num text-[11px] bg-transparent focus:outline-none text-slate-800 placeholder:text-[10px] placeholder:text-slate-400"
                                    />
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Booking Date + Price + Less Price + Submit Footer inside Right Box */}
                  <div className="space-y-2 pt-2 border-t border-[#EAE0C8]">
                    {/* Booking Date */}
                    <div>
                      <div className="flex items-center justify-between mb-0.5">
                        <label className="text-[11px] font-medium text-slate-700">
                          Booking Date <span className="text-red-600">*</span>
                        </label>
                        <span
                          className={`text-[10px] font-mono-num font-semibold ${
                            dateSelectionMode === 'date' && newDate
                              ? 'text-[#075E54]'
                              : dateSelectionMode === 'not_confirm'
                              ? 'text-amber-700'
                              : 'text-slate-400'
                          }`}
                        >
                          {dateSelectionMode === 'date' && newDate
                            ? formatIndianDate(newDate)
                            : dateSelectionMode === 'not_confirm'
                            ? 'Not Confirm'
                            : 'Select Date'}
                        </span>
                      </div>

                      <div className="flex flex-wrap items-center gap-1">
                        {[
                          { label: 'Aj', date: todayStr(0) },
                          { label: 'Kal', date: todayStr(1) },
                          { label: 'Parso', date: todayStr(2) },
                        ].map((opt) => {
                          const active =
                            dateSelectionMode === 'date' && !customDateOpen && newDate === opt.date;
                          return (
                            <button
                              key={opt.label}
                              type="button"
                              onClick={() => {
                                setNewDate(opt.date);
                                setDateSelectionMode('date');
                                setCustomDateOpen(false);
                              }}
                              className={`flex-1 py-1 px-2 text-[11px] font-semibold rounded border cursor-pointer transition-colors whitespace-nowrap ${
                                active
                                  ? 'bg-[#075E54] text-white border-[#075E54]'
                                  : 'bg-white text-slate-700 border-[#DFD4B8] hover:bg-[#F5EEDB]'
                              }`}
                            >
                              {opt.label}
                            </button>
                          );
                        })}

                        <button
                          type="button"
                          onClick={() => {
                            setCustomDateOpen((prev) => !prev);
                          }}
                          className={`flex-1 py-1 px-2 text-[11px] font-semibold rounded border cursor-pointer transition-colors whitespace-nowrap ${
                            customDateOpen ||
                            (dateSelectionMode === 'date' && Boolean(newDate) && !getIndianDayTag(newDate))
                              ? 'bg-[#075E54] text-white border-[#075E54]'
                              : 'bg-white text-slate-700 border-[#DFD4B8] hover:bg-[#F5EEDB]'
                          }`}
                        >
                          Date
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            setNewDate('');
                            setDateSelectionMode('not_confirm');
                            setCustomDateOpen(false);
                          }}
                          className={`shrink-0 py-1 px-2 text-[11px] font-semibold rounded border cursor-pointer transition-colors whitespace-nowrap ${
                            !customDateOpen && dateSelectionMode === 'not_confirm'
                              ? 'bg-amber-600 text-white border-amber-600'
                              : 'bg-amber-50 text-amber-800 border-amber-300 hover:bg-amber-100'
                          }`}
                        >
                          Not Confirm
                        </button>
                      </div>

                      {(customDateOpen ||
                        (dateSelectionMode === 'date' && Boolean(newDate) && !getIndianDayTag(newDate))) && (
                        <div className="mt-1 flex items-center gap-1.5">
                          <IndianDateInput
                            ariaLabel="Select custom booking date"
                            title="Custom Date (DD/MM/YY)"
                            value={newDate}
                            onChange={(val) => {
                              if (val) {
                                setNewDate(val);
                                setDateSelectionMode('date');
                              }
                            }}
                            className="flex-1 rounded-md border-[#128C7E]"
                          />
                        </div>
                      )}
                    </div>

                    {Number(newLessPrice) > 0 && (() => {
                      const gross = Math.max(0, Number(newPrice) || 0);
                      const less = Math.max(0, Number(newLessPrice) || 0);
                      const finalAmt = Math.max(0, gross - less);
                      return (
                        <div className="px-2 py-1 rounded bg-[#E9F7F0] border border-[#BFE6D1] flex items-center justify-between gap-2 text-[11px] font-mono-num">
                          <span className="text-slate-600">
                            ₹{gross.toLocaleString('en-IN')} - ₹{less.toLocaleString('en-IN')}
                          </span>
                          <span className="font-bold text-[#075E54]">
                            Net = ₹{finalAmt.toLocaleString('en-IN')}
                          </span>
                        </div>
                      );
                    })()}

                    <div className="flex flex-wrap sm:flex-nowrap items-end gap-2">
                      <div className="flex-1 min-w-[95px]">
                        <div className="flex items-center justify-between gap-1 mb-0.5">
                          <label className="text-[11px] font-medium text-slate-700 whitespace-nowrap">
                            Total Price (₹)
                          </label>
                          {autoCalculatedTotal > 0 && (
                            priceManuallyEdited && Number(newPrice) !== autoCalculatedTotal ? (
                              <button
                                type="button"
                                onClick={() => {
                                  setPriceManuallyEdited(false);
                                  setNewPrice(String(autoCalculatedTotal));
                                }}
                                className="text-[10px] font-semibold text-[#128C7E] hover:underline cursor-pointer whitespace-nowrap"
                              >
                                Use ₹{autoCalculatedTotal.toLocaleString('en-IN')}
                              </button>
                            ) : (
                              <span className="text-[10px] font-semibold text-[#075E54]">
                                Auto
                              </span>
                            )
                          )}
                        </div>
                        <input
                          type="number"
                          min={0}
                          value={newPrice}
                          onChange={(e) => {
                            setPriceManuallyEdited(true);
                            setNewPrice(e.target.value);
                          }}
                          placeholder="Amount"
                          className="w-full h-[30px] px-2 text-xs font-mono-num bg-white border border-[#DFD4B8] rounded-md focus:outline-none focus:border-[#128C7E]"
                        />
                      </div>

                      <div className="flex-1 min-w-[85px]">
                        <label className="block text-[11px] font-medium text-slate-700 mb-0.5 whitespace-nowrap">
                          Less Price (₹)
                        </label>
                        <div className="flex items-center h-[30px] bg-[#FFF8F6] border border-[#F3D0C8] rounded-md px-2 focus-within:bg-white focus-within:border-red-400">
                          <span className="text-[11px] font-bold text-red-500 mr-1 shrink-0">- ₹</span>
                          <input
                            type="number"
                            min={0}
                            value={newLessPrice}
                            onChange={(e) => setNewLessPrice(e.target.value)}
                            placeholder="0"
                            aria-label="Less Price"
                            className="w-full py-1 text-xs font-mono-num bg-transparent focus:outline-none text-slate-800"
                          />
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => setNewOrderOpen(false)}
                        className="h-[30px] px-2.5 text-[11px] font-semibold bg-white border border-[#DFD4B8] hover:bg-slate-50 text-slate-700 rounded-md cursor-pointer whitespace-nowrap shrink-0"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={adding}
                        className="h-[30px] px-3 bg-[#128C7E] hover:bg-[#075E54] disabled:opacity-60 text-white text-xs font-semibold rounded-md flex items-center gap-1 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        {adding ? 'Adding...' : 'Add Order Entry'}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

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
          return `This number (${firstActive.number}) already has an Active order taken by ${firstActive.createdByName} for "${firstActive.name || 'Customer'}" on Booking Date ${formatIndianDate(firstActive.bookingDate) || 'N/A'} (${firstActive.serviceName}, ₹${firstActive.price}). Do you still want to add a new order?`;
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

      {/* Pass Order to Another Telecaller Modal */}
      <TransferOrderModal
        ordersToTransfer={transferTargetOrders}
        staffMembers={config.telecallers || []}
        currentUser={currentUser}
        onClose={() => setTransferTargetIds(null)}
        onTransfer={async (ids, targetUserId) => {
          await onTransferOrders(ids, targetUserId);
          const transferredSet = new Set(ids);
          setSelectedIds((prev) => prev.filter((id) => !transferredSet.has(id)));
        }}
        onUntransfer={async (ids) => {
          await onUntransferOrders(ids);
          const untransferredSet = new Set(ids);
          setSelectedIds((prev) => prev.filter((id) => !untransferredSet.has(id)));
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
