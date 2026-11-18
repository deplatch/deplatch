// GENERATED — do not edit. Run `node scripts/gen-esm.js` to regenerate.
// Source: packages/npm/src/verdict.js

import { closestPopular, normalize } from './similarity.esm.js';

const DEFAULT_POLICY = Object.freeze({
  minAgeDays: 30,
  requireRepository: false,
  onReview: 'warn', // 'warn' lets the install continue, 'block' stops it
  onRegistryError: 'review',
  allow: [], // e.g. ["npm:my-internal-lib"]
  deny: [],
});

function key(ecosystem, name) {
  return `${ecosystem}:${normalize(ecosystem, name)}`;
}

function listHas(list, ecosystem, name) {
  const k = key(ecosystem, name);
  return (list || []).some((entry) => {
    const [eco, ...rest] = String(entry).split(':');
    return key(eco, rest.join(':')) === k;
  });
}

/**
 * Pure function: evidence + policy in, verdict out.
 * verdict is one of 'verified' | 'review' | 'blocked'.
 */
function decide({ ecosystem, name, evidence, error }, policyInput) {
  const policy = { ...DEFAULT_POLICY, ...(policyInput || {}) };
  const reasons = [];
  const push = (code, severity, message) => reasons.push({ code, severity, message });

  if (listHas(policy.deny, ecosystem, name)) {
    push('DENYLISTED', 'block', 'Your policy denies this package.');
    return { verdict: 'blocked', reasons };
  }
  if (listHas(policy.allow, ecosystem, name)) {
    push('ALLOWLISTED', 'info', 'Your policy allows this package.');
    return { verdict: 'verified', reasons };
  }
  if (error) {
    push('REGISTRY_ERROR', 'review', `Could not reach the registry: ${error}`);
    return { verdict: policy.onRegistryError === 'block' ? 'blocked' : 'review', reasons };
  }
  if (!evidence || !evidence.exists) {
    push('NOT_FOUND', 'block',
      `"${name}" does not exist on ${ecosystem === 'npm' ? 'npm' : 'PyPI'}. ` +
      'AI assistants often invent names like this, and attackers register them later.');
    const near = closestPopular(ecosystem, name);
    if (near) push('DID_YOU_MEAN', 'info', `Did you mean "${near.name}"?`);
    return { verdict: 'blocked', reasons };
  }

  if (evidence.ageDays !== null && evidence.ageDays !== undefined && evidence.ageDays < policy.minAgeDays) {
    push('TOO_NEW', 'review',
      `First published ${evidence.ageDays} day(s) ago (policy minimum: ${policy.minAgeDays}).`);
  }
  const near = closestPopular(ecosystem, name);
  if (near) {
    push('LOOKALIKE', 'review',
      `Name is ${near.distance} character(s) away from the popular package "${near.name}".`);
  }
  if (policy.requireRepository && !evidence.repository) {
    push('NO_REPOSITORY', 'review', 'No source repository is linked.');
  }
  if (evidence.deprecated) {
    push('DEPRECATED', 'review', 'The latest version is deprecated or yanked.');
  }

  const needsReview = reasons.some((r) => r.severity === 'review');
  if (!needsReview) return { verdict: 'verified', reasons };
  return { verdict: policy.onReview === 'block' ? 'blocked' : 'review', reasons };
}

export { decide, DEFAULT_POLICY };
export default { decide, DEFAULT_POLICY };
