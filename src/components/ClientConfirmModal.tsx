import React, { useEffect, useState } from 'react';
import { Check, Copy, Languages, Loader2, MessageCircle, Send, X } from 'lucide-react';
import {
  buildClientConfirmationMessage,
  formatWhatsAppPhone,
  translateMessage,
} from '../lib/api';
import type { Order, TranslateTarget } from '../types';

interface ClientConfirmModalProps {
  order: Order | null;
  onClose: () => void;
  onNotify: (msg: string, type?: 'success' | 'error') => void;
}

const LANGS: { id: TranslateTarget; label: string }[] = [
  { id: 'english', label: 'English' },
  { id: 'hindi', label: 'Hindi (हिन्दी)' },
  { id: 'punjabi', label: 'Punjabi (ਪੰਜਾਬੀ)' },
];

export const ClientConfirmModal: React.FC<ClientConfirmModalProps> = ({
  order,
  onClose,
  onNotify,
}) => {
  const [lang, setLang] = useState<TranslateTarget>('english');
  const [text, setText] = useState('');
  const [translating, setTranslating] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!order) return;
    setLang('english');
    setText(buildClientConfirmationMessage(order));
  }, [order]);

  if (!order) return null;

  const baseMessage = buildClientConfirmationMessage(order);
  const waPhone = formatWhatsAppPhone(order.number);
  const waHref = `https://api.whatsapp.com/send?phone=${encodeURIComponent(
    waPhone
  )}&text=${encodeURIComponent(text)}`;

  const handleLanguageSwitch = async (nextLang: TranslateTarget) => {
    setLang(nextLang);
    if (nextLang === 'english') {
      setText(baseMessage);
      return;
    }
    setTranslating(true);
    try {
      const translated = await translateMessage(baseMessage, nextLang);
      setText(translated);
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'Translation unavailable',
        'error'
      );
      setText(baseMessage);
      setLang('english');
    } finally {
      setTranslating(false);
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      onNotify('Client confirmation message copied.');
      setTimeout(() => setCopied(false), 1800);
    } catch {
      onNotify('Copy failed', 'error');
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/45 flex items-center justify-center p-4"
      role="dialog"
      aria-label="Send WhatsApp Confirmation to Client"
    >
      <div className="w-full max-w-[520px] bg-white border border-[#DCE4E0] rounded-xl shadow-xl overflow-hidden">
        <div className="px-5 py-3.5 bg-[#075E54] text-white flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MessageCircle className="w-4 h-4 text-[#25D366]" />
            <div>
              <h3 className="font-display text-sm font-bold">
                WhatsApp Confirmation to Client
              </h3>
              <p className="text-[11px] text-emerald-100/85 font-mono-num">
                {order.name || 'Customer'} · {order.number} ({order.serviceName})
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="p-1.5 rounded-lg hover:bg-white/10 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
              <Languages className="w-3.5 h-3.5 text-[#128C7E]" />
              <span>Language:</span>
            </div>
            <div className="flex items-center gap-1.5">
              {LANGS.map((l) => (
                <button
                  key={l.id}
                  type="button"
                  disabled={translating}
                  onClick={() => handleLanguageSwitch(l.id)}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md border transition-colors cursor-pointer ${
                    lang === l.id
                      ? 'bg-[#128C7E] text-white border-[#128C7E]'
                      : 'bg-[#F7F9F8] text-slate-700 border-[#DCE4E0] hover:bg-[#EFF4F1]'
                  }`}
                >
                  {l.label}
                </button>
              ))}
            </div>
          </div>

          <div className="bg-[#EFEAE2] border border-[#DCE4E0] rounded-xl p-3 relative">
            {translating && (
              <div className="absolute inset-0 bg-white/80 rounded-xl flex items-center justify-center gap-2 z-10 text-xs font-semibold text-[#075E54]">
                <Loader2 className="w-4 h-4 animate-spin" />
                Translating...
              </div>
            )}
            <div className="bg-[#D9FDD3] border border-[#C3EAB9] rounded-lg p-3">
              <textarea
                rows={9}
                value={text}
                onChange={(e) => setText(e.target.value)}
                className="w-full bg-transparent text-[13px] leading-relaxed text-slate-900 resize-y focus:outline-none"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <button
              type="button"
              onClick={handleCopy}
              className="px-3.5 py-2 text-xs font-semibold bg-white border border-[#DCE4E0] hover:bg-[#F7F9F8] text-slate-800 rounded-lg flex items-center gap-1.5 cursor-pointer"
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5 text-[#128C7E]" />
                  Copied
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  Copy Text
                </>
              )}
            </button>

            <a
              href={waHref}
              target="_blank"
              rel="noopener noreferrer"
              className="px-4 py-2 text-xs font-semibold bg-[#25D366] hover:bg-[#1ebe5d] text-white rounded-lg flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
            >
              <Send className="w-3.5 h-3.5" />
              Send Confirmation on WhatsApp
            </a>
          </div>
        </div>
      </div>
    </div>
  );
};
