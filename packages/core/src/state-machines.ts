import { AppError } from './errors.js';

/** Persisted decisions never change again after approval or rejection. */
export type ProposalDecisionStatus = 'pending' | 'approved' | 'rejected';

/** A conflicted proposal is still *stored* as pending; it is no longer publishable. */
export type ProposalState = ProposalDecisionStatus | 'conflicted';

export type ProposalAction = 'approve' | 'reject';

/** A projection, not a stored column: a newly published revision can invalidate old proposals. */
export function proposalState(
  status: ProposalDecisionStatus,
  baseRevision: number,
  currentRevision: number,
): ProposalState {
  if (status !== 'pending') return status;
  return baseRevision === currentRevision ? 'pending' : 'conflicted';
}

/** The only permitted transitions from a proposal's projected state. */
export function requireProposalTransition(
  state: ProposalState,
  action: ProposalAction,
  authorId: string,
  reviewerId: string,
): void {
  if (state === 'approved' || state === 'rejected')
    throw new AppError(409, 'PROPOSAL_RESOLVED', 'Proposal already resolved');
  if (action === 'approve' && authorId === reviewerId)
    throw new AppError(403, 'SELF_APPROVAL', 'Author cannot approve own proposal');
  if (action === 'approve' && state === 'conflicted')
    throw new AppError(409, 'REVISION_CONFLICT', 'Knowledge changed since proposal was made');
  // An outdated proposal can still be explicitly rejected to close the review queue.
}

/** A credential can only move away from active; reactivation requires issuing a new credential. */
export type CredentialState = 'active' | 'revoked' | 'expired';
export function credentialState(
  expiresAt: number,
  revokedAt: number | null,
  now: number,
): CredentialState {
  if (revokedAt !== null) return 'revoked';
  if (expiresAt <= now) return 'expired';
  return 'active';
}
