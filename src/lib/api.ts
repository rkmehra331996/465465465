import type {
  BulkImportOrderRow,
  BulkImportResult,
  CleanerProfile,
  DuplicateOrderMatch,
  HostingerSettingsPublic,
  NewOrderPayload,
  Order,
  PaymentStatus,
  PortalConfig,
  TranslateTarget,
  UserPublic,
} from '../types';

const TOKEN_STORAGE_KEY = 'orderdesk_auth_token';

export function getStoredToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setStoredToken(token: string | null): void {
  try {
    if (token) {
      localStorage.setItem(TOKEN_STORAGE_KEY, token);
    } else {
      localStorage.removeItem(TOKEN_STORAGE_KEY);
    }
  } catch {
    // Ignore storage errors in restricted environments
  }
}

function toRelativeApiUrl(url: string): string {
  return url.startsWith('/api/') ? `.${url}` : url;
}

function buildPhpFallbackUrl(url: string): string {
  const [pathPart, queryPart] = url.split('?');
  const route = pathPart.startsWith('/api/') ? pathPart : `/${pathPart.replace(/^\/+/, '')}`;
  const qs = new URLSearchParams(queryPart || '');
  qs.set('__route', route);
  return `./api.php?${qs.toString()}`;
}

async function apiFetch<T>(url: string, options: RequestInit = {}): Promise<T> {
  const token = getStoredToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> | undefined),
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const reqInit: RequestInit = {
    ...options,
    headers,
    credentials: 'include',
  };

  let res = await fetch(toRelativeApiUrl(url), reqInit);
  const ct = (res.headers.get('content-type') || '').toLowerCase();
  if ((res.status === 404 || !ct.includes('application/json')) && url.startsWith('/api/')) {
    const phpRes = await fetch(buildPhpFallbackUrl(url), reqInit);
    const phpCt = (phpRes.headers.get('content-type') || '').toLowerCase();
    if (phpCt.includes('application/json')) {
      res = phpRes;
    }
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { error?: string }).error || `Request failed (${res.status})`);
  }
  return data as T;
}

export async function login(username: string, password: string): Promise<{ token: string; user: UserPublic }> {
  const res = await apiFetch<{ token: string; user: UserPublic }>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
  setStoredToken(res.token);
  return res;
}

export async function logout(): Promise<void> {
  try {
    await apiFetch('/api/auth/logout', { method: 'POST' });
  } finally {
    setStoredToken(null);
  }
}

export async function getMe(): Promise<UserPublic> {
  const res = await apiFetch<{ user: UserPublic }>('/api/auth/me');
  return res.user;
}

export async function getConfig(): Promise<PortalConfig> {
  return apiFetch<PortalConfig>('/api/config');
}

export async function addCity(name: string): Promise<string[]> {
  const res = await apiFetch<{ cities: string[] }>('/api/config/cities', {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
  return res.cities;
}

export async function deleteCity(name: string): Promise<string[]> {
  const res = await apiFetch<{ cities: string[] }>(
    `/api/config/cities/${encodeURIComponent(name)}`,
    { method: 'DELETE' }
  );
  return res.cities;
}

export async function addCleaner(
  name: string,
  phone?: string,
  city?: string
): Promise<{ cleaners: string[]; cleanerProfiles: Record<string, CleanerProfile> }> {
  return apiFetch<{ cleaners: string[]; cleanerProfiles: Record<string, CleanerProfile> }>(
    '/api/config/cleaners',
    {
      method: 'POST',
      body: JSON.stringify({ name, phone, city }),
    }
  );
}

export async function updateCleanerProfile(
  name: string,
  profile: CleanerProfile
): Promise<Record<string, CleanerProfile>> {
  const res = await apiFetch<{ cleanerProfiles: Record<string, CleanerProfile> }>(
    `/api/config/cleaners/${encodeURIComponent(name)}`,
    {
      method: 'PATCH',
      body: JSON.stringify(profile),
    }
  );
  return res.cleanerProfiles;
}

export async function deleteCleaner(
  name: string
): Promise<{ cleaners: string[]; cleanerProfiles: Record<string, CleanerProfile> }> {
  return apiFetch<{ cleaners: string[]; cleanerProfiles: Record<string, CleanerProfile> }>(
    `/api/config/cleaners/${encodeURIComponent(name)}`,
    { method: 'DELETE' }
  );
}

export async function getOrders(): Promise<Order[]> {
  const res = await apiFetch<{ orders: Order[] }>('/api/orders');
  return res.orders;
}

export async function checkDuplicateNumber(number: string): Promise<DuplicateOrderMatch[]> {
  const res = await apiFetch<{ matches: DuplicateOrderMatch[] }>(
    `/api/orders/check-duplicate?number=${encodeURIComponent(number)}`
  );
  return res.matches;
}

export async function createOrder(payload: NewOrderPayload): Promise<Order> {
  const res = await apiFetch<{ order: Order }>('/api/orders', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return res.order;
}

export async function updateOrder(id: string, patch: Partial<Order>): Promise<Order> {
  const res = await apiFetch<{ order: Order }>(`/api/orders/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
  return res.order;
}

export async function deleteOrder(id: string): Promise<void> {
  await apiFetch(`/api/orders/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

export async function bulkCompleteOrders(ids: string[]): Promise<void> {
  await apiFetch('/api/orders/bulk-complete', {
    method: 'POST',
    body: JSON.stringify({ ids }),
  });
}

export async function bulkUpdatePayment(
  ids: string[],
  paymentStatus: PaymentStatus,
  paymentNote?: string
): Promise<Order[]> {
  const res = await apiFetch<{ ok: boolean; orders?: Order[] }>('/api/orders/bulk-payment', {
    method: 'POST',
    body: JSON.stringify({ ids, paymentStatus, paymentNote }),
  });
  return res.orders || [];
}

export async function bulkUpdatePartialPayments(
  updates: Array<{ id: string; paidCommission: number; paymentNote?: string }>
): Promise<Order[]> {
  const res = await apiFetch<{ ok: boolean; orders?: Order[] }>('/api/orders/bulk-payment', {
    method: 'POST',
    body: JSON.stringify({ updates }),
  });
  return res.orders || [];
}

export async function bulkImportOrders(payload: {
  rows: BulkImportOrderRow[];
  autoAddDropdowns?: boolean;
  skipDuplicateNumbers?: boolean;
}): Promise<BulkImportResult> {
  return apiFetch<BulkImportResult>('/api/orders/bulk-import', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function transferOrders(
  ids: string[],
  targetUserId: string
): Promise<{
  ok: boolean;
  targetUser: { id: string; name: string };
  orders: Order[];
}> {
  return apiFetch('/api/orders/transfer', {
    method: 'POST',
    body: JSON.stringify({ ids, targetUserId }),
  });
}

export async function untransferOrders(
  ids: string[]
): Promise<{
  ok: boolean;
  orders: Order[];
}> {
  return apiFetch('/api/orders/untransfer', {
    method: 'POST',
    body: JSON.stringify({ ids }),
  });
}

export interface HostingerConfigInput {
  mode: 'none' | 'mysql' | 'webhook';
  autoSync: boolean;
  mysqlHost: string;
  mysqlPort: number;
  mysqlDatabase: string;
  mysqlUser: string;
  mysqlPassword?: string;
  webhookUrl: string;
  webhookSecret?: string;
}

export async function getHostingerConfig(): Promise<HostingerSettingsPublic> {
  const res = await apiFetch<{ config: HostingerSettingsPublic }>('/api/hostinger/config');
  return res.config;
}

export async function saveHostingerConfig(
  payload: HostingerConfigInput
): Promise<HostingerSettingsPublic> {
  const res = await apiFetch<{ config: HostingerSettingsPublic }>('/api/hostinger/config', {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
  return res.config;
}

export async function testHostingerConnection(
  payload: HostingerConfigInput
): Promise<{ ok: boolean; message: string }> {
  return apiFetch<{ ok: boolean; message: string }>('/api/hostinger/test', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function syncToHostingerNow(): Promise<{
  ok: boolean;
  syncedCount: number;
  lastSyncedAt: string;
  message: string;
}> {
  return apiFetch('/api/hostinger/sync', { method: 'POST' });
}

export async function pullFromHostingerMysql(): Promise<{
  ok: boolean;
  addedCount: number;
  orders: Order[];
}> {
  return apiFetch('/api/hostinger/pull', { method: 'POST' });
}

async function downloadAuthedFile(url: string, fallbackFilename: string): Promise<void> {
  const token = getStoredToken();
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const reqUrl = toRelativeApiUrl(url);
  let res = await fetch(reqUrl, { headers, credentials: 'include', cache: 'no-store' });
  const ct = (res.headers.get('content-type') || '').toLowerCase();
  if ((res.status === 404 || ct.includes('text/html')) && url.startsWith('/api/')) {
    res = await fetch(buildPhpFallbackUrl(url), {
      headers,
      credentials: 'include',
      cache: 'no-store',
    });
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || `Download failed (${res.status})`);
  }
  const blob = await res.blob();
  const objUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objUrl;
  link.setAttribute('download', fallbackFilename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(objUrl);
}

export async function downloadHostingerPhpScript(): Promise<void> {
  await downloadAuthedFile(`/api/hostinger/php-script?_t=${Date.now()}`, 'orderdesk-sync.php');
}

export async function downloadHostingerReadyZip(): Promise<void> {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
  await downloadAuthedFile(
    `/api/hostinger/download-zip?_t=${Date.now()}`,
    `orderdesk-hostinger-ready-${stamp}.zip`
  );
}

export async function downloadFullBackupJson(): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  await downloadAuthedFile(
    `/api/admin/export-backup?_t=${Date.now()}`,
    `orderdesk-backup-${today}.json`
  );
}

export function getOrderTotal(o: Pick<Order, 'price' | 'extraAmount'>): number {
  return Number(o.price || 0) + Number(o.extraAmount || 0);
}

export function calcCommission30(workAmount: number): number {
  return Math.round(workAmount * 0.3 * 100) / 100;
}

export function getPaidCommission(
  o: Pick<Order, 'price' | 'extraAmount' | 'paymentStatus' | 'paidCommission'>
): number {
  const comm30 = calcCommission30(getOrderTotal(o));
  if (o.paidCommission !== undefined && o.paidCommission !== null) {
    return Math.min(comm30, Math.max(0, Number(o.paidCommission)));
  }
  return o.paymentStatus === 'clear' ? comm30 : 0;
}

export function getPendingCommission(
  o: Pick<Order, 'price' | 'extraAmount' | 'paymentStatus' | 'paidCommission'>
): number {
  const comm30 = calcCommission30(getOrderTotal(o));
  const paid = getPaidCommission(o);
  return Math.max(0, Math.round((comm30 - paid) * 100) / 100);
}

export async function getTelecallers(): Promise<UserPublic[]> {
  const res = await apiFetch<{ users: UserPublic[] }>('/api/telecallers');
  return res.users;
}

export async function createTelecaller(payload: {
  name: string;
  username: string;
  password: string;
}): Promise<UserPublic> {
  const res = await apiFetch<{ user: UserPublic }>('/api/telecallers', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return res.user;
}

export async function updateTelecaller(
  id: string,
  patch: { name?: string; active?: boolean; password?: string }
): Promise<UserPublic> {
  const res = await apiFetch<{ user: UserPublic }>(`/api/telecallers/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
  return res.user;
}

export async function deleteTelecaller(id: string): Promise<void> {
  await apiFetch(`/api/telecallers/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

export async function translateMessage(
  text: string,
  targetLanguage: TranslateTarget
): Promise<string> {
  if (targetLanguage === 'english') return text;
  const res = await apiFetch<{ translatedText: string }>('/api/translate', {
    method: 'POST',
    body: JSON.stringify({ text, targetLanguage }),
  });
  return res.translatedText;
}

export function formatWhatsAppPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 11 && digits.startsWith('0')) return `91${digits.slice(1)}`;
  return digits;
}

export function buildClientConfirmationMessage(order: Order): string {
  const customerLine = order.name ? `Hello *${order.name}*,` : 'Hello,';
  const lines = [
    customerLine,
    'Your service booking is *Confirmed*!',
    '',
    `*Service:* ${order.serviceName}`,
    `*City:* ${order.city}`,
    ...(order.bookingDate ? [`*Booking Date:* ${formatIndianDate(order.bookingDate)}`] : []),
    ...(order.address ? [`*Address:* ${order.address}`] : []),
    ...(order.qty ? [`*Qty:* ${order.qty}`] : []),
    `*Amount:* ₹${order.price}`,
    `*Assigned Technician:* ${order.cleanerName}`,
    ...(order.notes ? [`*Details:* ${order.notes}`] : []),
    '',
    'Thank you for booking with us!',
  ];
  return lines.join('\n');
}

const DIGIT_EMOJIS = ['0️⃣', '1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣'];

export function toOrderNumberEmoji(num: number): string {
  if (num === 10) return '🔟';
  return String(num)
    .split('')
    .map((ch) => DIGIT_EMOJIS[Number(ch)] ?? ch)
    .join('');
}

export function buildCleanerWhatsAppMessage(
  cleanerLabel: string,
  orders: Order[],
  compact = false
): string {
  if (orders.length === 0) return '';

  const totalQty = orders.reduce((sum, o) => sum + Number(o.qty || 0), 0);
  const totalPrice = orders.reduce((sum, o) => sum + getOrderTotal(o), 0);

  const lines: string[] = [
    `*Cleaner: ${cleanerLabel}*`,
    `*Total Orders: ${orders.length}${totalQty > 0 ? ` | Qty: ${totalQty}` : ''} | Total: ₹${totalPrice}*`,
    '--------------------------------',
  ];

  orders.forEach((order, idx) => {
    const serialEmoji = toOrderNumberEmoji(idx + 1);
    const customerLabel = order.name || (order.isExtraWork ? 'Extra / On-Site Work' : 'Customer');
    const qtyPart = order.qty ? ` | Qty: ${order.qty}` : '';
    const indianDate = order.bookingDate ? formatIndianDate(order.bookingDate) : '';
    const datePart = indianDate ? `Date: ${indianDate} | ` : '';
    const addrPart = [order.address, order.city].filter(Boolean).join(', ');
    const orderTotal = getOrderTotal(order);
    const extraPart = order.extraAmount > 0 ? ` (+₹${order.extraAmount} Extra)` : '';

    if (compact) {
      lines.push(
        `${serialEmoji} *${customerLabel}*${order.number ? ` (${order.number}${order.altNumber ? ` / ${order.altNumber}` : ''})` : ''}`,
        `${order.serviceName} | ${datePart}₹${orderTotal}${extraPart}${qtyPart}`,
        `${addrPart ? `Address: ${addrPart}` : `City: ${order.city}`}${order.notes ? ` | Note: ${order.notes}` : ''}`,
        ''
      );
    } else {
      lines.push(
        `${serialEmoji} *Customer:* ${customerLabel}`,
        ...(order.number
          ? [`Phone: ${order.number}${order.altNumber ? ` | Alt: ${order.altNumber}` : ''}`]
          : []),
        `Service: ${order.serviceName} | City: ${order.city}`,
        ...(indianDate ? [`Booking Date: ${indianDate}`] : []),
        ...(order.address ? [`Address: ${order.address}`] : []),
        `Price: ₹${orderTotal}${extraPart}${qtyPart}`,
        ...(order.notes ? [`Message: ${order.notes}`] : []),
        ''
      );
    }
  });

  lines.push('--------------------------------', `*Grand Total: ₹${totalPrice}*`);
  return lines.join('\n').trim();
}

export function exportOrdersToCsv(orders: Order[], filename: string): void {
  const headers = [
    'Serial No.',
    'Name',
    'Number',
    'Alt Number',
    'Date of Booking',
    'Service Name',
    'City',
    'Address',
    'Qty',
    'Base Price',
    'Extra Work',
    'Total Price',
    'Cleaner Name',
    'Payment Status',
    'Message',
    'Status',
    'Telecaller',
  ];

  const escapeCell = (val: string | number | null | undefined) => {
    const str = String(val ?? '');
    if (str.includes('"') || str.includes(',') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const rows = orders.map((o, idx) => [
    idx + 1,
    o.name || '',
    o.number || '',
    o.altNumber || '',
    o.bookingDate || '',
    o.serviceName,
    o.city,
    o.address || '',
    o.qty ?? '',
    o.price,
    o.extraAmount || 0,
    getOrderTotal(o),
    o.cleanerName,
    o.paymentStatus === 'clear' ? 'Clear' : 'Pending',
    o.notes ?? '',
    o.status === 'completed' ? 'Completed' : 'Active',
    o.createdByName,
  ]);

  const csvContent =
    '\uFEFF' +
    [headers, ...rows].map((row) => row.map(escapeCell).join(',')).join('\r\n');

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function getLocalDateStr(offsetDays = 0): string {
  const d = new Date(Date.now() + offsetDays * 86400000);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function formatIndianDate(dateStr?: string): string {
  if (!dateStr) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr.trim());
  if (m) {
    return `${m[3]}/${m[2]}/${m[1].slice(-2)}`;
  }
  return dateStr;
}

export function getIndianDayTag(dateStr?: string): 'Aj' | 'Kal' | 'Parso' | null {
  if (!dateStr) return null;
  if (dateStr === getLocalDateStr(0)) return 'Aj';
  if (dateStr === getLocalDateStr(1)) return 'Kal';
  if (dateStr === getLocalDateStr(2)) return 'Parso';
  return null;
}

