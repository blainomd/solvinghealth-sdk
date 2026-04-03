import { describe, it, expect } from 'vitest';
import {
  calculateSurgeonRevenue,
  quickEstimate,
  type RevenueInput,
} from '../revenue-calculator.js';

describe('Revenue Calculator', () => {
  describe('per-surgeon revenue with 200-patient panel', () => {
    const orthoInput: RevenueInput = {
      specialty: 'orthopedic_surgery',
      panelSize: 200,
      currentCodes: [],
      chronicPercentage: 0.4,
      mskPercentage: 0.95,
      monthlyDischarges: 5,
      isACCESSProvider: false,
      accessPercentage: 0,
      isMember: true,
    };

    it('calculates positive optimized revenue', () => {
      const result = calculateSurgeonRevenue(orthoInput);
      expect(result.optimizedAnnualRevenue).toBeGreaterThan(0);
      expect(result.panelSize).toBe(200);
    });

    it('annual recovery is positive when no codes currently billed', () => {
      const result = calculateSurgeonRevenue(orthoInput);
      expect(result.annualRecovery).toBeGreaterThan(0);
      expect(result.annualRecovery).toBe(result.optimizedAnnualRevenue);
    });

    it('produces a detailed breakdown by category', () => {
      const result = calculateSurgeonRevenue(orthoInput);
      expect(result.breakdown.length).toBeGreaterThan(0);
      result.breakdown.forEach((b) => {
        expect(b.category).toBeTruthy();
        expect(b.codes.length).toBeGreaterThan(0);
        expect(b.eligiblePatients).toBeGreaterThanOrEqual(0);
      });
    });

    it('breakdown total matches optimized annual revenue', () => {
      const result = calculateSurgeonRevenue(orthoInput);
      const breakdownTotal = result.breakdown.reduce((sum, b) => sum + b.totalAnnual, 0);
      expect(Math.abs(breakdownTotal - result.optimizedAnnualRevenue)).toBeLessThan(0.02);
    });
  });

  describe('$962 to $1,820 per episode improvement', () => {
    it('optimized revenue per episode exceeds current for orthopedic surgeon', () => {
      const result = calculateSurgeonRevenue({
        specialty: 'orthopedic_surgery',
        panelSize: 200,
        currentCodes: ['98977'],
        mskPercentage: 0.95,
        chronicPercentage: 0.4,
        monthlyDischarges: 5,
        isMember: false,
      });
      expect(result.optimizedRevenuePerEpisode).toBeGreaterThan(result.currentRevenuePerEpisode);
      expect(result.revenuePerEpisodeIncrease).toBeGreaterThan(0);
    });
  });

  describe('$80K annual recovery estimate', () => {
    it('orthopedic surgeon with 200 patients and no billing has significant recovery', () => {
      const result = calculateSurgeonRevenue({
        specialty: 'orthopedic_surgery',
        panelSize: 200,
        currentCodes: [],
        mskPercentage: 0.95,
        chronicPercentage: 0.4,
        monthlyDischarges: 5,
        isMember: false,
      });
      // With full panel, recovery should be substantial
      expect(result.annualRecovery).toBeGreaterThan(50000);
    });
  });

  describe('breakdown by code category', () => {
    it('orthopedic surgeon has RTM and TCM categories', () => {
      const result = calculateSurgeonRevenue({
        specialty: 'orthopedic_surgery',
        panelSize: 200,
        currentCodes: [],
        mskPercentage: 0.95,
        monthlyDischarges: 5,
      });
      const categories = result.breakdown.map((b) => b.category);
      expect(categories).toContain('Remote Therapeutic Monitoring (RTM)');
      expect(categories).toContain('Transitional Care Management (TCM)');
    });

    it('primary care has CCM, RTM, ACP, PIN, CHI categories', () => {
      const result = calculateSurgeonRevenue({
        specialty: 'primary_care',
        panelSize: 500,
        currentCodes: [],
        chronicPercentage: 0.68,
        mskPercentage: 0.25,
        monthlyDischarges: 3,
      });
      const categories = result.breakdown.map((b) => b.category);
      expect(categories).toContain('Chronic Care Management (CCM)');
      expect(categories).toContain('Remote Therapeutic Monitoring (RTM)');
      expect(categories).toContain('Advance Care Planning (ACP)');
      expect(categories).toContain('Principal Illness Navigation (PIN)');
      expect(categories).toContain('Community Health Integration (CHI)');
    });
  });

  describe('different specialty profiles', () => {
    it('primary care with large panel generates highest total revenue', () => {
      const pcp = calculateSurgeonRevenue({
        specialty: 'primary_care',
        panelSize: 500,
        currentCodes: [],
        chronicPercentage: 0.68,
        mskPercentage: 0.25,
        monthlyDischarges: 3,
      });
      const ortho = calculateSurgeonRevenue({
        specialty: 'orthopedic_surgery',
        panelSize: 200,
        currentCodes: [],
        mskPercentage: 0.95,
        monthlyDischarges: 5,
      });
      // PCP with 500 patients should generate more total revenue than ortho with 200
      expect(pcp.optimizedAnnualRevenue).toBeGreaterThan(ortho.optimizedAnnualRevenue);
    });

    it('cardiology has CCM and RPM available', () => {
      const result = calculateSurgeonRevenue({
        specialty: 'cardiology',
        panelSize: 300,
        currentCodes: [],
        chronicPercentage: 0.75,
        mskPercentage: 0.1,
      });
      const categories = result.breakdown.map((b) => b.category);
      expect(categories).toContain('Chronic Care Management (CCM)');
    });

    it('endocrinology has high chronic percentage default', () => {
      const result = calculateSurgeonRevenue({
        specialty: 'endocrinology',
        panelSize: 200,
        currentCodes: [],
      });
      // Endocrinology default chronic pct is 0.85
      const ccm = result.breakdown.find((b) => b.category.includes('CCM'));
      expect(ccm).toBeDefined();
      expect(ccm!.eligiblePatients).toBeGreaterThan(100); // 85% of 200
    });
  });

  describe('platform fees', () => {
    it('member fee is $15/encounter', () => {
      const result = calculateSurgeonRevenue({
        specialty: 'orthopedic_surgery',
        panelSize: 200,
        currentCodes: [],
        isMember: true,
      });
      expect(result.platformFees.perEncounterFee).toBe(15);
    });

    it('non-member fee is $25/encounter', () => {
      const result = calculateSurgeonRevenue({
        specialty: 'orthopedic_surgery',
        panelSize: 200,
        currentCodes: [],
        isMember: false,
      });
      expect(result.platformFees.perEncounterFee).toBe(25);
    });

    it('platform revenue scales with panel size', () => {
      const small = calculateSurgeonRevenue({
        specialty: 'orthopedic_surgery',
        panelSize: 100,
        currentCodes: [],
        isMember: false,
      });
      const large = calculateSurgeonRevenue({
        specialty: 'orthopedic_surgery',
        panelSize: 400,
        currentCodes: [],
        isMember: false,
      });
      expect(large.platformFees.annualPlatformRevenue).toBeGreaterThan(
        small.platformFees.annualPlatformRevenue,
      );
    });
  });

  describe('ACCESS vs FFS split', () => {
    it('mixed ACCESS/FFS panel splits revenue correctly', () => {
      const result = calculateSurgeonRevenue({
        specialty: 'orthopedic_surgery',
        panelSize: 200,
        currentCodes: [],
        isACCESSProvider: true,
        accessPercentage: 0.3,
        mskPercentage: 0.95,
      });
      // 30% of 200 = 60 ACCESS patients at $180/year = $10,800
      expect(result.accessRevenue).toBe(10800);
      expect(result.ffsRevenue).toBeGreaterThan(0);
    });
  });

  describe('quickEstimate', () => {
    it('generates a readable message', () => {
      const result = quickEstimate(200, 'orthopedic_surgery');
      expect(result.message).toContain('200 patients');
      expect(result.annualRecovery).toBeGreaterThan(0);
      expect(result.perEpisodeDelta).toBeGreaterThan(0);
    });

    it('larger panel yields more recovery', () => {
      const small = quickEstimate(100);
      const large = quickEstimate(400);
      expect(large.annualRecovery).toBeGreaterThan(small.annualRecovery);
    });
  });

  describe('insights generation', () => {
    it('generates insight about no current codes', () => {
      const result = calculateSurgeonRevenue({
        specialty: 'orthopedic_surgery',
        panelSize: 200,
        currentCodes: [],
      });
      expect(result.insights.some((i) => i.includes('100% new revenue'))).toBe(true);
    });

    it('includes platform fee insight', () => {
      const result = calculateSurgeonRevenue({
        specialty: 'orthopedic_surgery',
        panelSize: 200,
        currentCodes: [],
        isMember: true,
      });
      expect(result.insights.some((i) => i.includes('$15/encounter'))).toBe(true);
      expect(result.insights.some((i) => i.includes('AKS-compliant'))).toBe(true);
    });
  });
});
