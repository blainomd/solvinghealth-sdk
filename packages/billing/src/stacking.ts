/**
 * @solvinghealth/billing — Code Stacking Analysis Engine
 *
 * Given a patient encounter, identifies ALL billable codes that apply,
 * calculates per-encounter revenue with stacking, and flags missed billing
 * opportunities. Per project memory: $4,500/patient from full code stacking
 * for non-ACCESS patients.
 *
 * PROPRIETARY — SolvingHealth LLC. All rights reserved.
 */

import { z } from 'zod';
import {
  BILLING_CODES,
  getPaymentDollars,
} from './codes.js';

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

export const PatientConditionSchema = z.object({
  /** ICD-10 diagnosis code */
  icd10Code: z.string(),
  /** Condition description */
  description: z.string(),
  /** Whether this is a chronic condition (relevant for CCM) */
  isChronic: z.boolean(),
  /** Whether this is a behavioral health condition (relevant for BHI) */
  isBehavioralHealth: z.boolean().default(false),
  /** Whether this is a musculoskeletal condition (relevant for RTM) */
  isMSK: z.boolean().default(false),
});
export type PatientCondition = z.infer<typeof PatientConditionSchema>;

export const EncounterInputSchema = z.object({
  /** Patient identifier */
  patientId: z.string(),
  /** Provider NPI */
  providerNPI: z.string(),
  /** Provider specialty */
  specialty: z.string(),
  /** Active diagnoses */
  conditions: z.array(PatientConditionSchema),
  /** Codes currently being billed */
  currentBilledCodes: z.array(z.string()),
  /** Whether patient is enrolled in ACCESS model */
  isACCESSPatient: z.boolean().default(false),
  /** Whether patient was recently discharged (relevant for TCM) */
  recentDischarge: z.boolean().default(false),
  /** Days since discharge, if applicable */
  daysSinceDischarge: z.number().int().nonnegative().optional(),
  /** Whether patient has advance directive needs */
  advanceCareNeed: z.boolean().default(false),
  /** Whether patient has caregiver training needs */
  caregiverTrainingNeed: z.boolean().default(false),
  /** Whether patient has cognitive assessment needs */
  cognitiveAssessmentNeed: z.boolean().default(false),
  /** Whether patient has social determinant needs (CHI) */
  socialDeterminantNeed: z.boolean().default(false),
  /** Whether patient has navigation needs (PIN) */
  navigationNeed: z.boolean().default(false),
  /** Panel size for this provider (for aggregate calculations) */
  panelSize: z.number().int().positive().optional(),
});
export type EncounterInput = z.infer<typeof EncounterInputSchema>;

export const StackingOpportunitySchema = z.object({
  /** The billing code */
  code: z.string(),
  /** Code description */
  description: z.string(),
  /** Category */
  category: z.string(),
  /** Monthly revenue in dollars */
  monthlyRevenueDollars: z.number(),
  /** Annual revenue in dollars */
  annualRevenueDollars: z.number(),
  /** Whether this code is currently being billed */
  currentlyBilled: z.boolean(),
  /** Whether this is a new opportunity */
  isNewOpportunity: z.boolean(),
  /** Reason this code applies */
  rationale: z.string(),
  /** Any caveats or requirements */
  requirements: z.array(z.string()),
});
export type StackingOpportunity = z.infer<typeof StackingOpportunitySchema>;

export const StackingAnalysisSchema = z.object({
  patientId: z.string(),
  providerNPI: z.string(),
  isACCESSPatient: z.boolean(),
  /** All identified billable opportunities */
  opportunities: z.array(StackingOpportunitySchema),
  /** Currently billed monthly revenue */
  currentMonthlyRevenue: z.number(),
  /** Optimized monthly revenue with full stacking */
  optimizedMonthlyRevenue: z.number(),
  /** Annual revenue delta (what the provider is leaving on the table) */
  annualRevenueDelta: z.number(),
  /** Missed opportunities with actionable messages */
  missedOpportunities: z.array(z.object({
    message: z.string(),
    additionalMonthlyRevenue: z.number(),
    code: z.string(),
  })),
  /** Warnings or restrictions */
  warnings: z.array(z.string()),
});
export type StackingAnalysis = z.infer<typeof StackingAnalysisSchema>;

// ---------------------------------------------------------------------------
// Stacking Logic
// ---------------------------------------------------------------------------

/**
 * Determine which CCM codes apply based on conditions.
 * CCM requires 2+ chronic conditions.
 */
function identifyCCMOpportunities(input: EncounterInput): StackingOpportunity[] {
  const chronicCount = input.conditions.filter((c) => c.isChronic).length;
  if (chronicCount < 2) return [];

  const opportunities: StackingOpportunity[] = [];

  // 99490 — first 20 min clinical staff
  const ccmBase = BILLING_CODES.get('99490')!;
  opportunities.push({
    code: '99490',
    description: ccmBase.description,
    category: 'CCM',
    monthlyRevenueDollars: ccmBase.paymentCents / 100,
    annualRevenueDollars: (ccmBase.paymentCents / 100) * 12,
    currentlyBilled: input.currentBilledCodes.includes('99490'),
    isNewOpportunity: !input.currentBilledCodes.includes('99490'),
    rationale: `Patient has ${chronicCount} chronic conditions (≥2 required for CCM)`,
    requirements: [
      'Documented comprehensive care plan',
      '20+ minutes of clinical staff time per month',
      'Patient consent for CCM services',
    ],
  });

  // 99439 — add-on 20 min (up to 2)
  const ccmAddon = BILLING_CODES.get('99439')!;
  opportunities.push({
    code: '99439',
    description: ccmAddon.description,
    category: 'CCM',
    monthlyRevenueDollars: ccmAddon.paymentCents / 100,
    annualRevenueDollars: (ccmAddon.paymentCents / 100) * 12,
    currentlyBilled: input.currentBilledCodes.includes('99439'),
    isNewOpportunity: !input.currentBilledCodes.includes('99439'),
    rationale: 'Add-on to CCM base when 40+ minutes of management time',
    requirements: [
      'Additional 20+ minutes beyond 99490',
      'Documented time logs',
    ],
  });

  return opportunities;
}

/**
 * Determine which RTM codes apply based on conditions.
 */
function identifyRTMOpportunities(input: EncounterInput): StackingOpportunity[] {
  const hasMSK = input.conditions.some((c) => c.isMSK);
  if (!hasMSK) return [];

  const opportunities: StackingOpportunity[] = [];
  const rtmCodes = ['98975', '98977', '98980', '98981'] as const;

  for (const code of rtmCodes) {
    const entry = BILLING_CODES.get(code);
    if (!entry) continue;

    const isSetup = code === '98975';
    const monthly = isSetup ? 0 : entry.paymentCents / 100;
    const annual = isSetup ? entry.paymentCents / 100 : monthly * 12;

    opportunities.push({
      code,
      description: entry.description,
      category: 'RTM',
      monthlyRevenueDollars: monthly,
      annualRevenueDollars: annual,
      currentlyBilled: input.currentBilledCodes.includes(code),
      isNewOpportunity: !input.currentBilledCodes.includes(code),
      rationale: isSetup
        ? 'One-time RTM setup for MSK condition monitoring'
        : `Ongoing RTM for ${input.conditions.find((c) => c.isMSK)?.description ?? 'MSK condition'}`,
      requirements: isSetup
        ? ['CMS-approved MSK monitoring device/app', 'Patient education on device use']
        : ['Device data collected 16+ days per month', 'Documented treatment management'],
    });
  }

  return opportunities;
}

/**
 * Determine TCM eligibility.
 */
function identifyTCMOpportunities(input: EncounterInput): StackingOpportunity[] {
  if (!input.recentDischarge) return [];

  const opportunities: StackingOpportunity[] = [];
  const days = input.daysSinceDischarge ?? 999;

  if (days <= 7) {
    const entry = BILLING_CODES.get('99496')!;
    opportunities.push({
      code: '99496',
      description: entry.description,
      category: 'TCM',
      monthlyRevenueDollars: entry.paymentCents / 100,
      annualRevenueDollars: entry.paymentCents / 100, // one-time per discharge
      currentlyBilled: input.currentBilledCodes.includes('99496'),
      isNewOpportunity: !input.currentBilledCodes.includes('99496'),
      rationale: `Patient discharged ${days} days ago — qualifies for high-complexity TCM (face-to-face within 7 days)`,
      requirements: [
        'Face-to-face visit within 7 calendar days',
        'Interactive contact within 2 business days of discharge',
        'High medical decision-making complexity',
      ],
    });
  } else if (days <= 14) {
    const entry = BILLING_CODES.get('99495')!;
    opportunities.push({
      code: '99495',
      description: entry.description,
      category: 'TCM',
      monthlyRevenueDollars: entry.paymentCents / 100,
      annualRevenueDollars: entry.paymentCents / 100,
      currentlyBilled: input.currentBilledCodes.includes('99495'),
      isNewOpportunity: !input.currentBilledCodes.includes('99495'),
      rationale: `Patient discharged ${days} days ago — qualifies for moderate-complexity TCM (face-to-face within 14 days)`,
      requirements: [
        'Face-to-face visit within 14 calendar days',
        'Interactive contact within 2 business days of discharge',
        'Moderate medical decision-making complexity',
      ],
    });
  }

  return opportunities;
}

/**
 * Determine ACP eligibility.
 */
function identifyACPOpportunities(input: EncounterInput): StackingOpportunity[] {
  if (!input.advanceCareNeed) return [];

  const entry = BILLING_CODES.get('99497')!;
  return [{
    code: '99497',
    description: entry.description,
    category: 'ACP',
    monthlyRevenueDollars: entry.paymentCents / 100,
    annualRevenueDollars: entry.paymentCents / 100, // per session, not monthly recurring
    currentlyBilled: input.currentBilledCodes.includes('99497'),
    isNewOpportunity: !input.currentBilledCodes.includes('99497'),
    rationale: 'Patient has advance care planning needs',
    requirements: [
      '30+ minutes face-to-face discussing advance directives',
      'Modifier 33 bypasses patient cost-sharing',
      'Document patient wishes, proxy designation',
    ],
  }];
}

/**
 * Determine PIN/CHI/CTS/caregiver training eligibility.
 */
function identifyAncillaryOpportunities(input: EncounterInput): StackingOpportunity[] {
  const opportunities: StackingOpportunity[] = [];

  if (input.navigationNeed) {
    const entry = BILLING_CODES.get('G0023')!;
    opportunities.push({
      code: 'G0023',
      description: entry.description,
      category: 'PIN',
      monthlyRevenueDollars: entry.paymentCents / 100,
      annualRevenueDollars: (entry.paymentCents / 100) * 12,
      currentlyBilled: input.currentBilledCodes.includes('G0023'),
      isNewOpportunity: !input.currentBilledCodes.includes('G0023'),
      rationale: 'Patient qualifies for principal illness navigation services',
      requirements: ['Certified navigator under physician supervision', '60+ minutes per month'],
    });
  }

  if (input.socialDeterminantNeed) {
    const entry = BILLING_CODES.get('G0019')!;
    opportunities.push({
      code: 'G0019',
      description: entry.description,
      category: 'CHI',
      monthlyRevenueDollars: entry.paymentCents / 100,
      annualRevenueDollars: (entry.paymentCents / 100) * 12,
      currentlyBilled: input.currentBilledCodes.includes('G0019'),
      isNewOpportunity: !input.currentBilledCodes.includes('G0019'),
      rationale: 'Patient has social determinant needs requiring community health integration',
      requirements: ['CHW or peer support specialist', '60+ minutes per month'],
    });
  }

  if (input.cognitiveAssessmentNeed) {
    const entry = BILLING_CODES.get('99483')!;
    opportunities.push({
      code: '99483',
      description: entry.description,
      category: 'CTS',
      monthlyRevenueDollars: entry.paymentCents / 100,
      annualRevenueDollars: entry.paymentCents / 100, // one-time
      currentlyBilled: input.currentBilledCodes.includes('99483'),
      isNewOpportunity: !input.currentBilledCodes.includes('99483'),
      rationale: 'Patient needs cognitive assessment and care planning',
      requirements: ['Physician (MD/DO) must perform', '50+ minutes', 'Comprehensive cognitive assessment'],
    });
  }

  if (input.caregiverTrainingNeed) {
    const entry = BILLING_CODES.get('G0136')!;
    opportunities.push({
      code: 'G0136',
      description: entry.description,
      category: 'CAREGIVER_TRAINING',
      monthlyRevenueDollars: entry.paymentCents / 100,
      annualRevenueDollars: (entry.paymentCents / 100) * 12,
      currentlyBilled: input.currentBilledCodes.includes('G0136'),
      isNewOpportunity: !input.currentBilledCodes.includes('G0136'),
      rationale: 'Patient has caregiver who needs training services',
      requirements: ['Licensed clinician or trained educator', 'Per diem billing'],
    });
  }

  return opportunities;
}

// ---------------------------------------------------------------------------
// Main Analysis Function
// ---------------------------------------------------------------------------

/**
 * Analyze a patient encounter for all billable code stacking opportunities.
 *
 * CRITICAL: ACCESS patients cannot receive FFS code stacking.
 * Code stacking ($4,500/patient) applies ONLY to non-ACCESS patients.
 *
 * @param input - Encounter data including conditions, current codes, and flags
 * @returns Full stacking analysis with opportunities and missed revenue
 */
export function analyzeCodeStacking(input: EncounterInput): StackingAnalysis {
  const parsed = EncounterInputSchema.parse(input);
  const warnings: string[] = [];

  // ACCESS exclusion check
  if (parsed.isACCESSPatient) {
    warnings.push(
      'CRITICAL: This patient is enrolled in ACCESS model. FFS code stacking is NOT allowed. ' +
      'Revenue for ACCESS patients comes from population-based payment ($180-420/beneficiary/year).',
    );

    return {
      patientId: parsed.patientId,
      providerNPI: parsed.providerNPI,
      isACCESSPatient: true,
      opportunities: [],
      currentMonthlyRevenue: 0,
      optimizedMonthlyRevenue: 0,
      annualRevenueDelta: 0,
      missedOpportunities: [],
      warnings,
    };
  }

  // Collect all opportunities
  const allOpportunities = [
    ...identifyCCMOpportunities(parsed),
    ...identifyRTMOpportunities(parsed),
    ...identifyTCMOpportunities(parsed),
    ...identifyACPOpportunities(parsed),
    ...identifyAncillaryOpportunities(parsed),
  ];

  // Calculate current vs optimized revenue
  const currentMonthlyRevenue = allOpportunities
    .filter((o) => o.currentlyBilled)
    .reduce((sum, o) => sum + o.monthlyRevenueDollars, 0);

  const optimizedMonthlyRevenue = allOpportunities
    .reduce((sum, o) => sum + o.monthlyRevenueDollars, 0);

  const currentAnnualRevenue = allOpportunities
    .filter((o) => o.currentlyBilled)
    .reduce((sum, o) => sum + o.annualRevenueDollars, 0);

  const optimizedAnnualRevenue = allOpportunities
    .reduce((sum, o) => sum + o.annualRevenueDollars, 0);

  // Build missed opportunity messages
  const missedOpportunities = allOpportunities
    .filter((o) => o.isNewOpportunity)
    .map((o) => ({
      message: `You are not billing ${o.code} (${o.description}) — $${o.monthlyRevenueDollars.toFixed(2)}/mo additional`,
      additionalMonthlyRevenue: o.monthlyRevenueDollars,
      code: o.code,
    }));

  // Check for common missed combinations
  const billedCodes = new Set(parsed.currentBilledCodes);

  if (billedCodes.has('98977') && !billedCodes.has('99490')) {
    const ccmChronicCount = parsed.conditions.filter((c) => c.isChronic).length;
    if (ccmChronicCount >= 2) {
      warnings.push(
        `You billed RTM but missed CCM — patient has ${ccmChronicCount} chronic conditions. ` +
        `Adding CCM could generate $42-93/mo additional revenue.`,
      );
    }
  }

  if (billedCodes.has('99490') && !billedCodes.has('98977')) {
    const hasMSK = parsed.conditions.some((c) => c.isMSK);
    if (hasMSK) {
      warnings.push(
        'You billed CCM but missed RTM — patient has MSK condition eligible for RTM. ' +
        'Adding RTM could generate $50-95/mo additional revenue.',
      );
    }
  }

  return {
    patientId: parsed.patientId,
    providerNPI: parsed.providerNPI,
    isACCESSPatient: false,
    opportunities: allOpportunities,
    currentMonthlyRevenue,
    optimizedMonthlyRevenue,
    annualRevenueDelta: optimizedAnnualRevenue - currentAnnualRevenue,
    missedOpportunities,
    warnings,
  };
}

/**
 * Quick summary: max annual revenue from full code stacking for a single patient.
 *
 * Per project data:
 * - Non-ACCESS patient with full stacking: ~$4,500/year
 * - ACCESS MSK patient: $180/year (population-based)
 *
 * @param hasChronicConditions - 2+ chronic conditions (enables CCM)
 * @param hasMSK - Has musculoskeletal condition (enables RTM)
 * @param isACCESS - Enrolled in CMS ACCESS model
 */
export function estimateMaxAnnualRevenue(
  hasChronicConditions: boolean,
  hasMSK: boolean,
  isACCESS: boolean,
): { annualRevenue: number; breakdown: Record<string, number> } {
  if (isACCESS) {
    return {
      annualRevenue: 180,
      breakdown: { ACCESS_MSK: 180 },
    };
  }

  const breakdown: Record<string, number> = {};

  if (hasChronicConditions) {
    breakdown['CCM (99490)'] = getPaymentDollars('99490') * 12;
    breakdown['CCM Add-on (99439)'] = getPaymentDollars('99439') * 12;
  }

  if (hasMSK) {
    breakdown['RTM Setup (98975)'] = getPaymentDollars('98975');
    breakdown['RTM Device (98977)'] = getPaymentDollars('98977') * 12;
    breakdown['RTM Mgmt (98980)'] = getPaymentDollars('98980') * 12;
    breakdown['RTM Add-on (98981)'] = getPaymentDollars('98981') * 12;
  }

  const annualRevenue = Object.values(breakdown).reduce((sum, v) => sum + v, 0);

  return { annualRevenue, breakdown };
}
