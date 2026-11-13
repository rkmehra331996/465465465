import React, { useEffect, useMemo, useState } from 'react';
import { ArrowRightLeft, UserCheck, X } from 'lucide-react';
import { getOrderTotal } from '../lib/api';
import type { Order, PortalStaffMember, UserPublic } from '../types';

interface TransferOrderModalProps {
  ordersToTransfer: Order[];
  staffMembers: PortalStaffMember[];
  currentUser: UserPublic;
  onClose: () => void;
  onTransfer: (ids: string[], targetUserId: string) => Promise<void>;
}

export const TransferOrderModal: React.FC<TransferOrderModalProps> = ({
  ordersToTransfer,
  staffMembers,
  currentUser,
  onClose,
  onTransfer,
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

  const [selectedTargetId, setSelectedTargetId] = useState<string>('');
  const [submitting, setSubmitting] = useState<boolean>(false);
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
    if (!selectedTargetId) {
      setErrorMsg('Please select a telecaller to pass this order to.');
      return;
    }
    setSubmitting(true);
    setErrorMsg('');
    try {
      await onTransfer(
        ordersToTransfer.map((o) => o.id),
        selectedTargetId
      );
      onClose();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Could not pass order');
    } finally {
      setSubmitting(false);
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
              Transfer Order to Another Telecaller
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close pass order modal"
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

          {candidateStaff.length === 0 ? (
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
                Select Destination Dashboard (Kis Telecaller ko Pass karna hai?)
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
                Pass karne ke baad yeh order aapke dashboard se hat kar selected telecaller ke Active
                Orders dashboard me dikhai dega.
              </p>
            </div>
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
            <button
              type="submit"
              disabled={submitting || candidateStaff.length === 0 || !selectedTargetId}
              className="px-4 py-1.5 bg-[#128C7E] hover:bg-[#075E54] disabled:opacity-50 text-white font-semibold rounded-lg inline-flex items-center gap-1.5 cursor-pointer"
            >
              <UserCheck className="w-3.5 h-3.5" />
              {submitting ? 'Transferring...' : 'Transfer to Dashboard'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
