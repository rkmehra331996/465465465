import React, { useRef, useState } from 'react';
import { Download, FileSpreadsheet, Upload, X } from 'lucide-react';
import { downloadExcelTemplate, parseExcelFile } from '../lib/excel';
import type { BulkImportOrderRow, PortalConfig } from '../types';

interface ExcelImportModalProps {
  open: boolean;
  config: PortalConfig;
  onClose: () => void;
  onImport: (payload: {
    rows: BulkImportOrderRow[];
    autoAddDropdowns: boolean;
    skipDuplicateNumbers: boolean;
  }) => Promise<void>;
  onNotify: (msg: string, type?: 'success' | 'error') => void;
}

export const ExcelImportModal: React.FC<ExcelImportModalProps> = ({
  open,
  config,
  onClose,
  onImport,
  onNotify,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [fileName, setFileName] = useState('');
  const [rows, setRows] = useState<BulkImportOrderRow[]>([]);
  const [autoAddDropdowns, setAutoAddDropdowns] = useState(true);
  const [skipDuplicateNumbers, setSkipDuplicateNumbers] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);

  if (!open) return null;

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setParsing(true);
    try {
      const parsed = await parseExcelFile(file, {
        city: config.cities[0] || 'Other',
        serviceName: config.services[0] || 'Water tank',
        cleanerName: config.cleaners[0] || 'Jagdish',
      });
      if (parsed.length === 0) {
        onNotify('No valid rows found in this file. Check column headers (Name / Number).', 'error');
        setRows([]);
        setFileName('');
        return;
      }
      setFileName(file.name);
      setRows(parsed);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Could not read Excel file', 'error');
    } finally {
      setParsing(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleConfirmImport = async () => {
    if (rows.length === 0) return;
    setImporting(true);
    try {
      await onImport({
        rows,
        autoAddDropdowns,
        skipDuplicateNumbers,
      });
      setRows([]);
      setFileName('');
      onClose();
    } finally {
      setImporting(false);
    }
  };

  const totalValue = rows.reduce(
    (sum, r) => sum + Number(r.price || 0) + Number(r.extraAmount || 0),
    0
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white border border-[#DCE4E0] rounded-xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3.5 bg-[#075E54] text-white flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="w-4 h-4" />
            <h2 className="font-display text-sm font-bold">
              Import Excel Data (.xlsx, .xls, .csv)
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Excel import modal"
            className="p-1 hover:bg-white/15 rounded cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 overflow-y-auto space-y-4 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-3 p-4 bg-[#F7F9F8] border border-dashed border-[#128C7E] rounded-xl">
            <div className="space-y-1">
              <div className="text-sm font-semibold text-slate-900">
                {fileName ? `Selected: ${fileName}` : 'Upload your Excel or CSV file'}
              </div>
              <p className="text-xs text-slate-600">
                Supports columns like Name, Number/Phone, Date, Service, City, Address, Qty, Price, Cleaner, Status, Payment, Message.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={downloadExcelTemplate}
                className="px-3 py-2 text-xs font-medium bg-white border border-[#DCE4E0] hover:bg-slate-50 text-slate-700 rounded-lg inline-flex items-center gap-1.5 cursor-pointer"
              >
                <Download className="w-3.5 h-3.5 text-slate-500" />
                Sample Excel
              </button>

              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={handleFileChange}
                className="hidden"
              />
              <button
                type="button"
                disabled={parsing}
                onClick={() => fileInputRef.current?.click()}
                className="px-3.5 py-2 text-xs font-semibold bg-[#128C7E] hover:bg-[#075E54] text-white rounded-lg inline-flex items-center gap-1.5 cursor-pointer"
              >
                <Upload className="w-3.5 h-3.5" />
                {parsing ? 'Reading...' : fileName ? 'Choose Another File' : 'Select Excel File'}
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-5 text-xs text-slate-700">
            <label className="inline-flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={autoAddDropdowns}
                onChange={(e) => setAutoAddDropdowns(e.target.checked)}
                className="accent-[#128C7E] rounded"
              />
              <span>Auto-add new Cities & Cleaners to dropdowns</span>
            </label>

            <label className="inline-flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={skipDuplicateNumbers}
                onChange={(e) => setSkipDuplicateNumbers(e.target.checked)}
                className="accent-[#128C7E] rounded"
              />
              <span>Skip rows with already existing Phone Numbers</span>
            </label>
          </div>

          {rows.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs font-semibold text-slate-800">
                <span>
                  Preview: {rows.length} row{rows.length > 1 ? 's' : ''} ready to import
                </span>
                <span className="font-mono-num text-[#075E54]">
                  Total Value: ₹{totalValue.toLocaleString('en-IN')}
                </span>
              </div>

              <div className="border border-[#DCE4E0] rounded-lg overflow-x-auto max-h-72">
                <table className="w-full text-left border-collapse min-w-[780px]">
                  <thead>
                    <tr className="bg-[#EFF4F1] border-b border-[#DCE4E0] text-[11px] font-semibold text-slate-600 sticky top-0">
                      <th className="py-2 px-2.5">#</th>
                      <th className="py-2 px-2.5">Name</th>
                      <th className="py-2 px-2.5">Number</th>
                      <th className="py-2 px-2.5">Date</th>
                      <th className="py-2 px-2.5">Service</th>
                      <th className="py-2 px-2.5">City</th>
                      <th className="py-2 px-2.5">Cleaner</th>
                      <th className="py-2 px-2.5 text-right">Price (₹)</th>
                      <th className="py-2 px-2.5">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#DCE4E0]">
                    {rows.slice(0, 100).map((r, i) => (
                      <tr key={i} className="hover:bg-[#FAFDFB]">
                        <td className="py-1.5 px-2.5 font-mono-num text-slate-400">{i + 1}</td>
                        <td className="py-1.5 px-2.5 font-medium text-slate-900">{r.name || '—'}</td>
                        <td className="py-1.5 px-2.5 font-mono-num text-slate-800">{r.number || '—'}</td>
                        <td className="py-1.5 px-2.5 font-mono-num text-slate-600">{r.bookingDate || '—'}</td>
                        <td className="py-1.5 px-2.5 text-slate-800">{r.serviceName}</td>
                        <td className="py-1.5 px-2.5 text-slate-700">{r.city}</td>
                        <td className="py-1.5 px-2.5 font-medium text-[#075E54]">{r.cleanerName}</td>
                        <td className="py-1.5 px-2.5 text-right font-mono-num font-semibold">
                          ₹{(Number(r.price || 0) + Number(r.extraAmount || 0)).toLocaleString('en-IN')}
                        </td>
                        <td className="py-1.5 px-2.5 uppercase text-[10px] font-semibold text-slate-600">
                          {r.status}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {rows.length > 100 && (
                <div className="text-[11px] text-slate-500">
                  Showing first 100 rows of {rows.length} total rows. All {rows.length} rows will be imported.
                </div>
              )}
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-[#DCE4E0] bg-[#FAFDFB] flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium bg-white border border-[#DCE4E0] rounded-lg text-slate-700 hover:bg-slate-50 cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={rows.length === 0 || importing}
            onClick={handleConfirmImport}
            className="px-4 py-2 text-xs font-semibold bg-[#128C7E] hover:bg-[#075E54] disabled:opacity-50 text-white rounded-lg cursor-pointer"
          >
            {importing ? 'Importing...' : `Import ${rows.length} Order${rows.length === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>
    </div>
  );
};
