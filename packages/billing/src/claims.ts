/**
 * @solvinghealth/billing — Claims Generation Engine
 *
 * Generates CMS-1500 claim format from encounter data. Validates required
 * fields, calculates expected reimbursement, and supports the SolvingHealth
 * model where surgeons bill under their own NPI with a flat $15/$25
 * transaction fee (not percentage — AKS clean).
 *
 * PROPRIETARY — SolvingHealth LLC. All rights reserved.
 */

import { z } from 'zod';
import { BILLING_CODES, getPaymentDollars } from './codes.js';

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

export const ClaimLineSchema = z.object({
  /** Line number (1-6 on CMS-1500) */
  lineNumber: z.number().int().min(1).max(6),
  /** CPT/HCPCS procedure code */
  procedureCode: z.string(),
  /** Modifier(s) */
  modifiers: z.array(z.string()).max(4).default([]),
  /** ICD-10 diagnosis pointer(s) — references diagnosisCodes array indices */
  diagnosisPointers: z.array(z.number().int().min(1).max(12)),
  /** Service date (YYYY-MM-DD) */
  dateOfService: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** Place of service code (e.g., 11 = office, 22 = outpatient hospital) */
  placeOfService: z.string().length(2),
  /** Units of service */
  units: z.number().int().positive().default(1),
  /** Charge amount in dollars */
  chargeDollars: z.number().nonnegative(),
});
export type ClaimLine = z.infer<typeof ClaimLineSchema>;

export const CMS1500ClaimSchema = z.object({
  /** Unique claim identifier */
  claimId: z.string(),
  /** Patient information */
  patient: z.object({
    lastName: z.string().min(1),
    firstName: z.string().min(1),
    dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    sex: z.enum(['M', 'F', 'U']),
    address: z.object({
      street: z.string(),
      city: z.string(),
      state: z.string().length(2),
      zip: z.string(),
    }),
    insuranceId: z.string().min(1),
  }),
  /** Insured information (if different from patient) */
  insured: z.object({
    lastName: z.string(),
    firstName: z.string(),
    insuranceGroupNumber: z.string().optional(),
    planName: z.string().optional(),
  }).optional(),
  /** Insurance type */
  insuranceType: z.enum(['Medicare', 'Medicaid', 'CHAMPUS', 'Commercial', 'Other']),
  /** Rendering provider (surgeon bills own NPI) */
  renderingProvider: z.object({
    npi: z.string().regex(/^\d{10}$/),
    lastName: z.string(),
    firstName: z.string(),
    credential: z.string().optional(),
    taxId: z.string(),
    taxIdType: z.enum(['EIN', 'SSN']),
  }),
  /** Referring provider (if applicable) */
  referringProvider: z.object({
    npi: z.string().regex(/^\d{10}$/),
    lastName: z.string(),
    firstName: z.string(),
  }).optional(),
  /** Billing provider / facility */
  billingProvider: z.object({
    npi: z.string().regex(/^\d{10}$/),
    name: z.string(),
    address: z.object({
      street: z.string(),
      city: z.string(),
      state: z.string().length(2),
      zip: z.string(),
    }),
    taxId: z.string(),
    phone: z.string(),
  }),
  /** ICD-10 diagnosis codes (up to 12) */
  diagnosisCodes: z.array(z.string()).min(1).max(12),
  /** Claim lines (up to 6) */
  lines: z.array(ClaimLineSchema).min(1).max(6),
  /** Dates */
  dateOfService: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** Authorization number if required */
  priorAuthNumber: z.string().optional(),
  /** Accept assignment (required for Medicare) */
  acceptAssignment: z.boolean().default(true),
  /** Total charge in dollars */
  totalChargeDollars: z.number().nonnegative(),
});
export type CMS1500Claim = z.infer<typeof CMS1500ClaimSchema>;

export const ClaimValidationResultSchema = z.object({
  valid: z.boolean(),
  errors: z.array(z.object({
    field: z.string(),
    message: z.string(),
    severity: z.enum(['error', 'warning']),
  })),
  expectedReimbursement: z.number().nonnegative(),
  /** SolvingHealth platform fee */
  platformFee: z.object({
    type: z.enum(['member', 'non-member']),
    /** Flat fee in dollars (NOT percentage — AKS clean) */
    feeDollars: z.number(),
  }),
});
export type ClaimValidationResult = z.infer<typeof ClaimValidationResultSchema>;

// ---------------------------------------------------------------------------
// Platform Fee Constants
// ---------------------------------------------------------------------------

/** SolvingHealth flat per-encounter transaction fee — member rate */
export const MEMBER_TRANSACTION_FEE_DOLLARS = 15;

/** SolvingHealth flat per-encounter transaction fee — non-member rate */
export const NON_MEMBER_TRANSACTION_FEE_DOLLARS = 25;

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

interface ValidationError {
  field: string;
  message: string;
  severity: 'error' | 'warning';
}

/**
 * Validate a CMS-1500 claim for completeness and correctness.
 */
function validateClaimFields(claim: CMS1500Claim): ValidationError[] {
  const errors: ValidationError[] = [];

  // NPI validation (Luhn check)
  if (!isValidNPI(claim.renderingProvider.npi)) {
    errors.push({
      field: 'renderingProvider.npi',
      message: `NPI ${claim.renderingProvider.npi} fails Luhn validation`,
      severity: 'error',
    });
  }

  if (!isValidNPI(claim.billingProvider.npi)) {
    errors.push({
      field: 'billingProvider.npi',
      message: `Billing NPI ${claim.billingProvider.npi} fails Luhn validation`,
      severity: 'error',
    });
  }

  // Diagnosis code validation
  for (const [i, code] of claim.diagnosisCodes.entries()) {
    if (!isValidICD10Format(code)) {
      errors.push({
        field: `diagnosisCodes[${i}]`,
        message: `ICD-10 code "${code}" has invalid format`,
        severity: 'error',
      });
    }
  }

  // Claim line validation
  for (const line of claim.lines) {
    // Check procedure code exists in registry
    if (!BILLING_CODES.has(line.procedureCode)) {
      errors.push({
        field: `lines[${line.lineNumber}].procedureCode`,
        message: `Procedure code "${line.procedureCode}" not found in SolvingHealth registry (may still be valid)`,
        severity: 'warning',
      });
    }

    // Check diagnosis pointers reference valid indices
    for (const ptr of line.diagnosisPointers) {
      if (ptr > claim.diagnosisCodes.length) {
        errors.push({
          field: `lines[${line.lineNumber}].diagnosisPointers`,
          message: `Diagnosis pointer ${ptr} references index beyond diagnosisCodes array (length ${claim.diagnosisCodes.length})`,
          severity: 'error',
        });
      }
    }

    // Charge amount should not be zero
    if (line.chargeDollars === 0) {
      errors.push({
        field: `lines[${line.lineNumber}].chargeDollars`,
        message: 'Charge amount is $0.00 — verify this is intentional',
        severity: 'warning',
      });
    }
  }

  // Medicare-specific checks
  if (claim.insuranceType === 'Medicare') {
    if (!claim.acceptAssignment) {
      errors.push({
        field: 'acceptAssignment',
        message: 'Medicare claims must accept assignment (participating provider)',
        severity: 'error',
      });
    }
  }

  // Total charge verification
  const lineTotal = claim.lines.reduce((sum, l) => sum + l.chargeDollars * l.units, 0);
  if (Math.abs(lineTotal - claim.totalChargeDollars) > 0.01) {
    errors.push({
      field: 'totalChargeDollars',
      message: `Total charge ($${claim.totalChargeDollars}) does not match sum of line charges ($${lineTotal.toFixed(2)})`,
      severity: 'error',
    });
  }

  return errors;
}

/**
 * Validate an NPI using the Luhn algorithm.
 */
function isValidNPI(npi: string): boolean {
  if (!/^\d{10}$/.test(npi)) return false;

  // NPI uses Luhn with prefix "80840"
  const prefixed = '80840' + npi;
  let sum = 0;
  let alternate = false;

  for (let i = prefixed.length - 1; i >= 0; i--) {
    let digit = parseInt(prefixed[i]!, 10);
    if (alternate) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    alternate = !alternate;
  }

  return sum % 10 === 0;
}

/**
 * Basic ICD-10 format validation.
 */
function isValidICD10Format(code: string): boolean {
  // ICD-10-CM: letter followed by 2 digits, optional dot, then up to 4 alphanumeric
  return /^[A-Z]\d{2}(\.\d{1,4})?$/.test(code);
}

// ---------------------------------------------------------------------------
// Claims Generation
// ---------------------------------------------------------------------------

/**
 * Calculate expected Medicare reimbursement for a claim.
 */
function calculateExpectedReimbursement(claim: CMS1500Claim): number {
  let total = 0;

  for (const line of claim.lines) {
    const billingCode = BILLING_CODES.get(line.procedureCode);
    if (billingCode) {
      // Use facility or non-facility rate based on place of service
      const isFacility = ['22', '23', '24'].includes(line.placeOfService);
      const payment = isFacility
        ? billingCode.paymentCents
        : (billingCode.paymentNonFacilityCents ?? billingCode.paymentCents);
      total += (payment / 100) * line.units;
    } else {
      // Use the charge amount as a fallback
      total += line.chargeDollars * line.units;
    }
  }

  return Math.round(total * 100) / 100;
}

/**
 * Validate a CMS-1500 claim and calculate expected reimbursement.
 *
 * @param claim - The claim to validate
 * @param isMember - Whether the provider is a SolvingHealth member ($15 vs $25 fee)
 * @returns Validation result with errors, expected reimbursement, and platform fee
 */
export function validateClaim(
  claim: CMS1500Claim,
  isMember = false,
): ClaimValidationResult {
  const parsed = CMS1500ClaimSchema.parse(claim);
  const errors = validateClaimFields(parsed);
  const expectedReimbursement = calculateExpectedReimbursement(parsed);

  return {
    valid: errors.filter((e) => e.severity === 'error').length === 0,
    errors,
    expectedReimbursement,
    platformFee: {
      type: isMember ? 'member' : 'non-member',
      feeDollars: isMember ? MEMBER_TRANSACTION_FEE_DOLLARS : NON_MEMBER_TRANSACTION_FEE_DOLLARS,
    },
  };
}

/**
 * Generate a CMS-1500 claim from encounter data.
 *
 * @param params - Encounter parameters
 * @returns A structured CMS-1500 claim ready for validation and submission
 */
export function generateClaim(params: {
  claimId: string;
  patient: CMS1500Claim['patient'];
  renderingProvider: CMS1500Claim['renderingProvider'];
  billingProvider: CMS1500Claim['billingProvider'];
  diagnosisCodes: string[];
  procedureCodes: string[];
  dateOfService: string;
  placeOfService?: string;
  referringProvider?: CMS1500Claim['referringProvider'];
  priorAuthNumber?: string;
}): CMS1500Claim {
  const placeOfService = params.placeOfService ?? '11'; // default: office

  const lines: ClaimLine[] = params.procedureCodes.map((code, index) => {
    const billingCode = BILLING_CODES.get(code);
    const chargeDollars = billingCode
      ? billingCode.paymentCents / 100
      : 0;

    return {
      lineNumber: index + 1,
      procedureCode: code,
      modifiers: billingCode?.modifiers ?? [],
      diagnosisPointers: [1], // point to first diagnosis by default
      dateOfService: params.dateOfService,
      placeOfService,
      units: 1,
      chargeDollars,
    };
  });

  const totalChargeDollars = lines.reduce((sum, l) => sum + l.chargeDollars * l.units, 0);

  return {
    claimId: params.claimId,
    patient: params.patient,
    insuranceType: 'Medicare',
    renderingProvider: params.renderingProvider,
    referringProvider: params.referringProvider,
    billingProvider: params.billingProvider,
    diagnosisCodes: params.diagnosisCodes,
    lines,
    dateOfService: params.dateOfService,
    priorAuthNumber: params.priorAuthNumber,
    acceptAssignment: true,
    totalChargeDollars,
  };
}

/**
 * Calculate net revenue for the surgeon after SolvingHealth platform fee.
 *
 * Key principle: Surgeon bills under their own NPI. SolvingHealth takes a
 * flat transaction fee ($15 member / $25 non-member), NOT a percentage.
 * This is AKS-clean because the fee is not tied to referral volume or
 * billing amounts.
 *
 * @param expectedReimbursement - Expected Medicare reimbursement in dollars
 * @param isMember - Whether provider is a SolvingHealth member
 * @returns Net revenue breakdown
 */
export function calculateNetRevenue(
  expectedReimbursement: number,
  isMember = false,
): {
  grossReimbursement: number;
  platformFee: number;
  netToSurgeon: number;
  feeType: string;
} {
  const platformFee = isMember ? MEMBER_TRANSACTION_FEE_DOLLARS : NON_MEMBER_TRANSACTION_FEE_DOLLARS;

  return {
    grossReimbursement: expectedReimbursement,
    platformFee,
    netToSurgeon: expectedReimbursement - platformFee,
    feeType: `Flat $${platformFee}/encounter (${isMember ? 'member' : 'non-member'} rate) — NOT percentage-based`,
  };
}

// Re-export NPI validator for external use
export { isValidNPI as validateNPIChecksum };
