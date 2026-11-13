import React, { useEffect, useMemo, useState } from 'react';
import {
  Check,
  Copy,
  Download,
  FileText,
  Printer,
  Send,
  X,
} from 'lucide-react';
import { formatWhatsAppPhone, getOrderTotal } from '../lib/api';
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
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!order) return;
    setInvoiceNo(buildDefaultInvoiceNo(order));
    setInvoiceDate(order.bookingDate || new Date().toISOString().slice(0, 10));
    setPaymentMode(order.status === 'completed' || order.paymentStatus === 'clear' ? 'Cash' : 'Pending');
    setDiscount('0');
    setDigitalSign(true);
    setCopied(false);
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

  const whatsappBillText = [
    '*CITY CLEAN COMPANY — SERVICE INVOICE*',
    'Water Tank | Sofa | Home | Kitchen | Bathroom | AC Cleaning',
    'Website: CityCleanCompany.com',
    'Customer Support: 9501359075 | 6283136043',
    '--------------------------------',
    `*Invoice No:* ${invoiceNo}`,
    `*Date:* ${invoiceDate}`,
    '',
    '*Client Details:*',
    `Name: ${customerName}`,
    ...(order.number ? [`Phone: ${order.number}`] : []),
    ...(fullAddress ? [`Address: ${fullAddress}`] : []),
    '',
    '*Booking & Service Staff Details:*',
    `Booking By (Telecaller): ${bookingBy}`,
    `Cleaning Expert Name: ${cleanerName}`,
    '',
    '*Bill Summary:*',
    `Service: ${order.serviceName}${order.qty ? ` (Qty: ${order.qty})` : ''}`,
    `Service Charge: ₹${totals.base.toLocaleString('en-IN')}`,
    ...(totals.extra > 0 ? [`Extra Work: ₹${totals.extra.toLocaleString('en-IN')}`] : []),
    ...(totals.disc > 0 ? [`Discount: -₹${totals.disc.toLocaleString('en-IN')}`] : []),
    `*Total Bill: ₹${totals.grandTotal.toLocaleString('en-IN')}* (${totalWords})`,
    `Payment Mode: ${paymentMode}`,
    '--------------------------------',
    `Verified & Signed By Cleaner: *${cleanerName}*`,
    'Thank you for choosing City Clean Company!',
  ].join('\n');

  const waHref = order.number
    ? `https://api.whatsapp.com/send?phone=${encodeURIComponent(
        formatWhatsAppPhone(order.number)
      )}&text=${encodeURIComponent(whatsappBillText)}`
    : `https://api.whatsapp.com/send?text=${encodeURIComponent(whatsappBillText)}`;

  const handleCopyText = async () => {
    try {
      await navigator.clipboard.writeText(whatsappBillText);
      setCopied(true);
      onNotify('Invoice bill WhatsApp ke liye copy ho gaya!');
      setTimeout(() => setCopied(false), 1800);
    } catch {
      onNotify('Copy failed', 'error');
    }
  };

  const handlePrint = () => {
    window.print();
  };

  const handleDownloadHtml = () => {
    const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Invoice ${escapeHtml(invoiceNo)} - City Clean Company</title>
<style>
  body { font-family: Arial, Helvetica, sans-serif; color: #0f172a; background: #f8fafc; margin: 0; padding: 24px; }
  .sheet { max-width: 780px; margin: 0 auto; background: #fff; border: 1px solid #cbd5e1; padding: 28px; }
  .header { text-align: center; border-bottom: 2px solid #075E54; padding-bottom: 14px; margin-bottom: 18px; }
  .brand { font-size: 26px; font-weight: 800; letter-spacing: 0.04em; color: #075E54; margin: 0; }
  .services { font-size: 12px; color: #334155; margin: 6px 0 4px; font-weight: 600; }
  .meta { font-size: 12px; color: #0f172a; margin: 2px 0; }
  .grid { display: flex; justify-content: space-between; gap: 16px; margin-bottom: 18px; font-size: 13px; }
  .box { flex: 1; border: 1px solid #e2e8f0; padding: 10px 12px; background: #f8fafc; }
  .box h4 { margin: 0 0 6px; font-size: 12px; text-transform: uppercase; color: #075E54; letter-spacing: 0.04em; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 16px; font-size: 13px; }
  th, td { border: 1px solid #cbd5e1; padding: 8px 10px; text-align: left; }
  th { background: #eff4f1; color: #0f172a; font-weight: 700; }
  .right { text-align: right; font-variant-numeric: tabular-nums; }
  .total-row td { font-weight: 800; font-size: 15px; background: #eff4f1; color: #075E54; }
  .words { font-size: 12px; color: #334155; margin-bottom: 24px; }
  .sigs { display: flex; justify-content: space-between; align-items: flex-end; margin-top: 36px; padding-top: 12px; }
  .sig-col { width: 220px; text-align: center; }
  .sig-script { font-family: "Brush Script MT", "Segoe Script", cursive; font-size: 24px; color: #075E54; min-height: 30px; }
  .sig-line { border-top: 1px solid #475569; padding-top: 6px; font-size: 12px; font-weight: 700; }
  .sig-sub { font-size: 11px; color: #64748b; }
  .footer { text-align: center; font-size: 11px; color: #64748b; border-top: 1px dashed #cbd5e1; padding-top: 10px; margin-top: 22px; }
  @media print { body { background: #fff; padding: 0; } .sheet { border: none; } }
</style>
</head>
<body>
  <div class="sheet">
    <div class="header">
      <h1 class="brand">CITY CLEAN COMPANY</h1>
      <div class="services">Water Tank Cleaning | Sofa Cleaning | Home Cleaning | Kitchen Cleaning | Bathroom Cleaning | AC Cleaning</div>
      <div class="meta"><strong>Website:</strong> CityCleanCompany.com &nbsp;|&nbsp; <strong>Customer Support:</strong> 9501359075 | 6283136043</div>
    </div>

    <div class="grid">
      <div class="box">
        <h4>Client Details</h4>
        <div><strong>Name:</strong> ${escapeHtml(customerName)}</div>
        <div><strong>Phone:</strong> ${escapeHtml(order.number || '—')}</div>
        <div><strong>Address:</strong> ${escapeHtml(fullAddress || '—')}</div>
      </div>
      <div class="box">
        <h4>Invoice Details</h4>
        <div><strong>Invoice No:</strong> ${escapeHtml(invoiceNo)}</div>
        <div><strong>Service Date:</strong> ${escapeHtml(invoiceDate)}</div>
        <div><strong>Payment Mode:</strong> ${escapeHtml(paymentMode)}</div>
      </div>
    </div>

    <table>
      <thead>
        <tr><th colspan="2">Booking &amp; Service Staff Details</th></tr>
        <tr><th style="width:45%">Field</th><th>Details</th></tr>
      </thead>
      <tbody>
        <tr><td>Booking By (Telecaller Name)</td><td><strong>${escapeHtml(bookingBy)}</strong></td></tr>
        <tr><td>Cleaning Expert Name</td><td><strong>${escapeHtml(cleanerName)}</strong></td></tr>
      </tbody>
    </table>

    <table>
      <thead>
        <tr>
          <th style="width:52px">S.No</th>
          <th>Service Description</th>
          <th>City</th>
          <th class="right">Qty</th>
          <th class="right">Amount (₹)</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>1</td>
          <td><strong>${escapeHtml(order.serviceName)}</strong>${order.notes ? `<br/><span style="font-size:11px;color:#475569">${escapeHtml(order.notes)}</span>` : ''}</td>
          <td>${escapeHtml(order.city)}</td>
          <td class="right">${order.qty ?? 1}</td>
          <td class="right">₹${totals.base.toLocaleString('en-IN')}</td>
        </tr>
        ${totals.extra > 0 ? `<tr><td>2</td><td colspan="3">Extra / Additional On-Site Cleaning Work</td><td class="right">₹${totals.extra.toLocaleString('en-IN')}</td></tr>` : ''}
        ${totals.disc > 0 ? `<tr><td colspan="4" class="right">Discount</td><td class="right">-₹${totals.disc.toLocaleString('en-IN')}</td></tr>` : ''}
        <tr class="total-row">
          <td colspan="4" class="right">Total Bill</td>
          <td class="right">₹${totals.grandTotal.toLocaleString('en-IN')}</td>
        </tr>
      </tbody>
    </table>

    <div class="words"><strong>Amount in Words:</strong> ${escapeHtml(totalWords)}</div>

    <div class="sigs">
      <div class="sig-col">
        <div class="sig-script"></div>
        <div class="sig-line">Customer Signature</div>
        <div class="sig-sub">${escapeHtml(customerName)}</div>
      </div>
      <div class="sig-col">
        <div class="sig-script">${digitalSign ? escapeHtml(cleanerName) : ''}</div>
        <div class="sig-line">Signature by Cleaner</div>
        <div class="sig-sub">${escapeHtml(cleanerName)} · City Clean Company</div>
      </div>
    </div>

    <div class="footer">
      Thank you for choosing City Clean Company! For support or re-booking call 9501359075 | 6283136043 · CityCleanCompany.com
    </div>
  </div>
</body>
</html>`;

    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const safeFile = `${invoiceNo}-${customerName}`.replace(/[^a-zA-Z0-9_-]/g, '_');
    link.setAttribute('download', `${safeFile}.html`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    onNotify('Invoice HTML bill downloaded!');
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/55 flex items-center justify-center p-3 sm:p-5 overflow-y-auto invoice-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="City Clean Company Auto Invoice"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[820px] bg-white border border-[#DCE4E0] rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[95vh] invoice-modal-shell"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top Modal Controls (Hidden on Print) */}
        <div className="px-4 py-3 bg-[#075E54] text-white flex flex-wrap items-center justify-between gap-2 no-print">
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-[#25D366]" />
            <div>
              <h3 className="font-display text-sm font-bold">
                Auto Bill &amp; Invoice — CITY CLEAN COMPANY
              </h3>
              <p className="text-[11px] text-emerald-100/85 font-mono-num">
                {customerName} · ₹{totals.grandTotal.toLocaleString('en-IN')}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={handlePrint}
              className="px-3 py-1.5 text-xs font-semibold bg-white text-[#075E54] hover:bg-emerald-50 rounded-lg inline-flex items-center gap-1.5 cursor-pointer"
            >
              <Printer className="w-3.5 h-3.5" />
              Print / Save PDF
            </button>

            <button
              type="button"
              onClick={handleDownloadHtml}
              className="px-3 py-1.5 text-xs font-semibold bg-white/15 hover:bg-white/25 text-white rounded-lg inline-flex items-center gap-1.5 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              Download Bill
            </button>

            <button
              type="button"
              onClick={handleCopyText}
              className="px-3 py-1.5 text-xs font-semibold bg-white/15 hover:bg-white/25 text-white rounded-lg inline-flex items-center gap-1.5 cursor-pointer"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-[#25D366]" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? 'Copied' : 'Copy Bill'}
            </button>

            <a
              href={waHref}
              target="_blank"
              rel="noopener noreferrer"
              className="px-3 py-1.5 text-xs font-semibold bg-[#25D366] hover:bg-[#1ebe5d] text-white rounded-lg inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
            >
              <Send className="w-3.5 h-3.5" />
              WhatsApp Bill
            </a>

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
            <input
              type="date"
              value={invoiceDate}
              onChange={(e) => setInvoiceDate(e.target.value)}
              className="px-2 py-1 font-mono-num bg-white border border-[#DCE4E0] rounded focus:outline-none focus:border-[#128C7E]"
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
