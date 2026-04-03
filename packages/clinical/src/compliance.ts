/**
 * @solvinghealth/clinical -- Compliance Sanitizer
 *
 * Middleware for validating healthcare transactions against:
 * - Anti-Kickback Statute (AKS): no percentage-based compensation, no referral incentives
 * - Stark Law: no self-referrals to designated health services
 * - Fair Market Value (FMV): encounter pricing within defensible ranges
 * - CMS Billing Rules: CPT/HCPCS code validation
 *
 * Returns a ComplianceResult with violations and suggestions.
 *
 * @module @solvinghealth/clinical/compliance
 * @license PROPRIETARY -- SEE LICENSE
 */

import { z } from 'zod';

// ─── Types ──────────────────────────────────────────────────

/** Severity of a compliance violation */
export type ViolationSeverity = 'critical' | 'warning' | 'info';

/** Category of compliance violation */
export type ViolationCategory = 'aks' | 'stark' | 'fmv' | 'billing' | 'hipaa' | 'cms_rule';

/** A single compliance violation */
export interface Violation {
  /** Unique violation code */
  code: string;
  /** Violation severity */
  severity: ViolationSeverity;
  /** Violation category */
  category: ViolationCategory;
  /** Human-readable description */
  message: string;
  /** The specific field or value that triggered the violation */
  field?: string;
  /** Reference to the regulatory authority or guidance */
  reference?: string;
}

/** Result of a compliance check */
export interface ComplianceResult {
  /** Whether the transaction is compliant (no critical violations) */
  compliant: boolean;
  /** All violations found */
  violations: Violation[];
  /** Actionable suggestions to remediate violations */
  suggestions: string[];
  /** Timestamp of the check */
  checkedAt: string;
  /** Which validators were run */
  validatorsRun: string[];
}

/** Arrangement details for AKS validation */
export const ArrangementSchema = z.object({
  /** Type of financial arrangement */
  type: z.enum(['flat_fee', 'per_encounter', 'subscription', 'percentage', 'referral_bonus', 'volume_based']),
  /** Amount in dollars */
  amount: z.number().nonnegative(),
  /** Unit of the amount */
  unit: z.enum(['per_encounter', 'per_month', 'per_year', 'one_time', 'per_referral', 'percentage']),
  /** Description of the arrangement */
  description: z.string(),
  /** Parties involved */
  parties: z.array(z.string()).min(2),
  /** Whether the arrangement involves a referral source */
  involvesReferralSource: z.boolean().default(false),
  /** Whether the arrangement is for a designated health service */
  involvesDesignatedHealthService: z.boolean().default(false),
});

export type Arrangement = z.infer<typeof ArrangementSchema>;

/** Encounter pricing for FMV validation */
export const EncounterPricingSchema = z.object({
  /** Price per encounter in dollars */
  pricePerEncounter: z.number().positive(),
  /** Type of encounter */
  encounterType: z.string(),
  /** Provider specialty */
  specialty: z.string(),
  /** Geographic region (for regional FMV comparison) */
  region: z.string().optional(),
  /** Whether the provider is a member (member vs. non-member pricing) */
  isMember: z.boolean().default(false),
});

export type EncounterPricing = z.infer<typeof EncounterPricingSchema>;

/** Billing code for CMS validation */
export const BillingCodeSchema = z.object({
  /** Code system */
  system: z.enum(['CPT', 'HCPCS', 'ICD10']),
  /** The code value */
  code: z.string(),
  /** Code description */
  description: z.string().optional(),
  /** Number of units */
  units: z.number().int().positive().default(1),
  /** Modifier codes */
  modifiers: z.array(z.string()).optional(),
  /** Whether this code requires physician attestation */
  requiresAttestation: z.boolean().default(true),
});

export type BillingCode = z.infer<typeof BillingCodeSchema>;

// ─── FMV Reference Ranges ───────────────────────────────────

/**
 * Fair Market Value reference ranges by specialty.
 * Based on published surveys (MGMA, AAPC, Force Therapeutics public data).
 * Range: [low, median, high] per encounter in dollars.
 */
const FMV_RANGES: Record<string, [number, number, number]> = {
  'primary_care':     [15, 35, 60],
  'internal_medicine': [15, 35, 60],
  'orthopedic':       [20, 45, 80],
  'cardiology':       [25, 50, 90],
  'endocrinology':    [20, 40, 70],
  'psychiatry':       [20, 40, 75],
  'nephrology':       [25, 50, 85],
  'radiology':        [15, 30, 55],
  'general':          [15, 35, 60],
};

// ─── CMS Code Validation Rules ─────────────────────────────

/**
 * Known CMS billing codes with basic validation rules.
 * This is a subset -- full implementation would integrate with CMS code databases.
 */
const CMS_CODE_RULES: Record<string, { description: string; requiresAttestation: boolean; maxUnits: number; timeRequirement?: string }> = {
  // CCM (Chronic Care Management)
  '99490': { description: 'CCM first 20 min', requiresAttestation: true, maxUnits: 1, timeRequirement: '20 min/month' },
  '99439': { description: 'CCM each additional 20 min', requiresAttestation: true, maxUnits: 2, timeRequirement: '20 min each' },
  '99491': { description: 'CCM complex first 30 min', requiresAttestation: true, maxUnits: 1, timeRequirement: '30 min/month' },

  // RTM (Remote Therapeutic Monitoring)
  '98975': { description: 'RTM setup', requiresAttestation: false, maxUnits: 1 },
  '98977': { description: 'RTM MSK monitoring', requiresAttestation: false, maxUnits: 1, timeRequirement: '16 days/30-day period' },
  '98980': { description: 'RTM treatment management first 20 min', requiresAttestation: true, maxUnits: 1 },
  '98981': { description: 'RTM treatment management additional 20 min', requiresAttestation: true, maxUnits: 1 },

  // ACP (Advance Care Planning)
  '99497': { description: 'ACP first 30 min', requiresAttestation: true, maxUnits: 1, timeRequirement: '16 min face-to-face' },
  '99498': { description: 'ACP each additional 30 min', requiresAttestation: true, maxUnits: 4, timeRequirement: '30 min each' },

  // TCM (Transitional Care Management)
  '99495': { description: 'TCM moderate complexity', requiresAttestation: true, maxUnits: 1, timeRequirement: '14-day contact' },
  '99496': { description: 'TCM high complexity', requiresAttestation: true, maxUnits: 1, timeRequirement: '2-day contact' },

  // E&M
  '99213': { description: 'Office visit established low', requiresAttestation: true, maxUnits: 1 },
  '99214': { description: 'Office visit established moderate', requiresAttestation: true, maxUnits: 1 },
  '99215': { description: 'Office visit established high', requiresAttestation: true, maxUnits: 1 },
};

// ─── Validators ─────────────────────────────────────────────

/**
 * Validate a financial arrangement against the Anti-Kickback Statute.
 *
 * AKS prohibits:
 * - Percentage-based compensation tied to referral volume
 * - Referral bonuses or incentives
 * - Volume-based pricing that incentivizes referrals
 *
 * Safe harbors include:
 * - Flat fee per service (not tied to referral volume)
 * - Fair market value compensation
 * - Written agreements with specified terms
 *
 * @param arrangement - The financial arrangement to validate
 * @returns Array of violations found
 */
export function validateAKS(arrangement: Arrangement): Violation[] {
  const validated = ArrangementSchema.parse(arrangement);
  const violations: Violation[] = [];

  // Critical: percentage-based compensation
  if (validated.type === 'percentage' || validated.unit === 'percentage') {
    violations.push({
      code: 'AKS-001',
      severity: 'critical',
      category: 'aks',
      message: 'Percentage-based compensation arrangements violate AKS. Use flat fee per encounter instead.',
      field: 'type',
      reference: '42 U.S.C. 1320a-7b(b)',
    });
  }

  // Critical: referral bonuses
  if (validated.type === 'referral_bonus' || validated.unit === 'per_referral') {
    violations.push({
      code: 'AKS-002',
      severity: 'critical',
      category: 'aks',
      message: 'Referral-based compensation is prohibited under AKS.',
      field: 'type',
      reference: '42 U.S.C. 1320a-7b(b)',
    });
  }

  // Warning: volume-based pricing
  if (validated.type === 'volume_based') {
    violations.push({
      code: 'AKS-003',
      severity: 'warning',
      category: 'aks',
      message: 'Volume-based pricing may create referral incentives. Ensure compensation is not tied to referral volume.',
      field: 'type',
      reference: 'OIG Advisory Opinion 25-03',
    });
  }

  // Warning: referral source involvement
  if (validated.involvesReferralSource && validated.type !== 'flat_fee') {
    violations.push({
      code: 'AKS-004',
      severity: 'warning',
      category: 'aks',
      message: 'Arrangement involves a referral source with non-flat-fee compensation. Heightened AKS scrutiny applies.',
      field: 'involvesReferralSource',
      reference: 'OIG Safe Harbor Regulations',
    });
  }

  return violations;
}

/**
 * Validate a financial arrangement against the Stark Law.
 *
 * Stark prohibits physician self-referrals to entities providing
 * Designated Health Services (DHS) unless an exception applies.
 *
 * @param arrangement - The financial arrangement to validate
 * @returns Array of violations found
 */
export function validateStark(arrangement: Arrangement): Violation[] {
  const validated = ArrangementSchema.parse(arrangement);
  const violations: Violation[] = [];

  if (validated.involvesDesignatedHealthService) {
    // Check for self-referral patterns
    if (validated.involvesReferralSource) {
      violations.push({
        code: 'STARK-001',
        severity: 'critical',
        category: 'stark',
        message: 'Self-referral to designated health service detected. Stark Law exception must be documented.',
        field: 'involvesDesignatedHealthService',
        reference: '42 U.S.C. 1395nn',
      });
    }

    // FMV requirement for DHS arrangements
    if (validated.type !== 'flat_fee' && validated.type !== 'per_encounter') {
      violations.push({
        code: 'STARK-002',
        severity: 'warning',
        category: 'stark',
        message: 'DHS arrangements require FMV documentation. Non-flat-fee arrangements need additional justification.',
        field: 'type',
        reference: '42 C.F.R. 411.357',
      });
    }
  }

  return violations;
}

/**
 * Validate encounter pricing against Fair Market Value ranges.
 *
 * FMV defense requires pricing within the range of compensation
 * that would be paid in arm's-length transactions.
 *
 * @param pricing - The encounter pricing to validate
 * @returns Array of violations found
 */
export function validateFMV(pricing: EncounterPricing): Violation[] {
  const validated = EncounterPricingSchema.parse(pricing);
  const violations: Violation[] = [];

  const specialtyKey = validated.specialty.toLowerCase().replace(/[^a-z_]/g, '_');
  const range = FMV_RANGES[specialtyKey] ?? FMV_RANGES['general']!;
  const [low, median, high] = range;

  if (validated.pricePerEncounter > high) {
    violations.push({
      code: 'FMV-001',
      severity: 'warning',
      category: 'fmv',
      message: `Price $${validated.pricePerEncounter}/encounter exceeds FMV high range ($${high}) for ${validated.specialty}. Document justification.`,
      field: 'pricePerEncounter',
      reference: 'MGMA Physician Compensation Survey',
    });
  }

  if (validated.pricePerEncounter < low) {
    violations.push({
      code: 'FMV-002',
      severity: 'info',
      category: 'fmv',
      message: `Price $${validated.pricePerEncounter}/encounter is below FMV low range ($${low}) for ${validated.specialty}. Strong FMV defense position (below median of $${median}).`,
      field: 'pricePerEncounter',
    });
  }

  return violations;
}

/**
 * Validate billing codes against CMS rules.
 *
 * @param codes - The billing codes to validate
 * @returns Array of violations found
 */
export function validateBillingCodes(codes: BillingCode[]): Violation[] {
  const violations: Violation[] = [];

  for (const code of codes) {
    const validated = BillingCodeSchema.parse(code);
    const rule = CMS_CODE_RULES[validated.code];

    // Format validation
    if (validated.system === 'CPT' && !/^\d{5}$/.test(validated.code)) {
      violations.push({
        code: 'BILLING-001',
        severity: 'critical',
        category: 'billing',
        message: `Invalid CPT code format: ${validated.code}. Must be 5 digits.`,
        field: 'code',
      });
      continue;
    }

    if (validated.system === 'ICD10' && !/^[A-Z]\d{2}(\.\d{1,4})?$/.test(validated.code)) {
      violations.push({
        code: 'BILLING-002',
        severity: 'critical',
        category: 'billing',
        message: `Invalid ICD-10 code format: ${validated.code}.`,
        field: 'code',
      });
      continue;
    }

    // Rule-based validation
    if (rule) {
      if (validated.units > rule.maxUnits) {
        violations.push({
          code: 'BILLING-003',
          severity: 'warning',
          category: 'billing',
          message: `Code ${validated.code} (${rule.description}): ${validated.units} units exceeds max of ${rule.maxUnits}.`,
          field: 'units',
          reference: 'CMS Fee Schedule',
        });
      }

      if (rule.requiresAttestation && !validated.requiresAttestation) {
        violations.push({
          code: 'BILLING-004',
          severity: 'warning',
          category: 'billing',
          message: `Code ${validated.code} requires physician attestation.`,
          field: 'requiresAttestation',
        });
      }
    }
  }

  // Check for conflicting codes
  const codePairs = codes.map(c => c.code);
  if (codePairs.includes('99490') && codePairs.includes('99491')) {
    violations.push({
      code: 'BILLING-005',
      severity: 'critical',
      category: 'billing',
      message: 'Cannot bill both 99490 (CCM standard) and 99491 (CCM complex) for the same patient in the same month.',
      reference: 'CMS CCM Billing Rules',
    });
  }

  return violations;
}

/**
 * Run all compliance validators and return a combined result.
 *
 * @param params - Parameters for compliance checking
 * @returns Combined compliance result
 */
export function runComplianceCheck(params: {
  arrangement?: Arrangement;
  encounterPricing?: EncounterPricing;
  billingCodes?: BillingCode[];
}): ComplianceResult {
  const allViolations: Violation[] = [];
  const suggestions: string[] = [];
  const validatorsRun: string[] = [];

  if (params.arrangement) {
    validatorsRun.push('AKS', 'Stark');
    allViolations.push(...validateAKS(params.arrangement));
    allViolations.push(...validateStark(params.arrangement));
  }

  if (params.encounterPricing) {
    validatorsRun.push('FMV');
    allViolations.push(...validateFMV(params.encounterPricing));
  }

  if (params.billingCodes) {
    validatorsRun.push('CMS Billing');
    allViolations.push(...validateBillingCodes(params.billingCodes));
  }

  // Generate suggestions
  const hasCritical = allViolations.some(v => v.severity === 'critical');
  if (hasCritical) {
    suggestions.push('Address all critical violations before proceeding with the transaction.');
  }

  if (allViolations.some(v => v.category === 'aks')) {
    suggestions.push('Convert to flat fee per encounter arrangement to satisfy AKS safe harbor.');
  }

  if (allViolations.some(v => v.category === 'stark')) {
    suggestions.push('Document applicable Stark Law exception with written agreement at FMV.');
  }

  if (allViolations.some(v => v.category === 'fmv')) {
    suggestions.push('Obtain independent FMV assessment to document arm\'s-length pricing.');
  }

  return {
    compliant: !hasCritical,
    violations: allViolations,
    suggestions,
    checkedAt: new Date().toISOString(),
    validatorsRun,
  };
}
