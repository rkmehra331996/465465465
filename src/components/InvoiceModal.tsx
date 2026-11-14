import React, { useEffect, useMemo, useState } from 'react';
import { jsPDF } from 'jspdf';
import {
  Download,
  FileText,
  Printer,
  X,
} from 'lucide-react';
import { formatIndianDate, getOrderTotal } from '../lib/api';
import { IndianDateInput } from './IndianDateInput';
import {
  DRY_CLEAN_ITEMS,
  HOME_CLEANING_ITEMS,
  SERVICE_OPTIONS,
  type Order,
} from '../types';

interface InvoiceModalProps {
  order: Order | null;
  onClose: () => void;
  onNotify: (msg: string, type?: 'success' | 'error') => void;
}

const ONES = [
  '',
  'One',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
  'Eleven',
  'Twelve',
  'Thirteen',
  'Fourteen',
  'Fifteen',
  'Sixteen',
  'Seventeen',
  'Eighteen',
  'Nineteen',
];

const TENS = [
  '',
  '',
  'Twenty',
  'Thirty',
  'Forty',
  'Fifty',
  'Sixty',
  'Seventy',
  'Eighty',
  'Ninety',
];

function twoDigitWords(n: number): string {
  if (n < 20) return ONES[n];
  return `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ''}`;
}

function amountToIndianWords(amount: number): string {
  const num = Math.round(Math.max(0, amount));
  if (num === 0) return 'Rupees Zero Only';

  const crore = Math.floor(num / 10000000);
  const lakh = Math.floor((num % 10000000) / 100000);
  const thousand = Math.floor((num % 100000) / 1000);
  const hundred = Math.floor((num % 1000) / 100);
  const rest = num % 100;

  const parts: string[] = [];
  if (crore > 0) parts.push(`${twoDigitWords(crore)} Crore`);
  if (lakh > 0) parts.push(`${twoDigitWords(lakh)} Lakh`);
  if (thousand > 0) parts.push(`${twoDigitWords(thousand)} Thousand`);
  if (hundred > 0) parts.push(`${ONES[hundred]} Hundred`);
  if (rest > 0) parts.push(twoDigitWords(rest));

  return `Rupees ${parts.join(' ')} Only`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildDefaultInvoiceNo(order: Order): string {
  const datePart = (order.bookingDate || new Date().toISOString().slice(0, 10)).replace(/-/g, '');
  const idPart = order.id.replace(/[^a-zA-Z0-9]/g, '').slice(-4).toUpperCase() || '0001';
  return `CCC-${datePart}-${idPart}`;
}

const TANK_INVOICE_LABELS = [
  '500 Ltr',
  '750 Ltr',
  '1000 Ltr',
  '1500 Ltr',
  '2000 Ltr',
  'Cement Tank',
] as const;

interface InvoiceLineItem {
  label: string;
  qty: number | null;
  rate: number | null;
  amount: number | null;
}

interface ParsedInvoiceBreakdown {
  items: InvoiceLineItem[];
  adjustment: number;
  adjustmentLabel: string;
  extraNotes: string[];
}

function parseInvoiceBreakdown(order: Order): ParsedInvoiceBreakdown {
  const selectedServices = (order.serviceName || '')
    .split('+')
    .map((s) => s.trim())
    .filter(Boolean);

  const items: InvoiceLineItem[] = [];
  const extraNotes: string[] = [];
  const coveredServiceKeys = new Set<string>();
  let lessFromNotes = 0;

  const segments = (order.notes || '')
    .split('|')
    .map((seg) => seg.trim())
    .filter(Boolean);

  for (const seg of segments) {
    const lessMatch = /^Less:\s*₹?\s*(\d+(?:\.\d+)?)$/i.exec(seg);
    if (lessMatch) {
      const parsedLess = Math.round(Number(lessMatch[1]) * 100) / 100;
      if (parsedLess > 0) lessFromNotes += parsedLess;
      continue;
    }

    const parts = seg.split(',').map((p) => p.trim()).filter(Boolean);

    // 1. Water Tank segment
    let matchedTankSeg = parts.length > 0;
    const tempTanks: InvoiceLineItem[] = [];
    for (const part of parts) {
      const tankMatch =
        /^(500 Ltr|750 Ltr|1000 Ltr|1500 Ltr|2000 Ltr|Cement Tank)\s*[×x*]\s*(\d+(?:\.\d+)?)(?:\s*@\s*₹?\s*(\d+(?:\.\d+)?))?$/i.exec(
          part
        );
      if (!tankMatch) {
        matchedTankSeg = false;
        break;
      }
      const matchedLabel = TANK_INVOICE_LABELS.find(
        (t) => t.toLowerCase() === tankMatch[1].trim().toLowerCase()
      );
      if (!matchedLabel) {
        matchedTankSeg = false;
        break;
      }
      const cnt = Number(tankMatch[2]);
      const rate = tankMatch[3] ? Math.round(Number(tankMatch[3]) * 100) / 100 : 0;
      if (cnt > 0) {
        tempTanks.push({
          label: matchedLabel === 'Cement Tank' ? 'Cement Tank' : `Water Tank (${matchedLabel})`,
          qty: cnt,
          rate: rate > 0 ? rate : null,
          amount: rate > 0 ? Math.round(cnt * rate * 100) / 100 : null,
        });
      }
    }
    if (matchedTankSeg) {
      items.push(...tempTanks);
      coveredServiceKeys.add('water tank');
      continue;
    }

    // 2. Dry Clean segment
    let matchedDryCleanSeg = parts.length > 0;
    const tempDryClean: InvoiceLineItem[] = [];
    for (const part of parts) {
      const dcMatch = /^(.+?)\s*[×x*]\s*(\d+(?:\.\d+)?)(?:\s*@\s*₹?\s*(\d+(?:\.\d+)?))?$/i.exec(
        part
      );
      if (!dcMatch) {
        matchedDryCleanSeg = false;
        break;
      }
      const dcDef = DRY_CLEAN_ITEMS.find(
        (item) => item.label.toLowerCase() === dcMatch[1].trim().toLowerCase()
      );
      if (!dcDef) {
        matchedDryCleanSeg = false;
        break;
      }
      const cnt = Number(dcMatch[2]);
      const rate = dcMatch[3] ? Math.round(Number(dcMatch[3]) * 100) / 100 : 0;
      if (cnt > 0) {
        tempDryClean.push({
          label: `Dry Clean - ${dcDef.label}`,
          qty: cnt,
          rate: rate > 0 ? rate : null,
          amount: rate > 0 ? Math.round(cnt * rate * 100) / 100 : null,
        });
      }
    }
    if (matchedDryCleanSeg) {
      items.push(...tempDryClean);
      coveredServiceKeys.add('dry clean');
      continue;
    }

    // 3. Home Cleaning segment
    let matchedHomeSeg = parts.length > 0;
    const tempHome: InvoiceLineItem[] = [];
    for (const part of parts) {
      const hcMatch =
        /^(?:Home Cleaning:\s*)?(.+?)\s*[×x*]\s*(\d+(?:\.\d+)?)(?:\s*@\s*₹?\s*(\d+(?:\.\d+)?))?$/i.exec(
          part
        );
      if (!hcMatch) {
        matchedHomeSeg = false;
        break;
      }
      const hcDef = HOME_CLEANING_ITEMS.find(
        (item) => item.label.toLowerCase() === hcMatch[1].trim().toLowerCase()
      );
      if (!hcDef) {
        matchedHomeSeg = false;
        break;
      }
      const cnt = Number(hcMatch[2]);
      const rate = hcMatch[3] ? Math.round(Number(hcMatch[3]) * 100) / 100 : 0;
      if (cnt > 0) {
        tempHome.push({
          label: `Home Cleaning - ${hcDef.label}`,
          qty: cnt,
          rate: rate > 0 ? rate : null,
          amount: rate > 0 ? Math.round(cnt * rate * 100) / 100 : null,
        });
      }
    }
    if (matchedHomeSeg) {
      items.push(...tempHome);
      coveredServiceKeys.add('home cleaning');
      continue;
    }

    // 4. Other services segment (e.g. Bathroom: 2 @ ₹600, Chimney: 1 @ ₹1200)
    let matchedServiceSeg = parts.length > 0;
    const tempService: InvoiceLineItem[] = [];
    for (const part of parts) {
      const svcMatch =
        /^(.+?):\s*(\d+(?:\.\d+)?)(?:\s*Seats?)?(?:\s*@\s*₹?\s*(\d+(?:\.\d+)?))?$/i.exec(part);
      if (!svcMatch) {
        matchedServiceSeg = false;
        break;
      }
      const rawSvc = svcMatch[1].trim();
      const matchedName =
        selectedServices.find((s) => s.toLowerCase() === rawSvc.toLowerCase()) ||
        SERVICE_OPTIONS.find((s) => s.toLowerCase() === rawSvc.toLowerCase());
      if (!matchedName || matchedName.toLowerCase() === 'water tank') {
        matchedServiceSeg = false;
        break;
      }
      const cnt = Number(svcMatch[2]);
      const rate = svcMatch[3] ? Math.round(Number(svcMatch[3]) * 100) / 100 : 0;
      if (cnt > 0) {
        tempService.push({
          label: matchedName,
          qty: cnt,
          rate: rate > 0 ? rate : null,
          amount: rate > 0 ? Math.round(cnt * rate * 100) / 100 : null,
        });
        coveredServiceKeys.add(matchedName.toLowerCase());
      }
    }
    if (matchedServiceSeg) {
      items.push(...tempService);
      continue;
    }

    extraNotes.push(seg);
  }

  const baseTotal = Math.round(Number(order.price || 0) * 100) / 100;
  let adjustment = 0;
  let adjustmentLabel = '';

  if (items.length === 0) {
    const qtyVal = order.qty && order.qty > 0 ? order.qty : 1;
    const isExactDivision =
      qtyVal === 1 || (qtyVal > 0 && Math.round(baseTotal * 100) % qtyVal === 0);
    items.push({
      label: order.serviceName || 'Cleaning Service',
      qty: qtyVal,
      rate: isExactDivision ? Math.round((baseTotal / qtyVal) * 100) / 100 : null,
      amount: baseTotal,
    });
  } else {
    const pricedSum = items.reduce((s, it) => s + (it.amount ?? 0), 0);
    const hasUnpriced = items.some((it) => it.amount === null);

    if (hasUnpriced) {
      if (pricedSum === 0) {
        items.push({
          label: `${order.serviceName || 'Service'} (Package Total)`,
          qty: order.qty ?? null,
          rate: null,
          amount: baseTotal,
        });
      } else {
        const diff = Math.round((baseTotal - pricedSum) * 100) / 100;
        if (diff > 0) {
          const uncovered = selectedServices.filter(
            (s) => !coveredServiceKeys.has(s.toLowerCase())
          );
          items.push({
            label: uncovered.length > 0 ? uncovered.join(' + ') : 'Remaining Service Items',
            qty: null,
            rate: null,
            amount: diff,
          });
        } else if (diff < 0) {
          adjustment = diff;
          adjustmentLabel = lessFromNotes > 0 ? 'Less / Discount' : 'Package Adjustment';
        }
      }
    } else {
      const diff = Math.round((baseTotal - pricedSum) * 100) / 100;
      if (diff > 0) {
        const uncovered = selectedServices.filter(
          (s) => !coveredServiceKeys.has(s.toLowerCase())
        );
        if (uncovered.length > 0) {
          items.push({
            label: uncovered.join(' + '),
            qty: 1,
            rate: diff,
            amount: diff,
          });
        } else {
          adjustment = diff;
          adjustmentLabel = 'Additional Service Charge';
        }
      } else if (diff < 0) {
        adjustment = diff;
        adjustmentLabel = lessFromNotes > 0 ? 'Less / Discount' : 'Package Discount / Adjustment';
      }
    }
  }

  return { items, adjustment, adjustmentLabel, extraNotes };
}

export const InvoiceModal: React.FC<InvoiceModalProps> = ({
  order,
  onClose,
  onNotify,
}) => {
  const [invoiceNo, setInvoiceNo] = useState('');
  const [invoiceDate, setInvoiceDate] = useState('');
  const [paymentMode, setPaymentMode] = useState<'Cash' | 'UPI / Online' | 'Pending'>('Cash');
  const [discount, setDiscount] = useState('0');

  useEffect(() => {
    if (!order) return;
    setInvoiceNo(buildDefaultInvoiceNo(order));
    setInvoiceDate(order.bookingDate || new Date().toISOString().slice(0, 10));
    setPaymentMode(order.status === 'completed' || order.paymentStatus === 'clear' ? 'Cash' : 'Pending');
    setDiscount('0');
  }, [order]);

  const totals = useMemo(() => {
    if (!order) return { base: 0, extra: 0, subtotal: 0, disc: 0, grandTotal: 0 };
    const base = Number(order.price || 0);
    const extra = Number(order.extraAmount || 0);
    const subtotal = getOrderTotal(order);
    const parsedDisc = Math.max(0, Number(discount) || 0);
    const disc = Math.min(subtotal, parsedDisc);
    const grandTotal = Math.max(0, subtotal - disc);
    return { base, extra, subtotal, disc, grandTotal };
  }, [order, discount]);

  const breakdown = useMemo(
    () => (order ? parseInvoiceBreakdown(order) : { items: [], adjustment: 0, adjustmentLabel: '', extraNotes: [] }),
    [order]
  );

  if (!order) return null;

  const customerName = order.name || (order.isExtraWork ? 'On-Site Customer' : 'Valued Customer');
  const fullAddress = [order.address, order.city].filter(Boolean).join(', ');
  const totalWords = amountToIndianWords(totals.grandTotal);
  const bookingBy = order.createdByName || 'City Clean Support';
  const cleanerName = order.cleanerName || 'Assigned Expert';

  const formattedInvoiceDate = formatIndianDate(invoiceDate) || invoiceDate;

  const handlePrint = () => {
    window.print();
  };

  const handleDownloadPdf = () => {
    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    const pageW = doc.internal.pageSize.getWidth();
    const margin = 40;
    const contentW = pageW - margin * 2;
    let y = 48;

    // Header
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(20);
    doc.setTextColor(7, 94, 84);
    doc.text('CITY CLEAN COMPANY', pageW / 2, y, { align: 'center' });
    y += 16;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(51, 65, 85);
    doc.text(
      'Water Tank Cleaning | Sofa Cleaning | Home Cleaning | Kitchen Cleaning | Bathroom Cleaning | AC Cleaning',
      pageW / 2,
      y,
      { align: 'center' }
    );
    y += 14;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.setTextColor(15, 23, 42);
    doc.text(
      'Website: CityCleanCompany.com   |   Customer Support: 9501359075 | 6283136043',
      pageW / 2,
      y,
      { align: 'center' }
    );
    y += 12;

    doc.setDrawColor(7, 94, 84);
    doc.setLineWidth(1.5);
    doc.line(margin, y, pageW - margin, y);
    y += 18;

    // Two Info Boxes: Client Details & Invoice Details
    const boxGap = 14;
    const boxW = (contentW - boxGap) / 2;
    const boxTop = y;
    const addrLines = doc.splitTextToSize(`Address: ${fullAddress || '-'}`, boxW - 20);
    const boxH = Math.max(76, 52 + addrLines.length * 12);

    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(203, 213, 225);
    doc.setLineWidth(0.8);
    doc.rect(margin, boxTop, boxW, boxH, 'FD');
    doc.rect(margin + boxW + boxGap, boxTop, boxW, boxH, 'FD');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(7, 94, 84);
    doc.text('CLIENT DETAILS', margin + 10, boxTop + 16);
    doc.text('INVOICE DETAILS', margin + boxW + boxGap + 10, boxTop + 16);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.setTextColor(15, 23, 42);
    doc.text(`Name: ${customerName}`, margin + 10, boxTop + 32);
    doc.text(`Phone: ${order.number || '-'}`, margin + 10, boxTop + 46);
    doc.text(addrLines, margin + 10, boxTop + 60);

    const rightX = margin + boxW + boxGap + 10;
    doc.text(`Invoice No: ${invoiceNo}`, rightX, boxTop + 32);
    doc.text(`Service Date: ${formattedInvoiceDate}`, rightX, boxTop + 46);
    doc.text(`Payment Mode: ${paymentMode}`, rightX, boxTop + 60);

    y = boxTop + boxH + 18;

    // Booking & Service Staff Details Table
    doc.setFillColor(239, 244, 241);
    doc.setDrawColor(203, 213, 225);
    doc.rect(margin, y, contentW, 22, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(7, 94, 84);
    doc.text('Booking & Service Staff Details', margin + 10, y + 15);
    y += 22;

    const colSplit = margin + contentW * 0.45;
    const drawStaffRow = (field: string, val: string, header = false) => {
      if (header) {
        doc.setFillColor(248, 250, 252);
        doc.rect(margin, y, contentW, 20, 'FD');
      } else {
        doc.rect(margin, y, contentW, 22, 'D');
      }
      doc.line(colSplit, y, colSplit, y + (header ? 20 : 22));
      doc.setFont('helvetica', header ? 'bold' : 'normal');
      doc.setFontSize(9.5);
      doc.setTextColor(15, 23, 42);
      doc.text(field, margin + 10, y + 14);
      doc.setFont('helvetica', 'bold');
      doc.text(val, colSplit + 10, y + 14);
      y += header ? 20 : 22;
    };

    drawStaffRow('Field', 'Details', true);
    drawStaffRow('Booking By (Telecaller Name)', bookingBy);
    drawStaffRow('Cleaning Expert Name', cleanerName);
    y += 18;

    // Service & Itemized Bill Summary Table
    const pageH = doc.internal.pageSize.getHeight();
    const ensurePageSpace = (needed: number) => {
      if (y + needed > pageH - 50) {
        doc.addPage();
        y = 48;
      }
    };

    const cSno = margin;
    const cDesc = margin + 36;
    const cQty = margin + 280;
    const cRate = margin + 355;
    const cAmt = pageW - margin;

    doc.setFillColor(239, 244, 241);
    doc.rect(margin, y, contentW, 22, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(15, 23, 42);
    doc.text('S.No', cSno + 6, y + 14);
    doc.text('Item / Service Description', cDesc + 6, y + 14);
    doc.text('Qty', cQty + 34, y + 14, { align: 'right' });
    doc.text('Rate (Rs.)', cRate + 68, y + 14, { align: 'right' });
    doc.text('Amount (Rs.)', cAmt - 8, y + 14, { align: 'right' });
    y += 22;

    let itemSerial = 1;
    for (const item of breakdown.items) {
      const descLines = doc.splitTextToSize(item.label, cQty - cDesc - 10);
      const rowH = Math.max(22, descLines.length * 13 + 9);
      ensurePageSpace(rowH + 30);
      doc.rect(margin, y, contentW, rowH, 'D');
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9.5);
      doc.setTextColor(15, 23, 42);
      doc.text(String(itemSerial), cSno + 8, y + 15);
      doc.setFont('helvetica', 'bold');
      doc.text(descLines, cDesc + 6, y + 15);
      doc.setFont('helvetica', 'normal');
      doc.text(item.qty !== null ? String(item.qty) : '-', cQty + 34, y + 15, {
        align: 'right',
      });
      doc.text(
        item.rate !== null ? `Rs. ${item.rate.toLocaleString('en-IN')}` : '-',
        cRate + 68,
        y + 15,
        { align: 'right' }
      );
      doc.setFont('helvetica', 'bold');
      doc.text(
        item.amount !== null ? `Rs. ${item.amount.toLocaleString('en-IN')}` : '-',
        cAmt - 8,
        y + 15,
        { align: 'right' }
      );
      y += rowH;
      itemSerial += 1;
    }

    if (totals.extra > 0) {
      ensurePageSpace(52);
      doc.rect(margin, y, contentW, 22, 'D');
      doc.setFont('helvetica', 'normal');
      doc.text(String(itemSerial), cSno + 8, y + 15);
      doc.setFont('helvetica', 'bold');
      doc.text('Extra / Additional On-Site Work', cDesc + 6, y + 15);
      doc.setFont('helvetica', 'normal');
      doc.text('1', cQty + 34, y + 15, { align: 'right' });
      doc.text(`Rs. ${totals.extra.toLocaleString('en-IN')}`, cRate + 68, y + 15, {
        align: 'right',
      });
      doc.setFont('helvetica', 'bold');
      doc.text(`Rs. ${totals.extra.toLocaleString('en-IN')}`, cAmt - 8, y + 15, {
        align: 'right',
      });
      y += 22;
    }

    if (breakdown.adjustment !== 0) {
      ensurePageSpace(52);
      doc.rect(margin, y, contentW, 22, 'D');
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(breakdown.adjustment < 0 ? 185 : 15, breakdown.adjustment < 0 ? 28 : 23, breakdown.adjustment < 0 ? 28 : 42);
      doc.text(breakdown.adjustmentLabel, cRate + 68, y + 15, { align: 'right' });
      const adjText =
        breakdown.adjustment < 0
          ? `-Rs. ${Math.abs(breakdown.adjustment).toLocaleString('en-IN')}`
          : `Rs. ${breakdown.adjustment.toLocaleString('en-IN')}`;
      doc.text(adjText, cAmt - 8, y + 15, { align: 'right' });
      doc.setTextColor(15, 23, 42);
      y += 22;
    }

    if (totals.disc > 0) {
      ensurePageSpace(52);
      doc.rect(margin, y, contentW, 22, 'D');
      doc.setFont('helvetica', 'normal');
      doc.text('Discount', cRate + 68, y + 15, { align: 'right' });
      doc.text(`-Rs. ${totals.disc.toLocaleString('en-IN')}`, cAmt - 8, y + 15, { align: 'right' });
      y += 22;
    }

    ensurePageSpace(70);
    doc.setFillColor(239, 244, 241);
    doc.rect(margin, y, contentW, 26, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(7, 94, 84);
    doc.text('Total Bill', cRate + 68, y + 17, { align: 'right' });
    doc.text(`Rs. ${totals.grandTotal.toLocaleString('en-IN')}`, cAmt - 8, y + 17, {
      align: 'right',
    });
    y += 38;

    if (breakdown.extraNotes.length > 0) {
      ensurePageSpace(30);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(71, 85, 105);
      const noteLines = doc.splitTextToSize(`Note: ${breakdown.extraNotes.join(' | ')}`, contentW);
      doc.text(noteLines, margin, y);
      y += noteLines.length * 13 + 8;
    }

    // Amount in Words
    ensurePageSpace(110);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(51, 65, 85);
    const wordsLines = doc.splitTextToSize(`Amount in Words: ${totalWords}`, contentW);
    doc.text(wordsLines, margin, y);
    y += wordsLines.length * 14 + 44;

    // Signatures (blank signature fields)
    const leftSigX = margin + 95;
    const rightSigX = pageW - margin - 95;
    doc.setDrawColor(100, 116, 139);
    doc.setLineWidth(0.8);
    doc.line(margin + 10, y, margin + 180, y);
    doc.line(pageW - margin - 180, y, pageW - margin - 10, y);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(15, 23, 42);
    doc.text('Customer Signature', leftSigX, y + 14, { align: 'center' });
    doc.text('Signature by Cleaner', rightSigX, y + 14, { align: 'center' });

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(100, 116, 139);
    doc.text(customerName, leftSigX, y + 26, { align: 'center' });
    doc.text(`${cleanerName} · City Clean Company`, rightSigX, y + 26, { align: 'center' });
    y += 54;

    // Footer
    doc.setDrawColor(203, 213, 225);
    doc.line(margin, y, pageW - margin, y);
    doc.setFontSize(8.5);
    doc.text(
      'Thank you for choosing City Clean Company! Support: 9501359075 | 6283136043 · CityCleanCompany.com',
      pageW / 2,
      y + 16,
      { align: 'center' }
    );

    const safeFile = `${invoiceNo}-${customerName}`.replace(/[^a-zA-Z0-9_-]/g, '_');
    doc.save(`${safeFile}.pdf`);
    onNotify('Invoice PDF downloaded!');
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/55 flex items-center justify-center p-3 sm:p-5 overflow-y-auto invoice-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="City Clean Company PDF Invoice"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[820px] bg-white border border-[#DCE4E0] rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[95vh] invoice-modal-shell"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top Modal Controls — PDF Only (Hidden on Print) */}
        <div className="px-4 py-3 bg-[#075E54] text-white flex flex-wrap items-center justify-between gap-2 no-print">
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-[#25D366]" />
            <div>
              <h3 className="font-display text-sm font-bold">
                Invoice PDF — CITY CLEAN COMPANY
              </h3>
              <p className="text-[11px] text-emerald-100/85 font-mono-num">
                {customerName} · ₹{totals.grandTotal.toLocaleString('en-IN')}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={handleDownloadPdf}
              className="px-3 py-1.5 text-xs font-semibold bg-white text-[#075E54] hover:bg-emerald-50 rounded-lg inline-flex items-center gap-1.5 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              Download PDF
            </button>

            <button
              type="button"
              onClick={handlePrint}
              className="px-3 py-1.5 text-xs font-semibold bg-white/15 hover:bg-white/25 text-white rounded-lg inline-flex items-center gap-1.5 cursor-pointer"
            >
              <Printer className="w-3.5 h-3.5" />
              Print PDF
            </button>

            <button
              type="button"
              onClick={onClose}
              aria-label="Close invoice"
              className="p-1.5 rounded-lg hover:bg-white/15 text-white cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Quick Invoice Customization Strip (Hidden on Print) */}
        <div className="px-4 py-2.5 bg-[#F7F9F8] border-b border-[#DCE4E0] flex flex-wrap items-center gap-3 text-xs no-print">
          <div className="flex items-center gap-1.5">
            <label className="font-semibold text-slate-600">Bill No:</label>
            <input
              type="text"
              value={invoiceNo}
              onChange={(e) => setInvoiceNo(e.target.value)}
              className="w-36 px-2 py-1 font-mono-num bg-white border border-[#DCE4E0] rounded focus:outline-none focus:border-[#128C7E]"
            />
          </div>

          <div className="flex items-center gap-1.5">
            <label className="font-semibold text-slate-600">Date:</label>
            <IndianDateInput
              ariaLabel="Invoice date"
              title="Invoice Date (DD/MM/YY)"
              value={invoiceDate}
              onChange={(val) => {
                if (val) setInvoiceDate(val);
              }}
              className="min-w-[104px]"
            />
          </div>

          <div className="flex items-center gap-1.5">
            <label className="font-semibold text-slate-600">Payment:</label>
            <select
              value={paymentMode}
              onChange={(e) => setPaymentMode(e.target.value as 'Cash' | 'UPI / Online' | 'Pending')}
              className="px-2 py-1 bg-white border border-[#DCE4E0] rounded focus:outline-none focus:border-[#128C7E]"
            >
              <option value="Cash">Cash</option>
              <option value="UPI / Online">UPI / Online</option>
              <option value="Pending">Pending</option>
            </select>
          </div>

          <div className="flex items-center gap-1.5">
            <label className="font-semibold text-slate-600">Discount (₹):</label>
            <input
              type="number"
              min={0}
              value={discount}
              onChange={(e) => setDiscount(e.target.value)}
              className="w-20 px-2 py-1 font-mono-num bg-white border border-[#DCE4E0] rounded focus:outline-none focus:border-[#128C7E]"
            />
          </div>
        </div>

        {/* Printable Company Invoice Sheet */}
        <div className="overflow-y-auto flex-1 p-4 sm:p-6 bg-[#EFF4F1] print:bg-white print:p-0">
          <div className="invoice-print-sheet bg-white border border-slate-300 rounded-lg p-6 sm:p-8 max-w-[740px] mx-auto shadow-sm print:shadow-none print:border-none print:rounded-none">
            {/* Company Masthead */}
            <div className="text-center border-b-2 border-[#075E54] pb-4 mb-5">
              <h1 className="font-display text-2xl sm:text-3xl font-extrabold tracking-wide text-[#075E54]">
                CITY CLEAN COMPANY
              </h1>
              <p className="text-xs font-semibold text-slate-700 mt-1.5">
                Water Tank Cleaning | Sofa Cleaning | Home Cleaning | Kitchen Cleaning | Bathroom Cleaning | AC Cleaning
              </p>
              <div className="mt-2 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-slate-800">
                <span>
                  <strong>Website:</strong> CityCleanCompany.com
                </span>
                <span aria-hidden="true" className="text-slate-400">
                  |
                </span>
                <span>
                  <strong>Customer Support:</strong>{' '}
                  <span className="font-mono-num font-semibold">9501359075 | 6283136043</span>
                </span>
              </div>
            </div>

            {/* Invoice Meta & Client Details */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-5 text-xs">
              <div className="border border-slate-200 rounded-md p-3.5 bg-[#FAFDFB]">
                <div className="font-display text-[11px] font-bold uppercase tracking-wider text-[#075E54] mb-1.5">
                  Client Details
                </div>
                <div className="space-y-1 text-slate-800">
                  <div>
                    <span className="text-slate-500">Customer Name:</span>{' '}
                    <strong className="text-slate-900">{customerName}</strong>
                  </div>
                  <div>
                    <span className="text-slate-500">Phone Number:</span>{' '}
                    <span className="font-mono-num font-semibold text-slate-900">
                      {order.number || '—'}
                      {order.altNumber ? ` / Alt: ${order.altNumber}` : ''}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500">Service Address:</span>{' '}
                    <span>{fullAddress || '—'}</span>
                  </div>
                </div>
              </div>

              <div className="border border-slate-200 rounded-md p-3.5 bg-[#FAFDFB]">
                <div className="font-display text-[11px] font-bold uppercase tracking-wider text-[#075E54] mb-1.5">
                  Invoice Summary
                </div>
                <div className="space-y-1 text-slate-800">
                  <div>
                    <span className="text-slate-500">Invoice No:</span>{' '}
                    <strong className="font-mono-num text-slate-900">{invoiceNo}</strong>
                  </div>
                  <div>
                    <span className="text-slate-500">Service Date:</span>{' '}
                    <span className="font-mono-num font-semibold text-slate-900">{invoiceDate}</span>
                  </div>
                  <div>
                    <span className="text-slate-500">Payment Mode:</span>{' '}
                    <strong className="text-[#075E54]">{paymentMode}</strong>
                  </div>
                </div>
              </div>
            </div>

            {/* Booking & Service Staff Details Table */}
            <div className="mb-5">
              <div className="text-xs font-display font-bold text-slate-900 mb-1.5">
                Booking &amp; Service Staff Details
              </div>
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="bg-[#EFF4F1] text-slate-800">
                    <th className="border border-slate-300 py-2 px-3 text-left font-bold w-1/2">
                      Field
                    </th>
                    <th className="border border-slate-300 py-2 px-3 text-left font-bold">
                      Details
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="border border-slate-300 py-2 px-3 text-slate-700">
                      Booking By (Telecaller Name)
                    </td>
                    <td className="border border-slate-300 py-2 px-3 font-semibold text-slate-900">
                      {bookingBy}
                    </td>
                  </tr>
                  <tr>
                    <td className="border border-slate-300 py-2 px-3 text-slate-700">
                      Cleaning Expert Name
                    </td>
                    <td className="border border-slate-300 py-2 px-3 font-semibold text-[#075E54]">
                      {cleanerName}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Client Service & Itemized Total Bill Table */}
            <div className="mb-4">
              <div className="text-xs font-display font-bold text-slate-900 mb-1.5">
                Service &amp; Itemized Bill Details
              </div>
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="bg-[#075E54] text-white">
                    <th className="border border-[#075E54] py-2 px-2.5 text-left w-12">S.No</th>
                    <th className="border border-[#075E54] py-2 px-3 text-left">
                      Item / Service Description
                    </th>
                    <th className="border border-[#075E54] py-2 px-2.5 text-right w-14">Qty</th>
                    <th className="border border-[#075E54] py-2 px-3 text-right w-24">
                      Rate (₹)
                    </th>
                    <th className="border border-[#075E54] py-2 px-3 text-right w-28">
                      Amount (₹)
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {breakdown.items.map((item, idx) => (
                    <tr key={`${item.label}-${idx}`}>
                      <td className="border border-slate-300 py-2 px-2.5 font-mono-num">
                        {idx + 1}
                      </td>
                      <td className="border border-slate-300 py-2 px-3 font-semibold text-slate-900">
                        {item.label}
                      </td>
                      <td className="border border-slate-300 py-2 px-2.5 text-right font-mono-num text-slate-800">
                        {item.qty !== null ? item.qty : '—'}
                      </td>
                      <td className="border border-slate-300 py-2 px-3 text-right font-mono-num text-slate-700">
                        {item.rate !== null ? `₹${item.rate.toLocaleString('en-IN')}` : '—'}
                      </td>
                      <td className="border border-slate-300 py-2 px-3 text-right font-mono-num font-semibold text-slate-900">
                        {item.amount !== null ? `₹${item.amount.toLocaleString('en-IN')}` : '—'}
                      </td>
                    </tr>
                  ))}

                  {totals.extra > 0 && (
                    <tr>
                      <td className="border border-slate-300 py-2 px-2.5 font-mono-num">
                        {breakdown.items.length + 1}
                      </td>
                      <td className="border border-slate-300 py-2 px-3 font-semibold text-slate-900">
                        Extra / Additional On-Site Work
                      </td>
                      <td className="border border-slate-300 py-2 px-2.5 text-right font-mono-num text-slate-800">
                        1
                      </td>
                      <td className="border border-slate-300 py-2 px-3 text-right font-mono-num text-slate-700">
                        ₹{totals.extra.toLocaleString('en-IN')}
                      </td>
                      <td className="border border-slate-300 py-2 px-3 text-right font-mono-num font-semibold text-slate-900">
                        ₹{totals.extra.toLocaleString('en-IN')}
                      </td>
                    </tr>
                  )}

                  {breakdown.adjustment !== 0 && (
                    <tr>
                      <td
                        className={`border border-slate-300 py-1.5 px-3 text-right ${
                          breakdown.adjustment < 0 ? 'text-red-700' : 'text-slate-700'
                        }`}
                        colSpan={4}
                      >
                        {breakdown.adjustmentLabel}
                      </td>
                      <td
                        className={`border border-slate-300 py-1.5 px-3 text-right font-mono-num font-semibold ${
                          breakdown.adjustment < 0 ? 'text-red-700' : 'text-slate-900'
                        }`}
                      >
                        {breakdown.adjustment < 0
                          ? `-₹${Math.abs(breakdown.adjustment).toLocaleString('en-IN')}`
                          : `₹${breakdown.adjustment.toLocaleString('en-IN')}`}
                      </td>
                    </tr>
                  )}

                  {totals.disc > 0 && (
                    <tr>
                      <td
                        className="border border-slate-300 py-1.5 px-3 text-right text-slate-600"
                        colSpan={4}
                      >
                        Discount
                      </td>
                      <td className="border border-slate-300 py-1.5 px-3 text-right font-mono-num text-red-700">
                        -₹{totals.disc.toLocaleString('en-IN')}
                      </td>
                    </tr>
                  )}

                  <tr className="bg-[#EFF4F1]">
                    <td
                      className="border border-slate-300 py-2.5 px-3 text-right font-display font-extrabold text-sm text-slate-900"
                      colSpan={4}
                    >
                      Total Bill
                    </td>
                    <td className="border border-slate-300 py-2.5 px-3 text-right font-mono-num font-extrabold text-base text-[#075E54]">
                      ₹{totals.grandTotal.toLocaleString('en-IN')}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            {breakdown.extraNotes.length > 0 && (
              <div className="text-xs text-slate-600 mb-2">
                <span className="font-semibold text-slate-800">Note:</span>{' '}
                {breakdown.extraNotes.join(' | ')}
              </div>
            )}

            <div className="text-xs text-slate-700 mb-8">
              <span className="font-semibold text-slate-900">Amount in Words:</span> {totalWords}
            </div>

            {/* Signature Section */}
            <div className="grid grid-cols-2 gap-8 pt-4 items-end">
              <div className="text-center max-w-[220px]">
                <div className="h-9" />
                <div className="border-t border-slate-500 pt-1.5 text-xs font-bold text-slate-800">
                  Customer Signature
                </div>
                <div className="text-[11px] text-slate-500">{customerName}</div>
              </div>

              <div className="text-center max-w-[240px] ml-auto w-full">
                <div className="h-9" />
                <div className="border-t border-slate-500 pt-1.5 text-xs font-bold text-slate-900">
                  Signature by Cleaner
                </div>
                <div className="text-[11px] text-slate-600">
                  {cleanerName} · City Clean Company
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="mt-7 pt-3 border-t border-dashed border-slate-300 text-center text-[11px] text-slate-500">
              Thank you for choosing City Clean Company · CityCleanCompany.com · Support: 9501359075 | 6283136043
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
