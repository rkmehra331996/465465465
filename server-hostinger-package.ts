import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

export interface ZipEntryInput {
  name: string;
  data: Buffer;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

export function createZipBuffer(entries: ZipEntryInput[]): Buffer {
  const localChunks: Buffer[] = [];
  const centralChunks: Buffer[] = [];
  let offset = 0;

  const now = new Date();
  const dosTime =
    ((now.getHours() & 0x1f) << 11) |
    ((now.getMinutes() & 0x3f) << 5) |
    ((now.getSeconds() >> 1) & 0x1f);
  const dosDate =
    (((Math.max(1980, now.getFullYear()) - 1980) & 0x7f) << 9) |
    (((now.getMonth() + 1) & 0xf) << 5) |
    (now.getDate() & 0x1f);

  for (const entry of entries) {
    const cleanName = entry.name.replace(/\\/g, '/').replace(/^\/+/, '');
    const nameBuf = Buffer.from(cleanName, 'utf-8');
    const rawData = entry.data;
    const compressed = zlib.deflateRawSync(rawData);
    const useStore = compressed.length >= rawData.length;
    const payload = useStore ? rawData : compressed;
    const method = useStore ? 0 : 8;
    const crc = crc32(rawData);

    // Local file header (30 bytes + filename)
    const local = Buffer.alloc(30 + nameBuf.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 filename flag
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(rawData.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    nameBuf.copy(local, 30);

    localChunks.push(local, payload);

    // Central directory header (46 bytes + filename)
    const central = Buffer.alloc(46 + nameBuf.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(dosTime, 12);
    central.writeUInt16LE(dosDate, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(payload.length, 20);
    central.writeUInt32LE(rawData.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    nameBuf.copy(central, 46);

    centralChunks.push(central);
    offset += local.length + payload.length;
  }

  const centralSize = centralChunks.reduce((sum, b) => sum + b.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localChunks, ...centralChunks, eocd]);
}

export function collectDirectoryZipEntries(dirPath: string, prefix = ''): ZipEntryInput[] {
  const out: ZipEntryInput[] = [];
  if (!fs.existsSync(dirPath)) return out;
  for (const item of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const full = path.join(dirPath, item.name);
    const rel = prefix ? `${prefix}/${item.name}` : item.name;
    if (item.isDirectory()) {
      out.push(...collectDirectoryZipEntries(full, rel));
    } else if (item.isFile()) {
      out.push({ name: rel, data: fs.readFileSync(full) });
    }
  }
  return out;
}

export function buildHostingerHtaccess(): string {
  return `DirectoryIndex index.html index.php

<IfModule mod_headers.c>
  <FilesMatch "^(index\\.html|api\\.php)$">
    Header set Cache-Control "no-cache, no-store, must-revalidate"
    Header set Pragma "no-cache"
    Header set Expires "0"
  </FilesMatch>
</IfModule>

RewriteEngine On

# Pass Authorization header through Apache / LiteSpeed CGI
RewriteCond %{HTTP:Authorization} .
RewriteRule .* - [E=HTTP_AUTHORIZATION:%{HTTP:Authorization}]

# Protect private data and config files
RewriteRule ^data/ - [F,L]
RewriteRule ^config\\.php$ - [F,L]

# Route all api/* requests (works in root and subfolders) to api.php
RewriteRule ^api/ api.php [QSA,L]

# Serve built static files directly
RewriteCond %{REQUEST_FILENAME} -f [OR]
RewriteCond %{REQUEST_FILENAME} -d
RewriteRule ^ - [L]

# Never rewrite static assets to index.html
RewriteCond %{REQUEST_URI} !\\.(js|css|mjs|png|jpg|jpeg|gif|svg|ico|woff2?|ttf|json|map)$ [NC]
RewriteRule ^ index.html [L]
`;
}

export function buildHostingerDataHtaccess(): string {
  return `<IfModule mod_authz_core.c>
  Require all denied
</IfModule>
<IfModule !mod_authz_core.c>
  Order allow,deny
  Deny from all
</IfModule>
`;
}

export function buildHostingerConfigPhp(): string {
  return `<?php
// Optional Configuration for Hostinger Hosting
// 1) Optional: Add Gemini API Key if you want Hindi/Punjabi auto-translation on Hostinger
define('ORDERDESK_GEMINI_API_KEY', '');

// 2) Optional: Also mirror orders to Hostinger MySQL (leave empty to use data/portal-db.json only)
define('ORDERDESK_MYSQL_HOST', 'localhost');
define('ORDERDESK_MYSQL_NAME', '');
define('ORDERDESK_MYSQL_USER', '');
define('ORDERDESK_MYSQL_PASS', '');
`;
}

export function buildHostingerReadme(): string {
  return `OrderDesk — Hostinger Ready Upload Package
=========================================

Upload & Run (Zero npm install needed):
1. Open Hostinger hPanel -> Files -> File Manager -> public_html
2. Upload this ZIP file and click "Extract" directly inside public_html
   (Make sure index.html, api.php, .htaccess, assets/, and data/ are inside public_html)
3. Open your website domain in Chrome/Mobile — OrderDesk works immediately!

Where does data get saved?
- By default, ALL orders, customers, cities, cleaners, and accounts save automatically
  inside: data/portal-db.json (no MySQL setup required).
- Want Hostinger MySQL database too?
  a) Open Hostinger hPanel -> Databases -> phpMyAdmin -> Import -> select "database.sql" from this ZIP.
  b) Edit config.php and fill ORDERDESK_MYSQL_NAME, ORDERDESK_MYSQL_USER, ORDERDESK_MYSQL_PASS
     (OR enter them in Admin Panel -> Hostinger Sync -> Hostinger MySQL).
  Once filled, every order automatically saves to BOTH data/portal-db.json and MySQL!
`;
}

function sqlStringLiteral(val: string): string {
  return `'${val
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')}'`;
}

export interface SqlOrderInput {
  id: string;
  name: string;
  number: string;
  bookingDate: string;
  address: string;
  serviceName: string;
  city: string;
  qty: number | null;
  price: number;
  extraAmount: number;
  cleanerName: string;
  notes?: string;
  status: string;
  paymentStatus: string;
  paidCommission?: number;
  paymentClearedAt?: string;
  paymentClearedByName?: string;
  paymentNote?: string;
  isExtraWork?: boolean;
  createdById: string;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  completedByName?: string;
}

export function buildHostingerSqlFile(orders: SqlOrderInput[]): string {
  const header = `-- OrderDesk / City Clean Company — Hostinger MySQL Database Dump
-- Import this file via Hostinger hPanel -> Databases -> phpMyAdmin -> Import

SET NAMES utf8mb4;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
`;

  if (orders.length === 0) {
    return `${header}\n-- No orders yet.\n`;
  }

  const statements = orders.map((o) => {
    const vals = [
      sqlStringLiteral(o.id || ''),
      sqlStringLiteral(o.name || ''),
      sqlStringLiteral(o.number || ''),
      sqlStringLiteral(o.bookingDate || ''),
      sqlStringLiteral(o.address || ''),
      sqlStringLiteral(o.serviceName || ''),
      sqlStringLiteral(o.city || ''),
      o.qty !== null && o.qty !== undefined && Number.isFinite(Number(o.qty)) ? String(Number(o.qty)) : 'NULL',
      String(Number(o.price || 0)),
      String(Number(o.extraAmount || 0)),
      sqlStringLiteral(o.cleanerName || ''),
      sqlStringLiteral(o.notes || ''),
      sqlStringLiteral(o.status || 'active'),
      sqlStringLiteral(o.paymentStatus || 'pending'),
      o.paidCommission !== undefined && o.paidCommission !== null ? String(Number(o.paidCommission)) : 'NULL',
      o.paymentClearedAt ? sqlStringLiteral(o.paymentClearedAt) : 'NULL',
      o.paymentClearedByName ? sqlStringLiteral(o.paymentClearedByName) : 'NULL',
      o.paymentNote ? sqlStringLiteral(o.paymentNote) : 'NULL',
      o.isExtraWork ? '1' : '0',
      sqlStringLiteral(o.createdById || ''),
      sqlStringLiteral(o.createdByName || ''),
      sqlStringLiteral(o.createdAt || ''),
      sqlStringLiteral(o.updatedAt || ''),
      o.completedAt ? sqlStringLiteral(o.completedAt) : 'NULL',
      o.completedByName ? sqlStringLiteral(o.completedByName) : 'NULL',
    ].join(', ');

    return `INSERT INTO orderdesk_orders (id, name, number, booking_date, address, service_name, city, qty, price, extra_amount, cleaner_name, notes, status, payment_status, paid_commission, payment_cleared_at, payment_cleared_by_name, payment_note, is_extra_work, created_by_id, created_by_name, created_at, updated_at, completed_at, completed_by_name) VALUES (${vals}) ON DUPLICATE KEY UPDATE name=VALUES(name), number=VALUES(number), booking_date=VALUES(booking_date), address=VALUES(address), service_name=VALUES(service_name), city=VALUES(city), qty=VALUES(qty), price=VALUES(price), extra_amount=VALUES(extra_amount), cleaner_name=VALUES(cleaner_name), notes=VALUES(notes), status=VALUES(status), payment_status=VALUES(payment_status), paid_commission=VALUES(paid_commission), payment_cleared_at=VALUES(payment_cleared_at), payment_cleared_by_name=VALUES(payment_cleared_by_name), payment_note=VALUES(payment_note), is_extra_work=VALUES(is_extra_work), updated_at=VALUES(updated_at), completed_at=VALUES(completed_at), completed_by_name=VALUES(completed_by_name);`;
  });

  return `${header}\n${statements.join('\n')}\n`;
}

export function buildHostingerApiPhp(): string {
  return `<?php
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
if (file_exists(__DIR__ . '/config.php')) {
  require_once __DIR__ . '/config.php';
}

const DB_DIR = __DIR__ . '/data';
const DB_PATH = DB_DIR . '/portal-db.json';
const DEFAULT_SERVICES = ['Water tank', 'Sofa', 'Chimney', 'Home cleaning', 'Bathroom'];
const DEFAULT_CITIES = ['Patiala', 'Ludhiana', 'Jalandhar', 'Chandigarh', 'Moga', 'Khanna', 'Other'];
const DEFAULT_CLEANERS = ['Jagdish', 'Raaj', 'Manish', 'Gurmeet', 'Aman', 'Karan', 'Arun'];

function jsonResponse($data, int $status = 200): void {
  http_response_code($status);
  echo json_encode($data, JSON_UNESCAPED_UNICODE);
  exit;
}

function getJsonBody(): array {
  $raw = file_get_contents('php://input');
  if (!$raw) return [];
  $decoded = json_decode($raw, true);
  return is_array($decoded) ? $decoded : [];
}

function b64urlEncode(string $data): string {
  return rtrim(strtr(base64_encode($data), '+/', '-_'), '=');
}

function b64urlDecode(string $data): string {
  $pad = strlen($data) % 4;
  if ($pad > 0) $data .= str_repeat('=', 4 - $pad);
  return base64_decode(strtr($data, '-_', '+/')) ?: '';
}

function hashPasswordValue(string $password): string {
  $salt = bin2hex(random_bytes(16));
  $hash = hash_pbkdf2('sha256', $password, $salt, 100000, 64);
  return 'pbkdf2:' . $salt . ':' . $hash;
}

function verifyPasswordValue(string $password, array $user): bool {
  $phpHash = (string)($user['phpPasswordHash'] ?? '');
  $mainHash = (string)($user['passwordHash'] ?? '');
  foreach ([$phpHash, $mainHash] as $stored) {
    if (!$stored) continue;
    if (str_starts_with($stored, 'pbkdf2:')) {
      $parts = explode(':', $stored, 3);
      if (count($parts) === 3) {
        $calc = hash_pbkdf2('sha256', $password, $parts[1], 100000, 64);
        if (hash_equals($parts[2], $calc)) return true;
      }
    } elseif (str_starts_with($stored, '$2')) {
      if (password_verify($password, $stored)) return true;
    }
  }
  return false;
}

function loadDb(): array {
  if (!is_dir(DB_DIR)) {
    mkdir(DB_DIR, 0755, true);
  }
  if (!file_exists(DB_PATH)) {
    $init = [
      'sessionSecret' => bin2hex(random_bytes(32)),
      'cities' => DEFAULT_CITIES,
      'cleaners' => DEFAULT_CLEANERS,
      'cleanerProfiles' => (object)[],
      'users' => [],
      'orders' => [],
      'hostinger' => [
        'mode' => 'none',
        'autoSync' => false,
        'mysqlHost' => 'localhost',
        'mysqlPort' => 3306,
        'mysqlDatabase' => '',
        'mysqlUser' => '',
        'mysqlPassword' => '',
        'webhookUrl' => '',
        'webhookSecret' => '',
      ],
    ];
    file_put_contents(DB_PATH, json_encode($init, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE), LOCK_EX);
    return $init;
  }
  $raw = file_get_contents(DB_PATH);
  $parsed = json_decode($raw ?: '{}', true);
  if (!is_array($parsed)) $parsed = [];
  if (empty($parsed['sessionSecret'])) $parsed['sessionSecret'] = bin2hex(random_bytes(32));
  if (empty($parsed['cities']) || !is_array($parsed['cities'])) $parsed['cities'] = DEFAULT_CITIES;
  if (empty($parsed['cleaners']) || !is_array($parsed['cleaners'])) $parsed['cleaners'] = DEFAULT_CLEANERS;
  if (!isset($parsed['cleanerProfiles']) || !is_array($parsed['cleanerProfiles'])) $parsed['cleanerProfiles'] = [];
  if (!isset($parsed['users']) || !is_array($parsed['users'])) $parsed['users'] = [];
  if (!isset($parsed['orders']) || !is_array($parsed['orders'])) $parsed['orders'] = [];
  if (!isset($parsed['hostinger']) || !is_array($parsed['hostinger'])) {
    $parsed['hostinger'] = ['mode' => 'none', 'autoSync' => false, 'mysqlHost' => 'localhost', 'mysqlPort' => 3306, 'mysqlDatabase' => '', 'mysqlUser' => '', 'mysqlPassword' => '', 'webhookUrl' => '', 'webhookSecret' => ''];
  }
  return $parsed;
}

function resolveMysqlSettings(array $db): ?array {
  $cfgName = defined('ORDERDESK_MYSQL_NAME') ? trim((string)ORDERDESK_MYSQL_NAME) : '';
  $cfgUser = defined('ORDERDESK_MYSQL_USER') ? trim((string)ORDERDESK_MYSQL_USER) : '';
  if ($cfgName !== '' && $cfgUser !== '') {
    return [
      'host' => (defined('ORDERDESK_MYSQL_HOST') && ORDERDESK_MYSQL_HOST) ? (string)ORDERDESK_MYSQL_HOST : 'localhost',
      'port' => 3306,
      'database' => $cfgName,
      'user' => $cfgUser,
      'password' => defined('ORDERDESK_MYSQL_PASS') ? (string)ORDERDESK_MYSQL_PASS : '',
    ];
  }
  $h = $db['hostinger'] ?? [];
  if (($h['mode'] ?? '') === 'mysql' && !empty($h['mysqlDatabase']) && !empty($h['mysqlUser'])) {
    return [
      'host' => !empty($h['mysqlHost']) ? (string)$h['mysqlHost'] : 'localhost',
      'port' => (int)($h['mysqlPort'] ?? 3306) ?: 3306,
      'database' => (string)$h['mysqlDatabase'],
      'user' => (string)$h['mysqlUser'],
      'password' => (string)($h['mysqlPassword'] ?? ''),
    ];
  }
  return null;
}

function openMysqlPdo(array $cfg): PDO {
  $dsn = sprintf('mysql:host=%s;port=%d;dbname=%s;charset=utf8mb4', $cfg['host'], $cfg['port'], $cfg['database']);
  return new PDO($dsn, $cfg['user'], $cfg['password'], [
    PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
    PDO::ATTR_TIMEOUT => 8,
  ]);
}

function ensureMysqlOrdersTable(PDO $pdo): void {
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
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
}

function syncOrdersToMysql(array $db, ?array $cfgOverride = null): int {
  $cfg = $cfgOverride ?? resolveMysqlSettings($db);
  if (!$cfg) return 0;
  $pdo = openMysqlPdo($cfg);
  ensureMysqlOrdersTable($pdo);
  $stmt = $pdo->prepare("INSERT INTO orderdesk_orders
    (id, name, number, booking_date, address, service_name, city, qty, price, extra_amount, cleaner_name, notes, status, payment_status, paid_commission, payment_cleared_at, payment_cleared_by_name, payment_note, is_extra_work, created_by_id, created_by_name, created_at, updated_at, completed_at, completed_by_name)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      name=VALUES(name), number=VALUES(number), booking_date=VALUES(booking_date), address=VALUES(address),
      service_name=VALUES(service_name), city=VALUES(city), qty=VALUES(qty), price=VALUES(price),
      extra_amount=VALUES(extra_amount), cleaner_name=VALUES(cleaner_name), notes=VALUES(notes),
      status=VALUES(status), payment_status=VALUES(payment_status), paid_commission=VALUES(paid_commission),
      payment_cleared_at=VALUES(payment_cleared_at), payment_cleared_by_name=VALUES(payment_cleared_by_name),
      payment_note=VALUES(payment_note), is_extra_work=VALUES(is_extra_work), updated_at=VALUES(updated_at),
      completed_at=VALUES(completed_at), completed_by_name=VALUES(completed_by_name)");
  $orders = $db['orders'] ?? [];
  foreach ($orders as $o) {
    $stmt->execute([
      (string)($o['id'] ?? ''),
      (string)($o['name'] ?? ''),
      (string)($o['number'] ?? ''),
      (string)($o['bookingDate'] ?? ''),
      (string)($o['address'] ?? ''),
      (string)($o['serviceName'] ?? ''),
      (string)($o['city'] ?? ''),
      isset($o['qty']) && $o['qty'] !== null ? (float)$o['qty'] : null,
      (float)($o['price'] ?? 0),
      (float)($o['extraAmount'] ?? 0),
      (string)($o['cleanerName'] ?? ''),
      (string)($o['notes'] ?? ''),
      (string)($o['status'] ?? 'active'),
      (string)($o['paymentStatus'] ?? 'pending'),
      isset($o['paidCommission']) && $o['paidCommission'] !== null ? (float)$o['paidCommission'] : null,
      $o['paymentClearedAt'] ?? null,
      $o['paymentClearedByName'] ?? null,
      $o['paymentNote'] ?? null,
      !empty($o['isExtraWork']) ? 1 : 0,
      (string)($o['createdById'] ?? ''),
      (string)($o['createdByName'] ?? ''),
      (string)($o['createdAt'] ?? ''),
      (string)($o['updatedAt'] ?? ''),
      $o['completedAt'] ?? null,
      $o['completedByName'] ?? null,
    ]);
  }
  return count($orders);
}

function saveDb(array $db, bool $skipMysqlSync = false): void {
  if (!is_dir(DB_DIR)) {
    mkdir(DB_DIR, 0755, true);
  }
  $json = json_encode($db, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
  file_put_contents(DB_PATH, $json, LOCK_EX);
  if (!$skipMysqlSync) {
    $cfgName = defined('ORDERDESK_MYSQL_NAME') ? trim((string)ORDERDESK_MYSQL_NAME) : '';
    $h = $db['hostinger'] ?? [];
    $shouldAuto = ($cfgName !== '') || (($h['mode'] ?? '') === 'mysql' && !empty($h['autoSync']));
    if ($shouldAuto) {
      try {
        syncOrdersToMysql($db);
      } catch (Throwable $e) {
        // Keep JSON storage reliable even if MySQL is unreachable
      }
    }
  }
}

function signToken(string $userId, string $secret): string {
  $payload = b64urlEncode(json_encode([
    'uid' => $userId,
    'iat' => time() * 1000,
    'exp' => (time() + 7 * 86400) * 1000,
  ]));
  $sig = b64urlEncode(hash_hmac('sha256', $payload, $secret, true));
  return $payload . '.' . $sig;
}

function verifyToken(string $token, string $secret): ?string {
  $parts = explode('.', $token);
  if (count($parts) !== 2) return null;
  [$payload, $sig] = $parts;
  $expected = b64urlEncode(hash_hmac('sha256', $payload, $secret, true));
  if (!hash_equals($expected, $sig)) return null;
  $decoded = json_decode(b64urlDecode($payload), true);
  if (!is_array($decoded) || empty($decoded['uid']) || empty($decoded['exp'])) return null;
  if (time() * 1000 > (float)$decoded['exp']) return null;
  return (string)$decoded['uid'];
}

function toPublicUser(array $u): array {
  return [
    'id' => $u['id'] ?? '',
    'name' => $u['name'] ?? '',
    'username' => $u['username'] ?? '',
    'role' => $u['role'] ?? 'telecaller',
    'active' => (bool)($u['active'] ?? true),
    'createdAt' => $u['createdAt'] ?? '',
  ];
}

function requireAuth(array $db): array {
  $headers = function_exists('getallheaders') ? getallheaders() : [];
  $authHeader = $headers['Authorization']
    ?? $headers['authorization']
    ?? ($_SERVER['HTTP_AUTHORIZATION'] ?? ($_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? ''));
  $token = null;
  if ($authHeader && str_starts_with($authHeader, 'Bearer ')) {
    $token = trim(substr($authHeader, 7));
  } elseif (!empty($_COOKIE['od_session'])) {
    $token = $_COOKIE['od_session'];
  }
  if (!$token) jsonResponse(['error' => 'Authentication required'], 401);
  $uid = verifyToken($token, (string)$db['sessionSecret']);
  if (!$uid) jsonResponse(['error' => 'Session expired or invalid'], 401);
  foreach ($db['users'] as $u) {
    if (($u['id'] ?? '') === $uid && !empty($u['active'])) return $u;
  }
  jsonResponse(['error' => 'Account inactive or not found'], 401);
  return [];
}

function requireSuperAdmin(array $user): void {
  if (($user['role'] ?? '') !== 'super_admin') {
    jsonResponse(['error' => 'Super Admin access required'], 403);
  }
}

function normalizePhoneDigits(string $raw): string {
  $digits = preg_replace('/\\D/', '', $raw) ?? '';
  if (strlen($digits) > 10) return substr($digits, -10);
  return $digits;
}

function calcOrderCommission30($price, $extraAmount): float {
  return round(((float)$price + (float)$extraAmount) * 0.3, 2);
}

function newId(string $prefix): string {
  return $prefix . '-' . bin2hex(random_bytes(4));
}

$db = loadDb();
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$overrideRoute = isset($_GET['__route']) ? trim((string)$_GET['__route']) : '';
if ($overrideRoute !== '') {
  $uriPath = $overrideRoute;
} else {
  $rawPath = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
  $apiPos = strpos($rawPath, '/api/');
  $uriPath = $apiPos !== false ? substr($rawPath, $apiPos) : $rawPath;
}
$body = getJsonBody();

// Auth
if ($method === 'POST' && $uriPath === '/api/auth/login') {
  $username = trim((string)($body['username'] ?? ''));
  $password = (string)($body['password'] ?? '');
  if ($username === '' || $password === '') {
    jsonResponse(['error' => 'Username and password are required'], 400);
  }
  $found = null;
  foreach ($db['users'] as $u) {
    if (strtolower((string)($u['username'] ?? '')) === strtolower($username)) {
      $found = $u;
      break;
    }
  }
  if (!$found || !verifyPasswordValue($password, $found)) {
    jsonResponse(['error' => 'Invalid username or password'], 401);
  }
  if (empty($found['active'])) {
    jsonResponse(['error' => 'Account is disabled by Super Admin'], 403);
  }
  $token = signToken((string)$found['id'], (string)$db['sessionSecret']);
  setcookie('od_session', $token, [
    'expires' => time() + 7 * 86400,
    'path' => '/',
    'httponly' => true,
    'samesite' => 'Lax',
  ]);
  jsonResponse(['token' => $token, 'user' => toPublicUser($found)]);
}

if ($method === 'POST' && $uriPath === '/api/auth/logout') {
  setcookie('od_session', '', ['expires' => time() - 3600, 'path' => '/']);
  jsonResponse(['ok' => true]);
}

if ($method === 'GET' && $uriPath === '/api/auth/me') {
  $user = requireAuth($db);
  jsonResponse(['user' => toPublicUser($user)]);
}

// Config
if ($method === 'GET' && $uriPath === '/api/config') {
  requireAuth($db);
  $staff = [];
  foreach ($db['users'] as $u) {
    if (!empty($u['active'])) {
      $staff[] = [
        'id' => (string)($u['id'] ?? ''),
        'name' => (string)($u['name'] ?? ''),
        'username' => (string)($u['username'] ?? ''),
        'role' => (string)($u['role'] ?? 'telecaller'),
      ];
    }
  }
  jsonResponse([
    'cities' => $db['cities'],
    'cleaners' => $db['cleaners'],
    'services' => DEFAULT_SERVICES,
    'cleanerProfiles' => empty($db['cleanerProfiles']) ? (object)[] : $db['cleanerProfiles'],
    'telecallers' => $staff,
  ]);
}

if ($method === 'POST' && $uriPath === '/api/config/cities') {
  $user = requireAuth($db);
  requireSuperAdmin($user);
  $city = trim((string)($body['name'] ?? ''));
  if ($city === '') jsonResponse(['error' => 'City name is required'], 400);
  foreach ($db['cities'] as $c) {
    if (strtolower($c) === strtolower($city)) jsonResponse(['error' => 'City already exists'], 409);
  }
  $db['cities'][] = $city;
  saveDb($db);
  jsonResponse(['cities' => $db['cities']], 201);
}

if ($method === 'DELETE' && preg_match('#^/api/config/cities/(.+)$#', $uriPath, $m)) {
  $user = requireAuth($db);
  requireSuperAdmin($user);
  $target = trim(urldecode($m[1]));
  $db['cities'] = array_values(array_filter($db['cities'], fn($c) => strtolower($c) !== strtolower($target)));
  saveDb($db);
  jsonResponse(['cities' => $db['cities']]);
}

if ($method === 'POST' && $uriPath === '/api/config/cleaners') {
  $user = requireAuth($db);
  requireSuperAdmin($user);
  $cleaner = trim((string)($body['name'] ?? ''));
  $phone = trim((string)($body['phone'] ?? ''));
  $city = trim((string)($body['city'] ?? ''));
  if ($cleaner === '') jsonResponse(['error' => 'Cleaner name is required'], 400);
  foreach ($db['cleaners'] as $c) {
    if (strtolower($c) === strtolower($cleaner)) jsonResponse(['error' => 'Cleaner already exists'], 409);
  }
  $db['cleaners'][] = $cleaner;
  if ($phone !== '' || $city !== '') {
    $db['cleanerProfiles'][$cleaner] = ['phone' => $phone, 'city' => $city];
  }
  saveDb($db);
  jsonResponse(['cleaners' => $db['cleaners'], 'cleanerProfiles' => empty($db['cleanerProfiles']) ? (object)[] : $db['cleanerProfiles']], 201);
}

if ($method === 'PATCH' && preg_match('#^/api/config/cleaners/(.+)$#', $uriPath, $m)) {
  $user = requireAuth($db);
  requireSuperAdmin($user);
  $target = trim(urldecode($m[1]));
  $matched = $target;
  foreach ($db['cleaners'] as $c) {
    if (strtolower($c) === strtolower($target)) { $matched = $c; break; }
  }
  $db['cleanerProfiles'][$matched] = [
    'phone' => trim((string)($body['phone'] ?? '')),
    'city' => trim((string)($body['city'] ?? '')),
  ];
  saveDb($db);
  jsonResponse(['cleanerProfiles' => $db['cleanerProfiles']]);
}

if ($method === 'DELETE' && preg_match('#^/api/config/cleaners/(.+)$#', $uriPath, $m)) {
  $user = requireAuth($db);
  requireSuperAdmin($user);
  $target = trim(urldecode($m[1]));
  $db['cleaners'] = array_values(array_filter($db['cleaners'], fn($c) => strtolower($c) !== strtolower($target)));
  foreach (array_keys($db['cleanerProfiles']) as $k) {
    if (strtolower($k) === strtolower($target)) unset($db['cleanerProfiles'][$k]);
  }
  saveDb($db);
  jsonResponse(['cleaners' => $db['cleaners'], 'cleanerProfiles' => empty($db['cleanerProfiles']) ? (object)[] : $db['cleanerProfiles']]);
}

// Telecallers
if ($method === 'GET' && $uriPath === '/api/telecallers') {
  $user = requireAuth($db);
  requireSuperAdmin($user);
  jsonResponse(['users' => array_map('toPublicUser', $db['users'])]);
}

if ($method === 'POST' && $uriPath === '/api/telecallers') {
  $user = requireAuth($db);
  requireSuperAdmin($user);
  $name = trim((string)($body['name'] ?? ''));
  $username = trim((string)($body['username'] ?? ''));
  $password = (string)($body['password'] ?? '');
  if ($name === '' || $username === '' || strlen($password) < 4) {
    jsonResponse(['error' => 'Name, username, and password (min 4 chars) are required'], 400);
  }
  foreach ($db['users'] as $u) {
    if (strtolower((string)$u['username']) === strtolower($username)) {
      jsonResponse(['error' => 'A user with this username already exists'], 409);
    }
  }
  $hashed = hashPasswordValue($password);
  $newUser = [
    'id' => newId('tc'),
    'name' => $name,
    'username' => $username,
    'passwordHash' => $hashed,
    'phpPasswordHash' => $hashed,
    'role' => 'telecaller',
    'active' => true,
    'createdAt' => gmdate('c'),
  ];
  $db['users'][] = $newUser;
  saveDb($db);
  jsonResponse(['user' => toPublicUser($newUser)], 201);
}

if ($method === 'PATCH' && preg_match('#^/api/telecallers/([^/]+)$#', $uriPath, $m)) {
  $user = requireAuth($db);
  requireSuperAdmin($user);
  $id = $m[1];
  $idx = null;
  foreach ($db['users'] as $i => $u) {
    if (($u['id'] ?? '') === $id) { $idx = $i; break; }
  }
  if ($idx === null) jsonResponse(['error' => 'User not found'], 404);
  $target = $db['users'][$idx];
  if (($target['role'] ?? '') === 'super_admin') {
    jsonResponse(['error' => 'Cannot modify Super Admin account from this panel'], 400);
  }
  if (isset($body['name']) && trim((string)$body['name']) !== '') $target['name'] = trim((string)$body['name']);
  if (isset($body['active']) && is_bool($body['active'])) $target['active'] = $body['active'];
  if (isset($body['password']) && strlen((string)$body['password']) >= 4) {
    $hashed = hashPasswordValue((string)$body['password']);
    $target['passwordHash'] = $hashed;
    $target['phpPasswordHash'] = $hashed;
  }
  $db['users'][$idx] = $target;
  saveDb($db);
  jsonResponse(['user' => toPublicUser($target)]);
}

if ($method === 'DELETE' && preg_match('#^/api/telecallers/([^/]+)$#', $uriPath, $m)) {
  $user = requireAuth($db);
  requireSuperAdmin($user);
  $id = $m[1];
  foreach ($db['users'] as $u) {
    if (($u['id'] ?? '') === $id && ($u['role'] ?? '') === 'super_admin') {
      jsonResponse(['error' => 'Cannot delete Super Admin account'], 400);
    }
  }
  $db['users'] = array_values(array_filter($db['users'], fn($u) => ($u['id'] ?? '') !== $id));
  saveDb($db);
  jsonResponse(['ok' => true]);
}

// Orders
if ($method === 'GET' && $uriPath === '/api/orders/check-duplicate') {
  requireAuth($db);
  $targetDigits = normalizePhoneDigits((string)($_GET['number'] ?? ''));
  if (strlen($targetDigits) < 8) jsonResponse(['matches' => []]);
  $matches = [];
  foreach ($db['orders'] as $o) {
    $d = normalizePhoneDigits((string)($o['number'] ?? ''));
    if (strlen($d) >= 8 && $d === $targetDigits) {
      $matches[] = [
        'id' => $o['id'],
        'name' => $o['name'] ?? '',
        'number' => $o['number'] ?? '',
        'bookingDate' => $o['bookingDate'] ?? '',
        'address' => $o['address'] ?? '',
        'serviceName' => $o['serviceName'] ?? '',
        'city' => $o['city'] ?? '',
        'price' => $o['price'] ?? 0,
        'cleanerName' => $o['cleanerName'] ?? '',
        'status' => $o['status'] ?? 'active',
        'createdById' => $o['createdById'] ?? '',
        'createdByName' => $o['createdByName'] ?? '',
        'createdAt' => $o['createdAt'] ?? '',
      ];
    }
  }
  usort($matches, function ($a, $b) {
    if ($a['status'] !== $b['status']) return $a['status'] === 'active' ? -1 : 1;
    return strcmp((string)$b['createdAt'], (string)$a['createdAt']);
  });
  jsonResponse(['matches' => $matches]);
}

if ($method === 'GET' && $uriPath === '/api/orders') {
  $user = requireAuth($db);
  $visible = ($user['role'] ?? '') === 'super_admin'
    ? $db['orders']
    : array_values(array_filter($db['orders'], fn($o) => ($o['createdById'] ?? '') === ($user['id'] ?? '') || ($o['transferredFromId'] ?? '') === ($user['id'] ?? '')));
  jsonResponse(['orders' => $visible]);
}

if ($method === 'POST' && $uriPath === '/api/orders') {
  $user = requireAuth($db);
  $name = trim((string)($body['name'] ?? ''));
  $number = trim((string)($body['number'] ?? ''));
  $isExtraWork = !empty($body['isExtraWork']);
  if ($number === '' && !$isExtraWork) jsonResponse(['error' => 'Phone Number is required'], 400);
  $price = max(0, (float)($body['price'] ?? 0));
  $extraAmount = max(0, (float)($body['extraAmount'] ?? 0));
  $comm30 = calcOrderCommission30($price, $extraAmount);
  $status = ($body['status'] ?? '') === 'completed' ? 'completed' : 'active';
  $payStatus = ($body['paymentStatus'] ?? '') === 'clear' ? 'clear' : 'pending';
  $paidComm = isset($body['paidCommission']) && is_numeric($body['paidCommission'])
    ? min($comm30, max(0, (float)$body['paidCommission']))
    : ($payStatus === 'clear' ? $comm30 : 0);
  $qty = isset($body['qty']) && is_numeric($body['qty']) && (float)$body['qty'] > 0 ? (float)$body['qty'] : null;
  $now = gmdate('c');
  $newOrder = [
    'id' => newId('ord'),
    'name' => $name,
    'number' => $number,
    'bookingDate' => trim((string)($body['bookingDate'] ?? '')),
    'address' => trim((string)($body['address'] ?? '')),
    'serviceName' => trim((string)($body['serviceName'] ?? DEFAULT_SERVICES[0])) ?: DEFAULT_SERVICES[0],
    'city' => trim((string)($body['city'] ?? ($db['cities'][0] ?? 'Other'))) ?: 'Other',
    'qty' => $qty,
    'price' => $price,
    'extraAmount' => $extraAmount,
    'cleanerName' => trim((string)($body['cleanerName'] ?? ($db['cleaners'][0] ?? 'Jagdish'))) ?: 'Jagdish',
    'notes' => trim((string)($body['notes'] ?? '')) ?: null,
    'status' => $status,
    'paymentStatus' => ($paidComm >= $comm30 && $payStatus === 'clear') ? 'clear' : $payStatus,
    'paidCommission' => $paidComm,
    'paymentClearedAt' => $payStatus === 'clear' ? $now : null,
    'paymentClearedByName' => $payStatus === 'clear' ? $user['name'] : null,
    'paymentNote' => trim((string)($body['paymentNote'] ?? '')) ?: null,
    'isExtraWork' => $isExtraWork ?: null,
    'createdById' => $user['id'],
    'createdByName' => $user['name'],
    'createdAt' => $now,
    'updatedAt' => $now,
    'completedAt' => $status === 'completed' ? $now : null,
    'completedByName' => $status === 'completed' ? $user['name'] : null,
  ];
  $newOrder = array_filter($newOrder, fn($v, $k) => $v !== null || $k === 'qty', ARRAY_FILTER_USE_BOTH);
  array_unshift($db['orders'], $newOrder);
  saveDb($db);
  jsonResponse(['order' => $newOrder], 201);
}

if ($method === 'POST' && $uriPath === '/api/orders/bulk-complete') {
  $user = requireAuth($db);
  $ids = is_array($body['ids'] ?? null) ? $body['ids'] : [];
  if (empty($ids)) jsonResponse(['error' => 'No order IDs provided'], 400);
  $now = gmdate('c');
  $idSet = array_flip($ids);
  foreach ($db['orders'] as $i => $o) {
    if (!isset($idSet[$o['id']])) continue;
    if (($user['role'] ?? '') !== 'super_admin' && ($o['createdById'] ?? '') !== $user['id']) continue;
    $db['orders'][$i]['status'] = 'completed';
    $db['orders'][$i]['updatedAt'] = $now;
    $db['orders'][$i]['completedAt'] = $o['completedAt'] ?? $now;
    $db['orders'][$i]['completedByName'] = $o['completedByName'] ?? $user['name'];
  }
  saveDb($db);
  jsonResponse(['ok' => true]);
}

if ($method === 'POST' && $uriPath === '/api/orders/bulk-payment') {
  $user = requireAuth($db);
  $now = gmdate('c');
  $updatedOrders = [];

  if (!empty($body['updates']) && is_array($body['updates'])) {
    $map = [];
    foreach ($body['updates'] as $item) {
      if (!empty($item['id']) && isset($item['paidCommission']) && is_numeric($item['paidCommission'])) {
        $map[$item['id']] = [
          'paidCommission' => max(0, (float)$item['paidCommission']),
          'paymentNote' => isset($item['paymentNote']) ? trim((string)$item['paymentNote']) : null,
        ];
      }
    }
    foreach ($db['orders'] as $i => $o) {
      if (!isset($map[$o['id']])) continue;
      if (($user['role'] ?? '') !== 'super_admin' && ($o['createdById'] ?? '') !== $user['id']) continue;
      $comm30 = calcOrderCommission30($o['price'] ?? 0, $o['extraAmount'] ?? 0);
      $paid = min($comm30, $map[$o['id']]['paidCommission']);
      $status = $paid >= $comm30 ? 'clear' : 'pending';
      $db['orders'][$i]['paymentStatus'] = $status;
      $db['orders'][$i]['paidCommission'] = $paid;
      $db['orders'][$i]['updatedAt'] = $now;
      if ($status === 'clear') {
        $db['orders'][$i]['paymentClearedAt'] = $o['paymentClearedAt'] ?? $now;
        $db['orders'][$i]['paymentClearedByName'] = $o['paymentClearedByName'] ?? $user['name'];
      } else {
        unset($db['orders'][$i]['paymentClearedAt'], $db['orders'][$i]['paymentClearedByName']);
      }
      if ($map[$o['id']]['paymentNote'] !== null) {
        if ($map[$o['id']]['paymentNote'] !== '') $db['orders'][$i]['paymentNote'] = $map[$o['id']]['paymentNote'];
        else unset($db['orders'][$i]['paymentNote']);
      }
      $updatedOrders[] = $db['orders'][$i];
    }
    saveDb($db);
    jsonResponse(['ok' => true, 'orders' => $updatedOrders]);
  }

  $ids = is_array($body['ids'] ?? null) ? $body['ids'] : [];
  if (empty($ids)) jsonResponse(['error' => 'No order IDs provided'], 400);
  $payStatus = ($body['paymentStatus'] ?? '') === 'pending' ? 'pending' : 'clear';
  $payNote = isset($body['paymentNote']) ? trim((string)$body['paymentNote']) : null;
  $idSet = array_flip($ids);
  foreach ($db['orders'] as $i => $o) {
    if (!isset($idSet[$o['id']])) continue;
    if (($user['role'] ?? '') !== 'super_admin' && ($o['createdById'] ?? '') !== $user['id']) continue;
    $comm30 = calcOrderCommission30($o['price'] ?? 0, $o['extraAmount'] ?? 0);
    $db['orders'][$i]['paymentStatus'] = $payStatus;
    $db['orders'][$i]['paidCommission'] = $payStatus === 'clear' ? $comm30 : 0;
    $db['orders'][$i]['updatedAt'] = $now;
    if ($payStatus === 'clear') {
      $db['orders'][$i]['paymentClearedAt'] = $o['paymentClearedAt'] ?? $now;
      $db['orders'][$i]['paymentClearedByName'] = $o['paymentClearedByName'] ?? $user['name'];
    } else {
      unset($db['orders'][$i]['paymentClearedAt'], $db['orders'][$i]['paymentClearedByName']);
    }
    if ($payNote !== null) {
      if ($payNote !== '') $db['orders'][$i]['paymentNote'] = $payNote;
      else unset($db['orders'][$i]['paymentNote']);
    }
    $updatedOrders[] = $db['orders'][$i];
  }
  saveDb($db);
  jsonResponse(['ok' => true, 'orders' => $updatedOrders]);
}

if ($method === 'POST' && $uriPath === '/api/orders/transfer') {
  $user = requireAuth($db);
  $ids = is_array($body['ids'] ?? null) ? array_values(array_filter(array_map('strval', $body['ids']))) : [];
  $targetUserId = trim((string)($body['targetUserId'] ?? ''));
  if (empty($ids)) jsonResponse(['error' => 'No order IDs provided'], 400);
  if ($targetUserId === '') jsonResponse(['error' => 'Target telecaller is required'], 400);

  $targetUser = null;
  foreach ($db['users'] as $u) {
    if (($u['id'] ?? '') === $targetUserId && !empty($u['active'])) {
      $targetUser = $u;
      break;
    }
  }
  if ($targetUser === null) {
    jsonResponse(['error' => 'Selected telecaller account was not found or is inactive'], 404);
  }

  $idSet = array_flip($ids);
  $now = gmdate('c');
  $updatedOrders = [];
  $unauthorizedCount = 0;

  foreach ($db['orders'] as $i => $o) {
    if (!isset($idSet[$o['id']])) continue;
    if (($user['role'] ?? '') !== 'super_admin' && ($o['createdById'] ?? '') !== ($user['id'] ?? '')) {
      $unauthorizedCount++;
      continue;
    }
    if (($o['createdById'] ?? '') === $targetUser['id']) {
      $updatedOrders[] = $o;
      continue;
    }
    $db['orders'][$i]['transferredFromId'] = ($o['createdById'] ?? '') !== '' ? $o['createdById'] : ($user['id'] ?? '');
    $db['orders'][$i]['transferredFromName'] = ($o['createdByName'] ?? '') !== '' ? $o['createdByName'] : ($user['name'] ?? '');
    $db['orders'][$i]['transferredAt'] = $now;
    $db['orders'][$i]['createdById'] = $targetUser['id'];
    $db['orders'][$i]['createdByName'] = $targetUser['name'];
    $db['orders'][$i]['updatedAt'] = $now;
    $updatedOrders[] = $db['orders'][$i];
  }

  if (empty($updatedOrders)) {
    jsonResponse([
      'error' => $unauthorizedCount > 0
        ? 'Not authorized to pass one or more selected orders'
        : 'No matching orders found',
    ], $unauthorizedCount > 0 ? 403 : 404);
  }

  saveDb($db);
  jsonResponse([
    'ok' => true,
    'targetUser' => ['id' => $targetUser['id'], 'name' => $targetUser['name']],
    'orders' => $updatedOrders,
  ]);
}

if ($method === 'POST' && $uriPath === '/api/orders/untransfer') {
  $user = requireAuth($db);
  $ids = is_array($body['ids'] ?? null) ? array_values(array_filter(array_map('strval', $body['ids']))) : [];
  if (empty($ids)) jsonResponse(['error' => 'No order IDs provided'], 400);

  $idSet = array_flip($ids);
  $now = gmdate('c');
  $updatedOrders = [];
  $unauthorizedCount = 0;

  $usersById = [];
  foreach ($db['users'] as $u) {
    if (!empty($u['id'])) $usersById[$u['id']] = $u;
  }

  foreach ($db['orders'] as $i => $o) {
    if (!isset($idSet[$o['id']])) continue;
    $fromId = (string)($o['transferredFromId'] ?? '');
    if ($fromId === '') continue;
    if (($user['role'] ?? '') !== 'super_admin' && $fromId !== ($user['id'] ?? '')) {
      $unauthorizedCount++;
      continue;
    }

    $origUser = $usersById[$fromId] ?? null;
    $db['orders'][$i]['createdById'] = $origUser['id'] ?? $fromId;
    $db['orders'][$i]['createdByName'] = $origUser['name'] ?? ($o['transferredFromName'] ?? ($user['name'] ?? ''));
    unset($db['orders'][$i]['transferredFromId']);
    unset($db['orders'][$i]['transferredFromName']);
    unset($db['orders'][$i]['transferredAt']);
    $db['orders'][$i]['updatedAt'] = $now;
    $updatedOrders[] = $db['orders'][$i];
  }

  if (empty($updatedOrders)) {
    jsonResponse([
      'error' => $unauthorizedCount > 0
        ? 'Not authorized to unsend one or more selected orders'
        : 'No transferred orders found to unsend',
    ], $unauthorizedCount > 0 ? 403 : 400);
  }

  saveDb($db);
  jsonResponse([
    'ok' => true,
    'orders' => $updatedOrders,
  ]);
}

if ($method === 'POST' && $uriPath === '/api/orders/bulk-import') {
  $user = requireAuth($db);
  $rows = is_array($body['rows'] ?? null) ? $body['rows'] : [];
  if (empty($rows)) jsonResponse(['error' => 'No rows provided for import'], 400);
  $autoAdd = ($body['autoAddDropdowns'] ?? true) !== false;
  $skipDup = !empty($body['skipDuplicateNumbers']);
  $existingDigits = [];
  if ($skipDup) {
    foreach ($db['orders'] as $o) {
      $d = normalizePhoneDigits((string)($o['number'] ?? ''));
      if (strlen($d) >= 8) $existingDigits[$d] = true;
    }
  }
  $created = [];
  $skipped = 0;
  $now = gmdate('c');
  foreach ($rows as $r) {
    if (!is_array($r)) { $skipped++; continue; }
    $number = trim((string)($r['number'] ?? ''));
    $name = trim((string)($r['name'] ?? ''));
    if ($number === '' && $name === '') { $skipped++; continue; }
    $d = normalizePhoneDigits($number);
    if ($skipDup && strlen($d) >= 8 && isset($existingDigits[$d])) { $skipped++; continue; }
    if (strlen($d) >= 8) $existingDigits[$d] = true;
    $city = trim((string)($r['city'] ?? '')) ?: ($db['cities'][0] ?? 'Other');
    $cleaner = trim((string)($r['cleanerName'] ?? '')) ?: ($db['cleaners'][0] ?? 'Jagdish');
    $service = trim((string)($r['serviceName'] ?? '')) ?: DEFAULT_SERVICES[0];
    $price = max(0, (float)($r['price'] ?? 0));
    $extra = max(0, (float)($r['extraAmount'] ?? 0));
    $comm30 = calcOrderCommission30($price, $extra);
    $status = ($r['status'] ?? '') === 'completed' ? 'completed' : 'active';
    $payStatus = ($r['paymentStatus'] ?? '') === 'clear' ? 'clear' : 'pending';
    $paid = isset($r['paidCommission']) && is_numeric($r['paidCommission'])
      ? min($comm30, max(0, (float)$r['paidCommission']))
      : ($payStatus === 'clear' ? $comm30 : 0);
    $finalPay = ($paid >= $comm30 && $comm30 > 0) ? 'clear' : $payStatus;

    if ($autoAdd) {
      $hasCity = false;
      foreach ($db['cities'] as $c) if (strtolower($c) === strtolower($city)) { $hasCity = true; break; }
      if (!$hasCity) $db['cities'][] = $city;
      $hasCl = false;
      foreach ($db['cleaners'] as $c) if (strtolower($c) === strtolower($cleaner)) { $hasCl = true; break; }
      if (!$hasCl) $db['cleaners'][] = $cleaner;
    }

    $ord = [
      'id' => newId('ord'),
      'name' => $name,
      'number' => $number,
      'bookingDate' => trim((string)($r['bookingDate'] ?? '')),
      'address' => trim((string)($r['address'] ?? '')),
      'serviceName' => $service,
      'city' => $city,
      'qty' => isset($r['qty']) && is_numeric($r['qty']) && (float)$r['qty'] > 0 ? (float)$r['qty'] : null,
      'price' => $price,
      'extraAmount' => $extra,
      'cleanerName' => $cleaner,
      'status' => $status,
      'paymentStatus' => $finalPay,
      'paidCommission' => $paid,
      'createdById' => $user['id'],
      'createdByName' => $user['name'],
      'createdAt' => $now,
      'updatedAt' => $now,
    ];
    if (!empty($r['notes'])) $ord['notes'] = trim((string)$r['notes']);
    if ($finalPay === 'clear') { $ord['paymentClearedAt'] = $now; $ord['paymentClearedByName'] = $user['name']; }
    if ($status === 'completed') { $ord['completedAt'] = $now; $ord['completedByName'] = $user['name']; }
    $created[] = $ord;
  }
  $db['orders'] = array_merge($created, $db['orders']);
  saveDb($db);
  jsonResponse([
    'importedCount' => count($created),
    'skippedCount' => $skipped,
    'orders' => $created,
    'config' => [
      'cities' => $db['cities'],
      'cleaners' => $db['cleaners'],
      'services' => DEFAULT_SERVICES,
      'cleanerProfiles' => empty($db['cleanerProfiles']) ? (object)[] : $db['cleanerProfiles'],
    ],
  ], 201);
}

if ($method === 'PATCH' && preg_match('#^/api/orders/([^/]+)$#', $uriPath, $m)) {
  $user = requireAuth($db);
  $id = $m[1];
  $idx = null;
  foreach ($db['orders'] as $i => $o) if (($o['id'] ?? '') === $id) { $idx = $i; break; }
  if ($idx === null) jsonResponse(['error' => 'Order not found'], 404);
  $existing = $db['orders'][$idx];
  if (($user['role'] ?? '') !== 'super_admin' && ($existing['createdById'] ?? '') !== $user['id']) {
    jsonResponse(['error' => 'Not authorized to modify this order'], 403);
  }
  $now = gmdate('c');
  $next = $existing;
  foreach (['name', 'number', 'bookingDate', 'address', 'serviceName', 'city', 'cleanerName'] as $field) {
    if (isset($body[$field]) && is_string($body[$field])) $next[$field] = trim($body[$field]);
  }
  if (array_key_exists('qty', $body)) {
    $next['qty'] = (is_numeric($body['qty']) && (float)$body['qty'] > 0) ? (float)$body['qty'] : null;
  }
  if (isset($body['price']) && is_numeric($body['price'])) $next['price'] = max(0, (float)$body['price']);
  if (isset($body['extraAmount']) && is_numeric($body['extraAmount'])) $next['extraAmount'] = max(0, (float)$body['extraAmount']);
  if (isset($body['notes'])) {
    $n = trim((string)$body['notes']);
    if ($n !== '') $next['notes'] = $n; else unset($next['notes']);
  }
  if (isset($body['paymentNote'])) {
    $pn = trim((string)$body['paymentNote']);
    if ($pn !== '') $next['paymentNote'] = $pn; else unset($next['paymentNote']);
  }
  if (isset($body['status']) && in_array($body['status'], ['active', 'completed'], true)) {
    $next['status'] = $body['status'];
    if ($next['status'] === 'completed') {
      $next['completedAt'] = $existing['completedAt'] ?? $now;
      $next['completedByName'] = $existing['completedByName'] ?? $user['name'];
    } else {
      unset($next['completedAt'], $next['completedByName']);
    }
  }
  $comm30 = calcOrderCommission30($next['price'] ?? 0, $next['extraAmount'] ?? 0);
  if (isset($body['paidCommission']) && is_numeric($body['paidCommission'])) {
    $paid = min($comm30, max(0, (float)$body['paidCommission']));
    $next['paidCommission'] = $paid;
    $next['paymentStatus'] = $paid >= $comm30 ? 'clear' : 'pending';
  } elseif (isset($body['paymentStatus']) && in_array($body['paymentStatus'], ['clear', 'pending'], true)) {
    $next['paymentStatus'] = $body['paymentStatus'];
    $next['paidCommission'] = $body['paymentStatus'] === 'clear' ? $comm30 : 0;
  }
  if (($next['paymentStatus'] ?? 'pending') === 'clear') {
    $next['paymentClearedAt'] = $existing['paymentClearedAt'] ?? $now;
    $next['paymentClearedByName'] = $existing['paymentClearedByName'] ?? $user['name'];
  } else {
    unset($next['paymentClearedAt'], $next['paymentClearedByName']);
  }
  $next['updatedAt'] = $now;
  $db['orders'][$idx] = $next;
  saveDb($db);
  jsonResponse(['order' => $next]);
}

if ($method === 'DELETE' && preg_match('#^/api/orders/([^/]+)$#', $uriPath, $m)) {
  $user = requireAuth($db);
  $id = $m[1];
  foreach ($db['orders'] as $o) {
    if (($o['id'] ?? '') === $id) {
      if (($user['role'] ?? '') !== 'super_admin' && ($o['createdById'] ?? '') !== $user['id']) {
        jsonResponse(['error' => 'Not authorized'], 403);
      }
      $db['orders'] = array_values(array_filter($db['orders'], fn($x) => ($x['id'] ?? '') !== $id));
      saveDb($db);
      jsonResponse(['ok' => true]);
    }
  }
  jsonResponse(['error' => 'Order not found'], 404);
}

// Backup JSON
if ($method === 'GET' && $uriPath === '/api/admin/export-backup') {
  $user = requireAuth($db);
  requireSuperAdmin($user);
  header('Content-Disposition: attachment; filename="orderdesk-backup-' . date('Y-m-d') . '.json"');
  jsonResponse([
    'exportedAt' => gmdate('c'),
    'cities' => $db['cities'],
    'cleaners' => $db['cleaners'],
    'cleanerProfiles' => empty($db['cleanerProfiles']) ? (object)[] : $db['cleanerProfiles'],
    'orders' => $db['orders'],
  ]);
}

// Hostinger config endpoints on Hostinger PHP
if ($method === 'GET' && $uriPath === '/api/hostinger/config') {
  $user = requireAuth($db);
  requireSuperAdmin($user);
  $h = $db['hostinger'];
  jsonResponse(['config' => [
    'mode' => $h['mode'] ?? 'none',
    'autoSync' => (bool)($h['autoSync'] ?? false),
    'mysqlHost' => $h['mysqlHost'] ?? 'localhost',
    'mysqlPort' => (int)($h['mysqlPort'] ?? 3306),
    'mysqlDatabase' => $h['mysqlDatabase'] ?? '',
    'mysqlUser' => $h['mysqlUser'] ?? '',
    'hasMysqlPassword' => !empty($h['mysqlPassword']),
    'webhookUrl' => $h['webhookUrl'] ?? '',
    'hasWebhookSecret' => !empty($h['webhookSecret']),
    'lastSyncedAt' => $h['lastSyncedAt'] ?? null,
  ]]);
}

if ($method === 'PUT' && $uriPath === '/api/hostinger/config') {
  $user = requireAuth($db);
  requireSuperAdmin($user);
  $h = $db['hostinger'];
  $h['mode'] = in_array($body['mode'] ?? '', ['mysql', 'webhook'], true) ? $body['mode'] : 'none';
  $h['autoSync'] = !empty($body['autoSync']);
  if (isset($body['mysqlHost'])) $h['mysqlHost'] = trim((string)$body['mysqlHost']);
  if (isset($body['mysqlPort'])) $h['mysqlPort'] = (int)$body['mysqlPort'] ?: 3306;
  if (isset($body['mysqlDatabase'])) $h['mysqlDatabase'] = trim((string)$body['mysqlDatabase']);
  if (isset($body['mysqlUser'])) $h['mysqlUser'] = trim((string)$body['mysqlUser']);
  if (!empty($body['mysqlPassword'])) $h['mysqlPassword'] = (string)$body['mysqlPassword'];
  if (isset($body['webhookUrl'])) $h['webhookUrl'] = trim((string)$body['webhookUrl']);
  if (!empty($body['webhookSecret'])) $h['webhookSecret'] = (string)$body['webhookSecret'];
  $db['hostinger'] = $h;
  saveDb($db, true);
  jsonResponse(['config' => [
    'mode' => $h['mode'],
    'autoSync' => (bool)$h['autoSync'],
    'mysqlHost' => $h['mysqlHost'],
    'mysqlPort' => (int)$h['mysqlPort'],
    'mysqlDatabase' => $h['mysqlDatabase'],
    'mysqlUser' => $h['mysqlUser'],
    'hasMysqlPassword' => !empty($h['mysqlPassword']),
    'webhookUrl' => $h['webhookUrl'],
    'hasWebhookSecret' => !empty($h['webhookSecret']),
    'lastSyncedAt' => $h['lastSyncedAt'] ?? null,
  ]]);
}

if ($method === 'POST' && $uriPath === '/api/hostinger/test') {
  $user = requireAuth($db);
  requireSuperAdmin($user);
  $h = $db['hostinger'];
  $mode = $body['mode'] ?? ($h['mode'] ?? 'none');
  if ($mode === 'mysql') {
    $cfg = [
      'host' => trim((string)($body['mysqlHost'] ?? ($h['mysqlHost'] ?? 'localhost'))) ?: 'localhost',
      'port' => (int)($body['mysqlPort'] ?? ($h['mysqlPort'] ?? 3306)) ?: 3306,
      'database' => trim((string)($body['mysqlDatabase'] ?? ($h['mysqlDatabase'] ?? ''))),
      'user' => trim((string)($body['mysqlUser'] ?? ($h['mysqlUser'] ?? ''))),
      'password' => !empty($body['mysqlPassword']) ? (string)$body['mysqlPassword'] : (string)($h['mysqlPassword'] ?? ''),
    ];
    if (!$cfg['database'] || !$cfg['user']) {
      jsonResponse(['error' => 'MySQL Database and Username are required'], 400);
    }
    try {
      $pdo = openMysqlPdo($cfg);
      ensureMysqlOrdersTable($pdo);
      jsonResponse(['ok' => true, 'message' => 'Hostinger MySQL connected & orderdesk_orders table verified!']);
    } catch (Throwable $e) {
      jsonResponse(['error' => $e->getMessage()], 500);
    }
  }
  jsonResponse(['error' => 'Select Hostinger MySQL to test connection'], 400);
}

if ($method === 'POST' && $uriPath === '/api/hostinger/sync') {
  $user = requireAuth($db);
  requireSuperAdmin($user);
  try {
    $cfg = resolveMysqlSettings($db);
    if (!$cfg) jsonResponse(['error' => 'Configure MySQL settings first'], 400);
    $count = syncOrdersToMysql($db, $cfg);
    $syncedAt = gmdate('c');
    $db['hostinger']['lastSyncedAt'] = $syncedAt;
    saveDb($db, true);
    jsonResponse(['ok' => true, 'syncedCount' => $count, 'lastSyncedAt' => $syncedAt, 'message' => $count . ' orders MySQL me sync ho gaye!']);
  } catch (Throwable $e) {
    jsonResponse(['error' => $e->getMessage()], 500);
  }
}

// Optional Translation via Gemini REST API (if configured in config.php)
if ($method === 'POST' && $uriPath === '/api/translate') {
  requireAuth($db);
  $text = trim((string)($body['text'] ?? ''));
  $lang = (string)($body['targetLanguage'] ?? 'hindi');
  if ($lang === 'english') jsonResponse(['translatedText' => $text]);
  $apiKey = defined('ORDERDESK_GEMINI_API_KEY') ? ORDERDESK_GEMINI_API_KEY : '';
  if (!$apiKey) {
    jsonResponse(['error' => 'Set ORDERDESK_GEMINI_API_KEY in config.php to enable auto-translation on Hostinger.'], 503);
  }
  $langMap = [
    'hindi' => 'Translate cleanly into simple Hindi (Devanagari).',
    'punjabi' => 'Translate cleanly into simple Punjabi (Gurmukhi).',
    'bilingual_hi' => 'Keep details in English and add a simple Hindi translation.',
    'bilingual_pa' => 'Keep details in English and add a simple Punjabi translation.',
  ];
  $instr = ($langMap[$lang] ?? $langMap['hindi']) . ' Preserve ALL emojis, phone numbers, dates, quantities, and ₹ amounts. Output ONLY the message.';
  $ch = curl_init('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' . urlencode($apiKey));
  curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_POST => true,
    CURLOPT_HTTPHEADER => ['Content-Type: application/json'],
    CURLOPT_POSTFIELDS => json_encode([
      'systemInstruction' => ['parts' => [['text' => $instr]]],
      'contents' => [['parts' => [['text' => $text]]]],
    ]),
    CURLOPT_TIMEOUT => 20,
  ]);
  $resp = curl_exec($ch);
  $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
  curl_close($ch);
  if ($code !== 200 || !$resp) jsonResponse(['error' => 'Translation API failed'], 502);
  $decoded = json_decode($resp, true);
  $out = trim((string)($decoded['candidates'][0]['content']['parts'][0]['text'] ?? ''));
  if ($out === '') jsonResponse(['error' => 'Empty translation returned'], 502);
  jsonResponse(['translatedText' => $out]);
}

jsonResponse(['error' => 'Endpoint not found'], 404);
`;
}
