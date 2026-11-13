import React from 'react';
import { AlertTriangle } from 'lucide-react';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  loadingLabel?: string;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  open,
  title,
  message,
  confirmLabel = 'Yes, Delete',
  cancelLabel = 'No, Cancel',
  loadingLabel = 'Deleting...',
  loading = false,
  onConfirm,
  onCancel,
}) => {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/45 flex items-center justify-center p-4"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
    >
      <div className="w-full max-w-[380px] bg-white border border-[#DCE4E0] rounded-xl shadow-xl overflow-hidden">
        <div className="p-5">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-lg bg-red-50 border border-red-200 flex items-center justify-center shrink-0">
              <AlertTriangle className="w-5 h-5 text-red-600" />
            </div>
            <div>
              <h3
                id="confirm-dialog-title"
                className="font-display text-base font-bold text-slate-900"
              >
                {title}
              </h3>
              <p className="text-sm text-slate-600 mt-1 leading-relaxed">{message}</p>
            </div>
          </div>

          <div className="mt-5 flex items-center justify-end gap-2.5">
            <button
              type="button"
              disabled={loading}
              onClick={onCancel}
              className="px-4 py-2 text-xs font-semibold bg-white border border-[#DCE4E0] hover:bg-slate-50 text-slate-700 rounded-lg cursor-pointer"
            >
              {cancelLabel}
            </button>
            <button
              type="button"
              disabled={loading}
              onClick={onConfirm}
              className="px-4 py-2 text-xs font-semibold bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white rounded-lg cursor-pointer"
            >
              {loading ? loadingLabel : confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
