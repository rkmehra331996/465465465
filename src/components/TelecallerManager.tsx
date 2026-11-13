import React, { useEffect, useState } from 'react';
import {
  Database,
  Download,
  FileSpreadsheet,
  KeyRound,
  MapPin,
  Phone,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
  Upload,
  UserCheck,
  UserCog,
  UserX,
} from 'lucide-react';
import {
  addCity,
  addCleaner,
  createTelecaller,
  deleteCity,
  deleteCleaner,
  deleteTelecaller,
  downloadFullBackupJson,
  downloadHostingerPhpScript,
  downloadHostingerReadyZip,
  getHostingerConfig,
  getTelecallers,
  pullFromHostingerMysql,
  saveHostingerConfig,
  syncToHostingerNow,
  testHostingerConnection,
  updateCleanerProfile,
  updateTelecaller,
} from '../lib/api';
import { downloadExcelTemplate, exportOrdersToExcel } from '../lib/excel';
import { ConfirmDialog } from './ConfirmDialog';
import { ExcelImportModal } from './ExcelImportModal';
import type { BulkImportOrderRow, Order, PortalConfig, UserPublic } from '../types';

interface TelecallerManagerProps {
  orders: Order[];
  config: PortalConfig;
  onConfigChange: (next: PortalConfig) => void;
  onBulkImport: (payload: {
    rows: BulkImportOrderRow[];
    autoAddDropdowns: boolean;
    skipDuplicateNumbers: boolean;
  }) => Promise<void>;
  onOrdersPull: (orders: Order[]) => void;
  onNotify: (msg: string, type?: 'success' | 'error') => void;
}

export const TelecallerManager: React.FC<TelecallerManagerProps> = ({
  orders,
  config,
  onConfigChange,
  onBulkImport,
  onOrdersPull,
  onNotify,
}) => {
  const [users, setUsers] = useState<UserPublic[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [resetTargetId, setResetTargetId] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState('');

  const [newCity, setNewCity] = useState('');
  const [citySubmitting, setCitySubmitting] = useState(false);

  const [newCleaner, setNewCleaner] = useState('');
  const [newCleanerPhone, setNewCleanerPhone] = useState('');
  const [newCleanerCity, setNewCleanerCity] = useState(config.cities[0] || 'Patiala');
  const [cleanerSubmitting, setCleanerSubmitting] = useState(false);

  const [editingCleaner, setEditingCleaner] = useState<string | null>(null);
  const [editCleanerPhone, setEditCleanerPhone] = useState('');
  const [editCleanerCity, setEditCleanerCity] = useState('');

  const [importModalOpen, setImportModalOpen] = useState(false);

  // Hostinger sync state
  const [hMode, setHMode] = useState<'none' | 'mysql' | 'webhook'>('none');
  const [hAutoSync, setHAutoSync] = useState(true);
  const [hMysqlHost, setHMysqlHost] = useState('');
  const [hMysqlPort, setHMysqlPort] = useState('3306');
  const [hMysqlDatabase, setHMysqlDatabase] = useState('');
  const [hMysqlUser, setHMysqlUser] = useState('');
  const [hMysqlPassword, setHMysqlPassword] = useState('');
  const [hHasMysqlPass, setHHasMysqlPass] = useState(false);
  const [hWebhookUrl, setHWebhookUrl] = useState('');
  const [hWebhookSecret, setHWebhookSecret] = useState('');
  const [hHasWebhookSecret, setHHasWebhookSecret] = useState(false);
  const [hLastSyncedAt, setHLastSyncedAt] = useState<string | undefined>(undefined);
  const [hBusy, setHBusy] = useState(false);
  const [hZipDownloading, setHZipDownloading] = useState(false);

  const loadUsers = async () => {
    setLoading(true);
    try {
      const [list, hCfg] = await Promise.all([getTelecallers(), getHostingerConfig()]);
      setUsers(list);
      setHMode(hCfg.mode);
      setHAutoSync(hCfg.autoSync);
      setHMysqlHost(hCfg.mysqlHost);
      setHMysqlPort(String(hCfg.mysqlPort || 3306));
      setHMysqlDatabase(hCfg.mysqlDatabase);
      setHMysqlUser(hCfg.mysqlUser);
      setHHasMysqlPass(hCfg.hasMysqlPassword);
      setHWebhookUrl(hCfg.webhookUrl);
      setHHasWebhookSecret(hCfg.hasWebhookSecret);
      setHLastSyncedAt(hCfg.lastSyncedAt);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Failed to load admin settings', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadUsers();
  }, []);

  const handleAddTelecaller = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !username.trim() || password.length < 4) {
      onNotify('Enter display name, username, and password (min 4 characters).', 'error');
      return;
    }

    setSubmitting(true);
    try {
      const created = await createTelecaller({
        name: name.trim(),
        username: username.trim(),
        password,
      });
      setUsers((prev) => [...prev, created]);
      setName('');
      setUsername('');
      setPassword('');
      onNotify(`Telecaller "${created.name}" added.`);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Could not add telecaller', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleActive = async (u: UserPublic) => {
    try {
      const updated = await updateTelecaller(u.id, { active: !u.active });
      setUsers((prev) => prev.map((item) => (item.id === u.id ? updated : item)));
      onNotify(`${updated.name} is now ${updated.active ? 'active' : 'disabled'}.`);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Update failed', 'error');
    }
  };

  const handleResetPassword = async (id: string) => {
    if (newPassword.length < 4) {
      onNotify('New password must be at least 4 characters.', 'error');
      return;
    }
    try {
      await updateTelecaller(id, { password: newPassword });
      setResetTargetId(null);
      setNewPassword('');
      onNotify('Password updated successfully.');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Password update failed', 'error');
    }
  };

  const [pendingDelete, setPendingDelete] = useState<
    | { kind: 'telecaller'; user: UserPublic }
    | { kind: 'city'; name: string }
    | { kind: 'cleaner'; name: string }
    | null
  >(null);
  const [confirmDeleting, setConfirmDeleting] = useState(false);

  const handleConfirmDelete = async () => {
    if (!pendingDelete) return;
    setConfirmDeleting(true);
    try {
      if (pendingDelete.kind === 'telecaller') {
        const u = pendingDelete.user;
        await deleteTelecaller(u.id);
        setUsers((prev) => prev.filter((item) => item.id !== u.id));
        onNotify(`Removed telecaller "${u.name}".`);
      } else if (pendingDelete.kind === 'city') {
        const cities = await deleteCity(pendingDelete.name);
        onConfigChange({ ...config, cities });
        onNotify(`Removed city "${pendingDelete.name}".`);
      } else if (pendingDelete.kind === 'cleaner') {
        const res = await deleteCleaner(pendingDelete.name);
        onConfigChange({
          ...config,
          cleaners: res.cleaners,
          cleanerProfiles: res.cleanerProfiles,
        });
        onNotify(`Removed cleaner "${pendingDelete.name}".`);
      }
      setPendingDelete(null);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Delete failed', 'error');
    } finally {
      setConfirmDeleting(false);
    }
  };

  const handleAddCity = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCity.trim()) return;
    setCitySubmitting(true);
    try {
      const cities = await addCity(newCity.trim());
      onConfigChange({ ...config, cities });
      setNewCity('');
      onNotify(`City "${newCity.trim()}" added to dropdown.`);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Failed to add city', 'error');
    } finally {
      setCitySubmitting(false);
    }
  };

  const handleRemoveCity = (city: string) => {
    setPendingDelete({ kind: 'city', name: city });
  };

  const handleAddCleaner = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCleaner.trim()) return;
    const cleanPhone = newCleanerPhone.replace(/\D/g, '');
    if (cleanPhone && cleanPhone.length !== 10) {
      onNotify('Phone number must be exactly 10 digits.', 'error');
      return;
    }
    setCleanerSubmitting(true);
    try {
      const res = await addCleaner(
        newCleaner.trim(),
        cleanPhone,
        newCleanerCity.trim()
      );
      onConfigChange({
        ...config,
        cleaners: res.cleaners,
        cleanerProfiles: res.cleanerProfiles,
      });
      setNewCleaner('');
      setNewCleanerPhone('');
      onNotify(`Cleaner "${newCleaner.trim()}" added to dropdown.`);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Failed to add cleaner', 'error');
    } finally {
      setCleanerSubmitting(false);
    }
  };

  const handleSaveCleanerProfile = async (cleanerName: string) => {
    const cleanPhone = editCleanerPhone.replace(/\D/g, '');
    if (cleanPhone && cleanPhone.length !== 10) {
      onNotify('Phone number must be exactly 10 digits.', 'error');
      return;
    }
    try {
      const cleanerProfiles = await updateCleanerProfile(cleanerName, {
        phone: cleanPhone,
        city: editCleanerCity.trim(),
      });
      onConfigChange({ ...config, cleanerProfiles });
      setEditingCleaner(null);
      onNotify(`Updated ${cleanerName}'s phone & city.`);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Could not update cleaner', 'error');
    }
  };

  const handleRemoveCleaner = (cleaner: string) => {
    setPendingDelete({ kind: 'cleaner', name: cleaner });
  };

  const getOrderCounts = (userId: string) => {
    const userOrders = orders.filter((o) => o.createdById === userId);
    const activeCount = userOrders.filter((o) => o.status === 'active').length;
    const completedCount = userOrders.filter((o) => o.status === 'completed').length;
    return { activeCount, completedCount, total: userOrders.length };
  };

  const buildHostingerPayload = () => ({
    mode: hMode,
    autoSync: hAutoSync,
    mysqlHost: hMysqlHost.trim(),
    mysqlPort: Number(hMysqlPort) || 3306,
    mysqlDatabase: hMysqlDatabase.trim(),
    mysqlUser: hMysqlUser.trim(),
    ...(hMysqlPassword ? { mysqlPassword: hMysqlPassword } : {}),
    webhookUrl: hWebhookUrl.trim(),
    ...(hWebhookSecret ? { webhookSecret: hWebhookSecret } : {}),
  });

  const handleSaveHostinger = async (e: React.FormEvent) => {
    e.preventDefault();
    setHBusy(true);
    try {
      const saved = await saveHostingerConfig(buildHostingerPayload());
      setHHasMysqlPass(saved.hasMysqlPassword);
      setHHasWebhookSecret(saved.hasWebhookSecret);
      setHMysqlPassword('');
      setHWebhookSecret('');
      onNotify('Hostinger sync settings saved.');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Could not save Hostinger settings', 'error');
    } finally {
      setHBusy(false);
    }
  };

  const handleTestHostinger = async () => {
    setHBusy(true);
    try {
      const res = await testHostingerConnection(buildHostingerPayload());
      onNotify(res.message);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Hostinger connection failed', 'error');
    } finally {
      setHBusy(false);
    }
  };

  const handleSyncNowHostinger = async () => {
    setHBusy(true);
    try {
      await saveHostingerConfig(buildHostingerPayload());
      const res = await syncToHostingerNow();
      setHLastSyncedAt(res.lastSyncedAt);
      onNotify(res.message);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Hostinger sync failed', 'error');
    } finally {
      setHBusy(false);
    }
  };

  const handlePullHostinger = async () => {
    setHBusy(true);
    try {
      await saveHostingerConfig(buildHostingerPayload());
      const res = await pullFromHostingerMysql();
      onOrdersPull(res.orders);
      onNotify(`Pulled ${res.addedCount} new orders from Hostinger MySQL.`);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Hostinger pull failed', 'error');
    } finally {
      setHBusy(false);
    }
  };

  const handleDownloadHostingerZip = async () => {
    setHZipDownloading(true);
    try {
      await downloadHostingerReadyZip();
      onNotify('Final Hostinger ZIP downloaded! Upload to public_html & click Extract.');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Hostinger ZIP build failed', 'error');
    } finally {
      setHZipDownloading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Excel Data Import / Export & Hostinger Sync */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Excel Import & Export Card */}
        <div className="bg-white border border-[#DCE4E0] rounded-xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-[#DCE4E0] bg-[#EFF4F1] flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FileSpreadsheet className="w-4 h-4 text-[#075E54]" />
              <h3 className="font-display text-sm font-bold text-slate-900">
                Excel Data Import & Export
              </h3>
            </div>
            <span className="text-xs font-mono-num text-slate-500">{orders.length} Orders</span>
          </div>

          <div className="p-4 space-y-3 text-xs text-slate-600">
            <p>
              Import your existing Excel sheets (.xlsx, .xls, .csv) directly into OrderDesk, or download all orders as an Excel workbook or JSON backup.
            </p>
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button
                type="button"
                onClick={() => setImportModalOpen(true)}
                className="px-3.5 py-2 text-xs font-semibold bg-[#128C7E] hover:bg-[#075E54] text-white rounded-lg inline-flex items-center gap-1.5 cursor-pointer"
              >
                <Upload className="w-3.5 h-3.5" />
                Import Excel (.xlsx / .csv)
              </button>

              <button
                type="button"
                onClick={() =>
                  exportOrdersToExcel(
                    orders,
                    `orderdesk-all-orders-${new Date().toISOString().slice(0, 10)}.xlsx`
                  )
                }
                className="px-3.5 py-2 text-xs font-semibold bg-white border border-[#DCE4E0] hover:bg-slate-50 text-slate-800 rounded-lg inline-flex items-center gap-1.5 cursor-pointer"
              >
                <Download className="w-3.5 h-3.5 text-[#075E54]" />
                Export All Excel (.xlsx)
              </button>

              <button
                type="button"
                onClick={downloadExcelTemplate}
                className="px-3 py-2 text-xs font-medium bg-white border border-[#DCE4E0] hover:bg-slate-50 text-slate-700 rounded-lg inline-flex items-center gap-1.5 cursor-pointer"
              >
                Sample Template
              </button>

              <button
                type="button"
                onClick={() =>
                  downloadFullBackupJson().catch((e) =>
                    onNotify(e instanceof Error ? e.message : 'Backup download failed', 'error')
                  )
                }
                className="px-3 py-2 text-xs font-medium bg-white border border-[#DCE4E0] hover:bg-slate-50 text-slate-700 rounded-lg inline-flex items-center gap-1.5 cursor-pointer"
              >
                JSON Backup
              </button>
            </div>
          </div>
        </div>

        {/* Hostinger Database / Website Sync Card */}
        <div className="bg-white border border-[#DCE4E0] rounded-xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-[#DCE4E0] bg-[#EFF4F1] flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Database className="w-4 h-4 text-[#075E54]" />
              <h3 className="font-display text-sm font-bold text-slate-900">
                Hostinger Sync (MySQL / Website PHP)
              </h3>
            </div>
            {hLastSyncedAt && (
              <span className="text-[11px] font-mono-num text-slate-500">
                Last: {new Date(hLastSyncedAt).toLocaleString('en-IN')}
              </span>
            )}
          </div>

          <div className="p-4 bg-[#F7F9F8] border-b border-[#DCE4E0] space-y-2.5 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-semibold text-slate-900">
                  Direct Upload Bundle (No npm install / No Node needed)
                </p>
                <p className="text-[11px] text-slate-600 mt-0.5">
                  Upload ZIP in <span className="font-mono-num font-semibold">public_html</span> → Extract → Open Domain. Includes built app, <span className="font-mono-num">api.php</span>, <span className="font-mono-num">database.sql</span> (MySQL) &amp; <span className="font-mono-num">data/portal-db.json</span> ({orders.length} orders).
                </p>
              </div>
              <button
                type="button"
                disabled={hZipDownloading}
                onClick={handleDownloadHostingerZip}
                className="px-3.5 py-2 text-xs font-semibold bg-[#075E54] hover:bg-[#054A42] disabled:opacity-60 text-white rounded-lg inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
              >
                <Download className="w-3.5 h-3.5" />
                {hZipDownloading ? 'Preparing ZIP...' : 'Download Final Hostinger ZIP'}
              </button>
            </div>
          </div>

          <form onSubmit={handleSaveHostinger} className="p-4 space-y-3 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="inline-flex rounded border border-[#DCE4E0] bg-white overflow-hidden">
                {[
                  { id: 'none', label: 'Off' },
                  { id: 'mysql', label: 'Hostinger MySQL' },
                  { id: 'webhook', label: 'Hostinger PHP URL' },
                ].map((opt, idx) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setHMode(opt.id as 'none' | 'mysql' | 'webhook')}
                    className={`px-3 py-1.5 font-semibold cursor-pointer ${
                      idx > 0 ? 'border-l border-[#DCE4E0]' : ''
                    } ${
                      hMode === opt.id
                        ? 'bg-[#075E54] text-white'
                        : 'bg-white text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              <label className="inline-flex items-center gap-1.5 text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={hAutoSync}
                  onChange={(e) => setHAutoSync(e.target.checked)}
                  className="accent-[#128C7E]"
                />
                <span>Auto-sync every order</span>
              </label>
            </div>

            {hMode === 'mysql' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <input
                  type="text"
                  value={hMysqlHost}
                  onChange={(e) => setHMysqlHost(e.target.value)}
                  placeholder="MySQL Host (e.g. srv123.hstgr.io)"
                  className="px-2.5 py-1.5 border border-[#DCE4E0] rounded bg-[#F7F9F8] focus:bg-white focus:outline-none focus:border-[#128C7E]"
                />
                <input
                  type="number"
                  value={hMysqlPort}
                  onChange={(e) => setHMysqlPort(e.target.value)}
                  placeholder="Port (3306)"
                  className="px-2.5 py-1.5 font-mono-num border border-[#DCE4E0] rounded bg-[#F7F9F8] focus:bg-white focus:outline-none focus:border-[#128C7E]"
                />
                <input
                  type="text"
                  value={hMysqlDatabase}
                  onChange={(e) => setHMysqlDatabase(e.target.value)}
                  placeholder="Database Name (u12345_db)"
                  className="px-2.5 py-1.5 border border-[#DCE4E0] rounded bg-[#F7F9F8] focus:bg-white focus:outline-none focus:border-[#128C7E]"
                />
                <input
                  type="text"
                  value={hMysqlUser}
                  onChange={(e) => setHMysqlUser(e.target.value)}
                  placeholder="MySQL Username"
                  className="px-2.5 py-1.5 border border-[#DCE4E0] rounded bg-[#F7F9F8] focus:bg-white focus:outline-none focus:border-[#128C7E]"
                />
                <input
                  type="password"
                  value={hMysqlPassword}
                  onChange={(e) => setHMysqlPassword(e.target.value)}
                  placeholder={hHasMysqlPass ? 'Password saved (leave blank to keep)' : 'MySQL Password'}
                  className="sm:col-span-2 px-2.5 py-1.5 border border-[#DCE4E0] rounded bg-[#F7F9F8] focus:bg-white focus:outline-none focus:border-[#128C7E]"
                />
              </div>
            )}

            {hMode === 'webhook' && (
              <div className="space-y-2">
                <input
                  type="url"
                  value={hWebhookUrl}
                  onChange={(e) => setHWebhookUrl(e.target.value)}
                  placeholder="https://yourdomain.com/orderdesk-sync.php"
                  className="w-full px-2.5 py-1.5 border border-[#DCE4E0] rounded bg-[#F7F9F8] focus:bg-white focus:outline-none focus:border-[#128C7E]"
                />
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="password"
                    value={hWebhookSecret}
                    onChange={(e) => setHWebhookSecret(e.target.value)}
                    placeholder={
                      hHasWebhookSecret
                        ? 'Secret saved (leave blank to keep)'
                        : 'Optional Sync Secret'
                    }
                    className="flex-1 min-w-[180px] px-2.5 py-1.5 border border-[#DCE4E0] rounded bg-[#F7F9F8] focus:bg-white focus:outline-none focus:border-[#128C7E]"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      downloadHostingerPhpScript().catch((e) =>
                        onNotify(e instanceof Error ? e.message : 'Download failed', 'error')
                      )
                    }
                    className="px-3 py-1.5 text-xs font-medium bg-white border border-[#DCE4E0] hover:bg-slate-50 text-slate-700 rounded inline-flex items-center gap-1 cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Download orderdesk-sync.php
                  </button>
                </div>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button
                type="submit"
                disabled={hBusy}
                className="px-3 py-1.5 text-xs font-semibold bg-white border border-[#DCE4E0] hover:bg-slate-50 text-slate-800 rounded-lg cursor-pointer"
              >
                Save Settings
              </button>

              {hMode !== 'none' && (
                <>
                  <button
                    type="button"
                    disabled={hBusy}
                    onClick={handleTestHostinger}
                    className="px-3 py-1.5 text-xs font-medium bg-white border border-[#DCE4E0] hover:bg-slate-50 text-slate-700 rounded-lg cursor-pointer"
                  >
                    Test Connection
                  </button>
                  <button
                    type="button"
                    disabled={hBusy}
                    onClick={handleSyncNowHostinger}
                    className="px-3.5 py-1.5 text-xs font-semibold bg-[#128C7E] hover:bg-[#075E54] disabled:opacity-50 text-white rounded-lg inline-flex items-center gap-1 cursor-pointer"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    Push Data to Hostinger
                  </button>
                  {hMode === 'mysql' && (
                    <button
                      type="button"
                      disabled={hBusy}
                      onClick={handlePullHostinger}
                      className="px-3 py-1.5 text-xs font-medium bg-white border border-[#DCE4E0] hover:bg-slate-50 text-slate-700 rounded-lg cursor-pointer"
                    >
                      Pull from Hostinger
                    </button>
                  )}
                </>
              )}
            </div>
          </form>
        </div>
      </div>

      {/* Super Admin Dropdown Management: Cities & Cleaners */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* City Dropdown Manager */}
        <div className="bg-white border border-[#DCE4E0] rounded-xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-[#DCE4E0] bg-[#EFF4F1] flex items-center justify-between">
            <div className="flex items-center gap-2">
              <MapPin className="w-4 h-4 text-[#075E54]" />
              <h3 className="font-display text-sm font-bold text-slate-900">
                City Dropdown Options ({config.cities.length})
              </h3>
            </div>
            <span className="text-xs text-slate-500">Super Admin Only</span>
          </div>

          <div className="p-4 space-y-3">
            <form onSubmit={handleAddCity} className="flex items-center gap-2">
              <input
                type="text"
                value={newCity}
                onChange={(e) => setNewCity(e.target.value)}
                placeholder="Add new city (e.g. Amritsar)"
                className="flex-1 px-3 py-2 text-sm bg-white border border-[#DCE4E0] rounded-lg focus:outline-none focus:border-[#128C7E]"
              />
              <button
                type="submit"
                disabled={citySubmitting || !newCity.trim()}
                className="px-4 py-2 bg-[#128C7E] hover:bg-[#075E54] disabled:opacity-50 text-white text-xs font-semibold rounded-lg flex items-center gap-1 cursor-pointer whitespace-nowrap"
              >
                <Plus className="w-3.5 h-3.5" />
                Add City
              </button>
            </form>

            <div className="border border-[#DCE4E0] rounded-lg divide-y divide-[#DCE4E0] max-h-60 overflow-y-auto">
              {config.cities.map((city, i) => (
                <div
                  key={city}
                  className="px-3.5 py-2 flex items-center justify-between text-sm hover:bg-[#F7F9F8]"
                >
                  <span className="text-slate-800">
                    <span className="font-mono-num text-xs text-slate-400 mr-2">{i + 1}.</span>
                    {city}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleRemoveCity(city)}
                    title={`Remove ${city}`}
                    className="p-1 text-slate-400 hover:text-red-600 rounded cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Cleaner Dropdown Manager */}
        <div className="bg-white border border-[#DCE4E0] rounded-xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-[#DCE4E0] bg-[#EFF4F1] flex items-center justify-between">
            <div className="flex items-center gap-2">
              <UserCog className="w-4 h-4 text-[#075E54]" />
              <h3 className="font-display text-sm font-bold text-slate-900">
                Cleaner Dropdown Options ({config.cleaners.length})
              </h3>
            </div>
            <span className="text-xs text-slate-500">Super Admin Only</span>
          </div>

          <div className="p-4 space-y-3">
            <form onSubmit={handleAddCleaner} className="grid grid-cols-1 sm:grid-cols-12 gap-2">
              <input
                type="text"
                value={newCleaner}
                onChange={(e) => setNewCleaner(e.target.value)}
                placeholder="Cleaner name"
                className="sm:col-span-4 px-3 py-2 text-sm bg-white border border-[#DCE4E0] rounded-lg focus:outline-none focus:border-[#128C7E]"
              />
              <input
                type="text"
                inputMode="numeric"
                minLength={10}
                maxLength={10}
                pattern="\d{10}"
                title="Minimum 10, maximum 10 digits"
                value={newCleanerPhone}
                onChange={(e) => setNewCleanerPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
                placeholder="10-digit phone"
                className="sm:col-span-3 px-3 py-2 text-sm font-mono-num bg-white border border-[#DCE4E0] rounded-lg focus:outline-none focus:border-[#128C7E]"
              />
              <select
                value={newCleanerCity}
                onChange={(e) => setNewCleanerCity(e.target.value)}
                className="sm:col-span-3 px-2.5 py-2 text-sm bg-white border border-[#DCE4E0] rounded-lg focus:outline-none focus:border-[#128C7E]"
              >
                {config.cities.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <button
                type="submit"
                disabled={cleanerSubmitting || !newCleaner.trim()}
                className="sm:col-span-2 px-3 py-2 bg-[#128C7E] hover:bg-[#075E54] disabled:opacity-50 text-white text-xs font-semibold rounded-lg flex items-center justify-center gap-1 cursor-pointer whitespace-nowrap"
              >
                <Plus className="w-3.5 h-3.5" />
                Add
              </button>
            </form>

            <div className="border border-[#DCE4E0] rounded-lg divide-y divide-[#DCE4E0] max-h-60 overflow-y-auto">
              {config.cleaners.map((cleaner, i) => {
                const prof = config.cleanerProfiles?.[cleaner];
                const isEditing = editingCleaner === cleaner;
                return (
                  <div
                    key={cleaner}
                    className="px-3.5 py-2 text-sm hover:bg-[#F7F9F8]"
                  >
                    {isEditing ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-slate-900 mr-1">{cleaner}</span>
                        <input
                          type="text"
                          inputMode="numeric"
                          minLength={10}
                          maxLength={10}
                          pattern="\d{10}"
                          title="Minimum 10, maximum 10 digits"
                          value={editCleanerPhone}
                          onChange={(e) =>
                            setEditCleanerPhone(e.target.value.replace(/\D/g, '').slice(0, 10))
                          }
                          placeholder="10-digit phone"
                          className="px-2 py-1 text-xs font-mono-num border border-[#128C7E] rounded bg-white w-32"
                        />
                        <select
                          value={editCleanerCity}
                          onChange={(e) => setEditCleanerCity(e.target.value)}
                          className="px-2 py-1 text-xs border border-[#128C7E] rounded bg-white"
                        >
                          <option value="">City</option>
                          {config.cities.map((c) => (
                            <option key={c} value={c}>
                              {c}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => handleSaveCleanerProfile(cleaner)}
                          className="px-2.5 py-1 text-xs font-semibold bg-[#128C7E] text-white rounded cursor-pointer"
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingCleaner(null)}
                          className="px-2 py-1 text-xs text-slate-600 cursor-pointer"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <span className="text-slate-800 font-medium">
                            <span className="font-mono-num text-xs text-slate-400 mr-2 font-normal">
                              {i + 1}.
                            </span>
                            {cleaner}
                          </span>
                          <span className="ml-2 text-xs text-slate-500 font-mono-num inline-flex items-center gap-2">
                            {prof?.phone && (
                              <span className="inline-flex items-center gap-0.5">
                                <Phone className="w-3 h-3" />
                                {prof.phone}
                              </span>
                            )}
                            {prof?.city && <span>· {prof.city}</span>}
                          </span>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => {
                              setEditingCleaner(cleaner);
                              setEditCleanerPhone(prof?.phone || '');
                              setEditCleanerCity(prof?.city || config.cities[0] || '');
                            }}
                            className="px-2 py-0.5 text-[11px] font-medium text-[#075E54] hover:bg-[#EFF4F1] rounded cursor-pointer"
                          >
                            Edit Info
                          </button>
                          <button
                            type="button"
                            onClick={() => handleRemoveCleaner(cleaner)}
                            title={`Remove ${cleaner}`}
                            className="p-1 text-slate-400 hover:text-red-600 rounded cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Add New Telecaller */}
      <div className="bg-white border border-[#DCE4E0] rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="font-display text-base font-bold text-slate-900">
              Add New Telecaller
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Create a login account for a new telecaller to start entering orders immediately.
            </p>
          </div>
        </div>

        <form onSubmit={handleAddTelecaller} className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Full Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Priya Sharma"
              className="w-full px-3 py-2 text-sm bg-white border border-[#DCE4E0] rounded-lg focus:outline-none focus:border-[#128C7E]"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Login Username</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="e.g. priya"
              className="w-full px-3 py-2 text-sm bg-white border border-[#DCE4E0] rounded-lg focus:outline-none focus:border-[#128C7E]"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Password</label>
            <input
              type="text"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="e.g. priya22@"
              className="w-full px-3 py-2 text-sm bg-white border border-[#DCE4E0] rounded-lg focus:outline-none focus:border-[#128C7E]"
            />
          </div>
          <div className="flex items-end">
            <button
              type="submit"
              disabled={submitting}
              className="w-full py-2 px-4 bg-[#128C7E] hover:bg-[#075E54] disabled:opacity-60 text-white text-sm font-semibold rounded-lg flex items-center justify-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
            >
              <Plus className="w-4 h-4" />
              {submitting ? 'Adding...' : 'Add Telecaller'}
            </button>
          </div>
        </form>
      </div>

      {/* Telecallers Table */}
      <div className="bg-white border border-[#DCE4E0] rounded-xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-[#DCE4E0] bg-[#EFF4F1] flex items-center justify-between">
          <h3 className="font-display text-sm font-bold text-slate-900">
            Team Accounts ({users.length})
          </h3>
          <span className="text-xs text-slate-500">Super Admin Access Control</span>
        </div>

        {loading ? (
          <div className="p-8 text-center text-sm text-slate-500">Loading accounts...</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[#DCE4E0] bg-[#F7F9F8] text-xs font-semibold text-slate-600">
                  <th className="py-2.5 px-4">S.No</th>
                  <th className="py-2.5 px-4">Name</th>
                  <th className="py-2.5 px-4">Login ID</th>
                  <th className="py-2.5 px-4">Role</th>
                  <th className="py-2.5 px-4 text-right">Active Orders</th>
                  <th className="py-2.5 px-4 text-right">Completed</th>
                  <th className="py-2.5 px-4">Status</th>
                  <th className="py-2.5 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#DCE4E0] text-sm">
                {users.map((u, idx) => {
                  const counts = getOrderCounts(u.id);
                  return (
                    <tr key={u.id} className="hover:bg-[#F2F8F5] transition-colors">
                      <td className="py-2.5 px-4 font-mono-num text-xs text-slate-500">
                        {idx + 1}
                      </td>
                      <td className="py-2.5 px-4 font-medium text-slate-900">{u.name}</td>
                      <td className="py-2.5 px-4 font-mono-num text-xs text-slate-700">
                        {u.username}
                      </td>
                      <td className="py-2.5 px-4 text-xs text-slate-600">
                        {u.role === 'super_admin' ? (
                          <span className="inline-flex items-center gap-1 font-semibold text-[#075E54]">
                            <ShieldCheck className="w-3.5 h-3.5" />
                            Super Admin
                          </span>
                        ) : (
                          'Telecaller'
                        )}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono-num text-slate-800">
                        {counts.activeCount}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono-num text-[#16A34A]">
                        {counts.completedCount}
                      </td>
                      <td className="py-2.5 px-4 text-xs">
                        {u.active ? (
                          <span className="text-[#16A34A] font-medium">Active</span>
                        ) : (
                          <span className="text-red-600 font-medium">Disabled</span>
                        )}
                      </td>
                      <td className="py-2.5 px-4 text-right">
                        {u.role === 'super_admin' ? (
                          <span className="text-xs text-slate-400">Protected</span>
                        ) : (
                          <div className="inline-flex items-center justify-end gap-1.5">
                            {resetTargetId === u.id ? (
                              <div className="flex items-center gap-1">
                                <input
                                  type="text"
                                  value={newPassword}
                                  onChange={(e) => setNewPassword(e.target.value)}
                                  placeholder="New pass"
                                  className="w-24 px-2 py-1 text-xs border border-[#DCE4E0] rounded bg-white"
                                />
                                <button
                                  type="button"
                                  onClick={() => handleResetPassword(u.id)}
                                  className="px-2 py-1 text-xs bg-[#128C7E] text-white rounded hover:bg-[#075E54] cursor-pointer"
                                >
                                  Save
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setResetTargetId(null);
                                    setNewPassword('');
                                  }}
                                  className="px-2 py-1 text-xs bg-slate-100 text-slate-600 rounded hover:bg-slate-200 cursor-pointer"
                                >
                                  Cancel
                                </button>
                              </div>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setResetTargetId(u.id);
                                    setNewPassword('');
                                  }}
                                  title="Reset Password"
                                  className="p-1.5 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded cursor-pointer"
                                >
                                  <KeyRound className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleToggleActive(u)}
                                  title={u.active ? 'Disable Account' : 'Enable Account'}
                                  className="p-1.5 text-slate-500 hover:text-[#075E54] hover:bg-slate-100 rounded cursor-pointer"
                                >
                                  {u.active ? (
                                    <UserX className="w-3.5 h-3.5" />
                                  ) : (
                                    <UserCheck className="w-3.5 h-3.5" />
                                  )}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setPendingDelete({ kind: 'telecaller', user: u })}
                                  title="Delete Telecaller"
                                  className="p-1.5 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded cursor-pointer"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="Confirm Delete"
        message={
          pendingDelete?.kind === 'telecaller'
            ? `Are you sure you want to delete telecaller "${pendingDelete.user.name}"?`
            : pendingDelete?.kind === 'city'
            ? `Are you sure you want to remove city "${pendingDelete.name}" from the dropdown?`
            : pendingDelete?.kind === 'cleaner'
            ? `Are you sure you want to remove cleaner "${pendingDelete.name}" from the dropdown?`
            : ''
        }
        confirmLabel="Yes, Delete"
        cancelLabel="No, Cancel"
        loading={confirmDeleting}
        onCancel={() => setPendingDelete(null)}
        onConfirm={handleConfirmDelete}
      />
      <ExcelImportModal
        open={importModalOpen}
        config={config}
        onClose={() => setImportModalOpen(false)}
        onImport={onBulkImport}
        onNotify={onNotify}
      />
    </div>
  );
};
