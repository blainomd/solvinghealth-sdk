import { describe, it, expect } from 'vitest';
import {
  BILLING_CODES,
  COMPATIBILITY_RULES,
  ICD10_CODES,
  getBillingCode,
  getCodesByCategory,
  getCodesBySystem,
  getICD10Code,
  searchICD10,
  areCodesCompatible,
  getPaymentDollars,
} from '../codes.js';

describe('Billing Codes Registry', () => {
  describe('code format validation', () => {
    it('all CPT codes are 5-digit numeric', () => {
      for (const [key, code] of BILLING_CODES) {
        if (code.system === 'CPT') {
          expect(code.code).toMatch(/^\d{5}$/);
          expect(key).toBe(code.code);
        }
      }
    });

    it('all HCPCS codes start with a letter or are ACCESS codes', () => {
      for (const [key, code] of BILLING_CODES) {
        if (code.system === 'HCPCS') {
          // HCPCS Level II codes start with a letter, or are ACCESS/TEAM custom codes
          expect(code.code).toMatch(/^[A-Z]|^ACCESS/);
          expect(key).toBe(code.code);
        }
      }
    });

    it('every code has a non-empty description', () => {
      for (const [, code] of BILLING_CODES) {
        expect(code.description.length).toBeGreaterThan(0);
      }
    });

    it('every code has at least one provider requirement', () => {
      for (const [, code] of BILLING_CODES) {
        expect(code.providerRequirements.length).toBeGreaterThan(0);
      }
    });
  });

  describe('2026 Medicare payment amounts', () => {
    it('CCM base (99490) payment is in expected range ($50-80)', () => {
      const payment = getPaymentDollars('99490');
      expect(payment).toBeGreaterThanOrEqual(50);
      expect(payment).toBeLessThanOrEqual(80);
    });

    it('RTM device (98977) payment is in expected range ($40-70)', () => {
      const payment = getPaymentDollars('98977');
      expect(payment).toBeGreaterThanOrEqual(40);
      expect(payment).toBeLessThanOrEqual(70);
    });

    it('TCM high-complexity (99496) is the highest-paying single-encounter code', () => {
      const tcm = getPaymentDollars('99496');
      // TCM 99496 should be > $200 (facility)
      expect(tcm).toBeGreaterThan(200);
    });

    it('ACCESS MSK per-beneficiary payment is $180/year', () => {
      const access = getBillingCode('ACCESS_MSK');
      expect(access.paymentCents).toBe(18000);
    });

    it('TEAM bundle payment is $28,000 per episode', () => {
      const team = getBillingCode('ACCESS00590');
      expect(team.paymentCents).toBe(2800000);
    });

    it('all payment amounts are non-negative integers', () => {
      for (const [, code] of BILLING_CODES) {
        expect(code.paymentCents).toBeGreaterThanOrEqual(0);
        expect(Number.isInteger(code.paymentCents)).toBe(true);
      }
    });

    it('non-facility rates are higher than or equal to facility rates where defined', () => {
      for (const [, code] of BILLING_CODES) {
        if (code.paymentNonFacilityCents !== undefined) {
          expect(code.paymentNonFacilityCents).toBeGreaterThanOrEqual(code.paymentCents);
        }
      }
    });

    it('getPaymentDollars returns non-facility rate when requested', () => {
      const facilityRate = getPaymentDollars('99495', true);
      const nonFacilityRate = getPaymentDollars('99495', false);
      expect(nonFacilityRate).toBeGreaterThan(facilityRate);
    });
  });

  describe('code compatibility matrix', () => {
    it('CCM (99490) and RTM (98977) can stack same month', () => {
      const rule = areCodesCompatible('99490', '98977');
      expect(rule).toBeDefined();
      expect(rule!.sameMonthCompatible).toBe(true);
    });

    it('CCM 99490 and 99491 are mutually exclusive', () => {
      const rule = areCodesCompatible('99490', '99491');
      expect(rule).toBeDefined();
      expect(rule!.compatible).toBe(false);
      expect(rule!.sameMonthCompatible).toBe(false);
    });

    it('ACCESS excludes FFS code stacking', () => {
      const rule1 = areCodesCompatible('ACCESS_MSK', '99490');
      expect(rule1).toBeDefined();
      expect(rule1!.compatible).toBe(false);
      expect(rule1!.sameMonthCompatible).toBe(false);

      const rule2 = areCodesCompatible('ACCESS_MSK', '98977');
      expect(rule2).toBeDefined();
      expect(rule2!.compatible).toBe(false);
      expect(rule2!.sameMonthCompatible).toBe(false);
    });

    it('ACP base + add-on can stack on same encounter', () => {
      const rule = areCodesCompatible('99497', '99498');
      expect(rule).toBeDefined();
      expect(rule!.compatible).toBe(true);
      expect(rule!.sameMonthCompatible).toBe(true);
    });

    it('RTM codes stack together for monthly billing', () => {
      const rule = areCodesCompatible('98977', '98980');
      expect(rule).toBeDefined();
      expect(rule!.compatible).toBe(true);
    });

    it('TCM excludes CCM in the same 30-day window', () => {
      const rule = areCodesCompatible('99495', '99490');
      expect(rule).toBeDefined();
      expect(rule!.sameMonthCompatible).toBe(false);
    });

    it('PIN and CHI can stack same month', () => {
      const rule = areCodesCompatible('G0023', 'G0019');
      expect(rule).toBeDefined();
      expect(rule!.sameMonthCompatible).toBe(true);
    });

    it('lookup works in both directions (codeA/codeB reversible)', () => {
      const forward = areCodesCompatible('99490', '98977');
      const reverse = areCodesCompatible('98977', '99490');
      expect(forward).toEqual(reverse);
    });
  });

  describe('ICD-10 code lookups', () => {
    it('M17.11 returns right knee osteoarthritis', () => {
      const code = getICD10Code('M17.11');
      expect(code).toBeDefined();
      expect(code!.description).toContain('right knee');
      expect(code!.category).toBe('Osteoarthritis');
    });

    it('M54.5 returns low back pain', () => {
      const code = getICD10Code('M54.5');
      expect(code).toBeDefined();
      expect(code!.description).toBe('Low back pain');
      expect(code!.specialties).toContain('Orthopedic Surgery');
    });

    it('E11.9 returns type 2 diabetes', () => {
      const code = getICD10Code('E11.9');
      expect(code).toBeDefined();
      expect(code!.description).toContain('Type 2 diabetes');
      expect(code!.specialties).toContain('PCP');
    });

    it('searchICD10 finds osteoarthritis codes', () => {
      const results = searchICD10('osteoarthritis');
      expect(results.length).toBeGreaterThanOrEqual(4);
      results.forEach((r) => {
        expect(r.description.toLowerCase()).toContain('osteoarthritis');
      });
    });

    it('searchICD10 is case-insensitive', () => {
      const upper = searchICD10('BACK PAIN');
      const lower = searchICD10('back pain');
      expect(upper).toEqual(lower);
      expect(upper.length).toBeGreaterThan(0);
    });

    it('returns undefined for unknown ICD-10 code', () => {
      const code = getICD10Code('Z99.99');
      expect(code).toBeUndefined();
    });
  });

  describe('ACCESS bundle codes', () => {
    it('ACCESS_MSK exists and has correct structure', () => {
      const code = getBillingCode('ACCESS_MSK');
      expect(code.system).toBe('HCPCS');
      expect(code.category).toBe('ACCESS');
      expect(code.requiresFaceToFace).toBe(false);
    });

    it('ACCESS_CKM exists and has higher payment than MSK', () => {
      const msk = getBillingCode('ACCESS_MSK');
      const ckm = getBillingCode('ACCESS_CKM');
      expect(ckm.paymentCents).toBeGreaterThan(msk.paymentCents);
    });

    it('ACCESS_ECKM exists', () => {
      const eckm = getBillingCode('ACCESS_ECKM');
      expect(eckm.category).toBe('ACCESS');
    });

    it('all three ACCESS codes exist', () => {
      const accessCodes = getCodesByCategory('ACCESS');
      expect(accessCodes.length).toBe(3);
    });
  });

  describe('lookup helpers', () => {
    it('getBillingCode throws for unknown code', () => {
      expect(() => getBillingCode('FAKE_CODE')).toThrow('not found');
    });

    it('getCodesByCategory returns correct counts', () => {
      const ccmCodes = getCodesByCategory('CCM');
      expect(ccmCodes.length).toBe(3); // 99490, 99439, 99491

      const rtmCodes = getCodesByCategory('RTM');
      expect(rtmCodes.length).toBe(6); // 98975, 98977, 98980, 98981, 99457, 99458
    });

    it('getCodesBySystem separates CPT and HCPCS', () => {
      const cpt = getCodesBySystem('CPT');
      const hcpcs = getCodesBySystem('HCPCS');

      cpt.forEach((c) => expect(c.system).toBe('CPT'));
      hcpcs.forEach((c) => expect(c.system).toBe('HCPCS'));

      expect(cpt.length + hcpcs.length).toBe(BILLING_CODES.size);
    });
  });
});
