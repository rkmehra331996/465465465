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
  'Dry clean',
  'Chimney',
  'Kitchen',
  'Home cleaning',
  'Bathroom',
] as const;

export const DEFAULT_SERVICE_PRICES: Record<string, number> = {
  bathroom: 600,
  chimney: 1200,
  kitchen: 1500,
};

export function getDefaultServicePrice(serviceName: string): number {
  return DEFAULT_SERVICE_PRICES[serviceName.trim().toLowerCase()] ?? 0;
}

export const DRY_CLEAN_ITEMS = [
  { key: 'Sofa Seat', label: 'Sofa Seat', defaultPrice: 150 },
  { key: 'Cushion', label: 'Cushion', defaultPrice: 30 },
  { key: 'Dining Chair', label: 'Dining Chair', defaultPrice: 130 },
  { key: 'Sofa Cum Bed', label: 'Sofa Cum Bed', defaultPrice: 250 },
  { key: 'Mattress', label: 'Mattress', defaultPrice: 400 },
  { key: 'Puffy', label: 'Puffy', defaultPrice: 100 },
  { key: 'Table', label: 'Table', defaultPrice: 120 },
  { key: 'Chair', label: 'Chair', defaultPrice: 100 },
] as const;

export const HOME_CLEANING_ITEMS = [
  { key: 'Room', label: 'Room' },
  { key: 'Lobby', label: 'Lobby' },
  { key: 'Hall', label: 'Hall' },
  { key: 'Kitchen', label: 'Kitchen' },
  { key: 'Chimney', label: 'Chimney' },
  { key: 'Bathroom', label: 'Bathroom' },
  { key: 'Sofa', label: 'Sofa' },
  { key: 'Storeroom', label: 'Storeroom' },
  { key: 'Balcony', label: 'Balcony' },
  { key: 'Other', label: 'Other' },
] as const;

export interface CleanerProfile {
  phone: string;
  city: string;
}

export interface PortalStaffMember {
  id: string;
  name: string;
  username: string;
  role: UserRole;
}

export interface PortalConfig {
  cities: string[];
  cleaners: string[];
  services: string[];
  cleanerProfiles: Record<string, CleanerProfile>;
  telecallers?: PortalStaffMember[];
}

export interface Order {
  id: string;
  name: string;
  number: string;
  altNumber?: string;
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
  transferredFromId?: string;
  transferredFromName?: string;
  transferredAt?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  completedByName?: string;
}

export type TranslateTarget = 'english' | 'hindi' | 'punjabi' | 'bilingual_hi' | 'bilingual_pa';

export interface NewOrderPayload {
  name?: string;
  number?: string;
  altNumber?: string;
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

