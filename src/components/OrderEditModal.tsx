import React, { useEffect, useMemo, useState } from 'react';
import { Check, Pencil, Plus, X } from 'lucide-react';
import { formatIndianDate, getIndianDayTag, getLocalDateStr } from '../lib/api';
import { IndianDateInput } from './IndianDateInput';
import { TANK_TYPES, parseOrderServiceState } from './ServiceEditModal';
import {
  DRY_CLEAN_ITEMS,
  HOME_CLEANING_ITEMS,
  getDefaultServicePrice,
  type Order,
  type PortalConfig,
} from '../types';

interface OrderEditModalProps {
  order: Order | null;
  config: PortalConfig;
  onClose: () => void;
  onSave: (orderId: string, patch: Partial<Order>) => Promise<void>;
}

export const OrderEditModal: React.FC<OrderEditModalProps> = ({
  order,
  config,
  onClose,
  onSave,
}) => {
  const [name, setName] = useState('');
  const [number, setNumber] = useState('');
  const [altNumber, setAltNumber] = useState('');
  const [bookingDate, setBookingDate] = useState('');
  const [dateSelectionMode, setDateSelectionMode] = useState<'none' | 'date' | 'not_confirm'>('none');
  const [customDateOpen, setCustomDateOpen] = useState(false);
  const [city, setCity] = useState('');
  const [address, setAddress] = useState('');
  const [cleanerName, setCleanerName] = useState('');

  const [selectedServices, setSelectedServices] = useState<string[]>([]);
  const [tankCounts, setTankCounts] = useState<Record<string, number>>({});
  const [tankPrices, setTankPrices] = useState<Record<string, number>>({});
  const [dryCleanCounts, setDryCleanCounts] = useState<Record<string, number>>({});
  const [dryCleanPrices, setDryCleanPrices] = useState<Record<string, number>>({});
  const [homeCleaningCounts, setHomeCleaningCounts] = useState<Record<string, number>>({});
  const [homeCleaningPrices, setHomeCleaningPrices] = useState<Record<string, number>>({});
  const [serviceQuantities, setServiceQuantities] = useState<Record<string, number>>({});
  const [servicePrices, setServicePrices] = useState<Record<string, number>>({});

  const [priceInput, setPriceInput] = useState('');
  const [lessPriceInput, setLessPriceInput] = useState('');
  const [extraAmountInput, setExtraAmountInput] = useState('');
  const [priceManuallyEdited, setPriceManuallyEdited] = useState(false);
  const [extraNote, setExtraNote] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [saving, setSaving] = useState(false);

  const allServices = useMemo(() => {
    const list = [...config.services];
    for (const s of selectedServices) {
      if (!list.some((item) => item.toLowerCase() === s.toLowerCase())) {
        list.push(s);
      }
    }
    return list;
  }, [config.services, selectedServices]);

  const allCities = useMemo(() => {
    const list = [...config.cities];
    if (city && !list.includes(city)) list.push(city);
    return list;
  }, [config.cities, city]);

  const allCleaners = useMemo(() => {
    const list = [...config.cleaners];
    if (cleanerName && !list.includes(cleanerName)) list.push(cleanerName);
    return list;
  }, [config.cleaners, cleanerName]);

  useEffect(() => {
    if (!order) return;
    setName(order.name || '');
    setNumber(order.number || '');
    setAltNumber(order.altNumber || '');
    const bd = (order.bookingDate || '').trim();
    setBookingDate(bd);
    setDateSelectionMode(bd ? 'date' : 'not_confirm');
    setCustomDateOpen(Boolean(bd) && !getIndianDayTag(bd));
    setCity(order.city || config.cities[0] || '');
    setAddress(order.address || '');
    setCleanerName(order.cleanerName || config.cleaners[0] || '');

    const parsed = parseOrderServiceState(order, config.services);
    setSelectedServices(parsed.selectedServices);
    setTankCounts(parsed.tankCounts);
    setTankPrices(parsed.tankPrices);
    setDryCleanCounts(parsed.dryCleanCounts);
    setDryCleanPrices(parsed.dryCleanPrices);
    setHomeCleaningCounts(parsed.homeCleaningCounts);
    setHomeCleaningPrices(parsed.homeCleaningPrices);
    setServiceQuantities(parsed.serviceQuantities);
    setServicePrices(parsed.servicePrices);
    setExtraNote(parsed.extraNote);

    const initialGross = order.price + parsed.lessPrice;
    setPriceInput(initialGross > 0 ? String(initialGross) : '');
    setLessPriceInput(parsed.lessPrice > 0 ? String(parsed.lessPrice) : '');
    setExtraAmountInput(order.extraAmount > 0 ? String(order.extraAmount) : '');
    setPriceManuallyEdited(
      initialGross > 0 && initialGross !== parsed.parsedAutoTotal
    );
    setErrorMsg('');
    setSaving(false);
  }, [order, config.services, config.cities, config.cleaners]);

  const hasWaterTankSelected = selectedServices.some(
    (s) => s.toLowerCase() === 'water tank'
  );
  const hasDryCleanSelected = selectedServices.some(
    (s) => s.toLowerCase() === 'dry clean'
  );
  const hasHomeCleaningSelected = selectedServices.some(
    (s) => s.toLowerCase() === 'home cleaning'
  );
  const selectedNonTankServices = useMemo(
    () =>
      selectedServices.filter((s) => {
        const lower = s.toLowerCase();
        return lower !== 'water tank' && lower !== 'dry clean' && lower !== 'home cleaning';
      }),
    [selectedServices]
  );
  const hasOtherServiceSelected = selectedNonTankServices.length > 0;

  const tankSummary = useMemo(() => {
    const parts: string[] = [];
    let totalTanks = 0;
    let totalPrice = 0;
    for (const t of TANK_TYPES) {
      const cnt = tankCounts[t.key] || 0;
      const rate = tankPrices[t.key] || 0;
      if (cnt > 0) {
        parts.push(rate > 0 ? `${t.label} × ${cnt} @ ₹${rate}` : `${t.label} × ${cnt}`);
        totalTanks += cnt;
        if (rate > 0) totalPrice += cnt * rate;
      }
    }
    return { text: parts.join(', '), totalTanks, totalPrice };
  }, [tankCounts, tankPrices]);

  const dryCleanSummary = useMemo(() => {
    const parts: string[] = [];
    let totalItems = 0;
    let totalPrice = 0;
    for (const item of DRY_CLEAN_ITEMS) {
      const cnt = dryCleanCounts[item.key] || 0;
      const rate = dryCleanPrices[item.key] || 0;
      if (cnt > 0) {
        parts.push(rate > 0 ? `${item.label} × ${cnt} @ ₹${rate}` : `${item.label} × ${cnt}`);
        totalItems += cnt;
        if (rate > 0) totalPrice += cnt * rate;
      }
    }
    return { text: parts.join(', '), totalItems, totalPrice };
  }, [dryCleanCounts, dryCleanPrices]);

  const homeCleaningSummary = useMemo(() => {
    const parts: string[] = [];
    let totalItems = 0;
    let totalPrice = 0;
    for (const item of HOME_CLEANING_ITEMS) {
      const cnt = homeCleaningCounts[item.key] || 0;
      const rate = homeCleaningPrices[item.key] || 0;
      if (cnt > 0) {
        parts.push(rate > 0 ? `${item.label} × ${cnt} @ ₹${rate}` : `${item.label} × ${cnt}`);
        totalItems += cnt;
        if (rate > 0) totalPrice += cnt * rate;
      }
    }
    return { text: parts.join(', '), totalItems, totalPrice };
  }, [homeCleaningCounts, homeCleaningPrices]);

  const serviceQtySummary = useMemo(() => {
    const parts: string[] = [];
    let totalQty = 0;
    let totalPrice = 0;
    for (const s of selectedNonTankServices) {
      const q = serviceQuantities[s] || 0;
      const rate = servicePrices[s] || 0;
      if (q > 0) {
        totalQty += q;
        if (rate > 0) totalPrice += q * rate;
        const priceSuffix = rate > 0 ? ` @ ₹${rate}` : '';
        if (s.toLowerCase() === 'sofa') {
          parts.push(`${s}: ${q} ${q === 1 ? 'Seat' : 'Seats'}${priceSuffix}`);
        } else {
          parts.push(`${s}: ${q}${priceSuffix}`);
        }
      }
    }
    return { text: parts.join(', '), totalQty, totalPrice };
  }, [selectedNonTankServices, serviceQuantities, servicePrices]);

  const autoCalculatedTotal = useMemo(() => {
    return (
      (hasWaterTankSelected ? tankSummary.totalPrice : 0) +
      (hasDryCleanSelected ? dryCleanSummary.totalPrice : 0) +
      (hasHomeCleaningSelected ? homeCleaningSummary.totalPrice : 0) +
      serviceQtySummary.totalPrice
    );
  }, [
    hasWaterTankSelected,
    hasDryCleanSelected,
    hasHomeCleaningSelected,
    tankSummary.totalPrice,
    dryCleanSummary.totalPrice,
    homeCleaningSummary.totalPrice,
    serviceQtySummary.totalPrice,
  ]);

  useEffect(() => {
    if (!priceManuallyEdited && autoCalculatedTotal > 0) {
      setPriceInput(String(autoCalculatedTotal));
    }
  }, [autoCalculatedTotal, priceManuallyEdited]);

  if (!order) return null;

  const toggleService = (service: string) => {
    setSelectedServices((prev) => {
      const exists = prev.some((s) => s.toLowerCase() === service.toLowerCase());
      if (exists) {
        if (prev.length === 1) return prev;
        if (service.toLowerCase() === 'water tank') {
          setTankCounts({});
          setTankPrices({});
        } else if (service.toLowerCase() === 'dry clean') {
          setDryCleanCounts({});
          setDryCleanPrices({});
        } else if (service.toLowerCase() === 'home cleaning') {
          setHomeCleaningCounts({});
          setHomeCleaningPrices({});
        } else {
          setServiceQuantities((qPrev) => {
            const copy = { ...qPrev };
            delete copy[service];
            return copy;
          });
          setServicePrices((pPrev) => {
            const copy = { ...pPrev };
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

  const makeCountHandler =
    (
      counts: Record<string, number>,
      setCounts: React.Dispatch<React.SetStateAction<Record<string, number>>>,
      setPrices: React.Dispatch<React.SetStateAction<Record<string, number>>>,
      getDefault?: (k: string) => number
    ) =>
    (key: string, rawVal: string) => {
      const digits = rawVal.replace(/\D/g, '');
      const num = digits ? Math.max(0, Math.min(999, Number(digits))) : 0;
      const prevCount = counts[key] || 0;
      const defaultPrice = getDefault ? getDefault(key) : 0;

      if (num === 0) {
        setCounts((prev) => {
          if (!(key in prev)) return prev;
          const copy = { ...prev };
          delete copy[key];
          return copy;
        });
        setPrices((pPrev) => {
          if (!(key in pPrev)) return pPrev;
          const copy = { ...pPrev };
          delete copy[key];
          return copy;
        });
        return;
      }

      setCounts((prev) => ({ ...prev, [key]: num }));
      if (prevCount === 0 && defaultPrice > 0) {
        setPrices((pPrev) =>
          pPrev[key] === undefined ? { ...pPrev, [key]: defaultPrice } : pPrev
        );
      }
    };

  const makePriceHandler =
    (
      counts: Record<string, number>,
      setCounts: React.Dispatch<React.SetStateAction<Record<string, number>>>,
      setPrices: React.Dispatch<React.SetStateAction<Record<string, number>>>
    ) =>
    (key: string, rawVal: string) => {
      const digits = rawVal.replace(/\D/g, '');
      const num = digits ? Math.max(0, Math.min(999999, Number(digits))) : 0;
      const count = counts[key] || 0;

      if (num === 0) {
        setPrices((prev) => {
          if (count > 0) return { ...prev, [key]: 0 };
          if (!(key in prev)) return prev;
          const copy = { ...prev };
          delete copy[key];
          return copy;
        });
        return;
      }

      setPrices((prev) => ({ ...prev, [key]: num }));
      if (count === 0) {
        setCounts((prev) => ((prev[key] || 0) === 0 ? { ...prev, [key]: 1 } : prev));
      }
    };

  const setTankCountDirect = makeCountHandler(
    tankCounts,
    setTankCounts,
    setTankPrices,
    (k) => TANK_TYPES.find((t) => t.key === k)?.defaultPrice ?? 0
  );
  const setTankPriceDirect = makePriceHandler(tankCounts, setTankCounts, setTankPrices);

  const setDryCleanCountDirect = makeCountHandler(
    dryCleanCounts,
    setDryCleanCounts,
    setDryCleanPrices,
    (k) => DRY_CLEAN_ITEMS.find((i) => i.key === k)?.defaultPrice ?? 0
  );
  const setDryCleanPriceDirect = makePriceHandler(
    dryCleanCounts,
    setDryCleanCounts,
    setDryCleanPrices
  );

  const setHomeCleaningCountDirect = makeCountHandler(
    homeCleaningCounts,
    setHomeCleaningCounts,
    setHomeCleaningPrices
  );
  const setHomeCleaningPriceDirect = makePriceHandler(
    homeCleaningCounts,
    setHomeCleaningCounts,
    setHomeCleaningPrices
  );

  const setServiceQtyDirect = makeCountHandler(
    serviceQuantities,
    setServiceQuantities,
    setServicePrices,
    (s) => getDefaultServicePrice(s)
  );
  const setServicePriceDirect = makePriceHandler(
    serviceQuantities,
    setServiceQuantities,
    setServicePrices
  );

  const grossTotal = Math.max(0, Number(priceInput) || 0);
  const lessAmount = Math.max(0, Number(lessPriceInput) || 0);
  const netFinalPrice = Math.max(0, grossTotal - lessAmount);
  const extraAmountVal = Math.max(0, Number(extraAmountInput) || 0);

  const today0 = getLocalDateStr(0);
  const today1 = getLocalDateStr(1);
  const today2 = getLocalDateStr(2);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');

    const cleanPhone = number.replace(/\D/g, '');
    if (!order.isExtraWork && cleanPhone.length !== 10) {
      setErrorMsg('Please enter a valid 10-digit Phone Number.');
      return;
    }

    const cleanAlt = altNumber.replace(/\D/g, '');
    if (cleanAlt && cleanAlt.length !== 10) {
      setErrorMsg('Alternate Number must be 10 digits (or leave it empty).');
      return;
    }
    if (cleanAlt && cleanAlt === cleanPhone) {
      setErrorMsg('Alternate Number must be different from Phone Number.');
      return;
    }

    if (dateSelectionMode === 'none' || (dateSelectionMode === 'date' && !bookingDate.trim())) {
      setErrorMsg('Please select a Booking Date or choose Not Confirm.');
      return;
    }

    if (selectedServices.length === 0) {
      setErrorMsg('Please select at least 1 service.');
      return;
    }

    setSaving(true);
    try {
      const totalQty =
        (hasWaterTankSelected ? tankSummary.totalTanks : 0) +
        (hasDryCleanSelected ? dryCleanSummary.totalItems : 0) +
        (hasHomeCleaningSelected ? homeCleaningSummary.totalItems : 0) +
        serviceQtySummary.totalQty;

      const noteParts = [
        hasWaterTankSelected && tankSummary.text ? tankSummary.text : '',
        hasDryCleanSelected && dryCleanSummary.text ? dryCleanSummary.text : '',
        hasHomeCleaningSelected && homeCleaningSummary.text ? homeCleaningSummary.text : '',
        serviceQtySummary.text ? serviceQtySummary.text : '',
        lessAmount > 0 ? `Less: ₹${lessAmount}` : '',
        extraNote.trim(),
      ].filter(Boolean);

      await onSave(order.id, {
        name: name.trim(),
        number: order.isExtraWork ? cleanPhone.slice(0, 10) : cleanPhone,
        altNumber: order.isExtraWork ? '' : cleanAlt,
        bookingDate: bookingDate.trim(),
        city: city || config.cities[0] || order.city,
        address: address.trim(),
        cleanerName: cleanerName || config.cleaners[0] || order.cleanerName,
        serviceName: selectedServices.join(' + '),
        qty: totalQty > 0 ? totalQty : order.qty,
        price:
          priceInput.trim() === '' && lessPriceInput.trim() === ''
            ? order.price
            : netFinalPrice,
        extraAmount: extraAmountVal,
        notes: noteParts.join(' | '),
      });
      onClose();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Could not update order.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="edit-order-modal-title"
      className="fixed inset-0 z-50 bg-slate-900/55 flex items-center justify-center p-2 sm:p-3 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="w-full max-w-5xl bg-white border border-[#DCE4E0] rounded-xl shadow-2xl overflow-hidden my-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-2 bg-[#075E54] text-white flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Pencil className="w-3.5 h-3.5 text-[#25D366]" />
            <h2 id="edit-order-modal-title" className="font-display text-sm font-bold">
              Edit Order Entry
            </h2>
          </div>
          <div className="flex items-center gap-2.5">
            <span className="text-[11px] text-white/90 font-mono-num">
              {(() => {
                if (!bookingDate) return 'Not Confirm';
                const tag = getIndianDayTag(bookingDate);
                const formatted = formatIndianDate(bookingDate) || 'Not Confirm';
                return tag ? `${tag} · ${formatted}` : formatted;
              })()}
            </span>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close edit order popup"
              className="p-1 rounded hover:bg-white/15 text-white cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        <form onSubmit={handleSave} className="p-3 max-h-[90vh] overflow-y-auto bg-white">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 items-stretch">
            {/* LEFT BOX: Customer Details */}
            <div className="lg:col-span-5 bg-[#F2F8F4] border border-[#CFE0D6] rounded-lg p-2.5 flex flex-col justify-between space-y-2">
              <div className="space-y-2">
                <div className="flex items-center justify-between border-b border-[#D9E7DF] pb-1">
                  <span className="text-[11px] font-bold uppercase tracking-wide text-[#075E54]">
                    1. Customer Details
                  </span>
                  <span className="text-[10px] text-slate-500">
                    {order.isExtraWork ? 'Extra Work' : '* Required'}
                  </span>
                </div>

                {/* Phone & Alt Phone */}
                <div className={number.length === 10 || altNumber ? 'grid grid-cols-2 gap-2' : ''}>
                  <div>
                    <div className="flex items-center justify-between gap-1 mb-0.5">
                      <label className="text-[11px] font-medium text-slate-700 truncate">
                        Phone Number {!order.isExtraWork && <span className="text-red-600">*</span>}
                      </label>
                      <span
                        className={`text-[10px] font-mono-num font-semibold shrink-0 ${
                          number.length === 10
                            ? 'text-[#075E54]'
                            : number.length > 0
                            ? 'text-amber-700'
                            : 'text-slate-400'
                        }`}
                      >
                        {number.length}/10
                      </span>
                    </div>
                    <input
                      autoFocus
                      type="text"
                      inputMode="numeric"
                      maxLength={10}
                      required={!order.isExtraWork}
                      value={number}
                      onChange={(e) => {
                        const val = e.target.value.replace(/\D/g, '').slice(0, 10);
                        setNumber(val);
                      }}
                      placeholder="10-digit number"
                      className="w-full px-2.5 py-1 text-xs font-mono-num bg-white border border-[#CFE0D6] rounded-md focus:outline-none focus:border-[#128C7E]"
                    />
                  </div>

                  {(number.length === 10 || altNumber) && (
                    <div>
                      <div className="flex items-center justify-between gap-1 mb-0.5">
                        <label className="text-[11px] font-medium text-slate-700 truncate">
                          Alternate Number (Optional)
                        </label>
                        <span
                          className={`text-[10px] font-mono-num font-semibold shrink-0 ${
                            altNumber.length === 10
                              ? 'text-[#075E54]'
                              : altNumber.length > 0
                              ? 'text-amber-700'
                              : 'text-slate-400'
                          }`}
                        >
                          {altNumber.length}/10
                        </span>
                      </div>
                      <input
                        type="text"
                        inputMode="numeric"
                        maxLength={10}
                        value={altNumber}
                        onChange={(e) =>
                          setAltNumber(e.target.value.replace(/\D/g, '').slice(0, 10))
                        }
                        placeholder="Alternate 10-digit"
                        className="w-full px-2.5 py-1 text-xs font-mono-num bg-white border border-[#CFE0D6] rounded-md focus:outline-none focus:border-[#128C7E]"
                      />
                    </div>
                  )}
                </div>

                {/* Customer Name & City */}
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[11px] font-medium text-slate-700 mb-0.5">
                      Customer Name
                    </label>
                    <input
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Optional"
                      className="w-full px-2.5 py-1 text-xs bg-white border border-[#CFE0D6] rounded-md focus:outline-none focus:border-[#128C7E]"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-medium text-slate-700 mb-0.5">
                      City Name
                    </label>
                    <select
                      value={city}
                      onChange={(e) => setCity(e.target.value)}
                      className="w-full px-2 py-1 text-xs bg-white border border-[#CFE0D6] rounded-md focus:outline-none focus:border-[#128C7E]"
                    >
                      {allCities.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Full Address */}
                <div>
                  <label className="block text-[11px] font-medium text-slate-700 mb-0.5">
                    Full Address
                  </label>
                  <input
                    type="text"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    placeholder="House no., Sector, Landmark (optional)"
                    className="w-full px-2.5 py-1 text-xs bg-white border border-[#CFE0D6] rounded-md focus:outline-none focus:border-[#128C7E]"
                  />
                </div>

                {/* Assign Cleaner & Message / Note */}
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[11px] font-medium text-slate-700 mb-0.5">
                      Assign Cleaner
                    </label>
                    <select
                      value={cleanerName}
                      onChange={(e) => setCleanerName(e.target.value)}
                      className="w-full px-2 py-1 text-xs bg-white border border-[#CFE0D6] rounded-md focus:outline-none focus:border-[#128C7E]"
                    >
                      {allCleaners.map((cl) => (
                        <option key={cl} value={cl}>
                          {cl}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] font-medium text-slate-700 mb-0.5">
                      Note (Optional)
                    </label>
                    <input
                      type="text"
                      value={extraNote}
                      onChange={(e) => setExtraNote(e.target.value)}
                      placeholder="Any instruction..."
                      className="w-full px-2.5 py-1 text-xs bg-white border border-[#CFE0D6] rounded-md focus:outline-none focus:border-[#128C7E]"
                    />
                  </div>
                </div>
              </div>

              {errorMsg && (
                <div className="px-2.5 py-1.5 rounded bg-red-50 border border-red-200 text-red-700 text-[11px] font-medium">
                  {errorMsg}
                </div>
              )}
            </div>

            {/* RIGHT BOX: Services, Qty, Price & Save Changes */}
            <div className="lg:col-span-7 bg-[#FAF6EC] border border-[#E5DABF] rounded-lg p-2.5 flex flex-col justify-between space-y-2">
              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-1.5 border-b border-[#EAE0C8] pb-1">
                  <span className="text-[11px] font-bold uppercase tracking-wide text-amber-900">
                    2. Service, Qty &amp; Price
                  </span>
                  <span className="text-[11px] font-semibold text-[#075E54]">
                    {selectedServices.join(' + ')}
                  </span>
                </div>

                {/* Multi-Service Selector */}
                <div className="flex flex-wrap gap-1">
                  {allServices.map((s) => {
                    const active = selectedServices.some(
                      (item) => item.toLowerCase() === s.toLowerCase()
                    );
                    return (
                      <button
                        key={s}
                        type="button"
                        onClick={() => toggleService(s)}
                        className={`px-2 py-1 text-[11px] font-semibold rounded border inline-flex items-center gap-1 cursor-pointer transition-colors ${
                          active
                            ? 'bg-[#075E54] text-white border-[#075E54]'
                            : 'bg-white text-slate-700 border-[#DFD4B8] hover:bg-[#F5EEDB]'
                        }`}
                      >
                        {active ? (
                          <Check className="w-3 h-3 text-[#25D366]" />
                        ) : (
                          <Plus className="w-3 h-3 text-slate-400" />
                        )}
                        {s}
                      </button>
                    );
                  })}
                </div>

                {/* Water Tank Qty & Price */}
                {hasWaterTankSelected && (
                  <div>
                    <div className="flex items-center justify-between gap-1 mb-1">
                      <span className="text-[11px] font-semibold text-slate-700">
                        Water Tank (Qty &amp; ₹/unit)
                      </span>
                      {tankSummary.totalTanks > 0 && (
                        <span className="text-[10px] text-[#075E54] font-semibold font-mono-num">
                          {tankSummary.totalTanks} tank{tankSummary.totalTanks > 1 ? 's' : ''}
                          {tankSummary.totalPrice > 0
                            ? ` · ₹${tankSummary.totalPrice.toLocaleString('en-IN')}`
                            : ''}
                        </span>
                      )}
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                      {TANK_TYPES.map((t) => {
                        const count = tankCounts[t.key] || 0;
                        const rate = tankPrices[t.key] || 0;
                        const lineTotal = count * rate;
                        return (
                          <div
                            key={t.key}
                            className={`flex items-center justify-between gap-2 px-2 py-1.5 rounded-md border text-[11px] ${
                              count > 0 || rate > 0
                                ? 'bg-white border-[#128C7E] text-[#075E54] font-semibold shadow-2xs'
                                : 'bg-white/95 border-[#E5DABF] text-slate-700'
                            }`}
                          >
                            <div className="min-w-0 flex-1">
                              <div className="leading-tight">{t.label}</div>
                              {lineTotal > 0 && (
                                <div className="text-[10px] font-mono-num text-[#128C7E]">
                                  = ₹{lineTotal.toLocaleString('en-IN')}
                                </div>
                              )}
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              <div className="inline-flex items-center border border-[#D4DDD8] rounded bg-[#F7F9F8] overflow-hidden focus-within:border-[#128C7E] focus-within:bg-white">
                                <button
                                  type="button"
                                  onClick={() =>
                                    setTankCountDirect(t.key, String(Math.max(0, count - 1)))
                                  }
                                  disabled={count === 0}
                                  aria-label={`Decrease ${t.label} qty`}
                                  className="w-5 h-6 flex items-center justify-center text-xs font-bold text-slate-600 hover:bg-[#E7F2EC] disabled:opacity-35 disabled:hover:bg-transparent cursor-pointer"
                                >
                                  -
                                </button>
                                <input
                                  type="text"
                                  inputMode="numeric"
                                  value={count > 0 ? String(count) : ''}
                                  onChange={(e) => setTankCountDirect(t.key, e.target.value)}
                                  placeholder="Qty"
                                  aria-label={`${t.label} qty`}
                                  className="w-8 h-6 text-center font-mono-num text-[11px] bg-transparent border-x border-[#E2E8E5] focus:outline-none text-slate-800 placeholder:text-[10px] placeholder:text-slate-400"
                                />
                                <button
                                  type="button"
                                  onClick={() => setTankCountDirect(t.key, String(count + 1))}
                                  aria-label={`Increase ${t.label} qty`}
                                  className="w-5 h-6 flex items-center justify-center text-xs font-bold text-[#075E54] hover:bg-[#E7F2EC] cursor-pointer"
                                >
                                  +
                                </button>
                              </div>
                              <span className="text-[10px] text-slate-400">×</span>
                              <div className="inline-flex items-center border border-[#D4DDD8] rounded bg-[#F7F9F8] px-1.5 h-6 focus-within:bg-white focus-within:border-[#128C7E]">
                                <span className="text-[10px] font-semibold text-slate-500 mr-0.5">
                                  ₹
                                </span>
                                <input
                                  type="text"
                                  inputMode="numeric"
                                  value={rate > 0 ? String(rate) : ''}
                                  onChange={(e) => setTankPriceDirect(t.key, e.target.value)}
                                  placeholder={
                                    count === 0 && t.defaultPrice > 0
                                      ? String(t.defaultPrice)
                                      : 'Price'
                                  }
                                  aria-label={`${t.label} manual price`}
                                  className="w-14 text-right font-mono-num text-[11px] bg-transparent focus:outline-none text-slate-800 placeholder:text-[10px] placeholder:text-slate-400"
                                />
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Dry Clean Qty & Price */}
                {hasDryCleanSelected && (
                  <div>
                    <div className="flex items-center justify-between gap-1 mb-1">
                      <span className="text-[11px] font-semibold text-slate-700">
                        Dry Clean Items (Qty &amp; ₹/unit)
                      </span>
                      {dryCleanSummary.totalItems > 0 && (
                        <span className="text-[10px] text-[#075E54] font-semibold font-mono-num">
                          {dryCleanSummary.totalItems} item
                          {dryCleanSummary.totalItems > 1 ? 's' : ''}
                          {dryCleanSummary.totalPrice > 0
                            ? ` · ₹${dryCleanSummary.totalPrice.toLocaleString('en-IN')}`
                            : ''}
                        </span>
                      )}
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                      {DRY_CLEAN_ITEMS.map((item) => {
                        const count = dryCleanCounts[item.key] || 0;
                        const rate = dryCleanPrices[item.key] || 0;
                        const lineTotal = count * rate;
                        return (
                          <div
                            key={item.key}
                            className={`flex items-center justify-between gap-2 px-2 py-1.5 rounded-md border text-[11px] ${
                              count > 0 || rate > 0
                                ? 'bg-white border-[#128C7E] text-[#075E54] font-semibold shadow-2xs'
                                : 'bg-white/95 border-[#E5DABF] text-slate-700'
                            }`}
                          >
                            <div className="min-w-0 flex-1">
                              <div className="leading-tight">{item.label}</div>
                              {lineTotal > 0 && (
                                <div className="text-[10px] font-mono-num text-[#128C7E]">
                                  = ₹{lineTotal.toLocaleString('en-IN')}
                                </div>
                              )}
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              <div className="inline-flex items-center border border-[#D4DDD8] rounded bg-[#F7F9F8] overflow-hidden focus-within:border-[#128C7E] focus-within:bg-white">
                                <button
                                  type="button"
                                  onClick={() =>
                                    setDryCleanCountDirect(
                                      item.key,
                                      String(Math.max(0, count - 1))
                                    )
                                  }
                                  disabled={count === 0}
                                  aria-label={`Decrease ${item.label} qty`}
                                  className="w-5 h-6 flex items-center justify-center text-xs font-bold text-slate-600 hover:bg-[#E7F2EC] disabled:opacity-35 disabled:hover:bg-transparent cursor-pointer"
                                >
                                  -
                                </button>
                                <input
                                  type="text"
                                  inputMode="numeric"
                                  value={count > 0 ? String(count) : ''}
                                  onChange={(e) =>
                                    setDryCleanCountDirect(item.key, e.target.value)
                                  }
                                  placeholder="Qty"
                                  aria-label={`${item.label} qty`}
                                  className="w-8 h-6 text-center font-mono-num text-[11px] bg-transparent border-x border-[#E2E8E5] focus:outline-none text-slate-800 placeholder:text-[10px] placeholder:text-slate-400"
                                />
                                <button
                                  type="button"
                                  onClick={() =>
                                    setDryCleanCountDirect(item.key, String(count + 1))
                                  }
                                  aria-label={`Increase ${item.label} qty`}
                                  className="w-5 h-6 flex items-center justify-center text-xs font-bold text-[#075E54] hover:bg-[#E7F2EC] cursor-pointer"
                                >
                                  +
                                </button>
                              </div>
                              <span className="text-[10px] text-slate-400">×</span>
                              <div className="inline-flex items-center border border-[#D4DDD8] rounded bg-[#F7F9F8] px-1.5 h-6 focus-within:bg-white focus-within:border-[#128C7E]">
                                <span className="text-[10px] font-semibold text-slate-500 mr-0.5">
                                  ₹
                                </span>
                                <input
                                  type="text"
                                  inputMode="numeric"
                                  value={rate > 0 ? String(rate) : ''}
                                  onChange={(e) =>
                                    setDryCleanPriceDirect(item.key, e.target.value)
                                  }
                                  placeholder={
                                    count === 0 && item.defaultPrice > 0
                                      ? String(item.defaultPrice)
                                      : 'Price'
                                  }
                                  aria-label={`${item.label} manual price`}
                                  className="w-14 text-right font-mono-num text-[11px] bg-transparent focus:outline-none text-slate-800 placeholder:text-[10px] placeholder:text-slate-400"
                                />
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Home Cleaning Qty & Manual Price */}
                {hasHomeCleaningSelected && (
                  <div>
                    <div className="flex items-center justify-between gap-1 mb-1">
                      <span className="text-[11px] font-semibold text-slate-700">
                        Home Cleaning Areas (Qty &amp; ₹/unit)
                      </span>
                      {homeCleaningSummary.totalItems > 0 && (
                        <span className="text-[10px] text-[#075E54] font-semibold font-mono-num">
                          {homeCleaningSummary.totalItems} item
                          {homeCleaningSummary.totalItems > 1 ? 's' : ''}
                          {homeCleaningSummary.totalPrice > 0
                            ? ` · ₹${homeCleaningSummary.totalPrice.toLocaleString('en-IN')}`
                            : ''}
                        </span>
                      )}
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                      {HOME_CLEANING_ITEMS.map((item) => {
                        const count = homeCleaningCounts[item.key] || 0;
                        const rate = homeCleaningPrices[item.key] || 0;
                        const lineTotal = count * rate;
                        return (
                          <div
                            key={item.key}
                            className={`flex items-center justify-between gap-2 px-2 py-1.5 rounded-md border text-[11px] ${
                              count > 0 || rate > 0
                                ? 'bg-white border-[#128C7E] text-[#075E54] font-semibold shadow-2xs'
                                : 'bg-white/95 border-[#E5DABF] text-slate-700'
                            }`}
                          >
                            <div className="min-w-0 flex-1">
                              <div className="leading-tight truncate">{item.label}</div>
                              {lineTotal > 0 && (
                                <div className="text-[10px] font-mono-num text-[#128C7E]">
                                  = ₹{lineTotal.toLocaleString('en-IN')}
                                </div>
                              )}
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              <div className="inline-flex items-center border border-[#D4DDD8] rounded bg-[#F7F9F8] overflow-hidden focus-within:border-[#128C7E] focus-within:bg-white">
                                <button
                                  type="button"
                                  onClick={() =>
                                    setHomeCleaningCountDirect(
                                      item.key,
                                      String(Math.max(0, count - 1))
                                    )
                                  }
                                  disabled={count === 0}
                                  aria-label={`Decrease ${item.label} qty`}
                                  className="w-5 h-6 flex items-center justify-center text-xs font-bold text-slate-600 hover:bg-[#E7F2EC] disabled:opacity-35 disabled:hover:bg-transparent cursor-pointer"
                                >
                                  -
                                </button>
                                <input
                                  type="text"
                                  inputMode="numeric"
                                  value={count > 0 ? String(count) : ''}
                                  onChange={(e) =>
                                    setHomeCleaningCountDirect(item.key, e.target.value)
                                  }
                                  placeholder="Qty"
                                  aria-label={`${item.label} qty`}
                                  className="w-8 h-6 text-center font-mono-num text-[11px] bg-transparent border-x border-[#E2E8E5] focus:outline-none text-slate-800 placeholder:text-[10px] placeholder:text-slate-400"
                                />
                                <button
                                  type="button"
                                  onClick={() =>
                                    setHomeCleaningCountDirect(item.key, String(count + 1))
                                  }
                                  aria-label={`Increase ${item.label} qty`}
                                  className="w-5 h-6 flex items-center justify-center text-xs font-bold text-[#075E54] hover:bg-[#E7F2EC] cursor-pointer"
                                >
                                  +
                                </button>
                              </div>
                              <span className="text-[10px] text-slate-400">×</span>
                              <div className="inline-flex items-center border border-[#D4DDD8] rounded bg-[#F7F9F8] px-1.5 h-6 focus-within:bg-white focus-within:border-[#128C7E]">
                                <span className="text-[10px] font-semibold text-slate-500 mr-0.5">
                                  ₹
                                </span>
                                <input
                                  type="text"
                                  inputMode="numeric"
                                  value={rate > 0 ? String(rate) : ''}
                                  onChange={(e) =>
                                    setHomeCleaningPriceDirect(item.key, e.target.value)
                                  }
                                  placeholder="Price"
                                  aria-label={`${item.label} manual price`}
                                  className="w-14 text-right font-mono-num text-[11px] bg-transparent focus:outline-none text-slate-800 placeholder:text-[10px] placeholder:text-slate-400"
                                />
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Other Services Qty & Price */}
                {hasOtherServiceSelected && (
                  <div>
                    <div className="flex items-center justify-between gap-1 mb-1">
                      <span className="text-[11px] font-semibold text-slate-700">
                        Service Qty &amp; ₹/unit
                      </span>
                      {serviceQtySummary.totalQty > 0 && (
                        <span className="text-[10px] text-[#075E54] font-semibold font-mono-num">
                          Qty: {serviceQtySummary.totalQty}
                          {serviceQtySummary.totalPrice > 0
                            ? ` · ₹${serviceQtySummary.totalPrice.toLocaleString('en-IN')}`
                            : ''}
                        </span>
                      )}
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                      {selectedNonTankServices.map((s) => {
                        const qtyVal = serviceQuantities[s] || 0;
                        const rate = servicePrices[s] || 0;
                        const defaultPrice = getDefaultServicePrice(s);
                        const lineTotal = qtyVal * rate;
                        const isSeats = s.toLowerCase() === 'sofa';
                        const unitLabel = isSeats ? `${s} (Seats)` : s;
                        return (
                          <div
                            key={s}
                            className={`flex items-center justify-between gap-2 px-2 py-1.5 rounded-md border text-[11px] ${
                              qtyVal > 0 || rate > 0
                                ? 'bg-white border-[#128C7E] text-[#075E54] font-semibold shadow-2xs'
                                : 'bg-white/95 border-[#E5DABF] text-slate-700'
                            }`}
                          >
                            <div className="min-w-0 flex-1">
                              <div className="leading-tight">{unitLabel}</div>
                              {lineTotal > 0 && (
                                <div className="text-[10px] font-mono-num text-[#128C7E]">
                                  = ₹{lineTotal.toLocaleString('en-IN')}
                                </div>
                              )}
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              <div className="inline-flex items-center border border-[#D4DDD8] rounded bg-[#F7F9F8] overflow-hidden focus-within:border-[#128C7E] focus-within:bg-white">
                                <button
                                  type="button"
                                  onClick={() =>
                                    setServiceQtyDirect(s, String(Math.max(0, qtyVal - 1)))
                                  }
                                  disabled={qtyVal === 0}
                                  aria-label={`Decrease ${unitLabel} qty`}
                                  className="w-5 h-6 flex items-center justify-center text-xs font-bold text-slate-600 hover:bg-[#E7F2EC] disabled:opacity-35 disabled:hover:bg-transparent cursor-pointer"
                                >
                                  -
                                </button>
                                <input
                                  type="text"
                                  inputMode="numeric"
                                  value={qtyVal > 0 ? String(qtyVal) : ''}
                                  onChange={(e) => setServiceQtyDirect(s, e.target.value)}
                                  placeholder={isSeats ? 'Seats' : 'Qty'}
                                  aria-label={`${unitLabel} qty`}
                                  className="w-8 h-6 text-center font-mono-num text-[11px] bg-transparent border-x border-[#E2E8E5] focus:outline-none text-slate-800 placeholder:text-[10px] placeholder:text-slate-400"
                                />
                                <button
                                  type="button"
                                  onClick={() => setServiceQtyDirect(s, String(qtyVal + 1))}
                                  aria-label={`Increase ${unitLabel} qty`}
                                  className="w-5 h-6 flex items-center justify-center text-xs font-bold text-[#075E54] hover:bg-[#E7F2EC] cursor-pointer"
                                >
                                  +
                                </button>
                              </div>
                              <span className="text-[10px] text-slate-400">×</span>
                              <div className="inline-flex items-center border border-[#D4DDD8] rounded bg-[#F7F9F8] px-1.5 h-6 focus-within:bg-white focus-within:border-[#128C7E]">
                                <span className="text-[10px] font-semibold text-slate-500 mr-0.5">
                                  ₹
                                </span>
                                <input
                                  type="text"
                                  inputMode="numeric"
                                  value={rate > 0 ? String(rate) : ''}
                                  onChange={(e) => setServicePriceDirect(s, e.target.value)}
                                  placeholder={
                                    qtyVal === 0 && defaultPrice > 0
                                      ? String(defaultPrice)
                                      : 'Price'
                                  }
                                  aria-label={`${unitLabel} manual price`}
                                  className="w-14 text-right font-mono-num text-[11px] bg-transparent focus:outline-none text-slate-800 placeholder:text-[10px] placeholder:text-slate-400"
                                />
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              {/* Booking Date + Price + Less Price + Extra + Save Footer inside Right Box */}
              <div className="space-y-2 pt-2 border-t border-[#EAE0C8]">
                {/* Booking Date */}
                <div>
                  <div className="flex items-center justify-between mb-0.5">
                    <label className="text-[11px] font-medium text-slate-700">
                      Booking Date <span className="text-red-600">*</span>
                    </label>
                    <span
                      className={`text-[10px] font-mono-num font-semibold ${
                        dateSelectionMode === 'date' && bookingDate
                          ? 'text-[#075E54]'
                          : dateSelectionMode === 'not_confirm'
                          ? 'text-amber-700'
                          : 'text-slate-400'
                      }`}
                    >
                      {dateSelectionMode === 'date' && bookingDate
                        ? formatIndianDate(bookingDate)
                        : dateSelectionMode === 'not_confirm'
                        ? 'Not Confirm'
                        : 'Select Date'}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-1">
                    {[
                      { label: 'Aj', date: today0 },
                      { label: 'Kal', date: today1 },
                      { label: 'Parso', date: today2 },
                    ].map((opt) => {
                      const active =
                        dateSelectionMode === 'date' &&
                        !customDateOpen &&
                        bookingDate === opt.date;
                      return (
                        <button
                          key={opt.label}
                          type="button"
                          onClick={() => {
                            setBookingDate(opt.date);
                            setDateSelectionMode('date');
                            setCustomDateOpen(false);
                          }}
                          className={`flex-1 py-1 px-2 text-[11px] font-semibold rounded border cursor-pointer transition-colors whitespace-nowrap ${
                            active
                              ? 'bg-[#075E54] text-white border-[#075E54]'
                              : 'bg-white text-slate-700 border-[#DFD4B8] hover:bg-[#F5EEDB]'
                          }`}
                        >
                          {opt.label}
                        </button>
                      );
                    })}

                    <button
                      type="button"
                      onClick={() => setCustomDateOpen((prev) => !prev)}
                      className={`flex-1 py-1 px-2 text-[11px] font-semibold rounded border cursor-pointer transition-colors whitespace-nowrap ${
                        customDateOpen ||
                        (dateSelectionMode === 'date' &&
                          Boolean(bookingDate) &&
                          !getIndianDayTag(bookingDate))
                          ? 'bg-[#075E54] text-white border-[#075E54]'
                          : 'bg-white text-slate-700 border-[#DFD4B8] hover:bg-[#F5EEDB]'
                      }`}
                    >
                      Date
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setBookingDate('');
                        setDateSelectionMode('not_confirm');
                        setCustomDateOpen(false);
                      }}
                      className={`shrink-0 py-1 px-2 text-[11px] font-semibold rounded border cursor-pointer transition-colors whitespace-nowrap ${
                        !customDateOpen && dateSelectionMode === 'not_confirm'
                          ? 'bg-amber-600 text-white border-amber-600'
                          : 'bg-amber-50 text-amber-800 border-amber-300 hover:bg-amber-100'
                      }`}
                    >
                      Not Confirm
                    </button>
                  </div>

                  {(customDateOpen ||
                    (dateSelectionMode === 'date' &&
                      Boolean(bookingDate) &&
                      !getIndianDayTag(bookingDate))) && (
                    <div className="mt-1 flex items-center gap-1.5">
                      <IndianDateInput
                        ariaLabel="Select custom booking date"
                        title="Custom Date (DD/MM/YY)"
                        value={bookingDate}
                        onChange={(val) => {
                          if (val) {
                            setBookingDate(val);
                            setDateSelectionMode('date');
                          }
                        }}
                        className="flex-1 rounded-md border-[#128C7E]"
                      />
                    </div>
                  )}
                </div>

                {lessAmount > 0 && (
                  <div className="px-2 py-1 rounded bg-[#E9F7F0] border border-[#BFE6D1] flex items-center justify-between gap-2 text-[11px] font-mono-num">
                    <span className="text-slate-600">
                      ₹{grossTotal.toLocaleString('en-IN')} - ₹{lessAmount.toLocaleString('en-IN')}
                    </span>
                    <span className="font-bold text-[#075E54]">
                      Net = ₹{netFinalPrice.toLocaleString('en-IN')}
                    </span>
                  </div>
                )}

                <div className="flex flex-wrap sm:flex-nowrap items-end gap-2">
                  <div className="flex-1 min-w-[90px]">
                    <div className="flex items-center justify-between gap-1 mb-0.5">
                      <label className="text-[11px] font-medium text-slate-700 whitespace-nowrap">
                        Total Price (₹)
                      </label>
                      {autoCalculatedTotal > 0 &&
                        (priceManuallyEdited && Number(priceInput) !== autoCalculatedTotal ? (
                          <button
                            type="button"
                            onClick={() => {
                              setPriceManuallyEdited(false);
                              setPriceInput(String(autoCalculatedTotal));
                            }}
                            className="text-[10px] font-semibold text-[#128C7E] hover:underline cursor-pointer whitespace-nowrap"
                          >
                            Use ₹{autoCalculatedTotal.toLocaleString('en-IN')}
                          </button>
                        ) : (
                          <span className="text-[10px] font-semibold text-[#075E54]">Auto</span>
                        ))}
                    </div>
                    <input
                      type="number"
                      min={0}
                      value={priceInput}
                      onChange={(e) => {
                        setPriceManuallyEdited(true);
                        setPriceInput(e.target.value);
                      }}
                      placeholder="Amount"
                      className="w-full h-[30px] px-2 text-xs font-mono-num bg-white border border-[#DFD4B8] rounded-md focus:outline-none focus:border-[#128C7E]"
                    />
                  </div>

                  <div className="flex-1 min-w-[80px]">
                    <label className="block text-[11px] font-medium text-slate-700 mb-0.5 whitespace-nowrap">
                      Less Price (₹)
                    </label>
                    <div className="flex items-center h-[30px] bg-[#FFF8F6] border border-[#F3D0C8] rounded-md px-2 focus-within:bg-white focus-within:border-red-400">
                      <span className="text-[11px] font-bold text-red-500 mr-1 shrink-0">- ₹</span>
                      <input
                        type="number"
                        min={0}
                        value={lessPriceInput}
                        onChange={(e) => setLessPriceInput(e.target.value)}
                        placeholder="0"
                        aria-label="Less Price"
                        className="w-full py-1 text-xs font-mono-num bg-transparent focus:outline-none text-slate-800"
                      />
                    </div>
                  </div>

                  <div className="w-20 shrink-0">
                    <label className="block text-[11px] font-medium text-slate-700 mb-0.5 whitespace-nowrap">
                      Extra (₹)
                    </label>
                    <input
                      type="number"
                      min={0}
                      value={extraAmountInput}
                      onChange={(e) => setExtraAmountInput(e.target.value)}
                      placeholder="0"
                      aria-label="Extra Work Amount"
                      className="w-full h-[30px] px-2 text-xs font-mono-num bg-white border border-[#DFD4B8] rounded-md focus:outline-none focus:border-[#128C7E]"
                    />
                  </div>

                  <button
                    type="button"
                    onClick={onClose}
                    className="h-[30px] px-2.5 text-[11px] font-semibold bg-white border border-[#DFD4B8] hover:bg-slate-50 text-slate-700 rounded-md cursor-pointer whitespace-nowrap shrink-0"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    className="h-[30px] px-3 bg-[#128C7E] hover:bg-[#075E54] disabled:opacity-60 text-white text-xs font-semibold rounded-md flex items-center gap-1 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                  >
                    <Check className="w-3.5 h-3.5" />
                    {saving ? 'Saving...' : 'Save Changes'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
