import React, { useRef } from 'react';
import { Calendar, X } from 'lucide-react';
import { formatIndianDate } from '../lib/api';

interface IndianDateInputProps {
  value: string;
  onChange: (value: string) => void;
  ariaLabel: string;
  title?: string;
  placeholder?: string;
  allowClear?: boolean;
  className?: string;
}

export const IndianDateInput: React.FC<IndianDateInputProps> = ({
  value,
  onChange,
  ariaLabel,
  title,
  placeholder = 'dd/mm/yy',
  allowClear = false,
  className = '',
}) => {
  const inputRef = useRef<HTMLInputElement | null>(null);

  const openPicker = () => {
    const el = inputRef.current;
    if (!el) return;
    try {
      el.showPicker?.();
    } catch {
      el.focus();
    }
  };

  const formatted = value ? formatIndianDate(value) : '';

  return (
    <div
      className={`relative inline-flex items-center bg-white border border-[#DCE4E0] rounded text-xs font-mono-num hover:border-slate-400 focus-within:border-[#128C7E] ${className}`}
      title={title}
    >
      <div className="flex items-center justify-between gap-1.5 w-full px-2 py-1 pointer-events-none select-none">
        <span className={formatted ? 'text-slate-700 font-medium' : 'text-slate-400'}>
          {formatted || placeholder}
        </span>
        <Calendar className="w-3.5 h-3.5 text-slate-400 shrink-0" />
      </div>

      <input
        ref={inputRef}
        type="date"
        aria-label={ariaLabel}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onClick={openPicker}
        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
      />

      {allowClear && value && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onChange('');
          }}
          aria-label={`Clear ${ariaLabel}`}
          title="Clear date"
          className="relative z-20 pr-1.5 pl-0.5 py-1 text-slate-400 hover:text-red-600 cursor-pointer"
        >
          <X className="w-3 h-3" />
        </button>
      )}
    </div>
  );
};
