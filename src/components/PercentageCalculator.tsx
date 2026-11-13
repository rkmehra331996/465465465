import React, { useMemo, useState } from 'react';
import { Calculator, Check, Copy, RotateCcw, X } from 'lucide-react';

interface PercentageCalculatorProps {
  open: boolean;
  onClose: () => void;
}

const QUICK_PERCENTS = [25, 30, 40];

export const PercentageCalculator: React.FC<PercentageCalculatorProps> = ({ open, onClose }) => {
  const [amount, setAmount] = useState<string>('1000');
  const [percent, setPercent] = useState<string>('30');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const calc = useMemo(() => {
    const base = Number(amount) || 0;
    const pct = Number(percent) || 0;
    const pctAmount = (base * pct) / 100;
    const afterLess = base - pctAmount;
    const afterAdd = base + pctAmount;

    return {
      pctAmount,
      afterLess,
      afterAdd,
    };
  }, [amount, percent]);

  if (!open) return null;

  const formatNum = (val: number) => {
    const rounded = Math.round(val * 100) / 100;
    return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2);
  };

  const handleCopy = async (val: string, key: string) => {
    try {
      await navigator.clipboard.writeText(val);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 1500);
    } catch {
      // Ignore clipboard failure
    }
  };

  return (
    <div
      className="fixed inset-y-0 right-0 z-50 w-full max-w-[360px] bg-white border-l border-[#DCE4E0] shadow-xl flex flex-col"
      role="dialog"
      aria-label="Percentage Calculator"
    >
      <div className="px-5 py-4 bg-[#075E54] text-white flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <Calculator className="w-5 h-5 text-[#25D366]" />
          <h2 className="font-display text-base font-semibold">Percentage Calculator</h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close Calculator"
          className="p-1.5 rounded-lg hover:bg-white/10 transition-colors cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="p-5 space-y-5 overflow-y-auto flex-1">
        {/* Amount Input */}
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1.5">
            Enter Amount (₹)
          </label>
          <input
            type="number"
            step="any"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="e.g. 1200"
            className="w-full px-3.5 py-2.5 text-base font-mono-num font-semibold bg-white border border-[#DCE4E0] rounded-lg focus:outline-none focus:border-[#128C7E]"
          />
        </div>

        {/* 25%, 30%, 40% Quick Select */}
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-2">
            Select Percentage (%)
          </label>
          <div className="grid grid-cols-3 gap-2">
            {QUICK_PERCENTS.map((p) => {
              const active = Number(percent) === p;
              return (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPercent(String(p))}
                  className={`py-2.5 text-sm font-mono-num font-bold rounded-lg border transition-colors cursor-pointer ${
                    active
                      ? 'bg-[#128C7E] text-white border-[#128C7E]'
                      : 'bg-[#F7F9F8] text-slate-800 border-[#DCE4E0] hover:bg-[#EFF4F1]'
                  }`}
                >
                  {p}%
                </button>
              );
            })}
          </div>

          <div className="mt-2.5 flex items-center gap-2">
            <span className="text-xs text-slate-500 whitespace-nowrap">Other %:</span>
            <input
              type="number"
              step="any"
              value={percent}
              onChange={(e) => setPercent(e.target.value)}
              className="flex-1 px-3 py-1.5 text-sm font-mono-num bg-white border border-[#DCE4E0] rounded-lg focus:outline-none focus:border-[#128C7E]"
            />
          </div>
        </div>

        {/* Results */}
        <div className="border border-[#DCE4E0] rounded-xl bg-[#F7F9F8] divide-y divide-[#DCE4E0]">
          <div className="p-3.5 flex items-center justify-between">
            <div>
              <div className="text-xs text-slate-500">
                {percent || 0}% Amount
              </div>
              <div className="text-xl font-bold font-mono-num text-[#075E54]">
                ₹{formatNum(calc.pctAmount)}
              </div>
            </div>
            <button
              type="button"
              onClick={() => handleCopy(formatNum(calc.pctAmount), 'pct')}
              className="px-2.5 py-1.5 text-xs font-medium bg-white border border-[#DCE4E0] rounded-md text-slate-700 hover:bg-slate-50 flex items-center gap-1 cursor-pointer"
            >
              {copiedKey === 'pct' ? (
                <>
                  <Check className="w-3.5 h-3.5 text-[#128C7E]" />
                  Copied
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  Copy
                </>
              )}
            </button>
          </div>

          <div className="p-3.5 flex items-center justify-between">
            <div>
              <div className="text-xs text-slate-500">
                After -{percent || 0}% (Remaining)
              </div>
              <div className="text-base font-bold font-mono-num text-slate-900">
                ₹{formatNum(calc.afterLess)}
              </div>
            </div>
            <button
              type="button"
              onClick={() => handleCopy(formatNum(calc.afterLess), 'less')}
              className="px-2.5 py-1.5 text-xs font-medium bg-white border border-[#DCE4E0] rounded-md text-slate-700 hover:bg-slate-50 flex items-center gap-1 cursor-pointer"
            >
              {copiedKey === 'less' ? (
                <>
                  <Check className="w-3.5 h-3.5 text-[#128C7E]" />
                  Copied
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  Copy
                </>
              )}
            </button>
          </div>

          <div className="p-3.5 flex items-center justify-between">
            <div>
              <div className="text-xs text-slate-500">
                After +{percent || 0}% (Total)
              </div>
              <div className="text-base font-bold font-mono-num text-slate-900">
                ₹{formatNum(calc.afterAdd)}
              </div>
            </div>
            <button
              type="button"
              onClick={() => handleCopy(formatNum(calc.afterAdd), 'add')}
              className="px-2.5 py-1.5 text-xs font-medium bg-white border border-[#DCE4E0] rounded-md text-slate-700 hover:bg-slate-50 flex items-center gap-1 cursor-pointer"
            >
              {copiedKey === 'add' ? (
                <>
                  <Check className="w-3.5 h-3.5 text-[#128C7E]" />
                  Copied
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  Copy
                </>
              )}
            </button>
          </div>
        </div>

        <button
          type="button"
          onClick={() => {
            setAmount('1000');
            setPercent('30');
          }}
          className="w-full py-2 px-3 bg-white border border-[#DCE4E0] hover:bg-slate-50 text-slate-700 text-xs font-semibold rounded-lg flex items-center justify-center gap-1.5 cursor-pointer"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          Reset
        </button>
      </div>
    </div>
  );
};
