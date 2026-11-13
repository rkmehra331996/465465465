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
import type { Order } from '../types';

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

export const InvoiceModal: React.FC<InvoiceModalProps> = ({
  order,
  onClose,
  onNotify,
}) => {
  const [invoiceNo, setInvoiceNo] = useState('');
  const [invoiceDate, setInvoiceDate] = useState('');
  const [paymentMode, setPaymentMode] = useState<'Cash' | 'UPI / Online' | 'Pending'>('Cash');
  const [discount, setDiscount] = useState('0');
  const [digitalSign, setDigitalSign] = useState(true);

  useEffect(() => {
    if (!order) return;
    setInvoiceNo(buildDefaultInvoiceNo(order));
    setInvoiceDate(order.bookingDate || new Date().toISOString().slice(0, 10));
    setPaymentMode(order.status === 'completed' || order.paymentStatus === 'clear' ? 'Cash' : 'Pending');
    setDiscount('0');
    setDigitalSign(true);
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

    // Service & Bill Summary Table
    const cSno = margin;
    const cDesc = margin + 42;
    const cCity = margin + 275;
    const cQty = margin + 375;
    const cAmt = pageW - margin;

    doc.setFillColor(239, 244, 241);
    doc.rect(margin, y, contentW, 22, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(15, 23, 42);
    doc.text('S.No', cSno + 8, y + 14);
    doc.text('Service Description', cDesc + 8, y + 14);
    doc.text('City', cCity + 8, y + 14);
    doc.text('Qty', cQty + 28, y + 14, { align: 'right' });
    doc.text('Amount (Rs.)', cAmt - 8, y + 14, { align: 'right' });
    y += 22;

    const svcLines = doc.splitTextToSize(
      order.notes ? `${order.serviceName} (${order.notes})` : order.serviceName,
      220
    );
    const row1H = Math.max(24, svcLines.length * 13 + 10);
    doc.rect(margin, y, contentW, row1H, 'D');
    doc.setFont('helvetica', 'normal');
    doc.text('1', cSno + 8, y + 15);
    doc.setFont('helvetica', 'bold');
    doc.text(svcLines, cDesc + 8, y + 15);
    doc.setFont('helvetica', 'normal');
    doc.text(order.city || '-', cCity + 8, y + 15);
    doc.text(String(order.qty ?? 1), cQty + 28, y + 15, { align: 'right' });
    doc.text(`Rs. ${totals.base.toLocaleString('en-IN')}`, cAmt - 8, y + 15, { align: 'right' });
    y += row1H;

    if (totals.extra > 0) {
      doc.rect(margin, y, contentW, 22, 'D');
      doc.text('2', cSno + 8, y + 15);
      doc.text('Extra / Additional On-Site Cleaning Work', cDesc + 8, y + 15);
      doc.text(`Rs. ${totals.extra.toLocaleString('en-IN')}`, cAmt - 8, y + 15, { align: 'right' });
      y += 22;
    }

    if (totals.disc > 0) {
      doc.rect(margin, y, contentW, 22, 'D');
      doc.text('Discount', cQty + 28, y + 15, { align: 'right' });
      doc.text(`-Rs. ${totals.disc.toLocaleString('en-IN')}`, cAmt - 8, y + 15, { align: 'right' });
      y += 22;
    }

    doc.setFillColor(239, 244, 241);
    doc.rect(margin, y, contentW, 26, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(7, 94, 84);
    doc.text('Total Bill', cQty + 28, y + 17, { align: 'right' });
    doc.text(`Rs. ${totals.grandTotal.toLocaleString('en-IN')}`, cAmt - 8, y + 17, {
      align: 'right',
    });
    y += 40;

    // Amount in Words
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(51, 65, 85);
    const wordsLines = doc.splitTextToSize(`Amount in Words: ${totalWords}`, contentW);
    doc.text(wordsLines, margin, y);
    y += wordsLines.length * 14 + 44;

    // Signatures
    const leftSigX = margin + 95;
    const rightSigX = pageW - margin - 95;
    if (digitalSign) {
      doc.setFont('times', 'italic');
      doc.setFontSize(16);
      doc.setTextColor(7, 94, 84);
      doc.text(cleanerName, rightSigX, y - 10, { align: 'center' });
    }
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

          <label className="inline-flex items-center gap-1.5 text-slate-700 font-medium cursor-pointer ml-auto">
            <input
              type="checkbox"
              checked={digitalSign}
              onChange={(e) => setDigitalSign(e.target.checked)}
              className="accent-[#075E54]"
            />
            <span>Auto Cleaner Signature</span>
          </label>
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

            {/* Client Service & Total Bill Table */}
            <div className="mb-4">
              <div className="text-xs font-display font-bold text-slate-900 mb-1.5">
                Service &amp; Bill Details
              </div>
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="bg-[#075E54] text-white">
                    <th className="border border-[#075E54] py-2 px-2.5 text-left w-12">S.No</th>
                    <th className="border border-[#075E54] py-2 px-3 text-left">
                      Service Description
                    </th>
                    <th className="border border-[#075E54] py-2 px-3 text-left">City</th>
                    <th className="border border-[#075E54] py-2 px-2.5 text-right w-14">Qty</th>
                    <th className="border border-[#075E54] py-2 px-3 text-right w-28">
                      Amount (₹)
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="border border-slate-300 py-2.5 px-2.5 font-mono-num">1</td>
                    <td className="border border-slate-300 py-2.5 px-3">
                      <div className="font-bold text-slate-900">{order.serviceName}</div>
                      {order.notes && (
                        <div className="text-[11px] text-slate-600 mt-0.5">{order.notes}</div>
                      )}
                    </td>
                    <td className="border border-slate-300 py-2.5 px-3 text-slate-800">
                      {order.city}
                    </td>
                    <td className="border border-slate-300 py-2.5 px-2.5 text-right font-mono-num">
                      {order.qty ?? 1}
                    </td>
                    <td className="border border-slate-300 py-2.5 px-3 text-right font-mono-num font-semibold text-slate-900">
                      ₹{totals.base.toLocaleString('en-IN')}
                    </td>
                  </tr>

                  {totals.extra > 0 && (
                    <tr>
                      <td className="border border-slate-300 py-2 px-2.5 font-mono-num">2</td>
                      <td className="border border-slate-300 py-2 px-3 text-slate-800" colSpan={3}>
                        Extra / Additional On-Site Work
                      </td>
                      <td className="border border-slate-300 py-2 px-3 text-right font-mono-num font-semibold text-slate-900">
                        ₹{totals.extra.toLocaleString('en-IN')}
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
                <div className="h-9 flex items-end justify-center pb-1">
                  {digitalSign && (
                    <span className="font-signature text-2xl text-[#075E54] leading-none select-none">
                      {cleanerName}
                    </span>
                  )}
                </div>
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
