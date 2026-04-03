/**
 * @solvinghealth/billing — Medicare Billing Code Registry
 *
 * Comprehensive registry of CPT, HCPCS, and ICD-10 codes relevant to
 * SolvingHealth's billing automation platform. Includes 2026 Medicare
 * payment amounts, code compatibility matrix, and lookup helpers.
 *
 * PROPRIETARY — SolvingHealth LLC. All rights reserved.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

export const CodeSystemSchema = z.enum(['CPT', 'HCPCS', 'ICD10']);
export type CodeSystem = z.infer<typeof CodeSystemSchema>;

export const CodeCategorySchema = z.enum([
  'CCM',
  'RTM',
  'TCM',
  'ACP',
  'PIN',
  'CHI',
  'CTS',
  'CAREGIVER_TRAINING',
  'TEAM',
  'ACCESS',
  'RPM',
  'BHI',
]);
export type CodeCategory = z.infer<typeof CodeCategorySchema>;

export const BillingCodeSchema = z.object({
  /** CPT or HCPCS code */
  code: z.string(),
  /** Human-readable short description */
  description: z.string(),
  /** Code system (CPT, HCPCS, ICD-10) */
  system: CodeSystemSchema,
  /** Functional category */
  category: CodeCategorySchema,
  /** 2026 Medicare national payment amount (facility) in cents */
  paymentCents: z.number().int().nonnegative(),
  /** 2026 Medicare national payment amount (non-facility) in cents, if different */
  paymentNonFacilityCents: z.number().int().nonnegative().optional(),
  /** Whether this code requires face-to-face encounter */
  requiresFaceToFace: z.boolean(),
  /** Minimum documented time in minutes, if applicable */
  minTimeMins: z.number().int().nonnegative().optional(),
  /** Required provider qualifications */
  providerRequirements: z.array(z.string()),
  /** Frequency limit description */
  frequencyLimit: z.string().optional(),
  /** Applicable modifiers */
  modifiers: z.array(z.string()),
});
export type BillingCode = z.infer<typeof BillingCodeSchema>;

export const CompatibilityRuleSchema = z.object({
  /** First code */
  codeA: z.string(),
  /** Second code */
  codeB: z.string(),
  /** Whether they can be billed together on the same encounter */
  compatible: z.boolean(),
  /** Whether they can be billed for the same patient in the same month */
  sameMonthCompatible: z.boolean(),
  /** Conditions or notes */
  notes: z.string(),
});
export type CompatibilityRule = z.infer<typeof CompatibilityRuleSchema>;

export const ICD10CodeSchema = z.object({
  code: z.string(),
  description: z.string(),
  category: z.string(),
  /** Common specialties that use this code */
  specialties: z.array(z.string()),
});
export type ICD10Code = z.infer<typeof ICD10CodeSchema>;

// ---------------------------------------------------------------------------
// Code Registry
// ---------------------------------------------------------------------------

/** Master registry of Medicare billing codes relevant to SolvingHealth */
export const BILLING_CODES: ReadonlyMap<string, BillingCode> = new Map<string, BillingCode>([
  // ---- Chronic Care Management (CCM) ----
  ['99490', {
    code: '99490',
    description: 'Chronic care management, first 20 minutes clinical staff time',
    system: 'CPT',
    category: 'CCM',
    paymentCents: 6415,
    paymentNonFacilityCents: 6415,
    requiresFaceToFace: false,
    minTimeMins: 20,
    providerRequirements: ['MD', 'DO', 'NP', 'PA', 'Clinical Staff under supervision'],
    frequencyLimit: 'Once per calendar month',
    modifiers: [],
  }],
  ['99439', {
    code: '99439',
    description: 'Chronic care management, each additional 20 minutes (up to 2)',
    system: 'CPT',
    category: 'CCM',
    paymentCents: 4780,
    paymentNonFacilityCents: 4780,
    requiresFaceToFace: false,
    minTimeMins: 20,
    providerRequirements: ['MD', 'DO', 'NP', 'PA', 'Clinical Staff under supervision'],
    frequencyLimit: 'Up to 2 per calendar month (with 99490)',
    modifiers: [],
  }],
  ['99491', {
    code: '99491',
    description: 'CCM by physician/QHP, first 30 minutes',
    system: 'CPT',
    category: 'CCM',
    paymentCents: 9310,
    paymentNonFacilityCents: 9310,
    requiresFaceToFace: false,
    minTimeMins: 30,
    providerRequirements: ['MD', 'DO', 'NP', 'PA'],
    frequencyLimit: 'Once per calendar month (cannot bill with 99490)',
    modifiers: [],
  }],

  // ---- Remote Therapeutic Monitoring (RTM) ----
  ['98975', {
    code: '98975',
    description: 'RTM initial setup and patient education',
    system: 'CPT',
    category: 'RTM',
    paymentCents: 1955,
    requiresFaceToFace: false,
    providerRequirements: ['MD', 'DO', 'NP', 'PA', 'PT', 'OT'],
    frequencyLimit: 'Once per episode of care',
    modifiers: [],
  }],
  ['98977', {
    code: '98977',
    description: 'RTM device supply, musculoskeletal system, each 30 days',
    system: 'CPT',
    category: 'RTM',
    paymentCents: 5680,
    requiresFaceToFace: false,
    providerRequirements: ['MD', 'DO', 'NP', 'PA', 'PT', 'OT'],
    frequencyLimit: 'Once per 30 days',
    modifiers: [],
  }],
  ['98980', {
    code: '98980',
    description: 'RTM treatment management, first 20 minutes',
    system: 'CPT',
    category: 'RTM',
    paymentCents: 5115,
    requiresFaceToFace: false,
    minTimeMins: 20,
    providerRequirements: ['MD', 'DO', 'NP', 'PA', 'PT', 'OT'],
    frequencyLimit: 'Once per calendar month',
    modifiers: [],
  }],
  ['98981', {
    code: '98981',
    description: 'RTM treatment management, each additional 20 minutes',
    system: 'CPT',
    category: 'RTM',
    paymentCents: 4225,
    requiresFaceToFace: false,
    minTimeMins: 20,
    providerRequirements: ['MD', 'DO', 'NP', 'PA', 'PT', 'OT'],
    frequencyLimit: 'Up to 2 per calendar month (with 98980)',
    modifiers: [],
  }],
  ['99457', {
    code: '99457',
    description: 'RTM management services, first 20 minutes (physician)',
    system: 'CPT',
    category: 'RTM',
    paymentCents: 5050,
    requiresFaceToFace: false,
    minTimeMins: 20,
    providerRequirements: ['MD', 'DO', 'NP', 'PA'],
    frequencyLimit: 'Once per calendar month',
    modifiers: [],
  }],
  ['99458', {
    code: '99458',
    description: 'RTM management services, each additional 20 minutes',
    system: 'CPT',
    category: 'RTM',
    paymentCents: 4150,
    requiresFaceToFace: false,
    minTimeMins: 20,
    providerRequirements: ['MD', 'DO', 'NP', 'PA'],
    frequencyLimit: 'Up to 2 per calendar month (with 99457)',
    modifiers: [],
  }],

  // ---- Transitional Care Management (TCM) ----
  ['99495', {
    code: '99495',
    description: 'TCM moderate complexity, face-to-face within 14 days',
    system: 'CPT',
    category: 'TCM',
    paymentCents: 17430,
    paymentNonFacilityCents: 22860,
    requiresFaceToFace: true,
    providerRequirements: ['MD', 'DO', 'NP', 'PA'],
    frequencyLimit: 'Once per 30 days post-discharge',
    modifiers: [],
  }],
  ['99496', {
    code: '99496',
    description: 'TCM high complexity, face-to-face within 7 days',
    system: 'CPT',
    category: 'TCM',
    paymentCents: 23450,
    paymentNonFacilityCents: 30100,
    requiresFaceToFace: true,
    providerRequirements: ['MD', 'DO', 'NP', 'PA'],
    frequencyLimit: 'Once per 30 days post-discharge',
    modifiers: [],
  }],

  // ---- Advance Care Planning (ACP) ----
  ['99497', {
    code: '99497',
    description: 'Advance care planning, first 30 minutes face-to-face',
    system: 'CPT',
    category: 'ACP',
    paymentCents: 8685,
    paymentNonFacilityCents: 8685,
    requiresFaceToFace: true,
    minTimeMins: 30,
    providerRequirements: ['MD', 'DO', 'NP', 'PA'],
    frequencyLimit: 'No annual limit (must document medical necessity)',
    modifiers: ['33'],
  }],
  ['99498', {
    code: '99498',
    description: 'ACP each additional 30 minutes',
    system: 'CPT',
    category: 'ACP',
    paymentCents: 7530,
    paymentNonFacilityCents: 7530,
    requiresFaceToFace: true,
    minTimeMins: 30,
    providerRequirements: ['MD', 'DO', 'NP', 'PA'],
    frequencyLimit: 'Add-on to 99497',
    modifiers: ['33'],
  }],

  // ---- Principal Illness Navigation (PIN) ----
  ['G0023', {
    code: 'G0023',
    description: 'Principal illness navigation, first 60 minutes per month',
    system: 'HCPCS',
    category: 'PIN',
    paymentCents: 7345,
    requiresFaceToFace: false,
    minTimeMins: 60,
    providerRequirements: ['Certified/trained navigator under physician supervision'],
    frequencyLimit: 'Once per calendar month',
    modifiers: [],
  }],

  // ---- Community Health Integration (CHI) ----
  ['G0019', {
    code: 'G0019',
    description: 'Community health integration, first 60 minutes per month',
    system: 'HCPCS',
    category: 'CHI',
    paymentCents: 7345,
    requiresFaceToFace: false,
    minTimeMins: 60,
    providerRequirements: ['CHW, peer support, or navigator under physician supervision'],
    frequencyLimit: 'Once per calendar month',
    modifiers: [],
  }],

  // ---- Cognitive Assessment / Care Planning (CTS) ----
  ['99483', {
    code: '99483',
    description: 'Cognitive assessment and care plan, initial visit',
    system: 'CPT',
    category: 'CTS',
    paymentCents: 26950,
    paymentNonFacilityCents: 28200,
    requiresFaceToFace: true,
    minTimeMins: 50,
    providerRequirements: ['MD', 'DO'],
    frequencyLimit: 'Once per lifetime (initial), then annually with different code',
    modifiers: [],
  }],

  // ---- Caregiver Training ----
  ['G0136', {
    code: 'G0136',
    description: 'Caregiver training services, per diem',
    system: 'HCPCS',
    category: 'CAREGIVER_TRAINING',
    paymentCents: 2480,
    requiresFaceToFace: true,
    providerRequirements: ['Licensed clinician or trained educator'],
    frequencyLimit: 'Per diem, max 96 hrs over care episode',
    modifiers: [],
  }],

  // ---- TEAM Model (CMS) ----
  ['ACCESS00590', {
    code: 'ACCESS00590',
    description: 'TEAM episode payment — bundled joint replacement',
    system: 'HCPCS',
    category: 'TEAM',
    paymentCents: 2800000,
    requiresFaceToFace: true,
    providerRequirements: ['Participating TEAM hospital/surgeon'],
    frequencyLimit: 'Per episode (90-day window)',
    modifiers: [],
  }],

  // ---- ACCESS Model (CMS) ----
  ['ACCESS_MSK', {
    code: 'ACCESS_MSK',
    description: 'ACCESS population-based payment — MSK track',
    system: 'HCPCS',
    category: 'ACCESS',
    paymentCents: 18000,
    requiresFaceToFace: false,
    providerRequirements: ['Participating ACCESS physician organization'],
    frequencyLimit: '$180/beneficiary/year',
    modifiers: [],
  }],
  ['ACCESS_CKM', {
    code: 'ACCESS_CKM',
    description: 'ACCESS population-based payment — CKM track',
    system: 'HCPCS',
    category: 'ACCESS',
    paymentCents: 42000,
    requiresFaceToFace: false,
    providerRequirements: ['Participating ACCESS physician organization'],
    frequencyLimit: '$420/beneficiary/year',
    modifiers: [],
  }],
  ['ACCESS_ECKM', {
    code: 'ACCESS_ECKM',
    description: 'ACCESS population-based payment — eCKM track',
    system: 'HCPCS',
    category: 'ACCESS',
    paymentCents: 36000,
    requiresFaceToFace: false,
    providerRequirements: ['Participating ACCESS physician organization'],
    frequencyLimit: '$360/beneficiary/year',
    modifiers: [],
  }],
]);

// ---------------------------------------------------------------------------
// Code Compatibility Matrix
// ---------------------------------------------------------------------------

/**
 * Defines which codes can be billed together (same encounter or same month).
 * CRITICAL: ACCESS and FFS codes do NOT stack on the same patient.
 */
export const COMPATIBILITY_RULES: readonly CompatibilityRule[] = [
  // CCM + RTM can stack on same patient, different months
  {
    codeA: '99490',
    codeB: '98977',
    compatible: false,
    sameMonthCompatible: true,
    notes: 'CCM and RTM can be billed same month for same patient if different conditions',
  },
  // CCM 99490 and 99491 are mutually exclusive
  {
    codeA: '99490',
    codeB: '99491',
    compatible: false,
    sameMonthCompatible: false,
    notes: '99490 (clinical staff) and 99491 (physician) are mutually exclusive',
  },
  // TCM is exclusive with CCM in same 30-day window
  {
    codeA: '99495',
    codeB: '99490',
    compatible: false,
    sameMonthCompatible: false,
    notes: 'TCM includes CCM-like services; cannot bill both in 30-day post-discharge',
  },
  {
    codeA: '99496',
    codeB: '99490',
    compatible: false,
    sameMonthCompatible: false,
    notes: 'TCM includes CCM-like services; cannot bill both in 30-day post-discharge',
  },
  // ACP can stack with E/M on same date
  {
    codeA: '99497',
    codeB: '99498',
    compatible: true,
    sameMonthCompatible: true,
    notes: 'Base ACP + add-on; use modifier 33 to bypass cost-sharing',
  },
  // RTM codes stack together
  {
    codeA: '98975',
    codeB: '98977',
    compatible: true,
    sameMonthCompatible: true,
    notes: 'RTM setup + device supply; setup billed once per episode',
  },
  {
    codeA: '98977',
    codeB: '98980',
    compatible: true,
    sameMonthCompatible: true,
    notes: 'RTM device + management; bill together monthly',
  },
  {
    codeA: '98980',
    codeB: '98981',
    compatible: true,
    sameMonthCompatible: true,
    notes: 'RTM management base + add-on',
  },
  // PIN + CHI can stack
  {
    codeA: 'G0023',
    codeB: 'G0019',
    compatible: false,
    sameMonthCompatible: true,
    notes: 'PIN and CHI can be billed same month for same patient',
  },
  // CCM + PIN can stack
  {
    codeA: '99490',
    codeB: 'G0023',
    compatible: false,
    sameMonthCompatible: true,
    notes: 'CCM and PIN address different needs; can stack monthly',
  },
  // ACCESS exclusion: ACCESS patients cannot receive FFS stacking
  {
    codeA: 'ACCESS_MSK',
    codeB: '99490',
    compatible: false,
    sameMonthCompatible: false,
    notes: 'CRITICAL: ACCESS and FFS codes do NOT stack on the same patient',
  },
  {
    codeA: 'ACCESS_MSK',
    codeB: '98977',
    compatible: false,
    sameMonthCompatible: false,
    notes: 'CRITICAL: ACCESS and FFS codes do NOT stack on the same patient',
  },
  {
    codeA: 'ACCESS_MSK',
    codeB: '99457',
    compatible: false,
    sameMonthCompatible: false,
    notes: 'CRITICAL: ACCESS and FFS codes do NOT stack on the same patient',
  },
] as const;

// ---------------------------------------------------------------------------
// Common ICD-10 Codes
// ---------------------------------------------------------------------------

/** Commonly used ICD-10 diagnosis codes for SolvingHealth-relevant specialties */
export const ICD10_CODES: ReadonlyMap<string, ICD10Code> = new Map<string, ICD10Code>([
  // Osteoarthritis
  ['M17.11', { code: 'M17.11', description: 'Primary osteoarthritis, right knee', category: 'Osteoarthritis', specialties: ['Orthopedic Surgery'] }],
  ['M17.12', { code: 'M17.12', description: 'Primary osteoarthritis, left knee', category: 'Osteoarthritis', specialties: ['Orthopedic Surgery'] }],
  ['M16.11', { code: 'M16.11', description: 'Primary osteoarthritis, right hip', category: 'Osteoarthritis', specialties: ['Orthopedic Surgery'] }],
  ['M16.12', { code: 'M16.12', description: 'Primary osteoarthritis, left hip', category: 'Osteoarthritis', specialties: ['Orthopedic Surgery'] }],
  // Spine
  ['M54.5', { code: 'M54.5', description: 'Low back pain', category: 'Spine', specialties: ['Orthopedic Surgery', 'Physiatry', 'PCP'] }],
  ['M54.2', { code: 'M54.2', description: 'Cervicalgia', category: 'Spine', specialties: ['Orthopedic Surgery', 'Physiatry', 'PCP'] }],
  // Upper Extremity
  ['M75.111', { code: 'M75.111', description: 'Rotator cuff tear, right shoulder', category: 'Shoulder', specialties: ['Orthopedic Surgery'] }],
  ['M75.112', { code: 'M75.112', description: 'Rotator cuff tear, left shoulder', category: 'Shoulder', specialties: ['Orthopedic Surgery'] }],
  // Chronic conditions (CCM-relevant)
  ['E11.9', { code: 'E11.9', description: 'Type 2 diabetes mellitus without complications', category: 'Endocrine', specialties: ['PCP', 'Endocrinology'] }],
  ['I10', { code: 'I10', description: 'Essential hypertension', category: 'Cardiovascular', specialties: ['PCP', 'Cardiology'] }],
  ['J44.1', { code: 'J44.1', description: 'COPD with acute exacerbation', category: 'Pulmonary', specialties: ['PCP', 'Pulmonology'] }],
  ['F32.1', { code: 'F32.1', description: 'Major depressive disorder, single episode, moderate', category: 'Behavioral Health', specialties: ['Psychiatry', 'PCP'] }],
  // Cognitive
  ['G30.9', { code: 'G30.9', description: 'Alzheimer disease, unspecified', category: 'Cognitive', specialties: ['Neurology', 'Geriatrics', 'PCP'] }],
  ['R41.81', { code: 'R41.81', description: 'Age-related cognitive decline', category: 'Cognitive', specialties: ['Geriatrics', 'PCP'] }],
  // Obesity (LMN-relevant)
  ['E66.01', { code: 'E66.01', description: 'Morbid obesity due to excess calories', category: 'Obesity', specialties: ['PCP', 'Endocrinology', 'Bariatric Surgery'] }],
]);

// ---------------------------------------------------------------------------
// Lookup Helpers
// ---------------------------------------------------------------------------

/**
 * Get a billing code by its code string.
 * @throws Error if code is not found
 */
export function getBillingCode(code: string): BillingCode {
  const entry = BILLING_CODES.get(code);
  if (!entry) {
    throw new Error(`Billing code "${code}" not found in registry`);
  }
  return entry;
}

/**
 * Get all billing codes in a given category.
 */
export function getCodesByCategory(category: CodeCategory): BillingCode[] {
  const results: BillingCode[] = [];
  for (const entry of BILLING_CODES.values()) {
    if (entry.category === category) {
      results.push(entry);
    }
  }
  return results;
}

/**
 * Get all billing codes from a given code system.
 */
export function getCodesBySystem(system: CodeSystem): BillingCode[] {
  const results: BillingCode[] = [];
  for (const entry of BILLING_CODES.values()) {
    if (entry.system === system) {
      results.push(entry);
    }
  }
  return results;
}

/**
 * Look up an ICD-10 code by its code string.
 */
export function getICD10Code(code: string): ICD10Code | undefined {
  return ICD10_CODES.get(code);
}

/**
 * Search ICD-10 codes by description substring (case-insensitive).
 */
export function searchICD10(query: string): ICD10Code[] {
  const lower = query.toLowerCase();
  const results: ICD10Code[] = [];
  for (const entry of ICD10_CODES.values()) {
    if (entry.description.toLowerCase().includes(lower) || entry.code.toLowerCase().includes(lower)) {
      results.push(entry);
    }
  }
  return results;
}

/**
 * Check whether two codes are compatible for billing on the same encounter.
 */
export function areCodesCompatible(codeA: string, codeB: string): CompatibilityRule | undefined {
  return COMPATIBILITY_RULES.find(
    (r) =>
      (r.codeA === codeA && r.codeB === codeB) ||
      (r.codeA === codeB && r.codeB === codeA),
  );
}

/**
 * Get the 2026 Medicare payment in dollars for a given code.
 */
export function getPaymentDollars(code: string, facility = true): number {
  const entry = getBillingCode(code);
  const cents = facility ? entry.paymentCents : (entry.paymentNonFacilityCents ?? entry.paymentCents);
  return cents / 100;
}
