export type UserRole = 'super_admin' | 'telecaller';

export interface UserPublic {
  id: string;
  name: string;
  username: string;
  role: UserRole;
  active: boolean;
  createdAt: string;
}

export type OrderStatus = 'active' | 'completed';
export type PaymentStatus = 'pending' | 'clear';

export const SERVICE_OPTIONS = [
  'Water tank',
  'Sofa',
  'Chimney',
  'Home cleaning',
  'Bathroom',
] as const;

export interface CleanerProfile {
  phone: string;
  city: string;
}

export interface PortalConfig {
  cities: string[];
  cleaners: string[];
  services: string[];
  cleanerProfiles: Record<string, CleanerProfile>;
}

export interface Order {
  id: string;
  name: string;
  number: string;
  bookingDate: string; // YYYY-MM-DD or ''
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
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  completedByName?: string;
}

export type TranslateTarget = 'english' | 'hindi' | 'punjabi' | 'bilingual_hi' | 'bilingual_pa';

export interface NewOrderPayload {
  name?: string;
  number?: string;
  bookingDate?: string;
  address?: string;
  serviceName: string;
  city: string;
  qty?: number | null;
  price: number;
  extraAmount?: number;
  cleanerName: string;
  notes?: string;
  status?: OrderStatus;
  paymentStatus?: PaymentStatus;
  paidCommission?: number;
  paymentNote?: string;
  isExtraWork?: boolean;
}

export interface DuplicateOrderMatch {
  id: string;
  name: string;
  number: string;
  bookingDate: string;
  address: string;
  serviceName: string;
  city: string;
  price: number;
  cleanerName: string;
  status: OrderStatus;
  createdById: string;
  createdByName: string;
  createdAt: string;
}

export interface BulkImportOrderRow {
  name?: string;
  number: string;
  bookingDate?: string;
  address?: string;
  serviceName?: string;
  city?: string;
  qty?: number | null;
  price?: number;
  extraAmount?: number;
  cleanerName?: string;
  notes?: string;
  status?: OrderStatus;
  paymentStatus?: PaymentStatus;
  paidCommission?: number;
}

export interface BulkImportResult {
  importedCount: number;
  skippedCount: number;
  orders: Order[];
  config: PortalConfig;
}

export interface HostingerSettingsPublic {
  mode: 'none' | 'mysql' | 'webhook';
  autoSync: boolean;
  mysqlHost: string;
  mysqlPort: number;
  mysqlDatabase: string;
  mysqlUser: string;
  hasMysqlPassword: boolean;
  webhookUrl: string;
  hasWebhookSecret: boolean;
  lastSyncedAt?: string;
}

