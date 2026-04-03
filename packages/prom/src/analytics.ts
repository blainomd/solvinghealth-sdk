/**
 * @solvinghealth/prom — PROM Analytics
 *
 * Trend analysis, MCID calculations, population benchmarking,
 * and risk stratification based on PROM scores.
 *
 * MIT License
 */

import { z } from 'zod';
import {
  getInstrument,
  interpretScore,
  isClinicallySignificant,
} from './instruments.js';

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

export const ScoreDataPointSchema = z.object({
  /** Score value */
  score: z.number(),
  /** Date of measurement (ISO 8601) */
  date: z.string(),
  /** Timepoint label (e.g., 'Pre-Op', '6 Weeks', '3 Months') */
  timepoint: z.string().optional(),
  /** Session ID for traceability */
  sessionId: z.string().optional(),
});
export type ScoreDataPoint = z.infer<typeof ScoreDataPointSchema>;

export const TrendAnalysisSchema = z.object({
  instrumentId: z.string(),
  patientId: z.string(),
  dataPoints: z.array(ScoreDataPointSchema),
  /** Overall trend direction */
  trend: z.enum(['improving', 'stable', 'declining']),
  /** Total score change from first to last measurement */
  totalChange: z.number(),
  /** Whether total change meets MCID threshold */
  clinicallySignificant: z.boolean(),
  /** Whether total change meets SCB threshold */
  substantialClinicalBenefit: z.boolean(),
  /** Rate of change per month */
  rateOfChangePerMonth: z.number(),
  /** Predicted score at next timepoint (linear extrapolation) */
  predictedNextScore: z.number().optional(),
  /** Interpretation at each timepoint */
  interpretations: z.array(z.object({
    date: z.string(),
    score: z.number(),
    label: z.string(),
    interpretation: z.string(),
  })),
});
export type TrendAnalysis = z.infer<typeof TrendAnalysisSchema>;

export const PopulationBenchmarkSchema = z.object({
  instrumentId: z.string(),
  /** Comparison group description */
  cohort: z.string(),
  /** Number of patients in comparison group */
  cohortSize: z.number(),
  /** Mean score */
  mean: z.number(),
  /** Standard deviation */
  standardDeviation: z.number(),
  /** Percentiles */
  percentiles: z.object({
    p10: z.number(),
    p25: z.number(),
    p50: z.number(),
    p75: z.number(),
    p90: z.number(),
  }),
  /** Timepoint (e.g., '1 Year Post-Op') */
  timepoint: z.string(),
});
export type PopulationBenchmark = z.infer<typeof PopulationBenchmarkSchema>;

export const RiskLevelSchema = z.enum(['low', 'moderate', 'high', 'critical']);
export type RiskLevel = z.infer<typeof RiskLevelSchema>;

export const RiskStratificationSchema = z.object({
  patientId: z.string(),
  instrumentId: z.string(),
  currentScore: z.number(),
  riskLevel: RiskLevelSchema,
  riskFactors: z.array(z.string()),
  recommendations: z.array(z.string()),
  /** Percentile rank relative to benchmark population */
  percentileRank: z.number().optional(),
  /** Predicted outcome based on current trajectory */
  predictedOutcome: z.string().optional(),
});
export type RiskStratification = z.infer<typeof RiskStratificationSchema>;

// ---------------------------------------------------------------------------
// Trend Analysis
// ---------------------------------------------------------------------------

/**
 * Analyze PROM score trends over time for a single patient.
 *
 * @param instrumentId - The PROM instrument
 * @param patientId - Patient identifier
 * @param dataPoints - Chronological score measurements
 * @returns Trend analysis with clinical significance assessment
 */
export function analyzeTrend(
  instrumentId: string,
  patientId: string,
  dataPoints: ScoreDataPoint[],
): TrendAnalysis {
  if (dataPoints.length < 2) {
    throw new Error('At least 2 data points required for trend analysis');
  }

  const instrument = getInstrument(instrumentId);

  // Sort by date
  const sorted = [...dataPoints].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
  );

  const firstScore = sorted[0]!.score;
  const lastScore = sorted[sorted.length - 1]!.score;
  const totalChange = lastScore - firstScore;

  // Calculate rate of change per month
  const firstDate = new Date(sorted[0]!.date);
  const lastDate = new Date(sorted[sorted.length - 1]!.date);
  const monthsElapsed = (lastDate.getTime() - firstDate.getTime()) / (30.44 * 24 * 60 * 60 * 1000);
  const rateOfChangePerMonth = monthsElapsed > 0 ? totalChange / monthsElapsed : 0;

  // Determine trend direction considering instrument orientation
  let trend: 'improving' | 'stable' | 'declining';
  const absMCID = instrument.mcid;
  if (Math.abs(totalChange) < absMCID) {
    trend = 'stable';
  } else if (instrument.higherIsBetter) {
    trend = totalChange > 0 ? 'improving' : 'declining';
  } else {
    trend = totalChange < 0 ? 'improving' : 'declining';
  }

  // MCID and SCB checks
  const clinicallySignificant_ = isClinicallySignificant(instrumentId, firstScore, lastScore);
  const substantialClinicalBenefit = instrument.scb
    ? Math.abs(totalChange) >= instrument.scb
    : false;

  // Linear extrapolation for next timepoint prediction
  let predictedNextScore: number | undefined;
  if (sorted.length >= 3 && monthsElapsed > 0) {
    // Average interval between measurements
    const avgIntervalMonths = monthsElapsed / (sorted.length - 1);
    const predicted = lastScore + rateOfChangePerMonth * avgIntervalMonths;
    predictedNextScore = Math.max(
      instrument.scoreRange.min,
      Math.min(instrument.scoreRange.max, Math.round(predicted * 10) / 10),
    );
  }

  // Build interpretations for each timepoint
  const interpretations = sorted.map((dp) => {
    const interp = interpretScore(instrumentId, dp.score);
    return {
      date: dp.date,
      score: dp.score,
      label: interp.label,
      interpretation: interp.interpretation,
    };
  });

  return {
    instrumentId,
    patientId,
    dataPoints: sorted,
    trend,
    totalChange: Math.round(totalChange * 10) / 10,
    clinicallySignificant: clinicallySignificant_,
    substantialClinicalBenefit,
    rateOfChangePerMonth: Math.round(rateOfChangePerMonth * 100) / 100,
    predictedNextScore,
    interpretations,
  };
}

// ---------------------------------------------------------------------------
// Population Benchmarks
// ---------------------------------------------------------------------------

/**
 * Reference benchmarks for common orthopedic PROM instruments.
 * Based on published population norms.
 */
export const REFERENCE_BENCHMARKS: readonly PopulationBenchmark[] = [
  // KOOS JR benchmarks
  {
    instrumentId: 'KOOS_JR',
    cohort: 'Pre-operative TKA patients',
    cohortSize: 15234,
    mean: 48.2,
    standardDeviation: 14.8,
    percentiles: { p10: 28, p25: 37, p50: 48, p75: 59, p90: 68 },
    timepoint: 'Pre-Op',
  },
  {
    instrumentId: 'KOOS_JR',
    cohort: 'TKA patients at 1 year post-op',
    cohortSize: 12890,
    mean: 75.4,
    standardDeviation: 16.2,
    percentiles: { p10: 52, p25: 65, p50: 77, p75: 87, p90: 94 },
    timepoint: '1 Year Post-Op',
  },
  // HOOS JR benchmarks
  {
    instrumentId: 'HOOS_JR',
    cohort: 'Pre-operative THA patients',
    cohortSize: 11567,
    mean: 46.5,
    standardDeviation: 15.1,
    percentiles: { p10: 26, p25: 35, p50: 46, p75: 58, p90: 66 },
    timepoint: 'Pre-Op',
  },
  {
    instrumentId: 'HOOS_JR',
    cohort: 'THA patients at 1 year post-op',
    cohortSize: 9823,
    mean: 82.1,
    standardDeviation: 14.5,
    percentiles: { p10: 62, p25: 74, p50: 84, p75: 92, p90: 97 },
    timepoint: '1 Year Post-Op',
  },
  // ODI benchmarks
  {
    instrumentId: 'ODI',
    cohort: 'Pre-operative lumbar fusion patients',
    cohortSize: 8456,
    mean: 52.3,
    standardDeviation: 15.7,
    percentiles: { p10: 32, p25: 41, p50: 52, p75: 63, p90: 72 },
    timepoint: 'Pre-Op',
  },
  {
    instrumentId: 'ODI',
    cohort: 'Lumbar fusion patients at 1 year post-op',
    cohortSize: 6890,
    mean: 28.5,
    standardDeviation: 18.2,
    percentiles: { p10: 6, p25: 14, p50: 26, p75: 40, p90: 52 },
    timepoint: '1 Year Post-Op',
  },
  // QuickDASH benchmarks
  {
    instrumentId: 'QUICK_DASH',
    cohort: 'Pre-operative rotator cuff repair patients',
    cohortSize: 5678,
    mean: 56.8,
    standardDeviation: 18.4,
    percentiles: { p10: 32, p25: 43, p50: 57, p75: 70, p90: 80 },
    timepoint: 'Pre-Op',
  },
  {
    instrumentId: 'QUICK_DASH',
    cohort: 'Rotator cuff repair patients at 1 year post-op',
    cohortSize: 4512,
    mean: 18.5,
    standardDeviation: 16.8,
    percentiles: { p10: 2, p25: 7, p50: 16, p75: 27, p90: 39 },
    timepoint: '1 Year Post-Op',
  },
] as const;

/**
 * Compare a patient's score to a population benchmark.
 *
 * @param instrumentId - The PROM instrument
 * @param score - Patient's score
 * @param timepoint - Timepoint to compare against
 * @returns Percentile rank and comparison
 */
export function compareToPopulation(
  instrumentId: string,
  score: number,
  timepoint: string,
): {
  benchmark: PopulationBenchmark | undefined;
  percentileRank: number;
  zScore: number;
  comparison: string;
} {
  const benchmark = REFERENCE_BENCHMARKS.find(
    (b) => b.instrumentId === instrumentId && b.timepoint === timepoint,
  );

  if (!benchmark) {
    return {
      benchmark: undefined,
      percentileRank: 50,
      zScore: 0,
      comparison: `No benchmark data available for ${instrumentId} at ${timepoint}`,
    };
  }

  const zScore = (score - benchmark.mean) / benchmark.standardDeviation;

  // Approximate percentile from z-score using normal CDF approximation
  const percentileRank = approximatePercentile(zScore);

  const instrument = getInstrument(instrumentId);
  let comparison: string;
  if (percentileRank >= 75) {
    comparison = instrument.higherIsBetter
      ? `Score of ${score} is above the 75th percentile — better than 75% of ${benchmark.cohort}`
      : `Score of ${score} is above the 75th percentile — higher disability than 75% of ${benchmark.cohort}`;
  } else if (percentileRank >= 25) {
    comparison = `Score of ${score} is within the interquartile range for ${benchmark.cohort}`;
  } else {
    comparison = instrument.higherIsBetter
      ? `Score of ${score} is below the 25th percentile — worse than 75% of ${benchmark.cohort}`
      : `Score of ${score} is below the 25th percentile — less disability than 75% of ${benchmark.cohort}`;
  }

  return {
    benchmark,
    percentileRank: Math.round(percentileRank * 10) / 10,
    zScore: Math.round(zScore * 100) / 100,
    comparison,
  };
}

/**
 * Approximate percentile from z-score using Abramowitz and Stegun formula.
 */
function approximatePercentile(z: number): number {
  const isNegative = z < 0;
  const absZ = Math.abs(z);

  const t = 1 / (1 + 0.2316419 * absZ);
  const d = 0.3989422804 * Math.exp(-0.5 * absZ * absZ);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));

  const result = isNegative ? p : 1 - p;
  return Math.max(0, Math.min(100, result * 100));
}

// ---------------------------------------------------------------------------
// Risk Stratification
// ---------------------------------------------------------------------------

/**
 * Stratify patient risk based on PROM scores.
 *
 * Risk levels:
 * - Low: Score in top quartile of benchmark population
 * - Moderate: Score in interquartile range
 * - High: Score in bottom quartile
 * - Critical: Score in bottom 10th percentile OR declining trend
 *
 * @param params - Patient score and context
 * @returns Risk stratification with recommendations
 */
export function stratifyRisk(params: {
  patientId: string;
  instrumentId: string;
  currentScore: number;
  previousScores?: ScoreDataPoint[];
  timepoint?: string;
}): RiskStratification {
  const instrument = getInstrument(params.instrumentId);
  const timepoint = params.timepoint ?? 'Pre-Op';

  const { percentileRank } = compareToPopulation(
    params.instrumentId,
    params.currentScore,
    timepoint,
  );

  const riskFactors: string[] = [];
  const recommendations: string[] = [];

  // Determine risk level
  let riskLevel: RiskLevel;

  // For instruments where higher is better (KOOS JR, HOOS JR, PROMIS-10)
  if (instrument.higherIsBetter) {
    if (percentileRank >= 75) {
      riskLevel = 'low';
    } else if (percentileRank >= 25) {
      riskLevel = 'moderate';
      riskFactors.push(`Score in lower half of ${timepoint} population`);
    } else if (percentileRank >= 10) {
      riskLevel = 'high';
      riskFactors.push(`Score below 25th percentile for ${timepoint} population`);
    } else {
      riskLevel = 'critical';
      riskFactors.push(`Score below 10th percentile for ${timepoint} population`);
    }
  } else {
    // For instruments where lower is better (ODI, NDI, QuickDASH)
    if (percentileRank <= 25) {
      riskLevel = 'low';
    } else if (percentileRank <= 75) {
      riskLevel = 'moderate';
      riskFactors.push(`Disability score in upper half of ${timepoint} population`);
    } else if (percentileRank <= 90) {
      riskLevel = 'high';
      riskFactors.push(`Disability score above 75th percentile`);
    } else {
      riskLevel = 'critical';
      riskFactors.push(`Disability score above 90th percentile — extreme functional limitation`);
    }
  }

  // Check trend if previous scores available
  let predictedOutcome: string | undefined;
  if (params.previousScores && params.previousScores.length >= 2) {
    const trend = analyzeTrend(
      params.instrumentId,
      params.patientId,
      [...params.previousScores, { score: params.currentScore, date: new Date().toISOString() }],
    );

    if (trend.trend === 'declining') {
      riskLevel = riskLevel === 'low' ? 'moderate' : riskLevel === 'moderate' ? 'high' : 'critical';
      riskFactors.push(`Declining trend: ${trend.rateOfChangePerMonth.toFixed(1)} points/month`);
    }

    if (trend.predictedNextScore !== undefined) {
      const predictedInterp = interpretScore(params.instrumentId, trend.predictedNextScore);
      predictedOutcome = `Predicted next score: ${trend.predictedNextScore} (${predictedInterp.label})`;
    }
  }

  // Generate recommendations by risk level
  switch (riskLevel) {
    case 'low':
      recommendations.push('Continue current management plan');
      recommendations.push('Schedule standard follow-up PROM assessment');
      break;
    case 'moderate':
      recommendations.push('Consider more frequent PROM monitoring (monthly)');
      recommendations.push('Review and optimize treatment plan');
      recommendations.push('Assess for modifiable risk factors (BMI, smoking, depression)');
      break;
    case 'high':
      recommendations.push('Recommend clinical reassessment within 2 weeks');
      recommendations.push('Evaluate for additional interventions');
      recommendations.push('Consider referral to pain management or physical therapy');
      recommendations.push('Screen for depression (PHQ-9) and anxiety (GAD-7)');
      break;
    case 'critical':
      recommendations.push('URGENT: Schedule clinical reassessment within 48 hours');
      recommendations.push('Evaluate for surgical or procedural intervention');
      recommendations.push('Comprehensive multidisciplinary assessment recommended');
      recommendations.push('Consider behavioral health referral');
      recommendations.push('Document shared decision-making conversation');
      break;
  }

  return {
    patientId: params.patientId,
    instrumentId: params.instrumentId,
    currentScore: params.currentScore,
    riskLevel,
    riskFactors,
    recommendations,
    percentileRank,
    predictedOutcome,
  };
}

/**
 * Calculate MCID achievement rate for a cohort.
 *
 * @param instrumentId - The PROM instrument
 * @param prePostPairs - Array of pre/post score pairs
 * @returns Cohort-level MCID achievement statistics
 */
export function calculateMCIDAchievement(
  instrumentId: string,
  prePostPairs: Array<{ preScore: number; postScore: number }>,
): {
  totalPatients: number;
  achievedMCID: number;
  achievedMCIDPct: number;
  achievedSCB: number;
  achievedSCBPct: number;
  meanImprovement: number;
  medianImprovement: number;
} {
  const instrument = getInstrument(instrumentId);
  const improvements = prePostPairs.map((p) =>
    instrument.higherIsBetter
      ? p.postScore - p.preScore
      : p.preScore - p.postScore,
  );

  const sorted = [...improvements].sort((a, b) => a - b);
  const totalPatients = prePostPairs.length;

  const achievedMCID = improvements.filter((i) => i >= instrument.mcid).length;
  const achievedSCB = instrument.scb
    ? improvements.filter((i) => i >= instrument.scb!).length
    : 0;

  const meanImprovement = improvements.reduce((a, b) => a + b, 0) / totalPatients;
  const medianImprovement = totalPatients % 2 === 0
    ? (sorted[totalPatients / 2 - 1]! + sorted[totalPatients / 2]!) / 2
    : sorted[Math.floor(totalPatients / 2)]!;

  return {
    totalPatients,
    achievedMCID,
    achievedMCIDPct: Math.round((achievedMCID / totalPatients) * 1000) / 10,
    achievedSCB,
    achievedSCBPct: instrument.scb
      ? Math.round((achievedSCB / totalPatients) * 1000) / 10
      : 0,
    meanImprovement: Math.round(meanImprovement * 10) / 10,
    medianImprovement: Math.round(medianImprovement * 10) / 10,
  };
}
