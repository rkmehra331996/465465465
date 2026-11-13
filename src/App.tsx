import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  bulkCompleteOrders,
  bulkImportOrders,
  bulkUpdatePartialPayments,
  bulkUpdatePayment,
  createOrder,
  deleteOrder,
  getConfig,
  getMe,
  getOrders,
  getOrderTotal,
  getStoredToken,
  logout,
  updateOrder,
} from './lib/api';
import { LoginView } from './components/LoginView';
import { OrderSheet } from './components/OrderSheet';
import { PercentageCalculator } from './components/PercentageCalculator';
import { TelecallerManager } from './components/TelecallerManager';
import { TodaysActiveVendors } from './components/TodaysActiveVendors';
import { VendorPayments } from './components/VendorPayments';
import { WhatsAppDispatch } from './components/WhatsAppDispatch';
import { SERVICE_OPTIONS } from './types';
import type {
  BulkImportOrderRow,
  NewOrderPayload,
  Order,
  PaymentStatus,
  PortalConfig,
  UserPublic,
} from './types';

type ActiveTab =
  | 'active'
  | 'todays_vendors'
  | 'whatsapp'
  | 'payments'
  | 'telecallers';

interface ToastState {
  id: number;
  message: string;
  type: 'success' | 'error';
}

const DEFAULT_CONFIG: PortalConfig = {
  cities: ['Patiala', 'Ludhiana', 'Jalandhar', 'Chandigarh', 'Moga', 'Khanna', 'Other'],
  cleaners: ['Jagdish', 'Raaj', 'Manish', 'Gurmeet', 'Aman', 'Karan', 'Arun'],
  services: [...SERVICE_OPTIONS],
  cleanerProfiles: {},
};

export default function App() {
  const [user, setUser] = useState<UserPublic | null>(null);
  const [authChecking, setAuthChecking] = useState<boolean>(true);
  const [orders, setOrders] = useState<Order[]>([]);
  const [config, setConfig] = useState<PortalConfig>(DEFAULT_CONFIG);
  const [ordersLoading, setOrdersLoading] = useState<boolean>(false);

  const [activeTab, setActiveTab] = useState<ActiveTab>('active');
  const [calcOpen, setCalcOpen] = useState<boolean>(false);
  const [dispatchCleaner, setDispatchCleaner] = useState<string | undefined>(undefined);
  const [dispatchSelectedIds, setDispatchSelectedIds] = useState<string[] | undefined>(undefined);
  const [toast, setToast] = useState<ToastState | null>(null);

  const notify = useCallback((message: string, type: 'success' | 'error' = 'success') => {
    const id = Date.now();
    setToast({ id, message, type });
    setTimeout(() => {
      setToast((curr) => (curr?.id === id ? null : curr));
    }, 3200);
  }, []);

  const loadWorkspaceData = useCallback(async () => {
    setOrdersLoading(true);
    try {
      const [ordersList, cfg] = await Promise.all([getOrders(), getConfig()]);
      setOrders(ordersList);
      setConfig(cfg);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to load portal data', 'error');
    } finally {
      setOrdersLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    let mounted = true;
    const checkSession = async () => {
      if (!getStoredToken()) {
        try {
          const me = await getMe();
          if (mounted) {
            setUser(me);
            await loadWorkspaceData();
          }
        } catch {
          if (mounted) setUser(null);
        } finally {
          if (mounted) setAuthChecking(false);
        }
        return;
      }

      try {
        const me = await getMe();
        if (mounted) {
          setUser(me);
          await loadWorkspaceData();
        }
      } catch {
        if (mounted) setUser(null);
      } finally {
        if (mounted) setAuthChecking(false);
      }
    };

    checkSession();
    return () => {
      mounted = false;
    };
  }, [loadWorkspaceData]);

  const handleLoginSuccess = async (loggedInUser: UserPublic) => {
    setUser(loggedInUser);
    setActiveTab('active');
    await loadWorkspaceData();
    notify(`Welcome, ${loggedInUser.name}`);
  };

  const handleLogout = async () => {
    await logout();
    setUser(null);
    setOrders([]);
    setCalcOpen(false);
  };

  const handleAddOrder = async (payload: NewOrderPayload) => {
    try {
      const created = await createOrder(payload);
      setOrders((prev) => [created, ...prev]);
      notify(`Order added (${created.number} · ${created.serviceName} · ${created.cleanerName})`);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not add order', 'error');
      throw err;
    }
  };

  const handleUpdateOrder = async (id: string, patch: Partial<Order>) => {
    try {
      const updated = await updateOrder(id, patch);
      setOrders((prev) => prev.map((o) => (o.id === id ? updated : o)));
      if (patch.status === 'completed') {
        notify(`Order (${updated.name || updated.number}) marked completed.`);
      } else if (patch.status === 'active') {
        notify(`Order (${updated.name || updated.number}) reopened in Active Orders.`);
      } else {
        notify('Saved changes.');
      }
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Update failed', 'error');
    }
  };

  const handleDeleteOrder = async (id: string) => {
    try {
      await deleteOrder(id);
      setOrders((prev) => prev.filter((o) => o.id !== id));
      notify('Order deleted.');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Delete failed', 'error');
    }
  };

  const handleBulkComplete = async (ids: string[]) => {
    try {
      await bulkCompleteOrders(ids);
      const idSet = new Set(ids);
      const now = new Date().toISOString();
      setOrders((prev) =>
        prev.map((o) =>
          idSet.has(o.id)
            ? {
                ...o,
                status: 'completed',
                completedAt: o.completedAt || now,
                completedByName: o.completedByName || user?.name,
              }
            : o
        )
      );
      notify(`${ids.length} order${ids.length > 1 ? 's' : ''} marked completed.`);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Bulk complete failed', 'error');
    }
  };

  const handleBulkUpdatePayment = async (ids: string[], paymentStatus: PaymentStatus) => {
    try {
      const updatedOrders = await bulkUpdatePayment(ids, paymentStatus);
      const updatedMap = new Map(updatedOrders.map((o) => [o.id, o]));
      setOrders((prev) => prev.map((o) => updatedMap.get(o.id) || o));
      notify(
        `${ids.length} order${ids.length > 1 ? 's' : ''} marked ${
          paymentStatus === 'clear' ? 'Payment Done' : 'Payment Pending'
        }.`
      );
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Payment update failed', 'error');
    }
  };

  const handleBulkUpdatePartialPayments = async (
    updates: Array<{ id: string; paidCommission: number; paymentNote?: string }>
  ) => {
    try {
      const updatedOrders = await bulkUpdatePartialPayments(updates);
      const updatedMap = new Map(updatedOrders.map((o) => [o.id, o]));
      setOrders((prev) => prev.map((o) => updatedMap.get(o.id) || o));
      notify('Received commission saved.');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Partial payment update failed', 'error');
    }
  };

  const handleBulkImportOrders = async (payload: {
    rows: BulkImportOrderRow[];
    autoAddDropdowns: boolean;
    skipDuplicateNumbers: boolean;
  }) => {
    try {
      const res = await bulkImportOrders(payload);
      setOrders((prev) => [...res.orders, ...prev]);
      setConfig(res.config);
      const skipNote = res.skippedCount > 0 ? ` (${res.skippedCount} skipped)` : '';
      notify(`${res.importedCount} orders Excel se import ho gaye!${skipNote}`);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Excel import failed', 'error');
      throw err;
    }
  };

  const handleOpenWhatsAppForCleaner = (cleanerName: string, selectedIds?: string[]) => {
    setDispatchCleaner(cleanerName);
    setDispatchSelectedIds(selectedIds);
    setActiveTab('whatsapp');
  };

  const stats = useMemo(() => {
    const active = orders.filter((o) => o.status === 'active');
    const completed = orders.filter((o) => o.status === 'completed');
    const activeAmount = active.reduce((s, o) => s + getOrderTotal(o), 0);
    return {
      activeCount: active.length,
      completedCount: completed.length,
      activeAmount,
    };
  }, [orders]);

  if (authChecking) {
    return (
      <div className="min-h-screen bg-[#F4F7F5] flex items-center justify-center text-sm text-slate-600">
        Loading OrderDesk...
      </div>
    );
  }

  if (!user) {
    return <LoginView onSuccess={handleLoginSuccess} />;
  }

  return (
    <div className="min-h-screen bg-[#F4F7F5] text-slate-900 flex flex-col">
      <header className="bg-[#075E54] text-white border-b border-[#054A42] sticky top-0 z-30">
        <div className="max-w-[1440px] mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-8">
          <button
            type="button"
            onClick={() => setActiveTab('active')}
            className="font-display text-lg font-bold tracking-tight text-white whitespace-nowrap shrink-0 cursor-pointer"
          >
            OrderDesk
          </button>

          <nav
            aria-label="Primary navigation"
            className="flex items-center gap-5 overflow-x-auto text-sm font-medium"
          >
            <button
              type="button"
              onClick={() => setActiveTab('active')}
              className={`py-1 whitespace-nowrap shrink-0 border-b-2 transition-colors cursor-pointer ${
                activeTab === 'active'
                  ? 'border-[#25D366] text-white'
                  : 'border-transparent text-emerald-100/80 hover:text-white'
              }`}
            >
              Active Orders
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('todays_vendors')}
              className={`px-3 py-1 rounded-md text-xs sm:text-sm font-semibold whitespace-nowrap shrink-0 transition-all cursor-pointer ${
                activeTab === 'todays_vendors'
                  ? 'bg-red-600 text-white ring-2 ring-white shadow-sm'
                  : 'bg-red-600/90 hover:bg-red-600 text-white'
              }`}
            >
              Today&apos;s Active Vendors
            </button>

            <button
              type="button"
              onClick={() => {
                setDispatchSelectedIds(undefined);
                setActiveTab('whatsapp');
              }}
              className={`py-1 whitespace-nowrap shrink-0 border-b-2 transition-colors cursor-pointer ${
                activeTab === 'whatsapp'
                  ? 'border-[#25D366] text-white'
                  : 'border-transparent text-emerald-100/80 hover:text-white'
              }`}
            >
              WhatsApp Dispatch
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('payments')}
              className={`py-1 whitespace-nowrap shrink-0 border-b-2 transition-colors cursor-pointer ${
                activeTab === 'payments'
                  ? 'border-[#25D366] text-white'
                  : 'border-transparent text-emerald-100/80 hover:text-white'
              }`}
            >
              Vendor Payments
            </button>

            <button
              type="button"
              onClick={() => setCalcOpen((prev) => !prev)}
              className={`py-1 whitespace-nowrap shrink-0 border-b-2 transition-colors cursor-pointer ${
                calcOpen
                  ? 'border-[#25D366] text-white'
                  : 'border-transparent text-emerald-100/80 hover:text-white'
              }`}
            >
              Calculator
            </button>

            {user.role === 'super_admin' && (
              <button
                type="button"
                onClick={() => setActiveTab('telecallers')}
                className={`py-1 whitespace-nowrap shrink-0 border-b-2 transition-colors cursor-pointer ${
                  activeTab === 'telecallers'
                    ? 'border-[#25D366] text-white'
                    : 'border-transparent text-emerald-100/80 hover:text-white'
                }`}
              >
                Admin Panel
              </button>
            )}
          </nav>

          <div className="shrink-0">
            <button
              type="button"
              onClick={handleLogout}
              className="px-3.5 py-1.5 text-xs font-semibold bg-white/15 hover:bg-white/25 text-white rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Sign Out
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-[1440px] w-full mx-auto px-4 sm:px-6 py-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-[#DCE4E0]">
          <div>
            <h1 className="font-display text-lg font-bold text-slate-900">
              {activeTab === 'active' && 'Active Orders Sheet'}
              {activeTab === 'todays_vendors' && "Today's Active Vendors — Cleaner Dispatch & Work List"}
              {activeTab === 'whatsapp' && 'WhatsApp Bulk Dispatch & Auto-Translate'}
              {activeTab === 'payments' && 'Vendor Payment Ledger — Pending & Cleared'}
              {activeTab === 'telecallers' && 'Super Admin Settings — Cities, Cleaners & Telecallers'}
            </h1>
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 mt-0.5">
              <span>
                Signed in as <strong className="text-slate-800">{user.name}</strong> (
                {user.role === 'super_admin' ? 'Super Admin' : 'Telecaller'})
              </span>
              <span aria-hidden="true">·</span>
              <span className="font-mono-num">Active: {stats.activeCount}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono-num">Completed: {stats.completedCount}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono-num text-[#075E54] font-semibold">
                Pending Value: ₹{stats.activeAmount.toLocaleString('en-IN')}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {activeTab !== 'whatsapp' && (
              <button
                type="button"
                onClick={() => {
                  setDispatchSelectedIds(undefined);
                  setActiveTab('whatsapp');
                }}
                className="px-3.5 py-2 text-xs font-semibold bg-[#25D366] hover:bg-[#1ebe5d] text-white rounded-lg transition-colors cursor-pointer whitespace-nowrap"
              >
                Open WhatsApp Auto-Message
              </button>
            )}
          </div>
        </div>

        {activeTab === 'active' && (
          <OrderSheet
            mode="active"
            orders={orders}
            config={config}
            currentUser={user}
            loading={ordersLoading}
            onAddOrder={handleAddOrder}
            onUpdateOrder={handleUpdateOrder}
            onDeleteOrder={handleDeleteOrder}
            onBulkComplete={handleBulkComplete}
            onBulkImport={handleBulkImportOrders}
            onOpenWhatsAppForCleaner={handleOpenWhatsAppForCleaner}
            onNotify={notify}
          />
        )}

        {activeTab === 'todays_vendors' && (
          <TodaysActiveVendors
            orders={orders}
            config={config}
            currentUser={user}
            onUpdateOrder={handleUpdateOrder}
            onBulkComplete={handleBulkComplete}
            onOpenWhatsAppForCleaner={handleOpenWhatsAppForCleaner}
            onNotify={notify}
          />
        )}

        {activeTab === 'whatsapp' && (
          <WhatsAppDispatch
            orders={orders}
            initialCleaner={dispatchCleaner}
            initialSelectedIds={dispatchSelectedIds}
            onBulkComplete={handleBulkComplete}
            onNotify={notify}
          />
        )}

        {activeTab === 'payments' && (
          <VendorPayments
            orders={orders}
            config={config}
            currentUser={user}
            onAddOrder={handleAddOrder}
            onUpdateOrder={handleUpdateOrder}
            onBulkUpdatePayment={handleBulkUpdatePayment}
            onBulkUpdatePartialPayments={handleBulkUpdatePartialPayments}
            onNotify={notify}
          />
        )}

        {activeTab === 'telecallers' && user.role === 'super_admin' && (
          <TelecallerManager
            orders={orders}
            config={config}
            onConfigChange={setConfig}
            onBulkImport={handleBulkImportOrders}
            onOrdersPull={setOrders}
            onNotify={notify}
          />
        )}
      </main>

      <PercentageCalculator open={calcOpen} onClose={() => setCalcOpen(false)} />

      {toast && (
        <div
          role="status"
          className={`fixed bottom-5 right-5 z-50 px-4 py-2.5 rounded-lg text-xs font-semibold shadow-lg border ${
            toast.type === 'error'
              ? 'bg-red-50 text-red-800 border-red-200'
              : 'bg-[#075E54] text-white border-[#054A42]'
          }`}
        >
          {toast.message}
        </div>
      )}
    </div>
  );
}
