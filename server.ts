import 'dotenv/config';
import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import express from 'express';
import mysql from 'mysql2/promise';
import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import {
  buildHostingerApiPhp,
  buildHostingerConfigPhp,
  buildHostingerDataHtaccess,
  buildHostingerHtaccess,
  buildHostingerReadme,
  buildHostingerSqlFile,
  collectDirectoryZipEntries,
  createZipBuffer,
} from './server-hostinger-package.ts';

const execFileAsync = promisify(execFile);

type UserRole = 'super_admin' | 'telecaller';
type OrderStatus = 'active' | 'completed';
type PaymentStatus = 'pending' | 'clear';

interface StoredUser {
  id: string;
  name: string;
  username: string;
  passwordHash: string;
  phpPasswordHash?: string;
  role: UserRole;
  active: boolean;
  createdAt: string;
}

interface StoredOrder {
  id: string;
  name: string;
  number: string;
  altNumber?: string;
  bookingDate: string;
  address: string;
  serviceName: string;
  city: string;
  qty: number | null;
  price: number;
  extraAmount: number;
  cleanerName: string;
  notes?: string;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  paidCommission?: number;
  paymentClearedAt?: string;
  paymentClearedByName?: string;
  paymentNote?: string;
  isExtraWork?: boolean;
  createdById: string;
  createdByName: string;
  transferredFromId?: string;
  transferredFromName?: string;
  transferredAt?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  completedByName?: string;
}

interface CleanerProfile {
  phone: string;
  city: string;
}

type HostingerSyncMode = 'none' | 'mysql' | 'webhook';

interface HostingerConfig {
  mode: HostingerSyncMode;
  autoSync: boolean;
  mysqlHost: string;
  mysqlPort: number;
  mysqlDatabase: string;
  mysqlUser: string;
  mysqlPassword: string;
  webhookUrl: string;
  webhookSecret: string;
  lastSyncedAt?: string;
}

interface PortalDatabase {
  sessionSecret: string;
  cities: string[];
  cleaners: string[];
  cleanerProfiles: Record<string, CleanerProfile>;
  users: StoredUser[];
  orders: StoredOrder[];
  hostinger: HostingerConfig;
}

const DEFAULT_SERVICES = [
  'Water tank',
  'Dry clean',
  'Chimney',
  'Kitchen',
  'Home cleaning',
  'Bathroom',
];

const DEFAULT_CITIES = [
  'Patiala',
  'Ludhiana',
  'Jalandhar',
  'Chandigarh',
  'Moga',
  'Khanna',
  'Other',
];

const DEFAULT_CLEANERS = [
  'Jagdish',
  'Raaj',
  'Manish',
  'Gurmeet',
  'Aman',
  'Karan',
  'Arun',
];

const DATA_DIR = path.resolve(process.cwd(), 'data');
const DB_FILE = path.join(DATA_DIR, 'portal-db.json');

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

function hashPhpPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256').toString('hex');
  return `pbkdf2:${salt}:${derived}`;
}

function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split(':');
  if (parts.length !== 2) return false;
  const [salt, keyHex] = parts;
  const derived = crypto.scryptSync(password, salt, 64);
  const keyBuf = Buffer.from(keyHex, 'hex');
  if (derived.length !== keyBuf.length) return false;
  return crypto.timingSafeEqual(derived, keyBuf);
}

function todayISO(offsetDays = 0): string {
  const d = new Date(Date.now() + offsetDays * 86400000);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function createInitialDb(): PortalDatabase {
  const now = new Date().toISOString();
  const today = todayISO(0);
  const yesterday = todayISO(-1);

  const users: StoredUser[] = [
    {
      id: 'admin-1',
      name: 'RK Mehra (Super Admin)',
      username: 'rkmehra331996@gmail.com',
      passwordHash: hashPassword('Asdfzxcv@336699'),
      phpPasswordHash: hashPhpPassword('Asdfzxcv@336699'),
      role: 'super_admin',
      active: true,
      createdAt: now,
    },
    {
      id: 'tc-suhana',
      name: 'Suhana',
      username: 'suhana',
      passwordHash: hashPassword('suhana11@'),
      phpPasswordHash: hashPhpPassword('suhana11@'),
      role: 'telecaller',
      active: true,
      createdAt: now,
    },
    {
      id: 'tc-deepika',
      name: 'Deepika',
      username: 'Deepika',
      passwordHash: hashPassword('Deepika49@'),
      phpPasswordHash: hashPhpPassword('Deepika49@'),
      role: 'telecaller',
      active: true,
      createdAt: now,
    },
  ];

  const orders: StoredOrder[] = [
    {
      id: 'ord-101',
      name: 'Harpreet Singh',
      number: '9815421104',
      bookingDate: today,
      address: 'H.No. 42, Sector 19-B, Near Market',
      serviceName: 'Sofa',
      city: 'Chandigarh',
      qty: 2,
      price: 1200,
      extraAmount: 0,
      cleanerName: 'Jagdish',
      notes: '5-seater sofa deep shampooing',
      status: 'active',
      paymentStatus: 'pending',
      createdById: 'tc-suhana',
      createdByName: 'Suhana',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'ord-102',
      name: 'Gurpreet Kaur',
      number: '9876234019',
      bookingDate: today,
      address: 'Flat 304, Motia Royal City',
      serviceName: 'Chimney',
      city: 'Patiala',
      qty: 1,
      price: 750,
      extraAmount: 0,
      cleanerName: 'Jagdish',
      notes: 'Kitchen chimney & exhaust cleaning',
      status: 'active',
      paymentStatus: 'pending',
      createdById: 'tc-suhana',
      createdByName: 'Suhana',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'ord-103',
      name: 'Rajesh Sharma',
      number: '9914502288',
      bookingDate: today,
      address: 'Plot 18, Phase 7',
      serviceName: 'Bathroom',
      city: 'Chandigarh',
      qty: 3,
      price: 1800,
      extraAmount: 0,
      cleanerName: 'Jagdish',
      notes: '3BHK bathroom acid wash',
      status: 'active',
      paymentStatus: 'pending',
      createdById: 'tc-suhana',
      createdByName: 'Suhana',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'ord-104',
      name: 'Maninder Gill',
      number: '9814087654',
      bookingDate: today,
      address: 'Kothi 112, Model Town Extension',
      serviceName: 'Water tank',
      city: 'Ludhiana',
      qty: 2,
      price: 1400,
      extraAmount: 0,
      cleanerName: 'Jagdish',
      notes: 'Water tank 1000L x 2',
      status: 'active',
      paymentStatus: 'pending',
      createdById: 'tc-suhana',
      createdByName: 'Suhana',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'ord-105',
      name: 'Neelam Verma',
      number: '9417209931',
      bookingDate: today,
      address: 'Street 4, Green Park',
      serviceName: 'Sofa',
      city: 'Khanna',
      qty: 1,
      price: 650,
      extraAmount: 0,
      cleanerName: 'Jagdish',
      notes: '5-seater L-shape sofa dry clean',
      status: 'active',
      paymentStatus: 'pending',
      createdById: 'tc-suhana',
      createdByName: 'Suhana',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'ord-106',
      name: 'Amandeep Sandhu',
      number: '9855110922',
      bookingDate: today,
      address: 'H.No. 78, Urban Estate Phase 2',
      serviceName: 'Home cleaning',
      city: 'Patiala',
      qty: 4,
      price: 2200,
      extraAmount: 0,
      cleanerName: 'Jagdish',
      notes: 'Full house deep cleaning',
      status: 'active',
      paymentStatus: 'pending',
      createdById: 'tc-suhana',
      createdByName: 'Suhana',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'ord-107',
      name: 'Priya Malhotra',
      number: '9872004512',
      bookingDate: today,
      address: 'SCO 14, Model Town',
      serviceName: 'Sofa',
      city: 'Jalandhar',
      qty: 2,
      price: 1100,
      extraAmount: 0,
      cleanerName: 'Raaj',
      notes: 'Office chairs shampooing',
      status: 'active',
      paymentStatus: 'pending',
      createdById: 'tc-deepika',
      createdByName: 'Deepika',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'ord-108',
      name: 'Vikramjit Bedi',
      number: '9815098711',
      bookingDate: today,
      address: 'B-12, Main Bazaar',
      serviceName: 'Water tank',
      city: 'Moga',
      qty: 1,
      price: 900,
      extraAmount: 0,
      cleanerName: 'Manish',
      notes: 'Overhead tank cleaning',
      status: 'active',
      paymentStatus: 'pending',
      createdById: 'tc-deepika',
      createdByName: 'Deepika',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'ord-109',
      name: 'Simranjeet Kaur',
      number: '9780012345',
      bookingDate: yesterday,
      address: 'H.No. 9, Sarabha Nagar',
      serviceName: 'Chimney',
      city: 'Ludhiana',
      qty: 2,
      price: 1500,
      extraAmount: 0,
      cleanerName: 'Gurmeet',
      notes: 'Complete kitchen deep clean',
      status: 'completed',
      paymentStatus: 'pending',
      createdById: 'tc-suhana',
      createdByName: 'Suhana',
      createdAt: now,
      updatedAt: now,
      completedAt: now,
      completedByName: 'Suhana',
    },
    {
      id: 'ord-110',
      name: 'Anil Kapoor',
      number: '9814433221',
      bookingDate: yesterday,
      address: 'Flat 12, Eco City',
      serviceName: 'Bathroom',
      city: 'Chandigarh',
      qty: 3,
      price: 1650,
      extraAmount: 0,
      cleanerName: 'Aman',
      notes: '3 Washroom deep cleaning',
      status: 'completed',
      paymentStatus: 'pending',
      createdById: 'tc-deepika',
      createdByName: 'Deepika',
      createdAt: now,
      updatedAt: now,
      completedAt: now,
      completedByName: 'Deepika',
    },
  ];

  return {
    sessionSecret: crypto.randomBytes(32).toString('hex'),
    cities: DEFAULT_CITIES,
    cleaners: DEFAULT_CLEANERS,
    cleanerProfiles: {},
    users,
    orders,
    hostinger: defaultHostingerConfig(),
  };
}

function defaultHostingerConfig(): HostingerConfig {
  const envMode = process.env.HOSTINGER_SYNC_MODE;
  const mode: HostingerSyncMode =
    envMode === 'mysql' || envMode === 'webhook'
      ? envMode
      : process.env.HOSTINGER_MYSQL_HOST
      ? 'mysql'
      : process.env.HOSTINGER_WEBHOOK_URL
      ? 'webhook'
      : 'none';
  return {
    mode,
    autoSync: mode !== 'none',
    mysqlHost: process.env.HOSTINGER_MYSQL_HOST || '',
    mysqlPort: Number(process.env.HOSTINGER_MYSQL_PORT) || 3306,
    mysqlDatabase: process.env.HOSTINGER_MYSQL_DATABASE || '',
    mysqlUser: process.env.HOSTINGER_MYSQL_USER || '',
    mysqlPassword: process.env.HOSTINGER_MYSQL_PASSWORD || '',
    webhookUrl: process.env.HOSTINGER_WEBHOOK_URL || '',
    webhookSecret: process.env.HOSTINGER_WEBHOOK_SECRET || '',
  };
}

function loadDb(): PortalDatabase {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(DB_FILE)) {
    const initial = createInitialDb();
    fs.writeFileSync(DB_FILE, JSON.stringify(initial, null, 2), 'utf-8');
    return initial;
  }
  const raw = fs.readFileSync(DB_FILE, 'utf-8');
  const parsed = JSON.parse(raw) as Partial<PortalDatabase>;
  const seedPasswords: Record<string, string> = {
    'admin-1': 'Asdfzxcv@336699',
    'tc-suhana': 'suhana11@',
    'tc-deepika': 'Deepika49@',
  };

  const migrated: PortalDatabase = {
    sessionSecret: parsed.sessionSecret || crypto.randomBytes(32).toString('hex'),
    cities: Array.isArray(parsed.cities) && parsed.cities.length > 0 ? parsed.cities : DEFAULT_CITIES,
    cleaners:
      Array.isArray(parsed.cleaners) && parsed.cleaners.length > 0
        ? parsed.cleaners
        : DEFAULT_CLEANERS,
    cleanerProfiles:
      parsed.cleanerProfiles && typeof parsed.cleanerProfiles === 'object'
        ? parsed.cleanerProfiles
        : {},
    users: Array.isArray(parsed.users)
      ? parsed.users.map((u) => {
          if (!u.phpPasswordHash && seedPasswords[u.id] && verifyPassword(seedPasswords[u.id], u.passwordHash)) {
            return { ...u, phpPasswordHash: hashPhpPassword(seedPasswords[u.id]) };
          }
          return u;
        })
      : [],
    orders: Array.isArray(parsed.orders)
      ? parsed.orders.map((o) => ({
          ...o,
          serviceName: o.serviceName || 'Home cleaning',
          city: o.city || 'Other',
          extraAmount: Number.isFinite(Number(o.extraAmount)) && Number(o.extraAmount) >= 0 ? Number(o.extraAmount) : 0,
          paymentStatus: o.paymentStatus === 'clear' ? ('clear' as PaymentStatus) : ('pending' as PaymentStatus),
          paidCommission:
            o.paidCommission !== undefined && Number.isFinite(Number(o.paidCommission)) && Number(o.paidCommission) >= 0
              ? Number(o.paidCommission)
              : undefined,
        }))
      : [],
    hostinger: parsed.hostinger
      ? {
          ...defaultHostingerConfig(),
          ...parsed.hostinger,
          mysqlPort: Number(parsed.hostinger.mysqlPort) || 3306,
        }
      : defaultHostingerConfig(),
  };
  return migrated;
}

let db: PortalDatabase = loadDb();

function persistDbFile(nextDb: PortalDatabase): void {
  db = nextDb;
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  const tmpFile = `${DB_FILE}.tmp`;
  fs.writeFileSync(tmpFile, JSON.stringify(db, null, 2), 'utf-8');
  fs.renameSync(tmpFile, DB_FILE);
}

function saveDb(nextDb: PortalDatabase, skipAutoSync = false): void {
  persistDbFile(nextDb);
  if (!skipAutoSync && db.hostinger?.autoSync && db.hostinger.mode !== 'none') {
    void syncDataToHostinger(db.hostinger, db)
      .then(() => {
        persistDbFile({
          ...db,
          hostinger: { ...db.hostinger, lastSyncedAt: new Date().toISOString() },
        });
      })
      .catch((err) => {
        console.error('Hostinger background sync warning:', err instanceof Error ? err.message : err);
      });
  }
}

function toPublicHostingerConfig(h: HostingerConfig) {
  return {
    mode: h.mode,
    autoSync: Boolean(h.autoSync),
    mysqlHost: h.mysqlHost || '',
    mysqlPort: Number(h.mysqlPort) || 3306,
    mysqlDatabase: h.mysqlDatabase || '',
    mysqlUser: h.mysqlUser || '',
    hasMysqlPassword: Boolean(h.mysqlPassword),
    webhookUrl: h.webhookUrl || '',
    hasWebhookSecret: Boolean(h.webhookSecret),
    lastSyncedAt: h.lastSyncedAt,
  };
}

async function openHostingerMysqlConnection(h: HostingerConfig) {
  if (!h.mysqlHost || !h.mysqlDatabase || !h.mysqlUser) {
    throw new Error('Hostinger MySQL Host, Database, and Username are required');
  }
  return mysql.createConnection({
    host: h.mysqlHost,
    port: Number(h.mysqlPort) || 3306,
    user: h.mysqlUser,
    password: h.mysqlPassword,
    database: h.mysqlDatabase,
    connectTimeout: 8000,
  });
}

async function ensureHostingerMysqlTable(conn: mysql.Connection): Promise<void> {
  await conn.execute(`
    CREATE TABLE IF NOT EXISTS orderdesk_orders (
      id VARCHAR(64) PRIMARY KEY,
      name VARCHAR(255) NOT NULL DEFAULT '',
      number VARCHAR(64) NOT NULL DEFAULT '',
      booking_date VARCHAR(32) NOT NULL DEFAULT '',
      address TEXT,
      service_name VARCHAR(120) NOT NULL DEFAULT '',
      city VARCHAR(120) NOT NULL DEFAULT '',
      qty DOUBLE NULL,
      price DOUBLE NOT NULL DEFAULT 0,
      extra_amount DOUBLE NOT NULL DEFAULT 0,
      cleaner_name VARCHAR(120) NOT NULL DEFAULT '',
      notes TEXT,
      status VARCHAR(32) NOT NULL DEFAULT 'active',
      payment_status VARCHAR(32) NOT NULL DEFAULT 'pending',
      paid_commission DOUBLE NULL,
      payment_cleared_at VARCHAR(64) NULL,
      payment_cleared_by_name VARCHAR(120) NULL,
      payment_note TEXT,
      is_extra_work TINYINT(1) NOT NULL DEFAULT 0,
      created_by_id VARCHAR(64) NOT NULL DEFAULT '',
      created_by_name VARCHAR(120) NOT NULL DEFAULT '',
      created_at VARCHAR(64) NOT NULL DEFAULT '',
      updated_at VARCHAR(64) NOT NULL DEFAULT '',
      completed_at VARCHAR(64) NULL,
      completed_by_name VARCHAR(120) NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
}

async function syncDataToHostinger(h: HostingerConfig, snapshot: PortalDatabase): Promise<{ count: number }> {
  if (h.mode === 'mysql') {
    const conn = await openHostingerMysqlConnection(h);
    try {
      await ensureHostingerMysqlTable(conn);
      const sql = `
        INSERT INTO orderdesk_orders (
          id, name, number, booking_date, address, service_name, city, qty,
          price, extra_amount, cleaner_name, notes, status, payment_status,
          paid_commission, payment_cleared_at, payment_cleared_by_name, payment_note,
          is_extra_work, created_by_id, created_by_name, created_at, updated_at,
          completed_at, completed_by_name
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          name = VALUES(name),
          number = VALUES(number),
          booking_date = VALUES(booking_date),
          address = VALUES(address),
          service_name = VALUES(service_name),
          city = VALUES(city),
          qty = VALUES(qty),
          price = VALUES(price),
          extra_amount = VALUES(extra_amount),
          cleaner_name = VALUES(cleaner_name),
          notes = VALUES(notes),
          status = VALUES(status),
          payment_status = VALUES(payment_status),
          paid_commission = VALUES(paid_commission),
          payment_cleared_at = VALUES(payment_cleared_at),
          payment_cleared_by_name = VALUES(payment_cleared_by_name),
          payment_note = VALUES(payment_note),
          is_extra_work = VALUES(is_extra_work),
          updated_at = VALUES(updated_at),
          completed_at = VALUES(completed_at),
          completed_by_name = VALUES(completed_by_name)
      `;
      for (const o of snapshot.orders) {
        await conn.execute(sql, [
          o.id,
          o.name || '',
          o.number || '',
          o.bookingDate || '',
          o.address || '',
          o.serviceName || '',
          o.city || '',
          o.qty ?? null,
          Number(o.price || 0),
          Number(o.extraAmount || 0),
          o.cleanerName || '',
          o.notes || '',
          o.status,
          o.paymentStatus,
          o.paidCommission ?? null,
          o.paymentClearedAt || null,
          o.paymentClearedByName || null,
          o.paymentNote || null,
          o.isExtraWork ? 1 : 0,
          o.createdById || '',
          o.createdByName || '',
          o.createdAt || '',
          o.updatedAt || '',
          o.completedAt || null,
          o.completedByName || null,
        ]);
      }
      return { count: snapshot.orders.length };
    } finally {
      await conn.end();
    }
  }

  if (h.mode === 'webhook') {
    if (!h.webhookUrl) {
      throw new Error('Hostinger Webhook URL is required');
    }
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (h.webhookSecret) {
      headers['X-OrderDesk-Secret'] = h.webhookSecret;
    }
    const resp = await fetch(h.webhookUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        type: 'sync',
        syncedAt: new Date().toISOString(),
        cities: snapshot.cities,
        cleaners: snapshot.cleaners,
        cleanerProfiles: snapshot.cleanerProfiles,
        orders: snapshot.orders,
      }),
      signal: AbortSignal.timeout(12000),
    });
    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      throw new Error(`Hostinger URL returned ${resp.status}${errText ? `: ${errText.slice(0, 120)}` : ''}`);
    }
    return { count: snapshot.orders.length };
  }

  throw new Error('Select Hostinger MySQL or Webhook URL first');
}

function getSessionSecret(): string {
  return process.env.SESSION_SECRET || db.sessionSecret;
}

function signToken(userId: string): string {
  const payload = Buffer.from(
    JSON.stringify({ uid: userId, iat: Date.now(), exp: Date.now() + 7 * 86400000 })
  ).toString('base64url');
  const sig = crypto.createHmac('sha256', getSessionSecret()).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

function verifyToken(token: string): string | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;
  const expected = crypto.createHmac('sha256', getSessionSecret()).update(payload).digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8')) as {
      uid?: string;
      exp?: number;
    };
    if (!parsed.uid || !parsed.exp || Date.now() > parsed.exp) {
      return null;
    }
    return parsed.uid;
  } catch {
    return null;
  }
}

function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!cookieHeader) return out;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const val = decodeURIComponent(part.slice(idx + 1).trim());
    out[key] = val;
  }
  return out;
}

function toPublicUser(u: StoredUser) {
  return {
    id: u.id,
    name: u.name,
    username: u.username,
    role: u.role,
    active: u.active,
    createdAt: u.createdAt,
  };
}

interface AuthedRequest extends express.Request {
  currentUser?: StoredUser;
}

function requireAuth(req: AuthedRequest, res: express.Response, next: express.NextFunction) {
  const authHeader = req.headers.authorization;
  let token: string | null = null;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.slice(7).trim();
  } else {
    const cookies = parseCookies(req.headers.cookie);
    token = cookies['od_session'] || null;
  }

  if (!token) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const uid = verifyToken(token);
  if (!uid) {
    res.status(401).json({ error: 'Session expired or invalid' });
    return;
  }

  const user = db.users.find((u) => u.id === uid && u.active);
  if (!user) {
    res.status(401).json({ error: 'Account inactive or not found' });
    return;
  }

  req.currentUser = user;
  next();
}

function requireSuperAdmin(req: AuthedRequest, res: express.Response, next: express.NextFunction) {
  if (!req.currentUser || req.currentUser.role !== 'super_admin') {
    res.status(403).json({ error: 'Super Admin access required' });
    return;
  }
  next();
}

const app = express();
app.use(express.json({ limit: '10mb' }));

// Auth routes
app.post('/api/auth/login', (req, res) => {
  const usernameInput = String(req.body?.username ?? '').trim();
  const passwordInput = String(req.body?.password ?? '');

  if (!usernameInput || !passwordInput) {
    res.status(400).json({ error: 'Username and password are required' });
    return;
  }

  const user = db.users.find(
    (u) => u.username.toLowerCase() === usernameInput.toLowerCase()
  );

  if (!user || !verifyPassword(passwordInput, user.passwordHash)) {
    res.status(401).json({ error: 'Invalid username or password' });
    return;
  }

  if (!user.active) {
    res.status(403).json({ error: 'Account is disabled by Super Admin' });
    return;
  }

  if (!user.phpPasswordHash) {
    const phpPasswordHash = hashPhpPassword(passwordInput);
    persistDbFile({
      ...db,
      users: db.users.map((u) => (u.id === user.id ? { ...u, phpPasswordHash } : u)),
    });
  }

  const token = signToken(user.id);
  res.cookie('od_session', token, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 7 * 86400000,
    path: '/',
  });

  res.json({ token, user: toPublicUser(user) });
});

app.post('/api/auth/logout', (_req, res) => {
  res.clearCookie('od_session', { path: '/' });
  res.json({ ok: true });
});

app.get('/api/auth/me', requireAuth, (req: AuthedRequest, res) => {
  res.json({ user: toPublicUser(req.currentUser!) });
});

// Dropdown config (Cities, Cleaners, Services, Active Staff for Order Passing)
app.get('/api/config', requireAuth, (_req, res) => {
  res.json({
    cities: db.cities,
    cleaners: db.cleaners,
    services: DEFAULT_SERVICES,
    cleanerProfiles: db.cleanerProfiles || {},
    telecallers: db.users
      .filter((u) => u.active)
      .map((u) => ({
        id: u.id,
        name: u.name,
        username: u.username,
        role: u.role,
      })),
  });
});

app.post('/api/config/cities', requireAuth, requireSuperAdmin, (req, res) => {
  const city = String(req.body?.name ?? '').trim();
  if (!city) {
    res.status(400).json({ error: 'City name is required' });
    return;
  }
  const exists = db.cities.some((c) => c.toLowerCase() === city.toLowerCase());
  if (exists) {
    res.status(409).json({ error: 'City already exists in the dropdown' });
    return;
  }
  const nextCities = [...db.cities, city];
  saveDb({ ...db, cities: nextCities });
  res.status(201).json({ cities: nextCities });
});

app.delete('/api/config/cities/:name', requireAuth, requireSuperAdmin, (req, res) => {
  const name = decodeURIComponent(req.params.name || '').trim();
  const nextCities = db.cities.filter((c) => c.toLowerCase() !== name.toLowerCase());
  saveDb({ ...db, cities: nextCities });
  res.json({ cities: nextCities });
});

app.post('/api/config/cleaners', requireAuth, requireSuperAdmin, (req, res) => {
  const cleaner = String(req.body?.name ?? '').trim();
  const phone = String(req.body?.phone ?? '').trim();
  const city = String(req.body?.city ?? '').trim();
  if (!cleaner) {
    res.status(400).json({ error: 'Cleaner name is required' });
    return;
  }
  const exists = db.cleaners.some((c) => c.toLowerCase() === cleaner.toLowerCase());
  if (exists) {
    res.status(409).json({ error: 'Cleaner already exists in the dropdown' });
    return;
  }
  const nextCleaners = [...db.cleaners, cleaner];
  const nextProfiles = { ...(db.cleanerProfiles || {}) };
  if (phone || city) {
    nextProfiles[cleaner] = { phone, city };
  }
  saveDb({ ...db, cleaners: nextCleaners, cleanerProfiles: nextProfiles });
  res.status(201).json({ cleaners: nextCleaners, cleanerProfiles: nextProfiles });
});

app.patch('/api/config/cleaners/:name', requireAuth, requireSuperAdmin, (req, res) => {
  const name = decodeURIComponent(req.params.name || '').trim();
  const matched = db.cleaners.find((c) => c.toLowerCase() === name.toLowerCase()) || name;
  const phone = String(req.body?.phone ?? '').trim();
  const city = String(req.body?.city ?? '').trim();
  const nextProfiles = {
    ...(db.cleanerProfiles || {}),
    [matched]: { phone, city },
  };
  saveDb({ ...db, cleanerProfiles: nextProfiles });
  res.json({ cleanerProfiles: nextProfiles });
});

app.delete('/api/config/cleaners/:name', requireAuth, requireSuperAdmin, (req, res) => {
  const name = decodeURIComponent(req.params.name || '').trim();
  const nextCleaners = db.cleaners.filter((c) => c.toLowerCase() !== name.toLowerCase());
  const nextProfiles = { ...(db.cleanerProfiles || {}) };
  for (const key of Object.keys(nextProfiles)) {
    if (key.toLowerCase() === name.toLowerCase()) {
      delete nextProfiles[key];
    }
  }
  saveDb({ ...db, cleaners: nextCleaners, cleanerProfiles: nextProfiles });
  res.json({ cleaners: nextCleaners, cleanerProfiles: nextProfiles });
});

// Telecaller management (Super Admin only)
app.get('/api/telecallers', requireAuth, requireSuperAdmin, (_req, res) => {
  const list = db.users.map(toPublicUser);
  res.json({ users: list });
});

app.post('/api/telecallers', requireAuth, requireSuperAdmin, (req, res) => {
  const name = String(req.body?.name ?? '').trim();
  const username = String(req.body?.username ?? '').trim();
  const password = String(req.body?.password ?? '');

  if (!name || !username || password.length < 4) {
    res.status(400).json({ error: 'Name, username, and password (min 4 chars) are required' });
    return;
  }

  const exists = db.users.some((u) => u.username.toLowerCase() === username.toLowerCase());
  if (exists) {
    res.status(409).json({ error: 'A user with this username already exists' });
    return;
  }

  const newUser: StoredUser = {
    id: `tc-${crypto.randomUUID().slice(0, 8)}`,
    name,
    username,
    passwordHash: hashPassword(password),
    phpPasswordHash: hashPhpPassword(password),
    role: 'telecaller',
    active: true,
    createdAt: new Date().toISOString(),
  };

  saveDb({ ...db, users: [...db.users, newUser] });
  res.status(201).json({ user: toPublicUser(newUser) });
});

app.patch('/api/telecallers/:id', requireAuth, requireSuperAdmin, (req, res) => {
  const { id } = req.params;
  const target = db.users.find((u) => u.id === id);
  if (!target) {
    res.status(404).json({ error: 'User not found' });
    return;
  }
  if (target.role === 'super_admin') {
    res.status(400).json({ error: 'Cannot modify Super Admin account from this panel' });
    return;
  }

  const nextPass = typeof req.body?.password === 'string' && req.body.password.length >= 4
    ? req.body.password
    : null;

  const updated: StoredUser = {
    ...target,
    name: typeof req.body?.name === 'string' && req.body.name.trim() ? req.body.name.trim() : target.name,
    active: typeof req.body?.active === 'boolean' ? req.body.active : target.active,
    passwordHash: nextPass ? hashPassword(nextPass) : target.passwordHash,
    phpPasswordHash: nextPass ? hashPhpPassword(nextPass) : target.phpPasswordHash,
  };

  saveDb({
    ...db,
    users: db.users.map((u) => (u.id === id ? updated : u)),
  });

  res.json({ user: toPublicUser(updated) });
});

app.delete('/api/telecallers/:id', requireAuth, requireSuperAdmin, (req, res) => {
  const { id } = req.params;
  const target = db.users.find((u) => u.id === id);
  if (!target) {
    res.status(404).json({ error: 'User not found' });
    return;
  }
  if (target.role === 'super_admin') {
    res.status(400).json({ error: 'Cannot delete Super Admin account' });
    return;
  }

  saveDb({
    ...db,
    users: db.users.filter((u) => u.id !== id),
  });
  res.json({ ok: true });
});

function normalizePhoneDigits(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.length > 10) return digits.slice(-10);
  return digits;
}

// Orders routes
app.get('/api/orders/check-duplicate', requireAuth, (req: AuthedRequest, res) => {
  const rawNumber = String(req.query.number ?? '').trim();
  const targetDigits = normalizePhoneDigits(rawNumber);

  if (targetDigits.length < 8) {
    res.json({ matches: [] });
    return;
  }

  const matches = db.orders
    .filter((o) => {
      const orderDigits = normalizePhoneDigits(o.number);
      const altDigits = o.altNumber ? normalizePhoneDigits(o.altNumber) : '';
      return (
        (orderDigits.length >= 8 && orderDigits === targetDigits) ||
        (altDigits.length >= 8 && altDigits === targetDigits)
      );
    })
    .sort((a, b) => {
      if (a.status !== b.status) return a.status === 'active' ? -1 : 1;
      return b.createdAt.localeCompare(a.createdAt);
    })
    .map((o) => ({
      id: o.id,
      name: o.name,
      number: o.number,
      bookingDate: o.bookingDate,
      address: o.address,
      serviceName: o.serviceName,
      city: o.city,
      price: o.price,
      cleanerName: o.cleanerName,
      status: o.status,
      createdById: o.createdById,
      createdByName: o.createdByName,
      createdAt: o.createdAt,
    }));

  res.json({ matches });
});

app.get('/api/orders', requireAuth, (req: AuthedRequest, res) => {
  const user = req.currentUser!;
  const visibleOrders =
    user.role === 'super_admin'
      ? db.orders
      : db.orders.filter(
          (o) => o.createdById === user.id || o.transferredFromId === user.id
        );

  res.json({ orders: visibleOrders });
});

function calcOrderCommission30(price: number, extraAmount: number): number {
  return Math.round((Number(price || 0) + Number(extraAmount || 0)) * 0.3 * 100) / 100;
}

app.post('/api/orders', requireAuth, (req: AuthedRequest, res) => {
  const user = req.currentUser!;
  const name = String(req.body?.name ?? '').trim();
  const number = String(req.body?.number ?? '').trim();
  const bookingDate = String(req.body?.bookingDate ?? '').trim();
  const address = String(req.body?.address ?? '').trim();
  const serviceName = String(req.body?.serviceName ?? DEFAULT_SERVICES[0]).trim();
  const city = String(req.body?.city ?? db.cities[0] ?? 'Other').trim();
  const rawQty = req.body?.qty;
  const qty =
    rawQty === null || rawQty === undefined || rawQty === ''
      ? null
      : Number.isFinite(Number(rawQty)) && Number(rawQty) > 0
      ? Number(rawQty)
      : null;
  const price = Number(req.body?.price ?? 0);
  const extraAmount = Number(req.body?.extraAmount ?? 0);
  const cleanerName = String(req.body?.cleanerName ?? db.cleaners[0] ?? 'Jagdish').trim();
  const notes = typeof req.body?.notes === 'string' ? req.body.notes.trim() : '';
  const paymentNote = typeof req.body?.paymentNote === 'string' ? req.body.paymentNote.trim() : '';
  const isExtraWork = Boolean(req.body?.isExtraWork);
  const initialStatus: OrderStatus =
    req.body?.status === 'completed' ? 'completed' : 'active';
  const safePrice = Number.isFinite(price) && price >= 0 ? price : 0;
  const safeExtra = Number.isFinite(extraAmount) && extraAmount >= 0 ? extraAmount : 0;
  const comm30 = calcOrderCommission30(safePrice, safeExtra);
  const initialPaymentStatus: PaymentStatus =
    req.body?.paymentStatus === 'clear' ? 'clear' : 'pending';
  const rawPaidComm = req.body?.paidCommission;
  const paidCommission =
    rawPaidComm !== undefined && Number.isFinite(Number(rawPaidComm)) && Number(rawPaidComm) >= 0
      ? Number(rawPaidComm)
      : initialPaymentStatus === 'clear'
      ? comm30
      : 0;

  const altNumberRaw = String(req.body?.altNumber ?? '').trim();
  const cleanAltDigits = altNumberRaw.replace(/\D/g, '');
  if (altNumberRaw && cleanAltDigits.length !== 10) {
    res.status(400).json({
      error: 'Alternate Number must be exactly 10 digits',
    });
    return;
  }

  const cleanNumberDigits = number.replace(/\D/g, '');
  if (!isExtraWork && cleanNumberDigits.length !== 10) {
    res.status(400).json({
      error: 'Phone Number must be exactly 10 digits',
    });
    return;
  }

  const now = new Date().toISOString();
  const newOrder: StoredOrder = {
    id: `ord-${crypto.randomUUID().slice(0, 8)}`,
    name,
    number: isExtraWork ? number : cleanNumberDigits,
    altNumber: !isExtraWork && cleanAltDigits ? cleanAltDigits : undefined,
    bookingDate,
    address,
    serviceName: serviceName || DEFAULT_SERVICES[0],
    city: city || 'Other',
    qty,
    price: safePrice,
    extraAmount: safeExtra,
    cleanerName: cleanerName || 'Jagdish',
    notes: notes || undefined,
    status: initialStatus,
    paymentStatus: paidCommission >= comm30 && initialPaymentStatus === 'clear' ? 'clear' : initialPaymentStatus,
    paidCommission,
    paymentClearedAt: initialPaymentStatus === 'clear' ? now : undefined,
    paymentClearedByName: initialPaymentStatus === 'clear' ? user.name : undefined,
    paymentNote: paymentNote || undefined,
    isExtraWork: isExtraWork || undefined,
    createdById: user.id,
    createdByName: user.name,
    createdAt: now,
    updatedAt: now,
    completedAt: initialStatus === 'completed' ? now : undefined,
    completedByName: initialStatus === 'completed' ? user.name : undefined,
  };

  saveDb({ ...db, orders: [newOrder, ...db.orders] });
  res.status(201).json({ order: newOrder });
});

app.patch('/api/orders/:id', requireAuth, (req: AuthedRequest, res) => {
  const user = req.currentUser!;
  const { id } = req.params;
  const existing = db.orders.find((o) => o.id === id);

  if (!existing) {
    res.status(404).json({ error: 'Order not found' });
    return;
  }

  if (user.role !== 'super_admin' && existing.createdById !== user.id) {
    res.status(403).json({ error: 'Not authorized to modify this order' });
    return;
  }

  const now = new Date().toISOString();
  const nextStatus: OrderStatus =
    req.body?.status === 'completed' || req.body?.status === 'active'
      ? req.body.status
      : existing.status;

  let nextQty = existing.qty;
  if (req.body?.qty !== undefined) {
    if (req.body.qty === null || req.body.qty === '') {
      nextQty = null;
    } else if (Number.isFinite(Number(req.body.qty)) && Number(req.body.qty) > 0) {
      nextQty = Number(req.body.qty);
    }
  }

  const nextPrice =
    req.body?.price !== undefined && Number.isFinite(Number(req.body.price)) && Number(req.body.price) >= 0
      ? Number(req.body.price)
      : existing.price;
  const nextExtraAmount =
    req.body?.extraAmount !== undefined &&
    Number.isFinite(Number(req.body.extraAmount)) &&
    Number(req.body.extraAmount) >= 0
      ? Number(req.body.extraAmount)
      : existing.extraAmount || 0;
  const nextComm30 = calcOrderCommission30(nextPrice, nextExtraAmount);

  let nextPaidCommission =
    existing.paidCommission !== undefined
      ? existing.paidCommission
      : existing.paymentStatus === 'clear'
      ? calcOrderCommission30(existing.price, existing.extraAmount || 0)
      : 0;
  let nextPaymentStatus: PaymentStatus = existing.paymentStatus || 'pending';

  if (
    req.body?.paidCommission !== undefined &&
    Number.isFinite(Number(req.body.paidCommission)) &&
    Number(req.body.paidCommission) >= 0
  ) {
    nextPaidCommission = Math.min(nextComm30, Number(req.body.paidCommission));
    nextPaymentStatus = nextPaidCommission >= nextComm30 ? 'clear' : 'pending';
  } else if (req.body?.paymentStatus === 'clear' || req.body?.paymentStatus === 'pending') {
    nextPaymentStatus = req.body.paymentStatus;
    nextPaidCommission = req.body.paymentStatus === 'clear' ? nextComm30 : 0;
  } else if (nextPaidCommission >= nextComm30 && nextPaymentStatus === 'clear') {
    nextPaidCommission = nextComm30;
  } else if (nextPaidCommission < nextComm30 && nextPaymentStatus === 'clear') {
    nextPaymentStatus = 'pending';
  }

  let nextNumber = existing.number;
  if (typeof req.body?.number === 'string') {
    const cleanPatchDigits = req.body.number.replace(/\D/g, '');
    if (existing.isExtraWork) {
      nextNumber = cleanPatchDigits ? cleanPatchDigits.slice(0, 10) : '';
    } else {
      if (cleanPatchDigits.length !== 10) {
        res.status(400).json({ error: 'Phone Number must be exactly 10 digits (min 10, max 10)' });
        return;
      }
      nextNumber = cleanPatchDigits;
    }
  }

  let nextAltNumber = existing.altNumber;
  if (req.body?.altNumber !== undefined) {
    const rawAlt = String(req.body.altNumber ?? '').trim();
    if (!rawAlt) {
      nextAltNumber = undefined;
    } else {
      const cleanAltDigits = rawAlt.replace(/\D/g, '');
      if (cleanAltDigits.length !== 10) {
        res.status(400).json({ error: 'Alternate Number must be exactly 10 digits (min 10, max 10)' });
        return;
      }
      nextAltNumber = cleanAltDigits;
    }
  }

  const updated: StoredOrder = {
    ...existing,
    name: typeof req.body?.name === 'string' ? req.body.name.trim() : existing.name,
    number: nextNumber,
    altNumber: nextAltNumber,
    bookingDate:
      typeof req.body?.bookingDate === 'string'
        ? req.body.bookingDate.trim()
        : existing.bookingDate,
    address:
      typeof req.body?.address === 'string'
        ? req.body.address.trim()
        : existing.address,
    serviceName:
      typeof req.body?.serviceName === 'string'
        ? req.body.serviceName.trim() || existing.serviceName
        : existing.serviceName,
    city:
      typeof req.body?.city === 'string'
        ? req.body.city.trim() || existing.city
        : existing.city,
    qty: nextQty,
    price: nextPrice,
    extraAmount: nextExtraAmount,
    cleanerName:
      typeof req.body?.cleanerName === 'string'
        ? req.body.cleanerName.trim() || existing.cleanerName
        : existing.cleanerName,
    notes: typeof req.body?.notes === 'string' ? req.body.notes.trim() || undefined : existing.notes,
    paymentNote:
      typeof req.body?.paymentNote === 'string'
        ? req.body.paymentNote.trim() || undefined
        : existing.paymentNote,
    status: nextStatus,
    paymentStatus: nextPaymentStatus,
    paidCommission: nextPaidCommission,
    paymentClearedAt:
      nextPaymentStatus === 'clear'
        ? existing.paymentClearedAt || now
        : undefined,
    paymentClearedByName:
      nextPaymentStatus === 'clear'
        ? existing.paymentClearedByName || user.name
        : undefined,
    updatedAt: now,
    completedAt: nextStatus === 'completed' ? existing.completedAt || now : undefined,
    completedByName:
      nextStatus === 'completed' ? existing.completedByName || user.name : undefined,
  };

  saveDb({
    ...db,
    orders: db.orders.map((o) => (o.id === id ? updated : o)),
  });

  res.json({ order: updated });
});

app.post('/api/orders/bulk-complete', requireAuth, (req: AuthedRequest, res) => {
  const user = req.currentUser!;
  const ids = Array.isArray(req.body?.ids) ? (req.body.ids as string[]) : [];
  if (ids.length === 0) {
    res.status(400).json({ error: 'No order IDs provided' });
    return;
  }

  const now = new Date().toISOString();
  const idSet = new Set(ids);
  const nextOrders = db.orders.map((o) => {
    if (!idSet.has(o.id)) return o;
    if (user.role !== 'super_admin' && o.createdById !== user.id) return o;
    return {
      ...o,
      status: 'completed' as OrderStatus,
      updatedAt: now,
      completedAt: o.completedAt || now,
      completedByName: o.completedByName || user.name,
    };
  });

  saveDb({ ...db, orders: nextOrders });
  res.json({ ok: true });
});

app.post('/api/orders/bulk-payment', requireAuth, (req: AuthedRequest, res) => {
  const user = req.currentUser!;
  const now = new Date().toISOString();

  // Support granular partial payment updates per order: updates: [{ id, paidCommission, paymentNote? }]
  if (Array.isArray(req.body?.updates) && req.body.updates.length > 0) {
    const updateMap = new Map<string, { paidCommission: number; paymentNote?: string }>();
    for (const item of req.body.updates as Array<{
      id?: string;
      paidCommission?: number;
      paymentNote?: string;
    }>) {
      if (
        item &&
        typeof item.id === 'string' &&
        Number.isFinite(Number(item.paidCommission)) &&
        Number(item.paidCommission) >= 0
      ) {
        updateMap.set(item.id, {
          paidCommission: Number(item.paidCommission),
          paymentNote: typeof item.paymentNote === 'string' ? item.paymentNote.trim() : undefined,
        });
      }
    }

    const updatedOrders: StoredOrder[] = [];
    const nextOrders = db.orders.map((o) => {
      const upd = updateMap.get(o.id);
      if (!upd) return o;
      if (user.role !== 'super_admin' && o.createdById !== user.id) return o;
      const comm30 = calcOrderCommission30(o.price, o.extraAmount || 0);
      const clampedPaid = Math.min(comm30, upd.paidCommission);
      const status: PaymentStatus = clampedPaid >= comm30 ? 'clear' : 'pending';
      const nextOrder: StoredOrder = {
        ...o,
        paymentStatus: status,
        paidCommission: clampedPaid,
        paymentClearedAt: status === 'clear' ? o.paymentClearedAt || now : undefined,
        paymentClearedByName: status === 'clear' ? o.paymentClearedByName || user.name : undefined,
        paymentNote: upd.paymentNote !== undefined ? upd.paymentNote || undefined : o.paymentNote,
        updatedAt: now,
      };
      updatedOrders.push(nextOrder);
      return nextOrder;
    });

    saveDb({ ...db, orders: nextOrders });
    res.json({ ok: true, orders: updatedOrders });
    return;
  }

  const ids = Array.isArray(req.body?.ids) ? (req.body.ids as string[]) : [];
  const paymentStatus: PaymentStatus =
    req.body?.paymentStatus === 'pending' ? 'pending' : 'clear';
  const paymentNote =
    typeof req.body?.paymentNote === 'string' ? req.body.paymentNote.trim() : undefined;

  if (ids.length === 0) {
    res.status(400).json({ error: 'No order IDs provided' });
    return;
  }

  const idSet = new Set(ids);
  const updatedOrders: StoredOrder[] = [];
  const nextOrders = db.orders.map((o) => {
    if (!idSet.has(o.id)) return o;
    if (user.role !== 'super_admin' && o.createdById !== user.id) return o;
    const comm30 = calcOrderCommission30(o.price, o.extraAmount || 0);
    const nextOrder: StoredOrder = {
      ...o,
      paymentStatus,
      paidCommission: paymentStatus === 'clear' ? comm30 : 0,
      paymentClearedAt: paymentStatus === 'clear' ? o.paymentClearedAt || now : undefined,
      paymentClearedByName:
        paymentStatus === 'clear' ? o.paymentClearedByName || user.name : undefined,
      paymentNote: paymentNote !== undefined ? paymentNote || undefined : o.paymentNote,
      updatedAt: now,
    };
    updatedOrders.push(nextOrder);
    return nextOrder;
  });

  saveDb({ ...db, orders: nextOrders });
  res.json({ ok: true, orders: updatedOrders });
});

app.post('/api/orders/transfer', requireAuth, (req: AuthedRequest, res) => {
  const user = req.currentUser!;
  const ids = Array.isArray(req.body?.ids)
    ? (req.body.ids as unknown[]).map((v) => String(v)).filter(Boolean)
    : [];
  const targetUserId = String(req.body?.targetUserId ?? '').trim();

  if (ids.length === 0) {
    res.status(400).json({ error: 'No order IDs provided' });
    return;
  }
  if (!targetUserId) {
    res.status(400).json({ error: 'Target telecaller is required' });
    return;
  }

  const targetUser = db.users.find((u) => u.id === targetUserId && u.active);
  if (!targetUser) {
    res.status(404).json({ error: 'Selected telecaller account was not found or is inactive' });
    return;
  }

  const idSet = new Set(ids);
  const now = new Date().toISOString();
  const updatedOrders: StoredOrder[] = [];
  let unauthorizedCount = 0;

  const nextOrders = db.orders.map((o) => {
    if (!idSet.has(o.id)) return o;
    if (user.role !== 'super_admin' && o.createdById !== user.id) {
      unauthorizedCount += 1;
      return o;
    }
    if (o.createdById === targetUser.id) {
      updatedOrders.push(o);
      return o;
    }
    const nextOrder: StoredOrder = {
      ...o,
      transferredFromId: o.createdById || user.id,
      transferredFromName: o.createdByName || user.name,
      transferredAt: now,
      createdById: targetUser.id,
      createdByName: targetUser.name,
      updatedAt: now,
    };
    updatedOrders.push(nextOrder);
    return nextOrder;
  });

  if (updatedOrders.length === 0) {
    res.status(unauthorizedCount > 0 ? 403 : 404).json({
      error:
        unauthorizedCount > 0
          ? 'Not authorized to pass one or more selected orders'
          : 'No matching orders found',
    });
    return;
  }

  saveDb({ ...db, orders: nextOrders });
  res.json({
    ok: true,
    targetUser: { id: targetUser.id, name: targetUser.name },
    orders: updatedOrders,
  });
});

app.post('/api/orders/untransfer', requireAuth, (req: AuthedRequest, res) => {
  const user = req.currentUser!;
  const ids = Array.isArray(req.body?.ids)
    ? (req.body.ids as unknown[]).map((v) => String(v)).filter(Boolean)
    : [];

  if (ids.length === 0) {
    res.status(400).json({ error: 'No order IDs provided' });
    return;
  }

  const idSet = new Set(ids);
  const now = new Date().toISOString();
  const updatedOrders: StoredOrder[] = [];
  let unauthorizedCount = 0;

  const nextOrders = db.orders.map((o) => {
    if (!idSet.has(o.id)) return o;
    if (!o.transferredFromId) {
      return o;
    }
    if (user.role !== 'super_admin' && o.transferredFromId !== user.id) {
      unauthorizedCount += 1;
      return o;
    }

    const originalUser = db.users.find((u) => u.id === o.transferredFromId);
    const nextOrder: StoredOrder = {
      ...o,
      createdById: originalUser?.id || o.transferredFromId,
      createdByName: originalUser?.name || o.transferredFromName || user.name,
      transferredFromId: undefined,
      transferredFromName: undefined,
      transferredAt: undefined,
      updatedAt: now,
    };
    updatedOrders.push(nextOrder);
    return nextOrder;
  });

  if (updatedOrders.length === 0) {
    res.status(unauthorizedCount > 0 ? 403 : 400).json({
      error:
        unauthorizedCount > 0
          ? 'Not authorized to unsend one or more selected orders'
          : 'No transferred orders found to unsend',
    });
    return;
  }

  saveDb({ ...db, orders: nextOrders });
  res.json({
    ok: true,
    orders: updatedOrders,
  });
});

app.delete('/api/orders/:id', requireAuth, (req: AuthedRequest, res) => {
  const user = req.currentUser!;
  const { id } = req.params;
  const existing = db.orders.find((o) => o.id === id);

  if (!existing) {
    res.status(404).json({ error: 'Order not found' });
    return;
  }
  if (user.role !== 'super_admin' && existing.createdById !== user.id) {
    res.status(403).json({ error: 'Not authorized to delete this order' });
    return;
  }

  saveDb({
    ...db,
    orders: db.orders.filter((o) => o.id !== id),
  });
  res.json({ ok: true });
});

// Bulk Excel Import
app.post('/api/orders/bulk-import', requireAuth, (req: AuthedRequest, res) => {
  const user = req.currentUser!;
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
  const autoAddDropdowns = req.body?.autoAddDropdowns !== false;
  const skipDuplicateNumbers = Boolean(req.body?.skipDuplicateNumbers);

  if (rows.length === 0) {
    res.status(400).json({ error: 'No rows provided for import' });
    return;
  }

  const existingDigitsSet = new Set<string>();
  if (skipDuplicateNumbers) {
    for (const o of db.orders) {
      const digits = normalizePhoneDigits(o.number);
      if (digits.length >= 8) existingDigitsSet.add(digits);
    }
  }

  const nextCities = [...db.cities];
  const nextCleaners = [...db.cleaners];
  const createdOrders: StoredOrder[] = [];
  let skippedCount = 0;
  const now = new Date().toISOString();

  for (const rawRow of rows) {
    const row = (rawRow || {}) as Record<string, unknown>;
    const number = String(row.number ?? '').trim();
    const name = String(row.name ?? '').trim();
    if (!number && !name) {
      skippedCount += 1;
      continue;
    }

    const digits = normalizePhoneDigits(number);
    if (skipDuplicateNumbers && digits.length >= 8 && existingDigitsSet.has(digits)) {
      skippedCount += 1;
      continue;
    }
    if (digits.length >= 8) {
      existingDigitsSet.add(digits);
    }

    const city = String(row.city ?? '').trim() || db.cities[0] || 'Other';
    const cleanerName = String(row.cleanerName ?? '').trim() || db.cleaners[0] || 'Jagdish';
    const serviceName = String(row.serviceName ?? '').trim() || DEFAULT_SERVICES[0];
    const bookingDate = String(row.bookingDate ?? '').trim();
    const address = String(row.address ?? '').trim();
    const notes = String(row.notes ?? '').trim();
    const rawQty = row.qty;
    const qty =
      rawQty === null || rawQty === undefined || rawQty === ''
        ? null
        : Number.isFinite(Number(rawQty)) && Number(rawQty) > 0
        ? Number(rawQty)
        : null;
    const rawPrice = Number(row.price ?? 0);
    const safePrice = Number.isFinite(rawPrice) && rawPrice >= 0 ? rawPrice : 0;
    const rawExtra = Number(row.extraAmount ?? 0);
    const safeExtra = Number.isFinite(rawExtra) && rawExtra >= 0 ? rawExtra : 0;
    const comm30 = calcOrderCommission30(safePrice, safeExtra);
    const status: OrderStatus = row.status === 'completed' ? 'completed' : 'active';
    const paymentStatus: PaymentStatus = row.paymentStatus === 'clear' ? 'clear' : 'pending';
    const rawPaid = row.paidCommission;
    const paidCommission =
      rawPaid !== undefined && rawPaid !== '' && Number.isFinite(Number(rawPaid)) && Number(rawPaid) >= 0
        ? Math.min(comm30, Number(rawPaid))
        : paymentStatus === 'clear'
        ? comm30
        : 0;
    const finalPaymentStatus: PaymentStatus =
      paidCommission >= comm30 && comm30 > 0 ? 'clear' : paymentStatus;

    if (autoAddDropdowns) {
      if (city && !nextCities.some((c) => c.toLowerCase() === city.toLowerCase())) {
        nextCities.push(city);
      }
      if (cleanerName && !nextCleaners.some((c) => c.toLowerCase() === cleanerName.toLowerCase())) {
        nextCleaners.push(cleanerName);
      }
    }

    createdOrders.push({
      id: `ord-${crypto.randomUUID().slice(0, 8)}`,
      name,
      number,
      bookingDate,
      address,
      serviceName,
      city,
      qty,
      price: safePrice,
      extraAmount: safeExtra,
      cleanerName,
      notes: notes || undefined,
      status,
      paymentStatus: finalPaymentStatus,
      paidCommission,
      paymentClearedAt: finalPaymentStatus === 'clear' ? now : undefined,
      paymentClearedByName: finalPaymentStatus === 'clear' ? user.name : undefined,
      createdById: user.id,
      createdByName: user.name,
      createdAt: now,
      updatedAt: now,
      completedAt: status === 'completed' ? now : undefined,
      completedByName: status === 'completed' ? user.name : undefined,
    });
  }

  saveDb({
    ...db,
    cities: nextCities,
    cleaners: nextCleaners,
    orders: [...createdOrders, ...db.orders],
  });

  res.status(201).json({
    importedCount: createdOrders.length,
    skippedCount,
    orders: createdOrders,
    config: {
      cities: nextCities,
      cleaners: nextCleaners,
      services: DEFAULT_SERVICES,
      cleanerProfiles: db.cleanerProfiles || {},
    },
  });
});

// Hostinger Sync & Backup routes (Super Admin only)
app.get('/api/hostinger/config', requireAuth, requireSuperAdmin, (_req, res) => {
  res.json({ config: toPublicHostingerConfig(db.hostinger) });
});

app.put('/api/hostinger/config', requireAuth, requireSuperAdmin, (req, res) => {
  const modeRaw = req.body?.mode;
  const mode: HostingerSyncMode =
    modeRaw === 'mysql' || modeRaw === 'webhook' ? modeRaw : 'none';
  const nextHostinger: HostingerConfig = {
    ...db.hostinger,
    mode,
    autoSync: Boolean(req.body?.autoSync),
    mysqlHost: String(req.body?.mysqlHost ?? db.hostinger.mysqlHost).trim(),
    mysqlPort: Number(req.body?.mysqlPort) || 3306,
    mysqlDatabase: String(req.body?.mysqlDatabase ?? db.hostinger.mysqlDatabase).trim(),
    mysqlUser: String(req.body?.mysqlUser ?? db.hostinger.mysqlUser).trim(),
    mysqlPassword:
      typeof req.body?.mysqlPassword === 'string' && req.body.mysqlPassword !== ''
        ? req.body.mysqlPassword
        : db.hostinger.mysqlPassword,
    webhookUrl: String(req.body?.webhookUrl ?? db.hostinger.webhookUrl).trim(),
    webhookSecret:
      typeof req.body?.webhookSecret === 'string' && req.body.webhookSecret !== ''
        ? req.body.webhookSecret
        : db.hostinger.webhookSecret,
  };

  saveDb({ ...db, hostinger: nextHostinger }, true);
  res.json({ config: toPublicHostingerConfig(nextHostinger) });
});

app.post('/api/hostinger/test', requireAuth, requireSuperAdmin, async (req, res) => {
  const h: HostingerConfig = {
    ...db.hostinger,
    ...(req.body?.mode ? { mode: req.body.mode } : {}),
    ...(req.body?.mysqlHost !== undefined ? { mysqlHost: String(req.body.mysqlHost).trim() } : {}),
    ...(req.body?.mysqlPort !== undefined ? { mysqlPort: Number(req.body.mysqlPort) || 3306 } : {}),
    ...(req.body?.mysqlDatabase !== undefined ? { mysqlDatabase: String(req.body.mysqlDatabase).trim() } : {}),
    ...(req.body?.mysqlUser !== undefined ? { mysqlUser: String(req.body.mysqlUser).trim() } : {}),
    ...(typeof req.body?.mysqlPassword === 'string' && req.body.mysqlPassword !== ''
      ? { mysqlPassword: req.body.mysqlPassword }
      : {}),
    ...(req.body?.webhookUrl !== undefined ? { webhookUrl: String(req.body.webhookUrl).trim() } : {}),
    ...(typeof req.body?.webhookSecret === 'string' && req.body.webhookSecret !== ''
      ? { webhookSecret: req.body.webhookSecret }
      : {}),
  };

  try {
    if (h.mode === 'mysql') {
      const conn = await openHostingerMysqlConnection(h);
      try {
        await ensureHostingerMysqlTable(conn);
        const [rows] = await conn.execute('SELECT COUNT(*) AS cnt FROM orderdesk_orders');
        const cnt = Array.isArray(rows) && rows[0] ? Number((rows[0] as { cnt?: number }).cnt || 0) : 0;
        res.json({ ok: true, message: `Hostinger MySQL connected! (${cnt} orders currently on Hostinger)` });
        return;
      } finally {
        await conn.end();
      }
    }

    if (h.mode === 'webhook') {
      if (!h.webhookUrl) {
        res.status(400).json({ error: 'Hostinger Webhook URL is required' });
        return;
      }
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (h.webhookSecret) headers['X-OrderDesk-Secret'] = h.webhookSecret;
      const resp = await fetch(h.webhookUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({ type: 'ping', timestamp: new Date().toISOString() }),
        signal: AbortSignal.timeout(10000),
      });
      if (!resp.ok) {
        res.status(502).json({ error: `Hostinger URL returned HTTP ${resp.status}` });
        return;
      }
      res.json({ ok: true, message: 'Hostinger URL responded OK!' });
      return;
    }

    res.status(400).json({ error: 'Select Hostinger MySQL or Hostinger PHP URL first' });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Hostinger connection test failed',
    });
  }
});

app.post('/api/hostinger/sync', requireAuth, requireSuperAdmin, async (_req, res) => {
  try {
    const result = await syncDataToHostinger(db.hostinger, db);
    const syncedAt = new Date().toISOString();
    saveDb({ ...db, hostinger: { ...db.hostinger, lastSyncedAt: syncedAt } }, true);
    res.json({
      ok: true,
      syncedCount: result.count,
      lastSyncedAt: syncedAt,
      message: `${result.count} orders Hostinger par sync ho gaye!`,
    });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Hostinger sync failed',
    });
  }
});

app.post('/api/hostinger/pull', requireAuth, requireSuperAdmin, async (_req, res) => {
  if (db.hostinger.mode !== 'mysql') {
    res.status(400).json({ error: 'Pull from Hostinger is available in Hostinger MySQL mode' });
    return;
  }
  try {
    const conn = await openHostingerMysqlConnection(db.hostinger);
    try {
      await ensureHostingerMysqlTable(conn);
      const [rows] = await conn.execute('SELECT * FROM orderdesk_orders ORDER BY created_at DESC');
      const rowList = Array.isArray(rows) ? (rows as Array<Record<string, unknown>>) : [];
      const existingMap = new Map(db.orders.map((o) => [o.id, o]));
      let addedCount = 0;

      for (const r of rowList) {
        const id = String(r.id || '').trim();
        if (!id || existingMap.has(id)) continue;
        addedCount += 1;
        existingMap.set(id, {
          id,
          name: String(r.name || ''),
          number: String(r.number || ''),
          bookingDate: String(r.booking_date || ''),
          address: String(r.address || ''),
          serviceName: String(r.service_name || DEFAULT_SERVICES[0]),
          city: String(r.city || 'Other'),
          qty: r.qty !== null && r.qty !== undefined ? Number(r.qty) : null,
          price: Number(r.price || 0),
          extraAmount: Number(r.extra_amount || 0),
          cleanerName: String(r.cleaner_name || 'Jagdish'),
          notes: r.notes ? String(r.notes) : undefined,
          status: r.status === 'completed' ? 'completed' : 'active',
          paymentStatus: r.payment_status === 'clear' ? 'clear' : 'pending',
          paidCommission:
            r.paid_commission !== null && r.paid_commission !== undefined
              ? Number(r.paid_commission)
              : undefined,
          paymentClearedAt: r.payment_cleared_at ? String(r.payment_cleared_at) : undefined,
          paymentClearedByName: r.payment_cleared_by_name
            ? String(r.payment_cleared_by_name)
            : undefined,
          paymentNote: r.payment_note ? String(r.payment_note) : undefined,
          isExtraWork: Boolean(r.is_extra_work),
          createdById: String(r.created_by_id || 'admin-1'),
          createdByName: String(r.created_by_name || 'Hostinger Sync'),
          createdAt: String(r.created_at || new Date().toISOString()),
          updatedAt: String(r.updated_at || new Date().toISOString()),
          completedAt: r.completed_at ? String(r.completed_at) : undefined,
          completedByName: r.completed_by_name ? String(r.completed_by_name) : undefined,
        });
      }

      const merged = Array.from(existingMap.values()).sort((a, b) =>
        b.createdAt.localeCompare(a.createdAt)
      );
      saveDb({ ...db, orders: merged }, true);
      res.json({ ok: true, addedCount, orders: merged });
    } finally {
      await conn.end();
    }
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to pull data from Hostinger MySQL',
    });
  }
});

app.get('/api/hostinger/php-script', requireAuth, requireSuperAdmin, (_req, res) => {
  const phpCode = `<?php
// Upload this file to Hostinger public_html/orderdesk-sync.php
header('Content-Type: application/json');

$SECRET = ''; // Optional: put same secret as OrderDesk Admin Panel
if ($SECRET !== '') {
  $incoming = $_SERVER['HTTP_X_ORDERDESK_SECRET'] ?? '';
  if (!hash_equals($SECRET, $incoming)) {
    http_response_code(403);
    echo json_encode(['error' => 'Unauthorized']);
    exit;
  }
}

$raw = file_get_contents('php://input');
$data = json_decode($raw, true);
if (!$data) {
  http_response_code(400);
  echo json_encode(['error' => 'Invalid JSON']);
  exit;
}

if (($data['type'] ?? '') === 'ping') {
  echo json_encode(['ok' => true, 'message' => 'Hostinger PHP endpoint ready']);
  exit;
}

// 1) Save full snapshot JSON on Hostinger
file_put_contents(__DIR__ . '/orderdesk-backup.json', json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));

// 2) Optional: Fill your Hostinger local MySQL credentials below to also store in MySQL
$DB_HOST = 'localhost';
$DB_NAME = '';
$DB_USER = '';
$DB_PASS = '';

if ($DB_NAME !== '' && $DB_USER !== '') {
  $pdo = new PDO("mysql:host=$DB_HOST;dbname=$DB_NAME;charset=utf8mb4", $DB_USER, $DB_PASS, [
    PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION
  ]);
  $pdo->exec("CREATE TABLE IF NOT EXISTS orderdesk_orders (
    id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(255) NOT NULL DEFAULT '',
    number VARCHAR(64) NOT NULL DEFAULT '',
    booking_date VARCHAR(32) NOT NULL DEFAULT '',
    address TEXT,
    service_name VARCHAR(120) NOT NULL DEFAULT '',
    city VARCHAR(120) NOT NULL DEFAULT '',
    qty DOUBLE NULL,
    price DOUBLE NOT NULL DEFAULT 0,
    extra_amount DOUBLE NOT NULL DEFAULT 0,
    cleaner_name VARCHAR(120) NOT NULL DEFAULT '',
    notes TEXT,
    status VARCHAR(32) NOT NULL DEFAULT 'active',
    payment_status VARCHAR(32) NOT NULL DEFAULT 'pending',
    paid_commission DOUBLE NULL,
    created_by_name VARCHAR(120) NOT NULL DEFAULT '',
    created_at VARCHAR(64) NOT NULL DEFAULT '',
    updated_at VARCHAR(64) NOT NULL DEFAULT ''
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

  $stmt = $pdo->prepare("INSERT INTO orderdesk_orders
    (id, name, number, booking_date, address, service_name, city, qty, price, extra_amount, cleaner_name, notes, status, payment_status, paid_commission, created_by_name, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      name=VALUES(name), number=VALUES(number), booking_date=VALUES(booking_date),
      address=VALUES(address), service_name=VALUES(service_name), city=VALUES(city),
      qty=VALUES(qty), price=VALUES(price), extra_amount=VALUES(extra_amount),
      cleaner_name=VALUES(cleaner_name), notes=VALUES(notes), status=VALUES(status),
      payment_status=VALUES(payment_status), paid_commission=VALUES(paid_commission),
      updated_at=VALUES(updated_at)");

  foreach (($data['orders'] ?? []) as $o) {
    $stmt->execute([
      $o['id'] ?? '', $o['name'] ?? '', $o['number'] ?? '', $o['bookingDate'] ?? '',
      $o['address'] ?? '', $o['serviceName'] ?? '', $o['city'] ?? '', $o['qty'] ?? null,
      $o['price'] ?? 0, $o['extraAmount'] ?? 0, $o['cleanerName'] ?? '', $o['notes'] ?? '',
      $o['status'] ?? 'active', $o['paymentStatus'] ?? 'pending', $o['paidCommission'] ?? null,
      $o['createdByName'] ?? '', $o['createdAt'] ?? '', $o['updatedAt'] ?? ''
    ]);
  }
}

echo json_encode(['ok' => true, 'savedOrders' => count($data['orders'] ?? [])]);
`;
  res.setHeader('Content-Type', 'application/x-php');
  res.setHeader('Content-Disposition', 'attachment; filename="orderdesk-sync.php"');
  res.send(phpCode);
});

app.get('/api/admin/export-backup', requireAuth, requireSuperAdmin, (_req, res) => {
  const backup = {
    exportedAt: new Date().toISOString(),
    cities: db.cities,
    cleaners: db.cleaners,
    cleanerProfiles: db.cleanerProfiles,
    orders: db.orders,
  };
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="orderdesk-backup-${todayISO(0)}.json"`);
  res.send(JSON.stringify(backup, null, 2));
});

let hostingerBuildPromise: Promise<void> | null = null;

async function ensureDistBuiltForHostinger(): Promise<string> {
  const distDir = path.resolve(process.cwd(), 'dist');
  const viteBin = path.resolve(process.cwd(), 'node_modules/vite/bin/vite.js');
  if (fs.existsSync(viteBin)) {
    if (!hostingerBuildPromise) {
      hostingerBuildPromise = execFileAsync(process.execPath, [viteBin, 'build'], {
        cwd: process.cwd(),
        timeout: 90000,
      })
        .then(() => undefined)
        .catch((err) => {
          if (!fs.existsSync(path.join(distDir, 'index.html'))) {
            throw err;
          }
        })
        .finally(() => {
          hostingerBuildPromise = null;
        });
    }
    await hostingerBuildPromise;
  }
  if (!fs.existsSync(path.join(distDir, 'index.html'))) {
    throw new Error('Frontend build did not produce dist/index.html');
  }
  return distDir;
}

app.get('/api/hostinger/download-zip', requireAuth, requireSuperAdmin, async (_req, res) => {
  try {
    const distDir = await ensureDistBuiltForHostinger();
    const distEntries = collectDirectoryZipEntries(distDir);

    const dbSnapshot: PortalDatabase = {
      ...db,
      hostinger: {
        ...db.hostinger,
        mysqlPassword: '',
        webhookSecret: '',
      },
    };

    const zipBuffer = createZipBuffer([
      ...distEntries,
      { name: '.htaccess', data: Buffer.from(buildHostingerHtaccess(), 'utf-8') },
      { name: 'config.php', data: Buffer.from(buildHostingerConfigPhp(), 'utf-8') },
      { name: 'api.php', data: Buffer.from(buildHostingerApiPhp(), 'utf-8') },
      { name: 'database.sql', data: Buffer.from(buildHostingerSqlFile(db.orders), 'utf-8') },
      { name: 'README-HOSTINGER.txt', data: Buffer.from(buildHostingerReadme(), 'utf-8') },
      { name: 'data/.htaccess', data: Buffer.from(buildHostingerDataHtaccess(), 'utf-8') },
      { name: 'data/portal-db.json', data: Buffer.from(JSON.stringify(dbSnapshot, null, 2), 'utf-8') },
    ]);

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Length', String(zipBuffer.length));
    res.setHeader('Content-Disposition', 'attachment; filename="orderdesk-hostinger-ready.zip"');
    res.send(zipBuffer);
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to build Hostinger ZIP package',
    });
  }
});

// Server-side Gemini Translation for WhatsApp Order Messages (Hindi / Punjabi / Bilingual)
const aiClient = process.env.GEMINI_API_KEY
  ? new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    })
  : null;

app.post('/api/translate', requireAuth, async (req, res) => {
  const text = String(req.body?.text ?? '').trim();
  const targetLanguage = String(req.body?.targetLanguage ?? 'hindi');

  if (!text) {
    res.status(400).json({ error: 'Message text is required for translation' });
    return;
  }

  if (!aiClient) {
    res.status(503).json({ error: 'Translation service is not configured (missing GEMINI_API_KEY)' });
    return;
  }

  let languageInstruction = '';
  if (targetLanguage === 'hindi') {
    languageInstruction =
      'Translate the WhatsApp order message cleanly into natural, simple Hindi (Devanagari script).';
  } else if (targetLanguage === 'punjabi') {
    languageInstruction =
      'Translate the WhatsApp order message cleanly into natural, simple Punjabi (Gurmukhi script).';
  } else if (targetLanguage === 'bilingual_hi') {
    languageInstruction =
      'Rewrite the WhatsApp order message in clean Bilingual format: keep customer name, service, city, and address readable in English AND add a clear Hindi (Devanagari) translation.';
  } else if (targetLanguage === 'bilingual_pa') {
    languageInstruction =
      'Rewrite the WhatsApp order message in clean Bilingual format: keep customer name, service, city, and address readable in English AND add a clear Punjabi (Gurmukhi) translation.';
  } else {
    res.json({ translatedText: text });
    return;
  }

  try {
    const response = await aiClient.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: `Translate this WhatsApp order message:\n\n${text}`,
      config: {
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        systemInstruction: `${languageInstruction}
CRITICAL RULES:
- Preserve ALL emoji order numbers (1️⃣, 2️⃣, 3️⃣, ..., 🔟, etc.) and any other emojis, ALL phone numbers, ALL dates, ALL quantities, and ALL ₹ amounts/prices with 100% accuracy.
- Keep WhatsApp bold formatting (*text*) intact so it looks clean when pasted or shared on WhatsApp.
- Keep it short, simple, and ready to send. Output ONLY the final WhatsApp message with no extra commentary.`,
      },
    });

    const translatedText = (response.text ?? '').trim();
    if (!translatedText) {
      res.status(502).json({ error: 'Translation returned an empty response' });
      return;
    }

    res.json({ translatedText });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Translation failed';
    res.status(500).json({ error: `Translation error: ${message}` });
  }
});

async function startServer() {
  const isProd = process.env.NODE_ENV === 'production';

  if (!isProd) {
    const { createServer } = await import('vite');
    const vite = await createServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('/{*path}', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const PORT = Number(process.env.PORT) || 3000;
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`OrderDesk server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
