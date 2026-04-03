import { describe, it, expect } from 'vitest';
import {
  analyzeTrend,
  compareToPopulation,
  stratifyRisk,
  calculateMCIDAchievement,
  REFERENCE_BENCHMARKS,
  type ScoreDataPoint,
} from '../analytics.js';

describe('PROM Analytics', () => {
  describe('trend analysis', () => {
    it('detects improving trajectory (higher-is-better instrument)', () => {
      const dataPoints: ScoreDataPoint[] = [
        { score: 45, date: '2025-01-01', timepoint: 'Pre-Op' },
        { score: 55, date: '2025-04-01', timepoint: '3 Months' },
        { score: 72, date: '2025-07-01', timepoint: '6 Months' },
        { score: 82, date: '2026-01-01', timepoint: '1 Year' },
      ];
      const result = analyzeTrend('KOOS_JR', 'PAT-100', dataPoints);
      expect(result.trend).toBe('improving');
      expect(result.totalChange).toBeGreaterThan(0);
      expect(result.clinicallySignificant).toBe(true); // change = 37 > MCID 14
    });

    it('detects stable trajectory when change is below MCID', () => {
      const dataPoints: ScoreDataPoint[] = [
        { score: 70, date: '2025-01-01' },
        { score: 72, date: '2025-04-01' },
        { score: 71, date: '2025-07-01' },
      ];
      const result = analyzeTrend('KOOS_JR', 'PAT-101', dataPoints);
      expect(result.trend).toBe('stable');
      expect(result.clinicallySignificant).toBe(false);
    });

    it('detects declining trajectory (higher-is-better instrument)', () => {
      const dataPoints: ScoreDataPoint[] = [
        { score: 80, date: '2025-01-01' },
        { score: 68, date: '2025-04-01' },
        { score: 55, date: '2025-07-01' },
      ];
      const result = analyzeTrend('KOOS_JR', 'PAT-102', dataPoints);
      expect(result.trend).toBe('declining');
      expect(result.totalChange).toBeLessThan(0);
    });

    it('detects improving trajectory for lower-is-better instrument (ODI)', () => {
      const dataPoints: ScoreDataPoint[] = [
        { score: 55, date: '2025-01-01', timepoint: 'Pre-Op' },
        { score: 40, date: '2025-04-01', timepoint: '3 Months' },
        { score: 25, date: '2025-07-01', timepoint: '6 Months' },
      ];
      const result = analyzeTrend('ODI', 'PAT-103', dataPoints);
      expect(result.trend).toBe('improving'); // lower ODI = better
      expect(result.clinicallySignificant).toBe(true); // change = 30 > MCID 12.8
    });

    it('calculates rate of change per month', () => {
      const dataPoints: ScoreDataPoint[] = [
        { score: 40, date: '2025-01-01' },
        { score: 70, date: '2025-07-01' },
      ];
      const result = analyzeTrend('KOOS_JR', 'PAT-104', dataPoints);
      // 30 point change over ~6 months = ~5 per month
      expect(result.rateOfChangePerMonth).toBeCloseTo(5, 0);
    });

    it('predicts next score with 3+ data points', () => {
      const dataPoints: ScoreDataPoint[] = [
        { score: 40, date: '2025-01-01' },
        { score: 50, date: '2025-04-01' },
        { score: 60, date: '2025-07-01' },
      ];
      const result = analyzeTrend('KOOS_JR', 'PAT-105', dataPoints);
      expect(result.predictedNextScore).toBeDefined();
      // Linear extrapolation: ~70
      expect(result.predictedNextScore!).toBeGreaterThan(60);
    });

    it('clamps predicted score to instrument range', () => {
      const dataPoints: ScoreDataPoint[] = [
        { score: 90, date: '2025-01-01' },
        { score: 95, date: '2025-04-01' },
        { score: 99, date: '2025-07-01' },
      ];
      const result = analyzeTrend('KOOS_JR', 'PAT-106', dataPoints);
      if (result.predictedNextScore !== undefined) {
        expect(result.predictedNextScore).toBeLessThanOrEqual(100);
      }
    });

    it('throws with fewer than 2 data points', () => {
      expect(() =>
        analyzeTrend('KOOS_JR', 'PAT-107', [{ score: 50, date: '2025-01-01' }]),
      ).toThrow('At least 2');
    });

    it('provides interpretations at each timepoint', () => {
      const dataPoints: ScoreDataPoint[] = [
        { score: 30, date: '2025-01-01' },
        { score: 75, date: '2025-07-01' },
      ];
      const result = analyzeTrend('KOOS_JR', 'PAT-108', dataPoints);
      expect(result.interpretations.length).toBe(2);
      expect(result.interpretations[0]!.label).toBe('Poor');
      expect(result.interpretations[1]!.label).toBe('Good');
    });

    it('detects substantial clinical benefit when SCB threshold met', () => {
      // KOOS JR SCB = 20
      const dataPoints: ScoreDataPoint[] = [
        { score: 40, date: '2025-01-01' },
        { score: 65, date: '2025-07-01' },
      ];
      const result = analyzeTrend('KOOS_JR', 'PAT-109', dataPoints);
      expect(result.substantialClinicalBenefit).toBe(true);
    });
  });

  describe('MCID achievement detection', () => {
    it('calculates MCID achievement rate for a cohort', () => {
      const prePostPairs = [
        { preScore: 40, postScore: 60 }, // improvement = 20 >= 14 (MCID)
        { preScore: 45, postScore: 55 }, // improvement = 10 < 14
        { preScore: 35, postScore: 60 }, // improvement = 25 >= 14
        { preScore: 50, postScore: 52 }, // improvement = 2 < 14
        { preScore: 30, postScore: 70 }, // improvement = 40 >= 14
      ];
      const result = calculateMCIDAchievement('KOOS_JR', prePostPairs);
      expect(result.totalPatients).toBe(5);
      expect(result.achievedMCID).toBe(3);
      expect(result.achievedMCIDPct).toBe(60);
      expect(result.meanImprovement).toBe(19.4); // (20+10+25+2+40)/5 = 19.4
    });

    it('calculates SCB achievement rate', () => {
      // KOOS JR SCB = 20
      const prePostPairs = [
        { preScore: 30, postScore: 55 }, // improvement = 25 >= 20
        { preScore: 40, postScore: 65 }, // improvement = 25 >= 20
        { preScore: 50, postScore: 60 }, // improvement = 10 < 20
      ];
      const result = calculateMCIDAchievement('KOOS_JR', prePostPairs);
      expect(result.achievedSCB).toBe(2);
      expect(result.achievedSCBPct).toBeCloseTo(66.7, 0);
    });

    it('handles lower-is-better instruments correctly (ODI)', () => {
      // ODI: lower = better, MCID = 12.8
      const prePostPairs = [
        { preScore: 60, postScore: 40 }, // improvement = 20 >= 12.8
        { preScore: 50, postScore: 45 }, // improvement = 5 < 12.8
        { preScore: 55, postScore: 35 }, // improvement = 20 >= 12.8
      ];
      const result = calculateMCIDAchievement('ODI', prePostPairs);
      expect(result.achievedMCID).toBe(2);
      expect(result.meanImprovement).toBe(15);
    });
  });

  describe('risk stratification', () => {
    it('stratifies low risk for high-scoring patient', () => {
      const result = stratifyRisk({
        patientId: 'PAT-200',
        instrumentId: 'KOOS_JR',
        currentScore: 90,
        timepoint: '1 Year Post-Op',
      });
      expect(result.riskLevel).toBe('low');
      expect(result.recommendations.length).toBeGreaterThan(0);
    });

    it('stratifies high risk for low-scoring patient', () => {
      const result = stratifyRisk({
        patientId: 'PAT-201',
        instrumentId: 'KOOS_JR',
        currentScore: 30,
        timepoint: 'Pre-Op',
      });
      expect(['high', 'critical']).toContain(result.riskLevel);
      expect(result.riskFactors.length).toBeGreaterThan(0);
    });

    it('escalates risk when trend is declining', () => {
      const previousScores: ScoreDataPoint[] = [
        { score: 70, date: '2025-01-01' },
        { score: 60, date: '2025-04-01' },
      ];
      const result = stratifyRisk({
        patientId: 'PAT-202',
        instrumentId: 'KOOS_JR',
        currentScore: 45,
        previousScores,
        timepoint: 'Pre-Op',
      });
      expect(result.riskFactors.some((f) => f.includes('Declining'))).toBe(true);
    });

    it('provides predicted outcome when previous scores available', () => {
      const previousScores: ScoreDataPoint[] = [
        { score: 50, date: '2025-01-01' },
        { score: 60, date: '2025-04-01' },
        { score: 70, date: '2025-07-01' },
      ];
      const result = stratifyRisk({
        patientId: 'PAT-203',
        instrumentId: 'KOOS_JR',
        currentScore: 75,
        previousScores,
        timepoint: '1 Year Post-Op',
      });
      expect(result.predictedOutcome).toBeDefined();
    });

    it('critical risk generates urgent recommendations', () => {
      const result = stratifyRisk({
        patientId: 'PAT-204',
        instrumentId: 'KOOS_JR',
        currentScore: 15, // very low score
        timepoint: 'Pre-Op',
      });
      if (result.riskLevel === 'critical') {
        expect(result.recommendations.some((r) => r.includes('URGENT'))).toBe(true);
      }
    });

    it('lower-is-better instruments (ODI) stratify correctly', () => {
      // ODI: high score = high disability = high risk
      const lowRisk = stratifyRisk({
        patientId: 'PAT-205',
        instrumentId: 'ODI',
        currentScore: 10, // low disability
        timepoint: 'Pre-Op',
      });
      const highRisk = stratifyRisk({
        patientId: 'PAT-206',
        instrumentId: 'ODI',
        currentScore: 70, // high disability
        timepoint: 'Pre-Op',
      });
      // Low score on ODI should be lower risk than high score
      const riskOrder = ['low', 'moderate', 'high', 'critical'];
      expect(riskOrder.indexOf(lowRisk.riskLevel)).toBeLessThanOrEqual(
        riskOrder.indexOf(highRisk.riskLevel),
      );
    });
  });

  describe('population benchmarking', () => {
    it('has benchmarks for KOOS JR, HOOS JR, ODI, and QuickDASH', () => {
      const instrumentIds = new Set(REFERENCE_BENCHMARKS.map((b) => b.instrumentId));
      expect(instrumentIds.has('KOOS_JR')).toBe(true);
      expect(instrumentIds.has('HOOS_JR')).toBe(true);
      expect(instrumentIds.has('ODI')).toBe(true);
      expect(instrumentIds.has('QUICK_DASH')).toBe(true);
    });

    it('compares KOOS JR score to pre-op population', () => {
      const result = compareToPopulation('KOOS_JR', 48, 'Pre-Op');
      expect(result.benchmark).toBeDefined();
      expect(result.benchmark!.cohort).toContain('Pre-operative TKA');
      // Score of 48 is near the mean of 48.2
      expect(result.percentileRank).toBeGreaterThan(40);
      expect(result.percentileRank).toBeLessThan(60);
    });

    it('above-average score gets high percentile rank', () => {
      const result = compareToPopulation('KOOS_JR', 85, '1 Year Post-Op');
      expect(result.percentileRank).toBeGreaterThan(60);
    });

    it('below-average score gets low percentile rank', () => {
      const result = compareToPopulation('KOOS_JR', 30, 'Pre-Op');
      expect(result.percentileRank).toBeLessThan(20);
    });

    it('returns fallback when no benchmark available', () => {
      const result = compareToPopulation('PROMIS_10', 50, 'Pre-Op');
      expect(result.benchmark).toBeUndefined();
      expect(result.percentileRank).toBe(50); // default
      expect(result.comparison).toContain('No benchmark');
    });

    it('z-score is positive for scores above mean', () => {
      const result = compareToPopulation('KOOS_JR', 80, 'Pre-Op');
      expect(result.zScore).toBeGreaterThan(0);
    });

    it('z-score is negative for scores below mean', () => {
      const result = compareToPopulation('KOOS_JR', 30, 'Pre-Op');
      expect(result.zScore).toBeLessThan(0);
    });

    it('benchmark data has valid percentile ordering', () => {
      for (const b of REFERENCE_BENCHMARKS) {
        expect(b.percentiles.p10).toBeLessThanOrEqual(b.percentiles.p25);
        expect(b.percentiles.p25).toBeLessThanOrEqual(b.percentiles.p50);
        expect(b.percentiles.p50).toBeLessThanOrEqual(b.percentiles.p75);
        expect(b.percentiles.p75).toBeLessThanOrEqual(b.percentiles.p90);
      }
    });
  });
});
