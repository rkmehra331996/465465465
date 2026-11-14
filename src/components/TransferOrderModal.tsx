import React, { useEffect, useMemo, useState } from 'react';
import { ArrowRightLeft, Send, Undo2, X } from 'lucide-react';
import { getOrderTotal } from '../lib/api';
import type { Order, PortalStaffMember, UserPublic } from '../types';

interface TransferOrderModalProps {
  ordersToTransfer: Order[];
  staffMembers: PortalStaffMember[];
  currentUser: UserPublic;
  onClose: () => void;
  onTransfer: (ids: string[], targetUserId: string) => Promise<void>;
  onUntransfer?: (ids: string[]) => Promise<void>;
}

export const TransferOrderModal: React.FC<TransferOrderModalProps> = ({
  ordersToTransfer,
  staffMembers,
  currentUser,
  onClose,
  onTransfer,
  onUntransfer,
}) => {
  const isOpen = ordersToTransfer.length > 0;

  const candidateStaff = useMemo(() => {
    const singleOwnerId =
      ordersToTransfer.length === 1 ? ordersToTransfer[0].createdById : undefined;
    return staffMembers.filter((m) => {
      if (singleOwnerId && m.id === singleOwnerId) return false;
      if (ordersToTransfer.length > 1 && currentUser.role !== 'super_admin' && m.id === currentUser.id) {
        return false;
      }
      return true;
    });
  }, [staffMembers, ordersToTransfer, currentUser]);

  const unsendableOrders = useMemo(
    () =>
      ordersToTransfer.filter(
        (o) =>
          Boolean(o.transferredFromId) &&
          (currentUser.role === 'super_admin' || o.transferredFromId === currentUser.id)
      ),
    [ordersToTransfer, currentUser]
  );

  const sendableOrders = useMemo(
    () =>
      ordersToTransfer.filter(
        (o) => currentUser.role === 'super_admin' || o.createdById === currentUser.id
      ),
    [ordersToTransfer, currentUser]
  );

  const [selectedTargetId, setSelectedTargetId] = useState<string>('');
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [unsending, setUnsending] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string>('');

  useEffect(() => {
    if (!isOpen) return;
    setErrorMsg('');
    const firstTelecaller =
      candidateStaff.find((m) => m.role === 'telecaller') || candidateStaff[0];
    setSelectedTargetId(firstTelecaller ? firstTelecaller.id : '');
  }, [isOpen, candidateStaff]);

  if (!isOpen) return null;

  const singleOrder = ordersToTransfer.length === 1 ? ordersToTransfer[0] : null;
  const totalAmount = ordersToTransfer.reduce((sum, o) => sum + getOrderTotal(o), 0);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (sendableOrders.length === 0) {
      setErrorMsg('You can only send orders currently in your dashboard.');
      return;
    }
    if (!selectedTargetId) {
      setErrorMsg('Please select a telecaller to send this order to.');
      return;
    }
    setSubmitting(true);
    setErrorMsg('');
    try {
      await onTransfer(
        sendableOrders.map((o) => o.id),
        selectedTargetId
      );
      onClose();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Could not send order');
    } finally {
      setSubmitting(false);
    }
  };

  const handleUnsend = async () => {
    if (!onUntransfer || unsendableOrders.length === 0) return;
    setUnsending(true);
    setErrorMsg('');
    try {
      await onUntransfer(unsendableOrders.map((o) => o.id));
      onClose();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Could not unsend transfer');
    } finally {
      setUnsending(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="transfer-order-title"
      className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white border border-[#DCE4E0] rounded-xl w-full max-w-md overflow-hidden shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 bg-[#075E54] text-white flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ArrowRightLeft className="w-4 h-4 text-[#25D366]" />
            <h2 id="transfer-order-title" className="font-display text-sm font-bold">
              Transfer Order — Send / Unsend
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close transfer order modal"
            className="p-1 hover:bg-white/15 rounded cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-3.5 text-xs">
          {/* Selected Order Summary */}
          <div className="bg-[#FAFDFB] border border-[#DCE4E0] rounded-lg p-3 space-y-1">
            {singleOrder ? (
              <>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-slate-900">
                    {singleOrder.name || 'Customer'} ({singleOrder.number || 'No Phone'})
                  </span>
                  <span className="font-mono-num font-bold text-[#075E54]">
                    ₹{totalAmount.toLocaleString('en-IN')}
                  </span>
                </div>
                <div className="text-[11px] text-slate-600">
                  {singleOrder.serviceName} · {singleOrder.city} · Cleaner:{' '}
                  <strong className="text-slate-800">{singleOrder.cleanerName}</strong>
                </div>
                <div className="text-[11px] text-slate-500">
                  Current Dashboard:{' '}
                  <strong className="text-slate-800">{singleOrder.createdByName}</strong>
                  {singleOrder.transferredFromName && (
                    <span className="ml-1.5 text-purple-700 font-semibold">
                      (Sent by {singleOrder.transferredFromName})
                    </span>
                  )}
                </div>
              </>
            ) : (
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-slate-900">
                  {ordersToTransfer.length} Orders Selected
                </span>
                <span className="font-mono-num font-bold text-[#075E54]">
                  Total ₹{totalAmount.toLocaleString('en-IN')}
                </span>
              </div>
            )}
          </div>

          {unsendableOrders.length > 0 && onUntransfer && (
            <div className="p-3 rounded-lg bg-purple-50 border border-purple-200 flex items-center justify-between gap-3">
              <div className="text-[11px] text-purple-900">
                <div className="font-semibold">
                  {unsendableOrders.length === 1
                    ? `Sent to ${unsendableOrders[0].createdByName}`
                    : `${unsendableOrders.length} sent transfer orders selected`}
                </div>
                <div className="text-purple-700">
                  Unsend karne par order wapas{' '}
                  <strong>{unsendableOrders[0].transferredFromName || 'original'}</strong>{' '}
                  dashboard me aa jayega.
                </div>
              </div>
              <button
                type="button"
                disabled={unsending || submitting}
                onClick={handleUnsend}
                className="px-3 py-1.5 bg-purple-700 hover:bg-purple-800 disabled:opacity-50 text-white font-semibold rounded-lg inline-flex items-center gap-1.5 shrink-0 cursor-pointer"
              >
                <Undo2 className="w-3.5 h-3.5" />
                {unsending ? 'Unsending...' : 'Unsend'}
              </button>
            </div>
          )}

          {sendableOrders.length > 0 && (
            candidateStaff.length === 0 ? (
              <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-900">
                Abhi koi doosra active telecaller available nahi hai. Super Admin se Admin Panel me
                naya telecaller account add karne ko kahen.
              </div>
            ) : (
              <div className="space-y-1.5">
                <label
                  htmlFor="target-telecaller-select"
                  className="block font-semibold text-slate-700"
                >
                  Send to Telecaller Dashboard (Kis Telecaller ko Send karna hai?)
                </label>

                <div className="space-y-1.5 max-h-56 overflow-y-auto pr-0.5">
                  {candidateStaff.map((member) => {
                    const isSelected = selectedTargetId === member.id;
                    return (
                      <label
                        key={member.id}
                        className={`flex items-center justify-between gap-2 px-3 py-2 rounded-lg border cursor-pointer transition-colors ${
                          isSelected
                            ? 'bg-[#E9F7F0] border-[#128C7E] text-slate-900'
                            : 'bg-white border-[#DCE4E0] hover:bg-slate-50 text-slate-700'
                        }`}
                      >
                        <div className="flex items-center gap-2.5">
                          <input
                            type="radio"
                            name="targetUserId"
                            value={member.id}
                            checked={isSelected}
                            onChange={() => setSelectedTargetId(member.id)}
                            className="accent-[#128C7E]"
                          />
                          <div>
                            <div className="font-semibold text-slate-900">{member.name}</div>
                            <div className="text-[11px] font-mono-num text-slate-500">
                              @{member.username}
                            </div>
                          </div>
                        </div>
                        <span
                          className={`text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded ${
                            member.role === 'super_admin'
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-slate-100 text-slate-600'
                          }`}
                        >
                          {member.role === 'super_admin' ? 'Admin' : 'Telecaller'}
                        </span>
                      </label>
                    );
                  })}
                </div>

                <p className="text-[11px] text-slate-500 pt-1">
                  Send karne ke baad aap jab chahen <strong>Unsend</strong> karke order wapas le
                  sakte hain.
                </p>
              </div>
            )
          )}

          {errorMsg && (
            <div className="px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-red-700 font-medium">
              {errorMsg}
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#DCE4E0]">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 border border-[#DCE4E0] rounded-lg text-slate-700 hover:bg-slate-50 cursor-pointer"
            >
              Cancel
            </button>
            {sendableOrders.length > 0 && (
              <button
                type="submit"
                disabled={submitting || unsending || candidateStaff.length === 0 || !selectedTargetId}
                className="px-4 py-1.5 bg-[#128C7E] hover:bg-[#075E54] disabled:opacity-50 text-white font-semibold rounded-lg inline-flex items-center gap-1.5 cursor-pointer"
              >
                <Send className="w-3.5 h-3.5" />
                {submitting ? 'Sending...' : 'Send Transfer'}
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
};
