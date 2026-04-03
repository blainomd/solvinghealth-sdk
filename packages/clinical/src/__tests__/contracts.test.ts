import { describe, it, expect } from 'vitest';
import {
  validatePreconditions,
  evaluateInvariants,
  computeSatisfaction,
  validateContract,
  STANDARD_CLINICAL_CONTRACT,
  PRESCRIBING_CONTRACT,
  type AgentContract,
  type Preconditions,
  type InvariantEvaluation,
} from '../contracts.js';

// ---------------------------------------------------------------------------
// Preconditions
// ---------------------------------------------------------------------------

describe('validatePreconditions', () => {
  it('passes when all preconditions are met', () => {
    const actual: Preconditions = {
      validNPI: true,
      activeStateLicenses: ['CO', 'NY'],
      matchingSpecialty: true,
      patientConsent: true,
      baaInPlace: true,
      deaRequired: false,
      deaOnFile: false,
    };
    const result = validatePreconditions(STANDARD_CLINICAL_CONTRACT, actual);
    expect(result.allMet).toBe(true);
    expect(result.results.every((r) => r.met)).toBe(true);
  });

  it('fails when NPI is invalid', () => {
    const actual: Preconditions = {
      validNPI: false,
      activeStateLicenses: ['CO'],
      matchingSpecialty: true,
      patientConsent: true,
      baaInPlace: true,
      deaRequired: false,
      deaOnFile: false,
    };
    const result = validatePreconditions(STANDARD_CLINICAL_CONTRACT, actual);
    expect(result.allMet).toBe(false);
    const npiResult = result.results.find((r) => r.precondition === 'validNPI');
    expect(npiResult?.met).toBe(false);
  });

  it('fails when DEA is required but not on file (prescribing contract)', () => {
    const actual: Preconditions = {
      validNPI: true,
      activeStateLicenses: ['CO'],
      matchingSpecialty: true,
      patientConsent: true,
      baaInPlace: true,
      deaRequired: true,
      deaOnFile: false,
    };
    const result = validatePreconditions(PRESCRIBING_CONTRACT, actual);
    expect(result.allMet).toBe(false);
    const deaResult = result.results.find((r) => r.precondition === 'deaOnFile');
    expect(deaResult?.met).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Invariant Evaluation
// ---------------------------------------------------------------------------

describe('evaluateInvariants', () => {
  it('hard invariant violation when PHI detected in output', () => {
    const evaluations = evaluateInvariants(
      STANDARD_CLINICAL_CONTRACT,
      'Patient presents with knee pain',
      { phiDetected: true, hasAuditTrail: true },
    );
    const phiViolation = evaluations.find(
      (e) => e.invariant === 'no_phi_exfiltration',
    );
    expect(phiViolation).toBeDefined();
    expect(phiViolation!.satisfied).toBe(false);
    expect(phiViolation!.type).toBe('hard');
  });

  it('hard invariant violation when billing code present without attestation', () => {
    const evaluations = evaluateInvariants(
      STANDARD_CLINICAL_CONTRACT,
      'Bill code 99213 for this visit',
      { hasAttestation: false, hasAuditTrail: true },
    );
    const billingViolation = evaluations.find(
      (e) => e.invariant === 'no_billing_without_attestation',
    );
    expect(billingViolation).toBeDefined();
    expect(billingViolation!.satisfied).toBe(false);
  });

  it('soft invariant violation for informal language', () => {
    const evaluations = evaluateInvariants(
      STANDARD_CLINICAL_CONTRACT,
      'lol this patient is gonna be fine',
      { hasAuditTrail: true },
    );
    const toneViolation = evaluations.find(
      (e) => e.invariant === 'professional_tone',
    );
    expect(toneViolation).toBeDefined();
    expect(toneViolation!.satisfied).toBe(false);
    expect(toneViolation!.type).toBe('soft');
  });

  it('all invariants pass with clean output and metadata', () => {
    const evaluations = evaluateInvariants(
      STANDARD_CLINICAL_CONTRACT,
      'Patient assessment:\nOsteoarthritis of the right knee, per AAOS guidelines.',
      {
        phiDetected: false,
        hasAttestation: true,
        withinScope: true,
        hasAuditTrail: true,
      },
    );
    const hardViolations = evaluations.filter(
      (e) => e.type === 'hard' && !e.satisfied,
    );
    expect(hardViolations).toHaveLength(0);
  });

  it('detects controlled substance without DEA (prescribing contract)', () => {
    const evaluations = evaluateInvariants(
      PRESCRIBING_CONTRACT,
      'Prescribe oxycodone 5mg for post-operative pain',
      { hasDEA: false, hasAuditTrail: true },
    );
    const deaViolation = evaluations.find(
      (e) => e.invariant === 'no_controlled_substance_without_dea',
    );
    expect(deaViolation).toBeDefined();
    expect(deaViolation!.satisfied).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// (p, delta, k)-Satisfaction Scoring
// ---------------------------------------------------------------------------

describe('computeSatisfaction', () => {
  it('high satisfaction: p=0.95, delta=0.05, k=0', () => {
    // 19 of 20 invariants satisfied, all hard invariants pass
    const evaluations: InvariantEvaluation[] = [];
    for (let i = 0; i < 10; i++) {
      evaluations.push({
        invariant: `hard_${i}`,
        type: 'hard',
        satisfied: true,
        confidence: 1.0,
      });
    }
    for (let i = 0; i < 9; i++) {
      evaluations.push({
        invariant: `soft_${i}`,
        type: 'soft',
        satisfied: true,
        confidence: 0.7,
      });
    }
    evaluations.push({
      invariant: 'soft_fail',
      type: 'soft',
      satisfied: false,
      confidence: 0.7,
      violation: 'Minor style issue',
    });

    const score = computeSatisfaction(evaluations);
    expect(score.p).toBe(19 / 20);
    expect(score.delta).toBeCloseTo(1 / 20);
    expect(score.k).toBe(0);
    expect(score.satisfied).toBe(true);
  });

  it('low satisfaction: p=0.70, delta=0.30, k=3', () => {
    const evaluations: InvariantEvaluation[] = [];
    for (let i = 0; i < 7; i++) {
      evaluations.push({
        invariant: `hard_${i}`,
        type: 'hard',
        satisfied: true,
        confidence: 1.0,
      });
    }
    for (let i = 0; i < 3; i++) {
      evaluations.push({
        invariant: `hard_fail_${i}`,
        type: 'hard',
        satisfied: false,
        confidence: 1.0,
        violation: `Critical failure ${i}`,
      });
    }

    const score = computeSatisfaction(evaluations);
    expect(score.p).toBe(0.7);
    expect(score.delta).toBeCloseTo(0.3);
    expect(score.k).toBe(3);
    expect(score.satisfied).toBe(false);
  });

  it('edge case: p=1.0 (perfect agent)', () => {
    const evaluations: InvariantEvaluation[] = [
      { invariant: 'hard_1', type: 'hard', satisfied: true, confidence: 1.0 },
      { invariant: 'soft_1', type: 'soft', satisfied: true, confidence: 1.0 },
    ];
    const score = computeSatisfaction(evaluations);
    expect(score.p).toBe(1.0);
    expect(score.delta).toBe(0.0);
    expect(score.k).toBe(0);
    expect(score.satisfied).toBe(true);
  });

  it('edge case: p=0.0 (always fails)', () => {
    const evaluations: InvariantEvaluation[] = [
      {
        invariant: 'hard_1',
        type: 'hard',
        satisfied: false,
        confidence: 1.0,
        violation: 'Failed',
      },
      {
        invariant: 'soft_1',
        type: 'soft',
        satisfied: false,
        confidence: 1.0,
        violation: 'Failed',
      },
    ];
    const score = computeSatisfaction(evaluations);
    expect(score.p).toBe(0.0);
    expect(score.delta).toBe(1.0);
    expect(score.k).toBe(1);
    expect(score.satisfied).toBe(false);
  });

  it('empty evaluations yield p=1.0 and satisfied=true', () => {
    const score = computeSatisfaction([]);
    expect(score.p).toBe(1.0);
    expect(score.satisfied).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Predefined Contracts
// ---------------------------------------------------------------------------

describe('predefined contracts', () => {
  it('standard clinical contract has correct hard invariants', () => {
    expect(STANDARD_CLINICAL_CONTRACT.hardInvariants).toContain(
      'no_phi_exfiltration',
    );
    expect(STANDARD_CLINICAL_CONTRACT.hardInvariants).toContain(
      'no_billing_without_attestation',
    );
    expect(STANDARD_CLINICAL_CONTRACT.hardInvariants).toContain(
      'audit_trail_required',
    );
  });

  it('prescribing contract has stricter invariants than clinical', () => {
    expect(PRESCRIBING_CONTRACT.hardInvariants.length).toBeGreaterThan(
      STANDARD_CLINICAL_CONTRACT.hardInvariants.length,
    );
    expect(PRESCRIBING_CONTRACT.hardInvariants).toContain(
      'no_controlled_substance_without_dea',
    );
    expect(PRESCRIBING_CONTRACT.hardInvariants).toContain(
      'no_prescription_without_review',
    );
    // Prescribing contract requires DEA
    expect(PRESCRIBING_CONTRACT.preconditions.deaRequired).toBe(true);
    expect(PRESCRIBING_CONTRACT.preconditions.deaOnFile).toBe(true);
  });

  it('prescribing contract has lower maxResponseTimeMs', () => {
    expect(PRESCRIBING_CONTRACT.maxResponseTimeMs).toBeLessThan(
      STANDARD_CLINICAL_CONTRACT.maxResponseTimeMs,
    );
  });
});

// ---------------------------------------------------------------------------
// Full Contract Validation
// ---------------------------------------------------------------------------

describe('validateContract', () => {
  it('hard invariant violation triggers circuit breaker (passed=false)', () => {
    const result = validateContract(
      STANDARD_CLINICAL_CONTRACT,
      {
        validNPI: true,
        activeStateLicenses: ['CO'],
        matchingSpecialty: true,
        patientConsent: true,
        baaInPlace: true,
        deaRequired: false,
        deaOnFile: false,
      },
      'Patient record with SSN 123-45-6789',
      { phiDetected: true, hasAuditTrail: true },
    );
    expect(result.passed).toBe(false);
    expect(result.satisfactionScore.k).toBeGreaterThan(0);
    expect(result.failureReasons.length).toBeGreaterThan(0);
  });

  it('soft invariant violation allows recovery (passed can still be true)', () => {
    const result = validateContract(
      STANDARD_CLINICAL_CONTRACT,
      {
        validNPI: true,
        activeStateLicenses: ['CO'],
        matchingSpecialty: true,
        patientConsent: true,
        baaInPlace: true,
        deaRequired: false,
        deaOnFile: false,
      },
      'lol the patient is doing great per guidelines, evidence shows recovery is on track.',
      {
        phiDetected: false,
        hasAttestation: true,
        withinScope: true,
        hasAuditTrail: true,
      },
    );
    // Soft violation (professional_tone) but all hard invariants pass
    expect(result.satisfactionScore.k).toBe(0);
    // Whether it passes depends on p threshold, but k=0 means no circuit breaker
    expect(result.contractName).toBe('standard-clinical');
  });
});
