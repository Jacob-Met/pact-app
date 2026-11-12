import { evaluateProject, projectView } from './core.mjs';

// A local explanation for the selected request, never payment authorization.
export function paymentReadiness(project, obligationId, asOf, providerState = 'checking') {
  if (!project || !obligationId) return { eligible: false, message: 'Choose a commitment to review its payment prerequisites.' };
  const obligations = projectView(project).obligations;
  const entry = obligations.find(item => item.id === obligationId);
  if (!entry) return { eligible: false, message: 'Choose a current commitment.' };
  const reasons = [];
  let evaluated;
  try { evaluated = evaluateProject(project, asOf).obligations.find(item => item.obligationId === obligationId); }
  catch { reasons.push('Set the evaluation time at or after the latest recorded event, then evaluate readiness.'); }
  if (evaluated?.blockers.includes('NO_VALID_ACCEPTED_EVIDENCE')) reasons.push('Record accepted evidence for this commitment’s current revision.');
  if (evaluated?.blockers.includes('OPEN_DISPUTE')) reasons.push('Review and explicitly resolve its open evidence disputes.');
  if (evaluated?.dependencyBlockers.length) reasons.push('Complete prerequisite review: ' + evaluated.dependencyBlockers.map(id => obligations.find(item => item.id === id)?.title || id).join(', ') + '.');
  if (entry.amountMinor < 1 || entry.amountMinor > 99999999) reasons.push('The request amount must be between $0.01 and $999,999.99.');
  if (providerState === 'checking') reasons.push('Checking this server’s Sandbox configuration.');
  else if (providerState === 'unavailable') reasons.push('Sandbox configuration could not be checked. Reload to check again; saved requests can still be restored.');
  else if (providerState !== 'configured') reasons.push('PayPal Sandbox is not configured on this server. You can continue reviewing evidence and restore saved requests.');
  return { eligible: reasons.length === 0, message: reasons.length ? 'Before preparing a request: ' + reasons.join(' ') : 'Ready for your local review at the selected evaluation time. Check the clause and amount, then acknowledge below. Payer approval is still separate.' };
}
