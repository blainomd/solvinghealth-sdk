import { describe, it, expect } from 'vitest';
import {
  INSTRUMENTS,
  KOOS_JR,
  HOOS_JR,
  ODI,
  NDI,
  QUICK_DASH,
  PROMIS_10,
  getInstrument,
  scoreInstrument,
  scorePROMIS10Domain,
  interpretScore,
  isClinicallySignificant,
} from '../instruments.js';

describe('PROM Instruments', () => {
  describe('instrument registry', () => {
    it('has all 6 instruments registered', () => {
      expect(INSTRUMENTS.size).toBe(6);
      expect(INSTRUMENTS.has('KOOS_JR')).toBe(true);
      expect(INSTRUMENTS.has('HOOS_JR')).toBe(true);
      expect(INSTRUMENTS.has('ODI')).toBe(true);
      expect(INSTRUMENTS.has('NDI')).toBe(true);
      expect(INSTRUMENTS.has('QUICK_DASH')).toBe(true);
      expect(INSTRUMENTS.has('PROMIS_10')).toBe(true);
    });

    it('getInstrument throws for unknown instrument', () => {
      expect(() => getInstrument('FAKE')).toThrow('not found');
    });

    it('all instruments have required fields', () => {
      for (const [, inst] of INSTRUMENTS) {
        expect(inst.id).toBeTruthy();
        expect(inst.name).toBeTruthy();
        expect(inst.items.length).toBeGreaterThan(0);
        expect(inst.scoreRange.min).toBeLessThan(inst.scoreRange.max);
        expect(typeof inst.higherIsBetter).toBe('boolean');
        expect(inst.normativeRanges.length).toBeGreaterThan(0);
        expect(inst.mcid).toBeGreaterThan(0);
        expect(inst.completionTimeMins).toBeGreaterThan(0);
        expect(inst.citation).toBeTruthy();
      }
    });

    it('all instruments have a scoring function', () => {
      // Verify scoreInstrument does not throw for each ID with valid inputs
      const instrumentIds = ['KOOS_JR', 'HOOS_JR', 'ODI', 'NDI', 'QUICK_DASH', 'PROMIS_10'];
      for (const id of instrumentIds) {
        const inst = getInstrument(id);
        const responses: Record<string, number> = {};
        for (const item of inst.items) {
          responses[item.id] = item.options[0]!.value;
        }
        expect(() => scoreInstrument(id, responses)).not.toThrow();
      }
    });
  });

  describe('KOOS JR scoring', () => {
    it('all zeros (no problems) = 100', () => {
      const responses = {
        kj1: 0, kj2: 0, kj3: 0, kj4: 0, kj5: 0, kj6: 0, kj7: 0,
      };
      const score = scoreInstrument('KOOS_JR', responses);
      expect(score).toBe(100);
    });

    it('all 4s (worst) = 0', () => {
      const responses = {
        kj1: 4, kj2: 4, kj3: 4, kj4: 4, kj5: 4, kj6: 4, kj7: 4,
      };
      const score = scoreInstrument('KOOS_JR', responses);
      expect(score).toBe(0);
    });

    it('moderate responses produce mid-range score', () => {
      const responses = {
        kj1: 2, kj2: 2, kj3: 2, kj4: 2, kj5: 2, kj6: 2, kj7: 2,
      };
      const score = scoreInstrument('KOOS_JR', responses);
      expect(score).toBe(50);
    });

    it('throws for wrong number of responses', () => {
      expect(() => scoreInstrument('KOOS_JR', { kj1: 0, kj2: 0 })).toThrow();
    });

    it('MCID is 14 points', () => {
      expect(KOOS_JR.mcid).toBe(14);
    });

    it('SCB is 20 points', () => {
      expect(KOOS_JR.scb).toBe(20);
    });
  });

  describe('HOOS JR scoring', () => {
    it('all zeros (no problems) = 100', () => {
      const responses = { hj1: 0, hj2: 0, hj3: 0, hj4: 0, hj5: 0, hj6: 0 };
      const score = scoreInstrument('HOOS_JR', responses);
      expect(score).toBe(100);
    });

    it('all 4s (worst) = 0', () => {
      const responses = { hj1: 4, hj2: 4, hj3: 4, hj4: 4, hj5: 4, hj6: 4 };
      const score = scoreInstrument('HOOS_JR', responses);
      expect(score).toBe(0);
    });

    it('boundary: one item at max, rest at zero', () => {
      const responses = { hj1: 4, hj2: 0, hj3: 0, hj4: 0, hj5: 0, hj6: 0 };
      const score = scoreInstrument('HOOS_JR', responses);
      // 4/24 raw = 16.67% -> score = 100 - 16.67 = 83.3
      expect(score).toBeCloseTo(83.3, 0);
    });

    it('MCID is 18 points', () => {
      expect(HOOS_JR.mcid).toBe(18);
    });
  });

  describe('ODI scoring', () => {
    it('all zeros = 0% disability (no disability)', () => {
      const responses: Record<string, number> = {};
      ODI.items.forEach((item) => { responses[item.id] = 0; });
      const score = scoreInstrument('ODI', responses);
      expect(score).toBe(0);
    });

    it('all 5s = 100% disability (bed-bound)', () => {
      const responses: Record<string, number> = {};
      ODI.items.forEach((item) => { responses[item.id] = 5; });
      const score = scoreInstrument('ODI', responses);
      expect(score).toBe(100);
    });

    it('half severity = 50% (severe disability)', () => {
      const responses: Record<string, number> = {};
      ODI.items.forEach((item) => { responses[item.id] = 2.5; });
      const score = scoreInstrument('ODI', responses);
      expect(score).toBe(50);
    });

    it('ODI interpretation at 50% is Severe Disability', () => {
      const interp = interpretScore('ODI', 50);
      expect(interp.label).toBe('Severe Disability');
    });

    it('ODI MCID is 12.8', () => {
      expect(ODI.mcid).toBe(12.8);
    });

    it('lower is better for ODI', () => {
      expect(ODI.higherIsBetter).toBe(false);
    });
  });

  describe('NDI scoring', () => {
    it('all zeros = 0% disability', () => {
      const responses: Record<string, number> = {};
      NDI.items.forEach((item) => { responses[item.id] = 0; });
      const score = scoreInstrument('NDI', responses);
      expect(score).toBe(0);
    });

    it('all 5s = 100% disability', () => {
      const responses: Record<string, number> = {};
      NDI.items.forEach((item) => { responses[item.id] = 5; });
      const score = scoreInstrument('NDI', responses);
      expect(score).toBe(100);
    });

    it('NDI MCID is 7.5', () => {
      expect(NDI.mcid).toBe(7.5);
    });

    it('NDI interpretation at 5 is No Disability', () => {
      const interp = interpretScore('NDI', 5);
      expect(interp.label).toBe('No Disability');
    });
  });

  describe('QuickDASH scoring', () => {
    it('all 1s (no difficulty) = 0', () => {
      const responses: Record<string, number> = {};
      QUICK_DASH.items.forEach((item) => { responses[item.id] = 1; });
      const score = scoreInstrument('QUICK_DASH', responses);
      expect(score).toBe(0);
    });

    it('all 5s (extreme) = 100', () => {
      const responses: Record<string, number> = {};
      QUICK_DASH.items.forEach((item) => { responses[item.id] = 5; });
      const score = scoreInstrument('QUICK_DASH', responses);
      expect(score).toBe(100);
    });

    it('all 3s (moderate) = 50', () => {
      const responses: Record<string, number> = {};
      QUICK_DASH.items.forEach((item) => { responses[item.id] = 3; });
      const score = scoreInstrument('QUICK_DASH', responses);
      expect(score).toBe(50);
    });

    it('throws with fewer than 10 responses', () => {
      expect(() => scoreInstrument('QUICK_DASH', { qd1: 1, qd2: 1 })).toThrow(
        'at least 10 responses',
      );
    });

    it('QuickDASH MCID is 8', () => {
      expect(QUICK_DASH.mcid).toBe(8);
    });
  });

  describe('PROMIS-10 scoring', () => {
    it('all 5s (best) produces above-average T-score', () => {
      const responses: Record<string, number> = {};
      PROMIS_10.items.forEach((item) => { responses[item.id] = 5; });
      const score = scoreInstrument('PROMIS_10', responses);
      expect(score).toBeGreaterThanOrEqual(50);
    });

    it('all 1s (worst) produces below-average T-score', () => {
      const responses: Record<string, number> = {};
      PROMIS_10.items.forEach((item) => { responses[item.id] = 1; });
      const score = scoreInstrument('PROMIS_10', responses);
      expect(score).toBeLessThan(50);
    });

    it('T-score is clamped to 20-80 range', () => {
      const bestResponses: Record<string, number> = {};
      PROMIS_10.items.forEach((item) => { bestResponses[item.id] = 5; });
      const best = scoreInstrument('PROMIS_10', bestResponses);
      expect(best).toBeLessThanOrEqual(80);

      const worstResponses: Record<string, number> = {};
      PROMIS_10.items.forEach((item) => { worstResponses[item.id] = 1; });
      const worst = scoreInstrument('PROMIS_10', worstResponses);
      expect(worst).toBeGreaterThanOrEqual(20);
    });

    it('PROMIS-10 MCID is 3', () => {
      expect(PROMIS_10.mcid).toBe(3);
    });

    it('scorePROMIS10Domain returns separate physical and mental scores', () => {
      const responses: Record<string, number> = {};
      PROMIS_10.items.forEach((item) => { responses[item.id] = 3; });
      const physical = scorePROMIS10Domain(responses, 'physical');
      const mental = scorePROMIS10Domain(responses, 'mental');
      expect(physical).toBeGreaterThanOrEqual(20);
      expect(mental).toBeGreaterThanOrEqual(20);
    });
  });

  describe('MCID thresholds', () => {
    it.each([
      ['KOOS_JR', 14],
      ['HOOS_JR', 18],
      ['ODI', 12.8],
      ['NDI', 7.5],
      ['QUICK_DASH', 8],
      ['PROMIS_10', 3],
    ] as const)('%s has MCID of %d', (id, expectedMcid) => {
      const inst = getInstrument(id);
      expect(inst.mcid).toBe(expectedMcid);
    });

    it('isClinicallySignificant returns true when change meets MCID', () => {
      // KOOS JR MCID = 14
      expect(isClinicallySignificant('KOOS_JR', 50, 65)).toBe(true);
      expect(isClinicallySignificant('KOOS_JR', 50, 64)).toBe(true); // change = 14, exactly MCID
    });

    it('isClinicallySignificant returns false when change below MCID', () => {
      expect(isClinicallySignificant('KOOS_JR', 50, 60)).toBe(false); // change = 10 < 14
    });

    it('isClinicallySignificant works for both improvement and worsening', () => {
      expect(isClinicallySignificant('KOOS_JR', 80, 60)).toBe(true); // decline of 20 > 14
    });
  });

  describe('score interpretation', () => {
    it('KOOS JR 90 is Excellent', () => {
      const interp = interpretScore('KOOS_JR', 90);
      expect(interp.label).toBe('Excellent');
    });

    it('KOOS JR 75 is Good', () => {
      const interp = interpretScore('KOOS_JR', 75);
      expect(interp.label).toBe('Good');
    });

    it('KOOS JR 55 is Fair', () => {
      const interp = interpretScore('KOOS_JR', 55);
      expect(interp.label).toBe('Fair');
    });

    it('KOOS JR 30 is Poor', () => {
      const interp = interpretScore('KOOS_JR', 30);
      expect(interp.label).toBe('Poor');
    });

    it('ODI 10 is Minimal Disability', () => {
      const interp = interpretScore('ODI', 10);
      expect(interp.label).toBe('Minimal Disability');
    });

    it('ODI 90 is Bed-bound', () => {
      const interp = interpretScore('ODI', 90);
      expect(interp.label).toBe('Bed-bound');
    });
  });
});
