import { describe, it, expect } from 'vitest';
import {
  validateAKS,
  validateStark,
  validateFMV,
  validateBillingCodes,
  runComplianceCheck,
  type Arrangement,
  type EncounterPricing,
  type BillingCode,
} from '../compliance.js';

// ---------------------------------------------------------------------------
// AKS Validator
// ---------------------------------------------------------------------------

describe('validateAKS', () => {
  it('passes a flat fee $15/encounter arrangement', () => {
    const arrangement: Arrangement = {
      type: 'flat_fee',
      amount: 15,
      unit: 'per_encounter',
      description: 'Flat fee per encounter',
      parties: ['SolvingHealth', 'Dr. Smith'],
      involvesReferralSource: false,
      involvesDesignatedHealthService: false,
    };
    const violations = validateAKS(arrangement);
    expect(violations).toHaveLength(0);
  });

  it('passes a flat fee $25/encounter arrangement', () => {
    const arrangement: Arrangement = {
      type: 'flat_fee',
      amount: 25,
      unit: 'per_encounter',
      description: 'Non-member flat fee',
      parties: ['SolvingHealth', 'Dr. Jones'],
      involvesReferralSource: false,
      involvesDesignatedHealthService: false,
    };
    const violations = validateAKS(arrangement);
    expect(violations).toHaveLength(0);
  });

  it('rejects a percentage-based fee arrangement', () => {
    const arrangement: Arrangement = {
      type: 'percentage',
      amount: 10,
      unit: 'percentage',
      description: '10% of revenue',
      parties: ['SolvingHealth', 'Dr. Smith'],
      involvesReferralSource: false,
      involvesDesignatedHealthService: false,
    };
    const violations = validateAKS(arrangement);
    expect(violations.length).toBeGreaterThanOrEqual(1);
    const aksViolation = violations.find((v) => v.code === 'AKS-001');
    expect(aksViolation).toBeDefined();
    expect(aksViolation!.severity).toBe('critical');
    expect(aksViolation!.category).toBe('aks');
  });

  it('rejects a referral bonus arrangement', () => {
    const arrangement: Arrangement = {
      type: 'referral_bonus',
      amount: 500,
      unit: 'per_referral',
      description: '$500 per referred patient',
      parties: ['SolvingHealth', 'Dr. Smith'],
      involvesReferralSource: true,
      involvesDesignatedHealthService: false,
    };
    const violations = validateAKS(arrangement);
    const referralViolation = violations.find((v) => v.code === 'AKS-002');
    expect(referralViolation).toBeDefined();
    expect(referralViolation!.severity).toBe('critical');
  });

  it('warns on volume-based pricing', () => {
    const arrangement: Arrangement = {
      type: 'volume_based',
      amount: 20,
      unit: 'per_encounter',
      description: 'Volume-tiered pricing',
      parties: ['SolvingHealth', 'Dr. Smith'],
      involvesReferralSource: false,
      involvesDesignatedHealthService: false,
    };
    const violations = validateAKS(arrangement);
    const volumeViolation = violations.find((v) => v.code === 'AKS-003');
    expect(volumeViolation).toBeDefined();
    expect(volumeViolation!.severity).toBe('warning');
  });

  it('warns when referral source is involved with non-flat-fee arrangement', () => {
    const arrangement: Arrangement = {
      type: 'subscription',
      amount: 299,
      unit: 'per_month',
      description: 'Monthly subscription',
      parties: ['SolvingHealth', 'Dr. Smith'],
      involvesReferralSource: true,
      involvesDesignatedHealthService: false,
    };
    const violations = validateAKS(arrangement);
    const refSourceViolation = violations.find((v) => v.code === 'AKS-004');
    expect(refSourceViolation).toBeDefined();
    expect(refSourceViolation!.severity).toBe('warning');
  });
});

// ---------------------------------------------------------------------------
// Stark Validator
// ---------------------------------------------------------------------------

describe('validateStark', () => {
  it('detects self-referral to designated health services', () => {
    const arrangement: Arrangement = {
      type: 'per_encounter',
      amount: 50,
      unit: 'per_encounter',
      description: 'Self-referral to imaging center',
      parties: ['Dr. Smith', 'Smith Imaging LLC'],
      involvesReferralSource: true,
      involvesDesignatedHealthService: true,
    };
    const violations = validateStark(arrangement);
    const starkViolation = violations.find((v) => v.code === 'STARK-001');
    expect(starkViolation).toBeDefined();
    expect(starkViolation!.severity).toBe('critical');
    expect(starkViolation!.category).toBe('stark');
  });

  it('warns on DHS arrangements with non-flat-fee types', () => {
    const arrangement: Arrangement = {
      type: 'subscription',
      amount: 1000,
      unit: 'per_month',
      description: 'Monthly DHS subscription',
      parties: ['Dr. Smith', 'Lab Corp'],
      involvesReferralSource: false,
      involvesDesignatedHealthService: true,
    };
    const violations = validateStark(arrangement);
    const starkWarning = violations.find((v) => v.code === 'STARK-002');
    expect(starkWarning).toBeDefined();
    expect(starkWarning!.severity).toBe('warning');
  });

  it('passes when no DHS involvement', () => {
    const arrangement: Arrangement = {
      type: 'flat_fee',
      amount: 15,
      unit: 'per_encounter',
      description: 'Standard encounter fee',
      parties: ['SolvingHealth', 'Dr. Smith'],
      involvesReferralSource: false,
      involvesDesignatedHealthService: false,
    };
    const violations = validateStark(arrangement);
    expect(violations).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// FMV Validator
// ---------------------------------------------------------------------------

describe('validateFMV', () => {
  it('$15/encounter for primary care is within MGMA range', () => {
    const pricing: EncounterPricing = {
      pricePerEncounter: 15,
      encounterType: 'office',
      specialty: 'primary_care',
      isMember: true,
    };
    const violations = validateFMV(pricing);
    // $15 is the low bound, so either no violation or an "info" below-low-range message
    const criticalOrWarning = violations.filter(
      (v) => v.severity === 'critical' || v.severity === 'warning',
    );
    expect(criticalOrWarning).toHaveLength(0);
  });

  it('$200/encounter flags as above FMV high range', () => {
    const pricing: EncounterPricing = {
      pricePerEncounter: 200,
      encounterType: 'office',
      specialty: 'primary_care',
      isMember: false,
    };
    const violations = validateFMV(pricing);
    const fmvWarning = violations.find((v) => v.code === 'FMV-001');
    expect(fmvWarning).toBeDefined();
    expect(fmvWarning!.severity).toBe('warning');
    expect(fmvWarning!.message).toContain('exceeds FMV high range');
  });

  it('below-low-range returns info severity, not warning', () => {
    const pricing: EncounterPricing = {
      pricePerEncounter: 5,
      encounterType: 'office',
      specialty: 'orthopedic',
      isMember: true,
    };
    const violations = validateFMV(pricing);
    const fmvInfo = violations.find((v) => v.code === 'FMV-002');
    expect(fmvInfo).toBeDefined();
    expect(fmvInfo!.severity).toBe('info');
  });
});

// ---------------------------------------------------------------------------
// CMS Billing Code Validator
// ---------------------------------------------------------------------------

describe('validateBillingCodes', () => {
  it('valid CPT codes pass', () => {
    const codes: BillingCode[] = [
      { system: 'CPT', code: '99490', units: 1, requiresAttestation: true },
      { system: 'CPT', code: '99213', units: 1, requiresAttestation: true },
    ];
    const violations = validateBillingCodes(codes);
    const criticalViolations = violations.filter((v) => v.severity === 'critical');
    expect(criticalViolations).toHaveLength(0);
  });

  it('invalid CPT code format fails', () => {
    const codes: BillingCode[] = [
      { system: 'CPT', code: '9949', units: 1, requiresAttestation: true },
    ];
    const violations = validateBillingCodes(codes);
    const formatViolation = violations.find((v) => v.code === 'BILLING-001');
    expect(formatViolation).toBeDefined();
    expect(formatViolation!.severity).toBe('critical');
  });

  it('invalid ICD-10 code format fails', () => {
    const codes: BillingCode[] = [
      { system: 'ICD10', code: '12345', units: 1, requiresAttestation: true },
    ];
    const violations = validateBillingCodes(codes);
    const formatViolation = violations.find((v) => v.code === 'BILLING-002');
    expect(formatViolation).toBeDefined();
    expect(formatViolation!.severity).toBe('critical');
  });

  it('valid ICD-10 code passes', () => {
    const codes: BillingCode[] = [
      { system: 'ICD10', code: 'M17.11', units: 1, requiresAttestation: true },
    ];
    const violations = validateBillingCodes(codes);
    const formatViolations = violations.filter(
      (v) => v.code === 'BILLING-001' || v.code === 'BILLING-002',
    );
    expect(formatViolations).toHaveLength(0);
  });

  it('detects conflicting CCM codes (99490 + 99491)', () => {
    const codes: BillingCode[] = [
      { system: 'CPT', code: '99490', units: 1, requiresAttestation: true },
      { system: 'CPT', code: '99491', units: 1, requiresAttestation: true },
    ];
    const violations = validateBillingCodes(codes);
    const conflictViolation = violations.find((v) => v.code === 'BILLING-005');
    expect(conflictViolation).toBeDefined();
    expect(conflictViolation!.severity).toBe('critical');
  });

  it('warns when units exceed maximum', () => {
    const codes: BillingCode[] = [
      { system: 'CPT', code: '99490', units: 3, requiresAttestation: true },
    ];
    const violations = validateBillingCodes(codes);
    const unitsViolation = violations.find((v) => v.code === 'BILLING-003');
    expect(unitsViolation).toBeDefined();
    expect(unitsViolation!.severity).toBe('warning');
  });
});

// ---------------------------------------------------------------------------
// Compound Compliance Check
// ---------------------------------------------------------------------------

describe('runComplianceCheck', () => {
  it('returns compliant: true when all validators pass', () => {
    const result = runComplianceCheck({
      arrangement: {
        type: 'flat_fee',
        amount: 15,
        unit: 'per_encounter',
        description: 'Flat fee',
        parties: ['SolvingHealth', 'Dr. Smith'],
        involvesReferralSource: false,
        involvesDesignatedHealthService: false,
      },
      encounterPricing: {
        pricePerEncounter: 25,
        encounterType: 'office',
        specialty: 'primary_care',
        isMember: false,
      },
      billingCodes: [
        { system: 'CPT', code: '99213', units: 1, requiresAttestation: true },
      ],
    });

    expect(result.compliant).toBe(true);
    expect(result.validatorsRun).toContain('AKS');
    expect(result.validatorsRun).toContain('Stark');
    expect(result.validatorsRun).toContain('FMV');
    expect(result.validatorsRun).toContain('CMS Billing');
    expect(result.checkedAt).toBeTruthy();
  });

  it('returns compliant: false with multiple violations', () => {
    const result = runComplianceCheck({
      arrangement: {
        type: 'percentage',
        amount: 10,
        unit: 'percentage',
        description: 'Percentage arrangement with self-referral',
        parties: ['Dr. Smith', 'Smith Labs'],
        involvesReferralSource: true,
        involvesDesignatedHealthService: true,
      },
      encounterPricing: {
        pricePerEncounter: 200,
        encounterType: 'office',
        specialty: 'primary_care',
        isMember: false,
      },
      billingCodes: [
        { system: 'CPT', code: 'INVALID', units: 1, requiresAttestation: true },
      ],
    });

    expect(result.compliant).toBe(false);
    expect(result.violations.length).toBeGreaterThanOrEqual(3);
    expect(result.suggestions.length).toBeGreaterThan(0);
    expect(result.suggestions).toContain(
      'Address all critical violations before proceeding with the transaction.',
    );
  });
});
