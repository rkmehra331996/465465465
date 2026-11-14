import React, { useEffect, useMemo, useState } from 'react';
import { Check, Plus, X } from 'lucide-react';
import {
  DRY_CLEAN_ITEMS,
  HOME_CLEANING_ITEMS,
  getDefaultServicePrice,
  type Order,
} from '../types';

export const TANK_TYPES = [
  { key: '500L', label: '500 Ltr', defaultPrice: 500 },
  { key: '750L', label: '750 Ltr', defaultPrice: 550 },
  { key: '1000L', label: '1000 Ltr', defaultPrice: 600 },
  { key: '1500L', label: '1500 Ltr', defaultPrice: 700 },
  { key: '2000L', label: '2000 Ltr', defaultPrice: 800 },
  { key: 'Cement Tank', label: 'Cement Tank', defaultPrice: 0 },
] as const;

interface ServiceEditModalProps {
  order: Order | null;
  services: string[];
  onClose: () => void;
  onSave: (
    orderId: string,
    patch: { serviceName: string; qty: number | null; price?: number; notes: string }
  ) => Promise<void>;
}

export function parseOrderServiceState(order: Order, availableServices: string[]) {
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
  const tankPrices: Record<string, number> = {};
  const dryCleanCounts: Record<string, number> = {};
  const dryCleanPrices: Record<string, number> = {};
  const homeCleaningCounts: Record<string, number> = {};
  const homeCleaningPrices: Record<string, number> = {};
  const serviceQuantities: Record<string, number> = {};
  const servicePrices: Record<string, number> = {};
  const extraNoteParts: string[] = [];
  let lessPrice = 0;

  const segments = (order.notes || '')
    .split('|')
    .map((seg) => seg.trim())
    .filter(Boolean);

  for (const seg of segments) {
    const lessMatch = /^Less:\s*₹?\s*(\d+(?:\.\d+)?)$/i.exec(seg);
    if (lessMatch) {
      const parsedLess = Math.round(Number(lessMatch[1]));
      if (parsedLess > 0) lessPrice = parsedLess;
      continue;
    }

    const parts = seg.split(',').map((p) => p.trim()).filter(Boolean);
    let matchedTankSeg = parts.length > 0;
    const tempTanks: Record<string, number> = {};
    const tempTankPrices: Record<string, number> = {};
    for (const part of parts) {
      const tankMatch =
        /^(500 Ltr|750 Ltr|1000 Ltr|1500 Ltr|2000 Ltr|Cement Tank)\s*[×x*]\s*(\d+)(?:\s*@\s*₹?\s*(\d+(?:\.\d+)?))?$/i.exec(
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
      const rate = tankMatch[3] ? Math.round(Number(tankMatch[3])) : 0;
      if (cnt > 0) tempTanks[tankDef.key] = cnt;
      if (rate > 0) tempTankPrices[tankDef.key] = rate;
    }

    if (matchedTankSeg) {
      Object.assign(tankCounts, tempTanks);
      Object.assign(tankPrices, tempTankPrices);
      continue;
    }

    let matchedDryCleanSeg = parts.length > 0;
    const tempDryClean: Record<string, number> = {};
    const tempDryCleanPrices: Record<string, number> = {};
    for (const part of parts) {
      const dcMatch = /^(.+?)\s*[×x*]\s*(\d+)(?:\s*@\s*₹?\s*(\d+(?:\.\d+)?))?$/i.exec(part);
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
      const rate = dcMatch[3] ? Math.round(Number(dcMatch[3])) : 0;
      if (cnt > 0) tempDryClean[dcDef.key] = cnt;
      if (rate > 0) tempDryCleanPrices[dcDef.key] = rate;
    }

    if (matchedDryCleanSeg) {
      Object.assign(dryCleanCounts, tempDryClean);
      Object.assign(dryCleanPrices, tempDryCleanPrices);
      continue;
    }

    let matchedHomeCleaningSeg = parts.length > 0;
    const tempHomeCleaning: Record<string, number> = {};
    const tempHomeCleaningPrices: Record<string, number> = {};
    for (const part of parts) {
      const hcMatch =
        /^(?:Home Cleaning:\s*)?(.+?)\s*[×x*]\s*(\d+)(?:\s*@\s*₹?\s*(\d+(?:\.\d+)?))?$/i.exec(
          part
        );
      if (!hcMatch) {
        matchedHomeCleaningSeg = false;
        break;
      }
      const hcDef = HOME_CLEANING_ITEMS.find(
        (item) => item.label.toLowerCase() === hcMatch[1].trim().toLowerCase()
      );
      if (!hcDef) {
        matchedHomeCleaningSeg = false;
        break;
      }
      const cnt = Number(hcMatch[2]);
      const rate = hcMatch[3] ? Math.round(Number(hcMatch[3])) : 0;
      if (cnt > 0) tempHomeCleaning[hcDef.key] = cnt;
      if (rate > 0) tempHomeCleaningPrices[hcDef.key] = rate;
    }

    if (matchedHomeCleaningSeg) {
      Object.assign(homeCleaningCounts, tempHomeCleaning);
      Object.assign(homeCleaningPrices, tempHomeCleaningPrices);
      continue;
    }

    let matchedServiceSeg = parts.length > 0;
    const tempServiceQty: Record<string, number> = {};
    const tempServicePrices: Record<string, number> = {};
    for (const part of parts) {
      const svcMatch =
        /^(.+?):\s*(\d+)(?:\s*Seats?)?(?:\s*@\s*₹?\s*(\d+(?:\.\d+)?))?$/i.exec(part);
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
      const rate = svcMatch[3] ? Math.round(Number(svcMatch[3])) : 0;
      if (matchedSvc.toLowerCase() === 'dry clean') {
        if (cnt > 0 && !('Sofa Seat' in dryCleanCounts)) {
          dryCleanCounts['Sofa Seat'] = cnt;
          if (rate > 0) dryCleanPrices['Sofa Seat'] = rate;
        }
        continue;
      }
      if (cnt > 0) tempServiceQty[matchedSvc] = cnt;
      if (rate > 0) tempServicePrices[matchedSvc] = rate;
    }

    if (matchedServiceSeg) {
      Object.assign(serviceQuantities, tempServiceQty);
      Object.assign(servicePrices, tempServicePrices);
      continue;
    }

    extraNoteParts.push(seg);
  }

  const nonTankNonDryCleanSelected = uniqueServices.filter((s) => {
    const lower = s.toLowerCase();
    return lower !== 'water tank' && lower !== 'dry clean' && lower !== 'home cleaning';
  });
  if (
    Object.keys(serviceQuantities).length === 0 &&
    Object.keys(tankCounts).length === 0 &&
    Object.keys(dryCleanCounts).length === 0 &&
    Object.keys(homeCleaningCounts).length === 0 &&
    nonTankNonDryCleanSelected.length === 1 &&
    order.qty &&
    order.qty > 0
  ) {
    serviceQuantities[nonTankNonDryCleanSelected[0]] = order.qty;
  }

  let parsedAutoTotal = 0;
  for (const t of TANK_TYPES) {
    parsedAutoTotal += (tankCounts[t.key] || 0) * (tankPrices[t.key] || 0);
  }
  for (const item of DRY_CLEAN_ITEMS) {
    parsedAutoTotal += (dryCleanCounts[item.key] || 0) * (dryCleanPrices[item.key] || 0);
  }
  for (const item of HOME_CLEANING_ITEMS) {
    parsedAutoTotal +=
      (homeCleaningCounts[item.key] || 0) * (homeCleaningPrices[item.key] || 0);
  }
  for (const s of nonTankNonDryCleanSelected) {
    parsedAutoTotal += (serviceQuantities[s] || 0) * (servicePrices[s] || 0);
  }

  return {
    selectedServices: uniqueServices,
    tankCounts,
    tankPrices,
    dryCleanCounts,
    dryCleanPrices,
    homeCleaningCounts,
    homeCleaningPrices,
    serviceQuantities,
    servicePrices,
    parsedAutoTotal,
    lessPrice,
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
  const [tankPrices, setTankPrices] = useState<Record<string, number>>({});
  const [dryCleanCounts, setDryCleanCounts] = useState<Record<string, number>>({});
  const [dryCleanPrices, setDryCleanPrices] = useState<Record<string, number>>({});
  const [homeCleaningCounts, setHomeCleaningCounts] = useState<Record<string, number>>({});
  const [homeCleaningPrices, setHomeCleaningPrices] = useState<Record<string, number>>({});
  const [serviceQuantities, setServiceQuantities] = useState<Record<string, number>>({});
  const [servicePrices, setServicePrices] = useState<Record<string, number>>({});
  const [priceInput, setPriceInput] = useState('');
  const [lessPriceInput, setLessPriceInput] = useState('');
  const [priceManuallyEdited, setPriceManuallyEdited] = useState(false);
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
    setPriceManuallyEdited(
      initialGross > 0 && initialGross !== parsed.parsedAutoTotal
    );
    setSaving(false);
  }, [order, services]);

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

  const setTankCountDirect = (key: string, rawVal: string) => {
    const digits = rawVal.replace(/\D/g, '');
    const num = digits ? Math.max(0, Math.min(999, Number(digits))) : 0;
    const prevCount = tankCounts[key] || 0;
    const tankDef = TANK_TYPES.find((t) => t.key === key);

    if (num === 0) {
      setTankCounts((prev) => {
        if (!(key in prev)) return prev;
        const copy = { ...prev };
        delete copy[key];
        return copy;
      });
      setTankPrices((pPrev) => {
        if (!(key in pPrev)) return pPrev;
        const pCopy = { ...pPrev };
        delete pCopy[key];
        return pCopy;
      });
      return;
    }

    setTankCounts((prev) => ({ ...prev, [key]: num }));
    if (prevCount === 0 && tankDef && tankDef.defaultPrice > 0) {
      setTankPrices((pPrev) =>
        pPrev[key] === undefined ? { ...pPrev, [key]: tankDef.defaultPrice } : pPrev
      );
    }
  };

  const setTankPriceDirect = (key: string, rawVal: string) => {
    const digits = rawVal.replace(/\D/g, '');
    const num = digits ? Math.max(0, Math.min(999999, Number(digits))) : 0;
    const count = tankCounts[key] || 0;

    if (num === 0) {
      setTankPrices((prev) => {
        if (count > 0) {
          return { ...prev, [key]: 0 };
        }
        if (!(key in prev)) return prev;
        const copy = { ...prev };
        delete copy[key];
        return copy;
      });
      return;
    }

    setTankPrices((prev) => ({ ...prev, [key]: num }));
    if (count === 0) {
      setTankCounts((prev) => ((prev[key] || 0) === 0 ? { ...prev, [key]: 1 } : prev));
    }
  };

  const setDryCleanCountDirect = (key: string, rawVal: string) => {
    const digits = rawVal.replace(/\D/g, '');
    const num = digits ? Math.max(0, Math.min(999, Number(digits))) : 0;
    const prevCount = dryCleanCounts[key] || 0;
    const itemDef = DRY_CLEAN_ITEMS.find((item) => item.key === key);

    if (num === 0) {
      setDryCleanCounts((prev) => {
        if (!(key in prev)) return prev;
        const copy = { ...prev };
        delete copy[key];
        return copy;
      });
      setDryCleanPrices((pPrev) => {
        if (!(key in pPrev)) return pPrev;
        const pCopy = { ...pPrev };
        delete pCopy[key];
        return pCopy;
      });
      return;
    }

    setDryCleanCounts((prev) => ({ ...prev, [key]: num }));
    if (prevCount === 0 && itemDef && itemDef.defaultPrice > 0) {
      setDryCleanPrices((pPrev) =>
        pPrev[key] === undefined ? { ...pPrev, [key]: itemDef.defaultPrice } : pPrev
      );
    }
  };

  const setDryCleanPriceDirect = (key: string, rawVal: string) => {
    const digits = rawVal.replace(/\D/g, '');
    const num = digits ? Math.max(0, Math.min(999999, Number(digits))) : 0;
    const count = dryCleanCounts[key] || 0;

    if (num === 0) {
      setDryCleanPrices((prev) => {
        if (count > 0) {
          return { ...prev, [key]: 0 };
        }
        if (!(key in prev)) return prev;
        const copy = { ...prev };
        delete copy[key];
        return copy;
      });
      return;
    }

    setDryCleanPrices((prev) => ({ ...prev, [key]: num }));
    if (count === 0) {
      setDryCleanCounts((prev) => ((prev[key] || 0) === 0 ? { ...prev, [key]: 1 } : prev));
    }
  };

  const setHomeCleaningCountDirect = (key: string, rawVal: string) => {
    const digits = rawVal.replace(/\D/g, '');
    const num = digits ? Math.max(0, Math.min(999, Number(digits))) : 0;
    if (num === 0) {
      setHomeCleaningCounts((prev) => {
        if (!(key in prev)) return prev;
        const copy = { ...prev };
        delete copy[key];
        return copy;
      });
      setHomeCleaningPrices((pPrev) => {
        if (!(key in pPrev)) return pPrev;
        const pCopy = { ...pPrev };
        delete pCopy[key];
        return pCopy;
      });
      return;
    }
    setHomeCleaningCounts((prev) => ({ ...prev, [key]: num }));
  };

  const setHomeCleaningPriceDirect = (key: string, rawVal: string) => {
    const digits = rawVal.replace(/\D/g, '');
    const num = digits ? Math.max(0, Math.min(999999, Number(digits))) : 0;
    const count = homeCleaningCounts[key] || 0;

    if (num === 0) {
      setHomeCleaningPrices((prev) => {
        if (count > 0) {
          return { ...prev, [key]: 0 };
        }
        if (!(key in prev)) return prev;
        const copy = { ...prev };
        delete copy[key];
        return copy;
      });
      return;
    }

    setHomeCleaningPrices((prev) => ({ ...prev, [key]: num }));
    if (count === 0) {
      setHomeCleaningCounts((prev) => ((prev[key] || 0) === 0 ? { ...prev, [key]: 1 } : prev));
    }
  };

  const setServiceQtyDirect = (service: string, rawVal: string) => {
    const digits = rawVal.replace(/\D/g, '');
    const num = digits ? Math.max(0, Math.min(999, Number(digits))) : 0;
    const prevQty = serviceQuantities[service] || 0;
    const defaultPrice = getDefaultServicePrice(service);

    if (num === 0) {
      setServiceQuantities((prev) => {
        if (!(service in prev)) return prev;
        const copy = { ...prev };
        delete copy[service];
        return copy;
      });
      setServicePrices((pPrev) => {
        if (!(service in pPrev)) return pPrev;
        const pCopy = { ...pPrev };
        delete pCopy[service];
        return pCopy;
      });
      return;
    }

    setServiceQuantities((prev) => ({ ...prev, [service]: num }));
    if (prevQty === 0 && defaultPrice > 0) {
      setServicePrices((pPrev) =>
        pPrev[service] === undefined ? { ...pPrev, [service]: defaultPrice } : pPrev
      );
    }
  };

  const setServicePriceDirect = (service: string, rawVal: string) => {
    const digits = rawVal.replace(/\D/g, '');
    const num = digits ? Math.max(0, Math.min(999999, Number(digits))) : 0;
    const qty = serviceQuantities[service] || 0;

    if (num === 0) {
      setServicePrices((prev) => {
        if (qty > 0) {
          return { ...prev, [service]: 0 };
        }
        if (!(service in prev)) return prev;
        const copy = { ...prev };
        delete copy[service];
        return copy;
      });
      return;
    }

    setServicePrices((prev) => ({ ...prev, [service]: num }));
    if (qty === 0) {
      setServiceQuantities((prev) => ((prev[service] || 0) === 0 ? { ...prev, [service]: 1 } : prev));
    }
  };

  const grossTotal = Math.max(0, Number(priceInput) || 0);
  const lessAmount = Math.max(0, Number(lessPriceInput) || 0);
  const netFinalPrice = Math.max(0, grossTotal - lessAmount);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedServices.length === 0) return;
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
        serviceName: selectedServices.join(' + '),
        qty: totalQty > 0 ? totalQty : order.qty,
        price:
          priceInput.trim() === '' && lessPriceInput.trim() === ''
            ? order.price
            : netFinalPrice,
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
        className="w-full max-w-3xl bg-white border border-[#DCE4E0] rounded-xl shadow-xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="bg-[#075E54] text-white px-5 py-3 flex items-center justify-between">
          <div>
            <h3 className="font-display text-sm font-bold">Edit Services, Qty &amp; Prices</h3>
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
              <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                <label className="text-xs font-semibold text-slate-700">
                  Water Tank Quantity &amp; Manual Price (₹/unit)
                </label>
                {tankSummary.totalTanks > 0 && (
                  <span className="text-xs text-[#075E54] font-semibold">
                    {tankSummary.text}
                    {tankSummary.totalPrice > 0
                      ? ` · ₹${tankSummary.totalPrice.toLocaleString('en-IN')}`
                      : ''}
                  </span>
                )}
              </div>
              <div className="bg-[#F7F9F8] border border-[#DCE4E0] rounded-lg p-2">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {TANK_TYPES.map((t) => {
                    const count = tankCounts[t.key] || 0;
                    const rate = tankPrices[t.key] || 0;
                    const lineTotal = count * rate;
                    return (
                      <div
                        key={t.key}
                        className={`flex items-center justify-between gap-2 px-2.5 py-1.5 rounded border text-xs ${
                          count > 0 || rate > 0
                            ? 'bg-white border-[#128C7E] text-[#075E54] font-semibold'
                            : 'bg-white border-[#DCE4E0] text-slate-700'
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="truncate">{t.label}</div>
                          {lineTotal > 0 && (
                            <div className="text-[10px] font-mono-num text-[#128C7E]">
                              = ₹{lineTotal.toLocaleString('en-IN')}
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <div className="flex items-center border border-[#DCE4E0] rounded bg-[#F7F9F8] px-1.5 focus-within:bg-white focus-within:border-[#128C7E]">
                            <span className="text-[10px] text-slate-400 mr-1">Qty</span>
                            <input
                              type="text"
                              inputMode="numeric"
                              value={count > 0 ? String(count) : ''}
                              onChange={(e) => setTankCountDirect(t.key, e.target.value)}
                              placeholder="0"
                              aria-label={`${t.label} qty`}
                              className="w-8 text-center font-mono-num text-xs py-0.5 bg-transparent focus:outline-none text-slate-800"
                            />
                          </div>
                          <span className="text-[10px] text-slate-400">×</span>
                          <div className="flex items-center border border-[#DCE4E0] rounded bg-[#F7F9F8] px-1.5 focus-within:bg-white focus-within:border-[#128C7E]">
                            <span className="text-[10px] text-slate-400 mr-0.5">₹</span>
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
                              className="w-14 text-right font-mono-num text-xs py-0.5 bg-transparent focus:outline-none text-slate-800"
                            />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {hasDryCleanSelected && (
            <div>
              <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                <label className="text-xs font-semibold text-slate-700">
                  Dry Clean Items (Qty &amp; Manual Price ₹/unit)
                </label>
                {dryCleanSummary.totalItems > 0 && (
                  <span className="text-xs text-[#075E54] font-semibold">
                    {dryCleanSummary.text}
                    {dryCleanSummary.totalPrice > 0
                      ? ` · ₹${dryCleanSummary.totalPrice.toLocaleString('en-IN')}`
                      : ''}
                  </span>
                )}
              </div>
              <div className="bg-[#F7F9F8] border border-[#DCE4E0] rounded-lg p-2">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {DRY_CLEAN_ITEMS.map((item) => {
                    const count = dryCleanCounts[item.key] || 0;
                    const rate = dryCleanPrices[item.key] || 0;
                    const lineTotal = count * rate;
                    return (
                      <div
                        key={item.key}
                        className={`flex items-center justify-between gap-2 px-2.5 py-1.5 rounded border text-xs ${
                          count > 0 || rate > 0
                            ? 'bg-white border-[#128C7E] text-[#075E54] font-semibold'
                            : 'bg-white border-[#DCE4E0] text-slate-700'
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="truncate">{item.label}</div>
                          {lineTotal > 0 && (
                            <div className="text-[10px] font-mono-num text-[#128C7E]">
                              = ₹{lineTotal.toLocaleString('en-IN')}
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <div className="flex items-center border border-[#DCE4E0] rounded bg-[#F7F9F8] px-1.5 focus-within:bg-white focus-within:border-[#128C7E]">
                            <span className="text-[10px] text-slate-400 mr-1">Qty</span>
                            <input
                              type="text"
                              inputMode="numeric"
                              value={count > 0 ? String(count) : ''}
                              onChange={(e) => setDryCleanCountDirect(item.key, e.target.value)}
                              placeholder="0"
                              aria-label={`${item.label} qty`}
                              className="w-8 text-center font-mono-num text-xs py-0.5 bg-transparent focus:outline-none text-slate-800"
                            />
                          </div>
                          <span className="text-[10px] text-slate-400">×</span>
                          <div className="flex items-center border border-[#DCE4E0] rounded bg-[#F7F9F8] px-1.5 focus-within:bg-white focus-within:border-[#128C7E]">
                            <span className="text-[10px] text-slate-400 mr-0.5">₹</span>
                            <input
                              type="text"
                              inputMode="numeric"
                              value={rate > 0 ? String(rate) : ''}
                              onChange={(e) => setDryCleanPriceDirect(item.key, e.target.value)}
                              placeholder={
                                count === 0 && item.defaultPrice > 0
                                  ? String(item.defaultPrice)
                                  : 'Price'
                              }
                              aria-label={`${item.label} manual price`}
                              className="w-14 text-right font-mono-num text-xs py-0.5 bg-transparent focus:outline-none text-slate-800"
                            />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {hasHomeCleaningSelected && (
            <div>
              <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                <label className="text-xs font-semibold text-slate-700">
                  Home Cleaning Areas (Qty &amp; Manual Price ₹/unit)
                </label>
                {homeCleaningSummary.totalItems > 0 && (
                  <span className="text-xs text-[#075E54] font-semibold">
                    {homeCleaningSummary.text}
                    {homeCleaningSummary.totalPrice > 0
                      ? ` · ₹${homeCleaningSummary.totalPrice.toLocaleString('en-IN')}`
                      : ''}
                  </span>
                )}
              </div>
              <div className="bg-[#F7F9F8] border border-[#DCE4E0] rounded-lg p-2">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {HOME_CLEANING_ITEMS.map((item) => {
                    const count = homeCleaningCounts[item.key] || 0;
                    const rate = homeCleaningPrices[item.key] || 0;
                    const lineTotal = count * rate;
                    return (
                      <div
                        key={item.key}
                        className={`flex items-center justify-between gap-2 px-2.5 py-1.5 rounded border text-xs ${
                          count > 0 || rate > 0
                            ? 'bg-white border-[#128C7E] text-[#075E54] font-semibold'
                            : 'bg-white border-[#DCE4E0] text-slate-700'
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="truncate">{item.label}</div>
                          {lineTotal > 0 && (
                            <div className="text-[10px] font-mono-num text-[#128C7E]">
                              = ₹{lineTotal.toLocaleString('en-IN')}
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <div className="flex items-center border border-[#DCE4E0] rounded bg-[#F7F9F8] px-1.5 focus-within:bg-white focus-within:border-[#128C7E]">
                            <span className="text-[10px] text-slate-400 mr-1">Qty</span>
                            <input
                              type="text"
                              inputMode="numeric"
                              value={count > 0 ? String(count) : ''}
                              onChange={(e) => setHomeCleaningCountDirect(item.key, e.target.value)}
                              placeholder="0"
                              aria-label={`${item.label} qty`}
                              className="w-8 text-center font-mono-num text-xs py-0.5 bg-transparent focus:outline-none text-slate-800"
                            />
                          </div>
                          <span className="text-[10px] text-slate-400">×</span>
                          <div className="flex items-center border border-[#DCE4E0] rounded bg-[#F7F9F8] px-1.5 focus-within:bg-white focus-within:border-[#128C7E]">
                            <span className="text-[10px] text-slate-400 mr-0.5">₹</span>
                            <input
                              type="text"
                              inputMode="numeric"
                              value={rate > 0 ? String(rate) : ''}
                              onChange={(e) => setHomeCleaningPriceDirect(item.key, e.target.value)}
                              placeholder="Price"
                              aria-label={`${item.label} manual price`}
                              className="w-14 text-right font-mono-num text-xs py-0.5 bg-transparent focus:outline-none text-slate-800"
                            />
                          </div>
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
              <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                <label className="text-xs font-semibold text-slate-700">
                  Service Quantities &amp; Manual Price (₹/unit)
                </label>
                {serviceQtySummary.totalQty > 0 && (
                  <span className="text-xs text-[#075E54] font-semibold">
                    {serviceQtySummary.text}
                    {serviceQtySummary.totalPrice > 0
                      ? ` · ₹${serviceQtySummary.totalPrice.toLocaleString('en-IN')}`
                      : ''}
                  </span>
                )}
              </div>
              <div className="bg-[#F7F9F8] border border-[#DCE4E0] rounded-lg p-2">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
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
                        className={`flex items-center justify-between gap-2 px-2.5 py-1.5 rounded border text-xs ${
                          qtyVal > 0 || rate > 0
                            ? 'bg-white border-[#128C7E] text-[#075E54] font-semibold'
                            : 'bg-white border-[#DCE4E0] text-slate-700'
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="truncate">{unitLabel}</div>
                          {lineTotal > 0 && (
                            <div className="text-[10px] font-mono-num text-[#128C7E]">
                              = ₹{lineTotal.toLocaleString('en-IN')}
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <div className="flex items-center border border-[#DCE4E0] rounded bg-[#F7F9F8] px-1.5 focus-within:bg-white focus-within:border-[#128C7E]">
                            <span className="text-[10px] text-slate-400 mr-1">
                              {isSeats ? 'Seats' : 'Qty'}
                            </span>
                            <input
                              type="text"
                              inputMode="numeric"
                              value={qtyVal > 0 ? String(qtyVal) : ''}
                              onChange={(e) => setServiceQtyDirect(s, e.target.value)}
                              placeholder="0"
                              aria-label={`${unitLabel} qty`}
                              className="w-8 text-center font-mono-num text-xs py-0.5 bg-transparent focus:outline-none text-slate-800"
                            />
                          </div>
                          <span className="text-[10px] text-slate-400">×</span>
                          <div className="flex items-center border border-[#DCE4E0] rounded bg-[#F7F9F8] px-1.5 focus-within:bg-white focus-within:border-[#128C7E]">
                            <span className="text-[10px] text-slate-400 mr-0.5">₹</span>
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
                              className="w-14 text-right font-mono-num text-xs py-0.5 bg-transparent focus:outline-none text-slate-800"
                            />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-start">
            <div className="sm:col-span-4">
              <div className="flex items-center justify-between gap-1 mb-1">
                <label className="text-xs font-semibold text-slate-700">
                  Total Price (₹)
                </label>
                {autoCalculatedTotal > 0 && (
                  priceManuallyEdited && Number(priceInput) !== autoCalculatedTotal ? (
                    <button
                      type="button"
                      onClick={() => {
                        setPriceManuallyEdited(false);
                        setPriceInput(String(autoCalculatedTotal));
                      }}
                      className="text-[10px] font-semibold text-[#128C7E] hover:underline cursor-pointer"
                    >
                      Use ₹{autoCalculatedTotal.toLocaleString('en-IN')}
                    </button>
                  ) : (
                    <span className="text-[10px] font-semibold text-[#075E54]">
                      Auto Sum
                    </span>
                  )
                )}
              </div>
              <input
                type="number"
                min={0}
                value={priceInput}
                onChange={(e) => {
                  setPriceManuallyEdited(true);
                  setPriceInput(e.target.value);
                }}
                placeholder="Total Amount"
                className="w-full px-3 py-1.5 text-sm font-mono-num bg-[#F7F9F8] border border-[#DCE4E0] rounded-lg focus:bg-white focus:outline-none focus:border-[#128C7E]"
              />
            </div>

            <div className="sm:col-span-3">
              <div className="flex items-center justify-between gap-1 mb-1">
                <label className="text-xs font-semibold text-slate-700">
                  Less Price (₹)
                </label>
                {lessAmount > 0 && (
                  <span className="text-[10px] font-mono-num font-bold text-[#075E54]">
                    Final ₹{netFinalPrice.toLocaleString('en-IN')}
                  </span>
                )}
              </div>
              <div className="flex items-center bg-[#FFF8F6] border border-[#F3D0C8] rounded-lg px-2.5 focus-within:bg-white focus-within:border-red-400">
                <span className="text-xs font-bold text-red-500 mr-1">- ₹</span>
                <input
                  type="number"
                  min={0}
                  value={lessPriceInput}
                  onChange={(e) => setLessPriceInput(e.target.value)}
                  placeholder="0"
                  aria-label="Less Price"
                  className="w-full py-1.5 text-sm font-mono-num bg-transparent focus:outline-none text-slate-800"
                />
              </div>
            </div>

            <div className="sm:col-span-5">
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

            {lessAmount > 0 && (
              <div className="sm:col-span-12 px-3 py-1.5 rounded-lg bg-[#E9F7F0] border border-[#BFE6D1] flex flex-wrap items-center justify-between gap-2 text-xs font-mono-num">
                <span className="text-slate-700">
                  Total ₹{grossTotal.toLocaleString('en-IN')} - Less ₹{lessAmount.toLocaleString('en-IN')}
                </span>
                <span className="font-bold text-[#075E54]">
                  Final Price = ₹{netFinalPrice.toLocaleString('en-IN')}
                </span>
              </div>
            )}
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
