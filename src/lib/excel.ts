import * as XLSX from 'xlsx';
import { calcCommission30, getOrderTotal, getPaidCommission } from './api';
import type { BulkImportOrderRow, Order } from '../types';

export function exportOrdersToExcel(orders: Order[], filename: string): void {
  const rows = orders.map((o, idx) => {
    const total = getOrderTotal(o);
    const comm30 = calcCommission30(total);
    const paidComm = getPaidCommission(o);
    return {
      'Serial No.': idx + 1,
      Name: o.name || '',
      Number: o.number || '',
      'Booking Date': o.bookingDate || '',
      'Service Name': o.serviceName,
      City: o.city,
      Address: o.address || '',
      Qty: o.qty ?? '',
      'Base Price': Number(o.price || 0),
      'Extra Work': Number(o.extraAmount || 0),
      'Total Price': total,
      '30% Commission': comm30,
      'Paid Commission': paidComm,
      'Cleaner Name': o.cleanerName,
      'Payment Status': o.paymentStatus === 'clear' ? 'Clear' : 'Pending',
      Status: o.status === 'completed' ? 'Completed' : 'Active',
      Message: o.notes ?? '',
      Telecaller: o.createdByName || '',
    };
  });

  const ws = XLSX.utils.json_to_sheet(rows);
  ws['!cols'] = [
    { wch: 10 },
    { wch: 20 },
    { wch: 15 },
    { wch: 14 },
    { wch: 16 },
    { wch: 14 },
    { wch: 30 },
    { wch: 8 },
    { wch: 12 },
    { wch: 12 },
    { wch: 12 },
    { wch: 15 },
    { wch: 15 },
    { wch: 16 },
    { wch: 15 },
    { wch: 12 },
    { wch: 28 },
    { wch: 16 },
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Orders');
  XLSX.writeFile(wb, filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`);
}

export function downloadExcelTemplate(): void {
  const sampleRows = [
    {
      Name: 'Harpreet Singh',
      Number: '9815421104',
      'Booking Date': new Date().toISOString().slice(0, 10),
      'Service Name': 'Water tank',
      City: 'Patiala',
      Address: 'House No 42, Sector 19',
      Qty: 2,
      Price: 1200,
      'Extra Work': 0,
      'Cleaner Name': 'Jagdish',
      Status: 'Active',
      'Payment Status': 'Pending',
      Message: '1000 Ltr x 2',
    },
    {
      Name: 'Gurpreet Kaur',
      Number: '9876234019',
      'Booking Date': new Date().toISOString().slice(0, 10),
      'Service Name': 'Sofa',
      City: 'Chandigarh',
      Address: 'Flat 304, Phase 7',
      Qty: 1,
      Price: 800,
      'Extra Work': 200,
      'Cleaner Name': 'Raaj',
      Status: 'Completed',
      'Payment Status': 'Clear',
      Message: '5 seater sofa',
    },
  ];
  const ws = XLSX.utils.json_to_sheet(sampleRows);
  ws['!cols'] = [
    { wch: 18 },
    { wch: 14 },
    { wch: 14 },
    { wch: 15 },
    { wch: 14 },
    { wch: 26 },
    { wch: 8 },
    { wch: 10 },
    { wch: 12 },
    { wch: 15 },
    { wch: 12 },
    { wch: 15 },
    { wch: 22 },
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'OrdersTemplate');
  XLSX.writeFile(wb, 'orderdesk-import-template.xlsx');
}

function normalizeHeader(key: string): string {
  return key
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function pickField(normMap: Record<string, unknown>, candidates: string[]): unknown {
  for (const cand of candidates) {
    if (normMap[cand] !== undefined && normMap[cand] !== null && String(normMap[cand]).trim() !== '') {
      return normMap[cand];
    }
  }
  return undefined;
}

function parseExcelDate(val: unknown): string {
  if (val === undefined || val === null || val === '') return '';
  if (val instanceof Date && !Number.isNaN(val.getTime())) {
    const y = val.getFullYear();
    const m = String(val.getMonth() + 1).padStart(2, '0');
    const d = String(val.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  if (typeof val === 'number' && val > 20000 && val < 90000) {
    const parsed = XLSX.SSF.parse_date_code(val);
    if (parsed && parsed.y && parsed.m && parsed.d) {
      return `${parsed.y}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`;
    }
  }

  const str = String(val).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;

  // Match DD/MM/YYYY, DD-MM-YYYY, or DD/MM/YY
  const dmy = str.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})$/);
  if (dmy) {
    const day = dmy[1].padStart(2, '0');
    const month = dmy[2].padStart(2, '0');
    let year = dmy[3];
    if (year.length === 2) year = `20${year}`;
    return `${year}-${month}-${day}`;
  }

  const d = new Date(str);
  if (!Number.isNaN(d.getTime())) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
  return '';
}

function parseAmount(val: unknown): number {
  if (typeof val === 'number' && Number.isFinite(val)) return Math.max(0, val);
  const cleaned = String(val ?? '').replace(/[^\d.]/g, '');
  const num = Number(cleaned);
  return Number.isFinite(num) && num >= 0 ? num : 0;
}

export async function parseExcelFile(
  file: File,
  defaults: { city: string; serviceName: string; cleanerName: string }
): Promise<BulkImportOrderRow[]> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array', cellDates: true });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) {
    throw new Error('No worksheet found in this Excel file');
  }
  const sheet = wb.Sheets[sheetName];
  const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });

  const parsed: BulkImportOrderRow[] = [];

  for (const raw of rawRows) {
    const normMap: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(raw)) {
      normMap[normalizeHeader(k)] = v;
    }

    const nameVal = pickField(normMap, [
      'name',
      'customer',
      'customername',
      'client',
      'clientname',
      'partyname',
    ]);
    const numberVal = pickField(normMap, [
      'number',
      'phone',
      'phonenumber',
      'mobile',
      'mobilenumber',
      'mob',
      'contact',
      'contactnumber',
      'whatsapp',
    ]);

    const name = nameVal !== undefined ? String(nameVal).trim() : '';
    const number = numberVal !== undefined ? String(numberVal).trim().replace(/\.0$/, '') : '';
    if (!name && !number) continue;

    const dateVal = pickField(normMap, [
      'bookingdate',
      'dateofbooking',
      'date',
      'orderdate',
      'workdate',
      'day',
    ]);
    const serviceVal = pickField(normMap, ['servicename', 'service', 'work', 'category', 'job']);
    const cityVal = pickField(normMap, ['city', 'location', 'area', 'town']);
    const addressVal = pickField(normMap, ['address', 'fulladdress', 'addr', 'landmark']);
    const qtyVal = pickField(normMap, ['qty', 'quantity', 'count', 'tanks', 'units']);
    const basePriceVal = pickField(normMap, [
      'baseprice',
      'price',
      'amount',
      'totalprice',
      'total',
      'rate',
      'charges',
    ]);
    const extraVal = pickField(normMap, ['extrawork', 'extraamount', 'extra', 'pados']);
    const cleanerVal = pickField(normMap, [
      'cleanername',
      'cleaner',
      'vendor',
      'vendorname',
      'technician',
      'worker',
    ]);
    const statusVal = pickField(normMap, ['status', 'orderstatus']);
    const paymentVal = pickField(normMap, ['paymentstatus', 'payment', 'commstatus']);
    const paidCommVal = pickField(normMap, ['paidcommission', 'paid', 'received']);
    const notesVal = pickField(normMap, ['message', 'notes', 'note', 'details', 'remark', 'remarks']);

    const qtyNum = qtyVal !== undefined ? Number(String(qtyVal).replace(/[^\d.]/g, '')) : NaN;
    const statusRaw = String(statusVal ?? '').toLowerCase();
    const paymentRaw = String(paymentVal ?? '').toLowerCase();

    parsed.push({
      name,
      number,
      bookingDate: parseExcelDate(dateVal),
      serviceName: serviceVal ? String(serviceVal).trim() : defaults.serviceName,
      city: cityVal ? String(cityVal).trim() : defaults.city,
      address: addressVal ? String(addressVal).trim() : '',
      qty: Number.isFinite(qtyNum) && qtyNum > 0 ? qtyNum : null,
      price: parseAmount(basePriceVal),
      extraAmount: parseAmount(extraVal),
      cleanerName: cleanerVal ? String(cleanerVal).trim() : defaults.cleanerName,
      status:
        statusRaw.includes('complete') || statusRaw.includes('done')
          ? 'completed'
          : 'active',
      paymentStatus:
        paymentRaw.includes('clear') || paymentRaw.includes('paid') || paymentRaw.includes('done')
          ? 'clear'
          : 'pending',
      paidCommission: paidCommVal !== undefined ? parseAmount(paidCommVal) : undefined,
      notes: notesVal ? String(notesVal).trim() : undefined,
    });
  }

  return parsed;
}
