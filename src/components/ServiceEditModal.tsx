import React, { useEffect, useMemo, useState } from 'react';
import { Check, Plus, X } from 'lucide-react';
import type { Order } from '../types';

const TANK_TYPES = [
  { key: '500L', label: '500 Ltr' },
  { key: '750L', label: '750 Ltr' },
  { key: '1000L', label: '1000 Ltr' },
  { key: '1500L', label: '1500 Ltr' },
  { key: '2000L', label: '2000 Ltr' },
  { key: 'Cement Tank', label: 'Cement Tank' },
] as const;

interface ServiceEditModalProps {
  order: Order | null;
  services: string[];
  onClose: () => void;
  onSave: (
    orderId: string,
    patch: { serviceName: string; qty: number | null; notes: string }
  ) => Promise<void>;
}

function parseOrderServiceState(order: Order, availableServices: string[]) {
  const rawList = (order.serviceName || '')
    .split('+')
    .map((s) => s.trim())
    .filter(Boolean);

  const normalizedServices = rawList.map((raw) => {
    const match = availableServices.find((s) => s.toLowerCase() === raw.toLowerCase());
    return match || raw;
  });

  const uniqueServices = Array.from(new Set(normalizedServices));

  const tankCounts: Record<string, number> = {};
  const serviceQuantities: Record<string, number> = {};
  const extraNoteParts: string[] = [];

  const segments = (order.notes || '')
    .split('|')
    .map((seg) => seg.trim())
    .filter(Boolean);

  for (const seg of segments) {
    const parts = seg.split(',').map((p) => p.trim()).filter(Boolean);
    let matchedTankSeg = parts.length > 0;
    const tempTanks: Record<string, number> = {};
    for (const part of parts) {
      const tankMatch = /^(500 Ltr|750 Ltr|1000 Ltr|1500 Ltr|2000 Ltr|Cement Tank)\s*[×x*]\s*(\d+)$/i.exec(
        part
      );
      if (!tankMatch) {
        matchedTankSeg = false;
        break;
      }
      const tankDef = TANK_TYPES.find(
        (t) => t.label.toLowerCase() === tankMatch[1].toLowerCase()
      );
      if (!tankDef) {
        matchedTankSeg = false;
        break;
      }
      const cnt = Number(tankMatch[2]);
      if (cnt > 0) tempTanks[tankDef.key] = cnt;
    }

    if (matchedTankSeg) {
      Object.assign(tankCounts, tempTanks);
      continue;
    }

    let matchedServiceSeg = parts.length > 0;
    const tempServiceQty: Record<string, number> = {};
    for (const part of parts) {
      const svcMatch = /^(.+?):\s*(\d+)(?:\s*Seats?)?$/i.exec(part);
      if (!svcMatch) {
        matchedServiceSeg = false;
        break;
      }
      const rawSvc = svcMatch[1].trim();
      const matchedSvc =
        availableServices.find((s) => s.toLowerCase() === rawSvc.toLowerCase()) ||
        uniqueServices.find((s) => s.toLowerCase() === rawSvc.toLowerCase());
      if (!matchedSvc || matchedSvc.toLowerCase() === 'water tank') {
        matchedServiceSeg = false;
        break;
      }
      const cnt = Number(svcMatch[2]);
      if (cnt > 0) tempServiceQty[matchedSvc] = cnt;
    }

    if (matchedServiceSeg) {
      Object.assign(serviceQuantities, tempServiceQty);
      continue;
    }

    extraNoteParts.push(seg);
  }

  const nonTankSelected = uniqueServices.filter((s) => s.toLowerCase() !== 'water tank');
  if (
    Object.keys(serviceQuantities).length === 0 &&
    Object.keys(tankCounts).length === 0 &&
    nonTankSelected.length === 1 &&
    order.qty &&
    order.qty > 0
  ) {
    serviceQuantities[nonTankSelected[0]] = order.qty;
  }

  return {
    selectedServices: uniqueServices,
    tankCounts,
    serviceQuantities,
    extraNote: extraNoteParts.join(' | '),
  };
}

export const ServiceEditModal: React.FC<ServiceEditModalProps> = ({
  order,
  services,
  onClose,
  onSave,
}) => {
  const [selectedServices, setSelectedServices] = useState<string[]>([]);
  const [tankCounts, setTankCounts] = useState<Record<string, number>>({});
  const [serviceQuantities, setServiceQuantities] = useState<Record<string, number>>({});
  const [extraNote, setExtraNote] = useState('');
  const [saving, setSaving] = useState(false);

  const allServices = useMemo(() => {
    const list = [...services];
    for (const s of selectedServices) {
      if (!list.some((item) => item.toLowerCase() === s.toLowerCase())) {
        list.push(s);
      }
    }
    return list;
  }, [services, selectedServices]);

  useEffect(() => {
    if (!order) return;
    const parsed = parseOrderServiceState(order, services);
    setSelectedServices(parsed.selectedServices);
    setTankCounts(parsed.tankCounts);
    setServiceQuantities(parsed.serviceQuantities);
    setExtraNote(parsed.extraNote);
    setSaving(false);
  }, [order, services]);

  const hasWaterTankSelected = selectedServices.some(
    (s) => s.toLowerCase() === 'water tank'
  );
  const selectedNonTankServices = useMemo(
    () => selectedServices.filter((s) => s.toLowerCase() !== 'water tank'),
    [selectedServices]
  );

  const tankSummary = useMemo(() => {
    const parts: string[] = [];
    let totalTanks = 0;
    for (const t of TANK_TYPES) {
      const cnt = tankCounts[t.key] || 0;
      if (cnt > 0) {
        parts.push(`${t.label} × ${cnt}`);
        totalTanks += cnt;
      }
    }
    return { text: parts.join(', '), totalTanks };
  }, [tankCounts]);

  const serviceQtySummary = useMemo(() => {
    const parts: string[] = [];
    let totalQty = 0;
    for (const s of selectedNonTankServices) {
      const q = serviceQuantities[s] || 0;
      if (q > 0) {
        totalQty += q;
        if (s.toLowerCase() === 'sofa') {
          parts.push(`Sofa: ${q} ${q === 1 ? 'Seat' : 'Seats'}`);
        } else {
          parts.push(`${s}: ${q}`);
        }
      }
    }
    return { text: parts.join(', '), totalQty };
  }, [selectedNonTankServices, serviceQuantities]);

  if (!order) return null;

  const toggleService = (service: string) => {
    setSelectedServices((prev) => {
      const exists = prev.some((s) => s.toLowerCase() === service.toLowerCase());
      if (exists) {
        if (service.toLowerCase() === 'water tank') {
          setTankCounts({});
        } else {
          setServiceQuantities((qPrev) => {
            const copy = { ...qPrev };
            delete copy[service];
            return copy;
          });
        }
        return prev.filter((s) => s.toLowerCase() !== service.toLowerCase());
      }
      const next = [...prev, service];
      return next.sort((a, b) => allServices.indexOf(a) - allServices.indexOf(b));
    });
  };

  const adjustTankCount = (key: string, delta: number) => {
    setTankCounts((prev) => {
      const nextVal = Math.max(0, (prev[key] || 0) + delta);
      if (nextVal === 0) {
        const copy = { ...prev };
        delete copy[key];
        return copy;
      }
      return { ...prev, [key]: nextVal };
    });
  };

  const adjustServiceQty = (service: string, delta: number) => {
    setServiceQuantities((prev) => {
      const nextVal = Math.max(0, (prev[service] || 0) + delta);
      if (nextVal === 0) {
        const copy = { ...prev };
        delete copy[service];
        return copy;
      }
      return { ...prev, [service]: nextVal };
    });
  };

  const setServiceQtyDirect = (service: string, rawVal: string) => {
    const digits = rawVal.replace(/\D/g, '');
    const num = digits ? Math.max(0, Math.min(999, Number(digits))) : 0;
    setServiceQuantities((prev) => {
      if (num === 0) {
        const copy = { ...prev };
        delete copy[service];
        return copy;
      }
      return { ...prev, [service]: num };
    });
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedServices.length === 0) return;
    setSaving(true);
    try {
      const totalQty =
        (hasWaterTankSelected ? tankSummary.totalTanks : 0) + serviceQtySummary.totalQty;
      const noteParts = [
        hasWaterTankSelected && tankSummary.text ? tankSummary.text : '',
        serviceQtySummary.text ? serviceQtySummary.text : '',
        extraNote.trim(),
      ].filter(Boolean);

      await onSave(order.id, {
        serviceName: selectedServices.join(' + '),
        qty: totalQty > 0 ? totalQty : order.qty,
        notes: noteParts.join(' | '),
      });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-[1px] flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl bg-white border border-[#DCE4E0] rounded-xl shadow-xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="bg-[#075E54] text-white px-5 py-3 flex items-center justify-between">
          <div>
            <h3 className="font-display text-sm font-bold">Edit Services &amp; Quantities</h3>
            <p className="text-[11px] text-emerald-100 mt-0.5">
              {order.name || 'Customer'}
              {order.number ? ` · ${order.number}` : ''}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded hover:bg-white/15 text-white cursor-pointer"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSave} className="p-4 sm:p-5 space-y-3.5 max-h-[85vh] overflow-y-auto">
          <div>
            <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
              <label className="text-xs font-semibold text-slate-700">
                Select 1 or Multiple Services
              </label>
              <span
                className={`text-xs font-semibold ${
                  selectedServices.length > 0 ? 'text-[#075E54]' : 'text-red-600'
                }`}
              >
                {selectedServices.length > 0
                  ? `Selected: ${selectedServices.join(' + ')}`
                  : 'Select at least 1 service'}
              </span>
            </div>
            <div className="bg-[#F7F9F8] border border-[#DCE4E0] rounded-lg p-2 flex flex-wrap gap-1.5">
              {allServices.map((s) => {
                const active = selectedServices.some(
                  (item) => item.toLowerCase() === s.toLowerCase()
                );
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => toggleService(s)}
                    className={`px-3 py-1 text-xs font-semibold rounded-md border inline-flex items-center gap-1.5 cursor-pointer transition-colors ${
                      active
                        ? 'bg-[#075E54] text-white border-[#075E54]'
                        : 'bg-white text-slate-700 border-[#DCE4E0] hover:bg-[#EFF4F1]'
                    }`}
                  >
                    {active ? (
                      <Check className="w-3.5 h-3.5 text-[#25D366]" />
                    ) : (
                      <Plus className="w-3.5 h-3.5 text-slate-400" />
                    )}
                    {s}
                  </button>
                );
              })}
            </div>
          </div>

          {hasWaterTankSelected && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-semibold text-slate-700">
                  Water Tank Quantity (Size &amp; Count)
                </label>
                {tankSummary.totalTanks > 0 && (
                  <span className="text-xs text-[#075E54] font-semibold">
                    {tankSummary.text}
                  </span>
                )}
              </div>
              <div className="bg-[#F7F9F8] border border-[#DCE4E0] rounded-lg p-2">
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {TANK_TYPES.map((t) => {
                    const count = tankCounts[t.key] || 0;
                    return (
                      <div
                        key={t.key}
                        className={`flex items-center justify-between px-2 py-1.5 rounded border text-xs ${
                          count > 0
                            ? 'bg-white border-[#128C7E] text-[#075E54] font-semibold'
                            : 'bg-white border-[#DCE4E0] text-slate-700'
                        }`}
                      >
                        <span className="truncate mr-1">{t.label}</span>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => adjustTankCount(t.key, -1)}
                            className="w-5 h-5 rounded bg-[#EFF4F1] hover:bg-[#DCE4E0] text-slate-700 font-bold flex items-center justify-center cursor-pointer"
                          >
                            -
                          </button>
                          <span className="w-4 text-center font-mono-num">{count}</span>
                          <button
                            type="button"
                            onClick={() => adjustTankCount(t.key, 1)}
                            className="w-5 h-5 rounded bg-[#128C7E] hover:bg-[#075E54] text-white font-bold flex items-center justify-center cursor-pointer"
                          >
                            +
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {selectedNonTankServices.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-semibold text-slate-700">
                  Service Quantities &amp; Sofa Seats
                </label>
                {serviceQtySummary.totalQty > 0 && (
                  <span className="text-xs text-[#075E54] font-semibold">
                    {serviceQtySummary.text}
                  </span>
                )}
              </div>
              <div className="bg-[#F7F9F8] border border-[#DCE4E0] rounded-lg p-2">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {selectedNonTankServices.map((s) => {
                    const qtyVal = serviceQuantities[s] || 0;
                    const isSofa = s.toLowerCase() === 'sofa';
                    const unitLabel = isSofa ? `${s} (Seats)` : `${s} (Qty)`;
                    return (
                      <div
                        key={s}
                        className={`flex items-center justify-between px-2.5 py-1.5 rounded border text-xs ${
                          qtyVal > 0
                            ? 'bg-white border-[#128C7E] text-[#075E54] font-semibold'
                            : 'bg-white border-[#DCE4E0] text-slate-700'
                        }`}
                      >
                        <span className="truncate mr-2">{unitLabel}</span>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => adjustServiceQty(s, -1)}
                            className="w-5 h-5 rounded bg-[#EFF4F1] hover:bg-[#DCE4E0] text-slate-700 font-bold flex items-center justify-center cursor-pointer"
                          >
                            -
                          </button>
                          <input
                            type="text"
                            inputMode="numeric"
                            value={qtyVal > 0 ? String(qtyVal) : ''}
                            onChange={(e) => setServiceQtyDirect(s, e.target.value)}
                            placeholder={isSofa ? 'Seats' : 'Qty'}
                            aria-label={unitLabel}
                            className="w-11 text-center font-mono-num text-xs py-0.5 border border-[#DCE4E0] rounded bg-[#F7F9F8] focus:bg-white focus:outline-none focus:border-[#128C7E]"
                          />
                          <button
                            type="button"
                            onClick={() => adjustServiceQty(s, 1)}
                            className="w-5 h-5 rounded bg-[#128C7E] hover:bg-[#075E54] text-white font-bold flex items-center justify-center cursor-pointer"
                          >
                            +
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Message / Note (Optional)
            </label>
            <input
              type="text"
              value={extraNote}
              onChange={(e) => setExtraNote(e.target.value)}
              placeholder="Any extra instruction..."
              className="w-full px-3 py-1.5 text-sm bg-[#F7F9F8] border border-[#DCE4E0] rounded-lg focus:bg-white focus:outline-none focus:border-[#128C7E]"
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#DCE4E0]">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-1.5 text-xs font-semibold bg-white border border-[#DCE4E0] hover:bg-slate-50 text-slate-700 rounded-lg cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || selectedServices.length === 0}
              className="px-5 py-1.5 text-xs font-semibold bg-[#128C7E] hover:bg-[#075E54] disabled:opacity-50 text-white rounded-lg cursor-pointer"
            >
              {saving ? 'Saving...' : 'Save Services'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
