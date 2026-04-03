import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  analyzeCodeStacking,
  estimateMaxAnnualRevenue,
  type EncounterInput,
} from '../stacking.js';

// Load test patient journeys
const journeysPath = resolve(__dirname, '../../../../test-data/access-patient-journeys.json');
const journeys: Array<{
  id: string;
  condition: {
    icd10: string;
    icd10Description: string;
    bodyRegion: string;
    chronicity: string;
    severity: string;
  };
  pathway: string;
  billingCodes: Array<{
    code: string;
    description: string;
    frequency: string;
    reimbursement: number;
    annualRevenue: number;
  }>;
}> = JSON.parse(readFileSync(journeysPath, 'utf-8'));

describe('Code Stacking Analysis', () => {
  describe('non-surgical knee patient', () => {
    const kneePatient: EncounterInput = {
      patientId: 'TEST-KNEE-001',
      providerNPI: '1234567893',
      specialty: 'orthopedic_surgery',
      conditions: [
        {
          icd10Code: 'M17.11',
          description: 'Primary osteoarthritis, right knee',
          isChronic: true,
          isMSK: true,
        },
        {
          icd10Code: 'I10',
          description: 'Essential hypertension',
          isChronic: true,
          isMSK: false,
        },
      ],
      currentBilledCodes: [],
      isACCESSPatient: false,
      recentDischarge: false,
      advanceCareNeed: true,
      navigationNeed: true,
    };

    it('identifies RTM codes for MSK patient', () => {
      const analysis = analyzeCodeStacking(kneePatient);
      const rtmCodes = analysis.opportunities.filter((o) => o.category === 'RTM');
      expect(rtmCodes.length).toBeGreaterThanOrEqual(3); // 98975, 98977, 98980, 98981
      expect(rtmCodes.some((o) => o.code === '98977')).toBe(true);
    });

    it('identifies CCM codes for 2+ chronic conditions', () => {
      const analysis = analyzeCodeStacking(kneePatient);
      const ccmCodes = analysis.opportunities.filter((o) => o.category === 'CCM');
      expect(ccmCodes.length).toBe(2); // 99490 + 99439
      expect(ccmCodes.some((o) => o.code === '99490')).toBe(true);
    });

    it('identifies ACP when advance care need flagged', () => {
      const analysis = analyzeCodeStacking(kneePatient);
      const acp = analysis.opportunities.find((o) => o.code === '99497');
      expect(acp).toBeDefined();
    });

    it('identifies PIN when navigation need flagged', () => {
      const analysis = analyzeCodeStacking(kneePatient);
      const pin = analysis.opportunities.find((o) => o.code === 'G0023');
      expect(pin).toBeDefined();
    });

    it('optimized revenue is greater than zero', () => {
      const analysis = analyzeCodeStacking(kneePatient);
      expect(analysis.optimizedMonthlyRevenue).toBeGreaterThan(0);
    });
  });

  describe('surgical hip patient', () => {
    const hipPatient: EncounterInput = {
      patientId: 'TEST-HIP-001',
      providerNPI: '1234567893',
      specialty: 'orthopedic_surgery',
      conditions: [
        {
          icd10Code: 'M16.11',
          description: 'Primary osteoarthritis, right hip',
          isChronic: true,
          isMSK: true,
        },
        {
          icd10Code: 'E11.9',
          description: 'Type 2 diabetes',
          isChronic: true,
          isMSK: false,
        },
      ],
      currentBilledCodes: [],
      isACCESSPatient: false,
      recentDischarge: true,
      daysSinceDischarge: 5,
      caregiverTrainingNeed: true,
    };

    it('identifies TCM high-complexity for recent discharge within 7 days', () => {
      const analysis = analyzeCodeStacking(hipPatient);
      const tcm = analysis.opportunities.find((o) => o.code === '99496');
      expect(tcm).toBeDefined();
      expect(tcm!.category).toBe('TCM');
    });

    it('identifies caregiver training', () => {
      const analysis = analyzeCodeStacking(hipPatient);
      const cg = analysis.opportunities.find((o) => o.code === 'G0136');
      expect(cg).toBeDefined();
    });

    it('produces different code set than non-surgical knee', () => {
      const kneeAnalysis = analyzeCodeStacking({
        patientId: 'TEST-KNEE-002',
        providerNPI: '1234567893',
        specialty: 'orthopedic_surgery',
        conditions: [
          { icd10Code: 'M17.11', description: 'OA knee', isChronic: true, isMSK: true },
          { icd10Code: 'I10', description: 'HTN', isChronic: true, isMSK: false },
        ],
        currentBilledCodes: [],
        isACCESSPatient: false,
      });
      const hipAnalysis = analyzeCodeStacking(hipPatient);

      const kneeCodes = new Set(kneeAnalysis.opportunities.map((o) => o.code));
      const hipCodes = new Set(hipAnalysis.opportunities.map((o) => o.code));

      // Hip should have TCM and caregiver training that knee does not
      expect(hipCodes.has('99496')).toBe(true);
      expect(kneeCodes.has('99496')).toBe(false);
      expect(hipCodes.has('G0136')).toBe(true);
    });
  });

  describe('ACCESS patient exclusion', () => {
    it('returns no opportunities for ACCESS patient', () => {
      const accessPatient: EncounterInput = {
        patientId: 'TEST-ACCESS-001',
        providerNPI: '1234567893',
        specialty: 'orthopedic_surgery',
        conditions: [
          { icd10Code: 'M17.11', description: 'OA knee', isChronic: true, isMSK: true },
          { icd10Code: 'I10', description: 'HTN', isChronic: true, isMSK: false },
        ],
        currentBilledCodes: [],
        isACCESSPatient: true,
      };

      const analysis = analyzeCodeStacking(accessPatient);
      expect(analysis.isACCESSPatient).toBe(true);
      expect(analysis.opportunities.length).toBe(0);
      expect(analysis.optimizedMonthlyRevenue).toBe(0);
      expect(analysis.warnings.length).toBeGreaterThan(0);
      expect(analysis.warnings[0]).toContain('ACCESS');
    });
  });

  describe('missed billing opportunities', () => {
    it('flags missed CCM when RTM is billed but CCM is not', () => {
      const patient: EncounterInput = {
        patientId: 'TEST-MISS-001',
        providerNPI: '1234567893',
        specialty: 'orthopedic_surgery',
        conditions: [
          { icd10Code: 'M17.11', description: 'OA knee', isChronic: true, isMSK: true },
          { icd10Code: 'I10', description: 'HTN', isChronic: true, isMSK: false },
        ],
        currentBilledCodes: ['98977'],
        isACCESSPatient: false,
      };

      const analysis = analyzeCodeStacking(patient);
      expect(analysis.warnings.some((w) => w.includes('missed CCM'))).toBe(true);
    });

    it('flags missed RTM when CCM is billed but RTM is not for MSK patient', () => {
      const patient: EncounterInput = {
        patientId: 'TEST-MISS-002',
        providerNPI: '1234567893',
        specialty: 'orthopedic_surgery',
        conditions: [
          { icd10Code: 'M17.11', description: 'OA knee', isChronic: true, isMSK: true },
          { icd10Code: 'I10', description: 'HTN', isChronic: true, isMSK: false },
        ],
        currentBilledCodes: ['99490'],
        isACCESSPatient: false,
      };

      const analysis = analyzeCodeStacking(patient);
      expect(analysis.warnings.some((w) => w.includes('missed RTM'))).toBe(true);
    });

    it('identifies all new opportunities as missed when nothing is billed', () => {
      const patient: EncounterInput = {
        patientId: 'TEST-MISS-003',
        providerNPI: '1234567893',
        specialty: 'orthopedic_surgery',
        conditions: [
          { icd10Code: 'M17.11', description: 'OA knee', isChronic: true, isMSK: true },
          { icd10Code: 'I10', description: 'HTN', isChronic: true, isMSK: false },
        ],
        currentBilledCodes: [],
        isACCESSPatient: false,
      };

      const analysis = analyzeCodeStacking(patient);
      expect(analysis.missedOpportunities.length).toBe(analysis.opportunities.length);
      expect(analysis.currentMonthlyRevenue).toBe(0);
    });
  });

  describe('revenue comparison (before vs after)', () => {
    it('annual revenue delta equals optimized minus current', () => {
      const patient: EncounterInput = {
        patientId: 'TEST-REV-001',
        providerNPI: '1234567893',
        specialty: 'orthopedic_surgery',
        conditions: [
          { icd10Code: 'M17.11', description: 'OA knee', isChronic: true, isMSK: true },
          { icd10Code: 'I10', description: 'HTN', isChronic: true, isMSK: false },
        ],
        currentBilledCodes: ['99490'],
        isACCESSPatient: false,
      };

      const analysis = analyzeCodeStacking(patient);
      const currentAnnual = analysis.opportunities
        .filter((o) => o.currentlyBilled)
        .reduce((sum, o) => sum + o.annualRevenueDollars, 0);
      const optimizedAnnual = analysis.opportunities
        .reduce((sum, o) => sum + o.annualRevenueDollars, 0);

      expect(analysis.annualRevenueDelta).toBe(optimizedAnnual - currentAnnual);
      expect(analysis.annualRevenueDelta).toBeGreaterThan(0);
    });
  });

  describe('estimateMaxAnnualRevenue', () => {
    it('ACCESS patient returns $180/year', () => {
      const result = estimateMaxAnnualRevenue(true, true, true);
      expect(result.annualRevenue).toBe(180);
      expect(result.breakdown).toHaveProperty('ACCESS_MSK');
    });

    it('non-ACCESS patient with chronic + MSK generates substantial revenue', () => {
      const result = estimateMaxAnnualRevenue(true, true, false);
      // Full stacking should be in the thousands
      expect(result.annualRevenue).toBeGreaterThan(1000);
    });

    it('patient without chronic conditions gets no CCM', () => {
      const result = estimateMaxAnnualRevenue(false, true, false);
      expect(result.breakdown).not.toHaveProperty('CCM (99490)');
    });

    it('patient without MSK conditions gets no RTM', () => {
      const result = estimateMaxAnnualRevenue(true, false, false);
      expect(result.breakdown).not.toHaveProperty('RTM Setup (98975)');
    });
  });

  describe('patient journey test data validation (first 10 patients)', () => {
    const testPatients = journeys.slice(0, 10);

    testPatients.forEach((patient) => {
      it(`${patient.id}: stacking analysis runs without error`, () => {
        const isMSK = ['knee', 'hip', 'spine', 'shoulder', 'ankle', 'elbow'].includes(
          patient.condition.bodyRegion,
        );
        const isChronic = patient.condition.chronicity === 'chronic';

        const input: EncounterInput = {
          patientId: patient.id,
          providerNPI: '1234567893',
          specialty: 'orthopedic_surgery',
          conditions: [
            {
              icd10Code: patient.condition.icd10,
              description: patient.condition.icd10Description,
              isChronic,
              isMSK,
            },
            // Add a second chronic condition for CCM eligibility if chronic
            ...(isChronic
              ? [
                  {
                    icd10Code: 'I10',
                    description: 'Essential hypertension',
                    isChronic: true,
                    isMSK: false,
                    isBehavioralHealth: false,
                  },
                ]
              : []),
          ],
          currentBilledCodes: patient.billingCodes
            .map((b) => b.code)
            .filter((c) => !c.includes('-') && !c.includes('LMN')), // filter custom codes
          isACCESSPatient: patient.billingCodes.some((b) => b.code === 'ACCESS00590'),
        };

        const analysis = analyzeCodeStacking(input);

        expect(analysis.patientId).toBe(patient.id);

        // ACCESS patients should have no FFS opportunities
        if (input.isACCESSPatient) {
          expect(analysis.opportunities.length).toBe(0);
          expect(analysis.isACCESSPatient).toBe(true);
        } else {
          // Non-ACCESS MSK patients should have RTM opportunities
          if (isMSK) {
            const hasRTM = analysis.opportunities.some((o) => o.category === 'RTM');
            expect(hasRTM).toBe(true);
          }
          // Chronic patients with 2+ conditions should have CCM
          if (isChronic) {
            const hasCCM = analysis.opportunities.some((o) => o.category === 'CCM');
            expect(hasCCM).toBe(true);
          }
        }
      });
    });
  });
});
