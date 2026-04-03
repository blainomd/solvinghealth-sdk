/**
 * @solvinghealth/billing — Per-Surgeon Revenue Calculator
 *
 * Calculates current vs optimized revenue per surgeon based on panel size,
 * current billing codes, and specialty. Per project data:
 * - Current average revenue per episode: $962
 * - Optimized revenue per episode: $1,820
 * - Annual recovery potential: $80K+
 *
 * PROPRIETARY — SolvingHealth LLC. All rights reserved.
 */

import { z } from 'zod';
import { BILLING_CODES, getPaymentDollars, type CodeCategory } from './codes.js';
import { MEMBER_TRANSACTION_FEE_DOLLARS, NON_MEMBER_TRANSACTION_FEE_DOLLARS } from './claims.js';

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

export const SpecialtyTypeSchema = z.enum([
  'orthopedic_surgery',
  'primary_care',
  'cardiology',
  'endocrinology',
  'psychiatry',
  'physiatry',
  'geriatrics',
  'neurology',
  'general_surgery',
]);
export type SpecialtyType = z.infer<typeof SpecialtyTypeSchema>;

export const RevenueInputSchema = z.object({
  /** Provider NPI */
  npi: z.string().optional(),
  /** Provider specialty */
  specialty: SpecialtyTypeSchema,
  /** Total active panel size */
  panelSize: z.number().int().positive(),
  /** Percentage of panel with 2+ chronic conditions (CCM-eligible) */
  chronicPercentage: z.number().min(0).max(1).default(0.6),
  /** Percentage of panel with MSK conditions (RTM-eligible) */
  mskPercentage: z.number().min(0).max(1).default(0.3),
  /** Current billing codes being used */
  currentCodes: z.array(z.string()),
  /** Number of post-discharge patients per month (TCM-eligible) */
  monthlyDischarges: z.number().int().nonnegative().default(0),
  /** Whether provider is enrolled in ACCESS model */
  isACCESSProvider: z.boolean().default(false),
  /** Percentage of panel in ACCESS (rest is FFS) */
  accessPercentage: z.number().min(0).max(1).default(0),
  /** Whether provider is a SolvingHealth member */
  isMember: z.boolean().default(false),
});
export type RevenueInput = z.infer<typeof RevenueInputSchema>;

export const RevenueBreakdownSchema = z.object({
  category: z.string(),
  codes: z.array(z.string()),
  eligiblePatients: z.number(),
  monthlyPerPatient: z.number(),
  annualPerPatient: z.number(),
  totalAnnual: z.number(),
});
export type RevenueBreakdown = z.infer<typeof RevenueBreakdownSchema>;

export const RevenueAnalysisSchema = z.object({
  /** Provider info */
  specialty: z.string(),
  panelSize: z.number(),
  /** Current state */
  currentRevenuePerEpisode: z.number(),
  currentAnnualRevenue: z.number(),
  currentCodesUsed: z.array(z.string()),
  /** Optimized state */
  optimizedRevenuePerEpisode: z.number(),
  optimizedAnnualRevenue: z.number(),
  /** Delta */
  annualRecovery: z.number(),
  revenuePerEpisodeIncrease: z.number(),
  percentageIncrease: z.number(),
  /** Detailed breakdown by code category */
  breakdown: z.array(RevenueBreakdownSchema),
  /** ACCESS vs FFS split */
  accessRevenue: z.number(),
  ffsRevenue: z.number(),
  /** Platform fees (SolvingHealth cut) */
  platformFees: z.object({
    perEncounterFee: z.number(),
    estimatedMonthlyEncounters: z.number(),
    monthlyPlatformRevenue: z.number(),
    annualPlatformRevenue: z.number(),
  }),
  /** Key insights */
  insights: z.array(z.string()),
});
export type RevenueAnalysis = z.infer<typeof RevenueAnalysisSchema>;

// ---------------------------------------------------------------------------
// Specialty Revenue Profiles
// ---------------------------------------------------------------------------

interface SpecialtyProfile {
  /** Base revenue codes typically billed */
  typicalCodes: string[];
  /** Revenue categories available */
  availableCategories: CodeCategory[];
  /** Average episodes per patient per year */
  avgEpisodesPerYear: number;
  /** Default chronic percentage if not provided */
  defaultChronicPct: number;
  /** Default MSK percentage if not provided */
  defaultMSKPct: number;
}

const SPECIALTY_PROFILES: Record<SpecialtyType, SpecialtyProfile> = {
  orthopedic_surgery: {
    typicalCodes: ['98977'],
    availableCategories: ['RTM', 'TCM', 'ACP', 'CAREGIVER_TRAINING', 'TEAM', 'ACCESS'],
    avgEpisodesPerYear: 2.5,
    defaultChronicPct: 0.4,
    defaultMSKPct: 0.95,
  },
  primary_care: {
    typicalCodes: ['99490'],
    availableCategories: ['CCM', 'RTM', 'TCM', 'ACP', 'PIN', 'CHI', 'CTS', 'CAREGIVER_TRAINING', 'RPM', 'BHI'],
    avgEpisodesPerYear: 4,
    defaultChronicPct: 0.68,
    defaultMSKPct: 0.25,
  },
  cardiology: {
    typicalCodes: [],
    availableCategories: ['CCM', 'RTM', 'TCM', 'ACP', 'RPM', 'ACCESS'],
    avgEpisodesPerYear: 3,
    defaultChronicPct: 0.75,
    defaultMSKPct: 0.1,
  },
  endocrinology: {
    typicalCodes: [],
    availableCategories: ['CCM', 'RTM', 'TCM', 'ACP', 'RPM'],
    avgEpisodesPerYear: 3,
    defaultChronicPct: 0.85,
    defaultMSKPct: 0.15,
  },
  psychiatry: {
    typicalCodes: [],
    availableCategories: ['CCM', 'TCM', 'ACP', 'BHI', 'PIN', 'CHI'],
    avgEpisodesPerYear: 12,
    defaultChronicPct: 0.7,
    defaultMSKPct: 0.05,
  },
  physiatry: {
    typicalCodes: ['98977'],
    availableCategories: ['CCM', 'RTM', 'TCM', 'ACP', 'RPM'],
    avgEpisodesPerYear: 4,
    defaultChronicPct: 0.55,
    defaultMSKPct: 0.85,
  },
  geriatrics: {
    typicalCodes: ['99490'],
    availableCategories: ['CCM', 'RTM', 'TCM', 'ACP', 'PIN', 'CHI', 'CTS', 'CAREGIVER_TRAINING', 'RPM', 'BHI'],
    avgEpisodesPerYear: 6,
    defaultChronicPct: 0.9,
    defaultMSKPct: 0.4,
  },
  neurology: {
    typicalCodes: [],
    availableCategories: ['CCM', 'RTM', 'TCM', 'ACP', 'CTS', 'RPM'],
    avgEpisodesPerYear: 3,
    defaultChronicPct: 0.7,
    defaultMSKPct: 0.2,
  },
  general_surgery: {
    typicalCodes: [],
    availableCategories: ['TCM', 'ACP', 'CAREGIVER_TRAINING'],
    avgEpisodesPerYear: 2,
    defaultChronicPct: 0.35,
    defaultMSKPct: 0.15,
  },
};

// ---------------------------------------------------------------------------
// Revenue Calculation
// ---------------------------------------------------------------------------

/**
 * Calculate current revenue based on codes the surgeon is actually billing.
 */
function calculateCurrentRevenue(currentCodes: string[], panelSize: number): number {
  let monthlyPerPatient = 0;
  for (const code of currentCodes) {
    const entry = BILLING_CODES.get(code);
    if (entry) {
      monthlyPerPatient += entry.paymentCents / 100;
    }
  }
  return monthlyPerPatient * 12 * panelSize;
}

/**
 * Build detailed revenue breakdown by category.
 */
function buildBreakdown(
  input: RevenueInput,
  profile: SpecialtyProfile,
): RevenueBreakdown[] {
  const breakdowns: RevenueBreakdown[] = [];
  const ffsPatients = Math.round(input.panelSize * (1 - input.accessPercentage));

  // CCM
  if (profile.availableCategories.includes('CCM')) {
    const eligible = Math.round(ffsPatients * input.chronicPercentage);
    const monthlyBase = getPaymentDollars('99490');
    const monthlyAddon = getPaymentDollars('99439');
    const monthly = monthlyBase + monthlyAddon; // assume full management time

    breakdowns.push({
      category: 'Chronic Care Management (CCM)',
      codes: ['99490', '99439'],
      eligiblePatients: eligible,
      monthlyPerPatient: monthly,
      annualPerPatient: monthly * 12,
      totalAnnual: monthly * 12 * eligible,
    });
  }

  // RTM
  if (profile.availableCategories.includes('RTM')) {
    const eligible = Math.round(ffsPatients * input.mskPercentage);
    const monthlyDevice = getPaymentDollars('98977');
    const monthlyMgmt = getPaymentDollars('98980');
    const monthly = monthlyDevice + monthlyMgmt;
    const setup = getPaymentDollars('98975');

    breakdowns.push({
      category: 'Remote Therapeutic Monitoring (RTM)',
      codes: ['98975', '98977', '98980', '98981'],
      eligiblePatients: eligible,
      monthlyPerPatient: monthly,
      annualPerPatient: monthly * 12 + setup,
      totalAnnual: (monthly * 12 + setup) * eligible,
    });
  }

  // TCM
  if (profile.availableCategories.includes('TCM') && input.monthlyDischarges > 0) {
    const monthlyTCM = getPaymentDollars('99496'); // assume high-complexity
    breakdowns.push({
      category: 'Transitional Care Management (TCM)',
      codes: ['99495', '99496'],
      eligiblePatients: input.monthlyDischarges * 12,
      monthlyPerPatient: monthlyTCM,
      annualPerPatient: monthlyTCM, // one-time per discharge
      totalAnnual: monthlyTCM * input.monthlyDischarges * 12,
    });
  }

  // ACP
  if (profile.availableCategories.includes('ACP')) {
    // Estimate 10% of panel could benefit from ACP annually
    const eligible = Math.round(ffsPatients * 0.10);
    const perSession = getPaymentDollars('99497');
    breakdowns.push({
      category: 'Advance Care Planning (ACP)',
      codes: ['99497', '99498'],
      eligiblePatients: eligible,
      monthlyPerPatient: 0,
      annualPerPatient: perSession,
      totalAnnual: perSession * eligible,
    });
  }

  // PIN
  if (profile.availableCategories.includes('PIN')) {
    const eligible = Math.round(ffsPatients * 0.05);
    const monthly = getPaymentDollars('G0023');
    breakdowns.push({
      category: 'Principal Illness Navigation (PIN)',
      codes: ['G0023'],
      eligiblePatients: eligible,
      monthlyPerPatient: monthly,
      annualPerPatient: monthly * 12,
      totalAnnual: monthly * 12 * eligible,
    });
  }

  // CHI
  if (profile.availableCategories.includes('CHI')) {
    const eligible = Math.round(ffsPatients * 0.08);
    const monthly = getPaymentDollars('G0019');
    breakdowns.push({
      category: 'Community Health Integration (CHI)',
      codes: ['G0019'],
      eligiblePatients: eligible,
      monthlyPerPatient: monthly,
      annualPerPatient: monthly * 12,
      totalAnnual: monthly * 12 * eligible,
    });
  }

  // CTS
  if (profile.availableCategories.includes('CTS')) {
    const eligible = Math.round(ffsPatients * 0.03);
    const perAssessment = getPaymentDollars('99483');
    breakdowns.push({
      category: 'Cognitive Assessment (CTS)',
      codes: ['99483'],
      eligiblePatients: eligible,
      monthlyPerPatient: 0,
      annualPerPatient: perAssessment,
      totalAnnual: perAssessment * eligible,
    });
  }

  // Caregiver Training
  if (profile.availableCategories.includes('CAREGIVER_TRAINING')) {
    const eligible = Math.round(ffsPatients * 0.05);
    const monthly = getPaymentDollars('G0136');
    breakdowns.push({
      category: 'Caregiver Training',
      codes: ['G0136'],
      eligiblePatients: eligible,
      monthlyPerPatient: monthly,
      annualPerPatient: monthly * 6, // avg 6 sessions per episode
      totalAnnual: monthly * 6 * eligible,
    });
  }

  // ACCESS
  if (profile.availableCategories.includes('ACCESS') && input.accessPercentage > 0) {
    const accessPatients = Math.round(input.panelSize * input.accessPercentage);
    breakdowns.push({
      category: 'ACCESS Model (Population-Based)',
      codes: ['ACCESS_MSK'],
      eligiblePatients: accessPatients,
      monthlyPerPatient: 15, // $180/yr / 12
      annualPerPatient: 180,
      totalAnnual: 180 * accessPatients,
    });
  }

  return breakdowns;
}

/**
 * Calculate per-surgeon revenue analysis.
 *
 * Shows the gap between current billing and optimized billing with
 * SolvingHealth's code stacking engine. Per project data:
 * - Average surgeon: $962/episode (without optimization)
 * - With SolvingHealth: $1,820/episode (89% increase)
 * - Annual recovery: $80K+ per surgeon
 *
 * @param input - Revenue calculation parameters
 * @returns Detailed revenue analysis with breakdown and insights
 */
export function calculateSurgeonRevenue(input: RevenueInput): RevenueAnalysis {
  const parsed = RevenueInputSchema.parse(input);
  const profile = SPECIALTY_PROFILES[parsed.specialty];

  const currentAnnualRevenue = calculateCurrentRevenue(parsed.currentCodes, parsed.panelSize);
  const breakdown = buildBreakdown(parsed, profile);

  const optimizedAnnualRevenue = breakdown.reduce((sum, b) => sum + b.totalAnnual, 0);

  const ffsPatients = Math.round(parsed.panelSize * (1 - parsed.accessPercentage));
  const accessPatients = Math.round(parsed.panelSize * parsed.accessPercentage);

  // Revenue per episode calculations
  const totalEpisodes = parsed.panelSize * profile.avgEpisodesPerYear;
  const currentRevenuePerEpisode = totalEpisodes > 0 ? currentAnnualRevenue / totalEpisodes : 0;
  const optimizedRevenuePerEpisode = totalEpisodes > 0 ? optimizedAnnualRevenue / totalEpisodes : 0;

  const annualRecovery = optimizedAnnualRevenue - currentAnnualRevenue;
  const percentageIncrease = currentAnnualRevenue > 0
    ? ((annualRecovery / currentAnnualRevenue) * 100)
    : 100;

  // Platform fee calculation
  const perEncounterFee = parsed.isMember ? MEMBER_TRANSACTION_FEE_DOLLARS : NON_MEMBER_TRANSACTION_FEE_DOLLARS;
  const estimatedMonthlyEncounters = Math.round((totalEpisodes / 12) * 0.7); // 70% of episodes generate encounters
  const monthlyPlatformRevenue = perEncounterFee * estimatedMonthlyEncounters;

  // ACCESS vs FFS split
  const accessRevenue = accessPatients * 180;
  const ffsRevenue = optimizedAnnualRevenue - accessRevenue;

  // Generate insights
  const insights: string[] = [];

  if (annualRecovery > 80000) {
    insights.push(
      `Your panel of ${parsed.panelSize} patients has $${Math.round(annualRecovery).toLocaleString()} in annual revenue recovery potential.`,
    );
  }

  if (parsed.currentCodes.length === 0) {
    insights.push(
      'You are currently not billing any of the codes SolvingHealth optimizes. ' +
      'This represents 100% new revenue opportunity.',
    );
  }

  const chronicEligible = Math.round(ffsPatients * parsed.chronicPercentage);
  if (chronicEligible > 0 && !parsed.currentCodes.includes('99490')) {
    insights.push(
      `${chronicEligible} patients (${Math.round(parsed.chronicPercentage * 100)}% of FFS panel) are CCM-eligible. ` +
      `96% of CCM-eligible patients nationally are NOT enrolled. This is the single largest missed revenue opportunity.`,
    );
  }

  const mskEligible = Math.round(ffsPatients * parsed.mskPercentage);
  if (mskEligible > 0 && !parsed.currentCodes.some((c) => ['98977', '98975'].includes(c))) {
    insights.push(
      `${mskEligible} patients have MSK conditions eligible for RTM. ` +
      `RTM has seen 373% growth but less than 0.2% penetration. Early mover advantage.`,
    );
  }

  if (parsed.isACCESSProvider && parsed.accessPercentage > 0) {
    insights.push(
      `CRITICAL: ${accessPatients} patients are in ACCESS model. FFS code stacking does NOT apply to these patients. ` +
      `Revenue for ACCESS patients: $180/beneficiary/year (MSK track).`,
    );
  }

  insights.push(
    `SolvingHealth platform fee: flat $${perEncounterFee}/encounter ` +
    `(${parsed.isMember ? 'member' : 'non-member'} rate). Not a percentage. AKS-compliant.`,
  );

  return {
    specialty: parsed.specialty,
    panelSize: parsed.panelSize,
    currentRevenuePerEpisode: Math.round(currentRevenuePerEpisode * 100) / 100,
    currentAnnualRevenue: Math.round(currentAnnualRevenue * 100) / 100,
    currentCodesUsed: parsed.currentCodes,
    optimizedRevenuePerEpisode: Math.round(optimizedRevenuePerEpisode * 100) / 100,
    optimizedAnnualRevenue: Math.round(optimizedAnnualRevenue * 100) / 100,
    annualRecovery: Math.round(annualRecovery * 100) / 100,
    revenuePerEpisodeIncrease: Math.round((optimizedRevenuePerEpisode - currentRevenuePerEpisode) * 100) / 100,
    percentageIncrease: Math.round(percentageIncrease * 10) / 10,
    breakdown,
    accessRevenue: Math.round(accessRevenue * 100) / 100,
    ffsRevenue: Math.round(ffsRevenue * 100) / 100,
    platformFees: {
      perEncounterFee,
      estimatedMonthlyEncounters,
      monthlyPlatformRevenue,
      annualPlatformRevenue: monthlyPlatformRevenue * 12,
    },
    insights,
  };
}

/**
 * Quick estimate for SurgeonAccess sales pitch.
 * "Your panel of X patients is leaving $Y on the table."
 */
export function quickEstimate(
  panelSize: number,
  specialty: SpecialtyType = 'orthopedic_surgery',
): { annualRecovery: number; perEpisodeDelta: number; message: string } {
  const analysis = calculateSurgeonRevenue({
    specialty,
    panelSize,
    currentCodes: [],
    chronicPercentage: SPECIALTY_PROFILES[specialty].defaultChronicPct,
    mskPercentage: SPECIALTY_PROFILES[specialty].defaultMSKPct,
  });

  return {
    annualRecovery: analysis.annualRecovery,
    perEpisodeDelta: analysis.revenuePerEpisodeIncrease,
    message: `Your panel of ${panelSize} patients has approximately $${Math.round(analysis.annualRecovery).toLocaleString()} ` +
      `in untapped annual revenue. SolvingHealth can help you capture $${Math.round(analysis.revenuePerEpisodeIncrease)} ` +
      `more per episode with automated code stacking.`,
  };
}
