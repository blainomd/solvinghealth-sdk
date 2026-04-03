import { describe, it, expect } from 'vitest';
import {
  createSession,
  getNextItem,
  recordResponse,
  completeSession,
  getCompletionStats,
  toFHIRQuestionnaireResponse,
  type SurveySession,
} from '../collector.js';
import { getInstrument } from '../instruments.js';

describe('PROM Collector', () => {
  describe('session creation', () => {
    it('creates a session with correct initial state', () => {
      const session = createSession({
        patientId: 'PAT-001',
        instrumentId: 'KOOS_JR',
      });
      expect(session.patientId).toBe('PAT-001');
      expect(session.instrumentId).toBe('KOOS_JR');
      expect(session.status).toBe('created');
      expect(session.responses).toHaveLength(0);
      expect(session.sessionId).toMatch(/^prom_/);
      expect(session.score).toBeUndefined();
    });

    it('includes provider NPI and encounter ID when provided', () => {
      const session = createSession({
        patientId: 'PAT-002',
        instrumentId: 'ODI',
        providerNPI: '1234567893',
        encounterId: 'ENC-001',
      });
      expect(session.providerNPI).toBe('1234567893');
      expect(session.encounterId).toBe('ENC-001');
    });

    it('throws for unknown instrument', () => {
      expect(() =>
        createSession({ patientId: 'PAT-003', instrumentId: 'FAKE' }),
      ).toThrow('not found');
    });

    it('sets expiry to 72 hours by default', () => {
      const session = createSession({
        patientId: 'PAT-004',
        instrumentId: 'KOOS_JR',
      });
      const created = new Date(session.createdAt);
      const expires = new Date(session.expiresAt);
      const diffHours = (expires.getTime() - created.getTime()) / (1000 * 60 * 60);
      expect(diffHours).toBeCloseTo(72, 0);
    });

    it('supports custom expiry hours', () => {
      const session = createSession({
        patientId: 'PAT-005',
        instrumentId: 'KOOS_JR',
        expiryHours: 24,
      });
      const created = new Date(session.createdAt);
      const expires = new Date(session.expiresAt);
      const diffHours = (expires.getTime() - created.getTime()) / (1000 * 60 * 60);
      expect(diffHours).toBeCloseTo(24, 0);
    });
  });

  describe('response recording and real-time scoring', () => {
    it('records a response and updates status to in_progress', () => {
      let session = createSession({
        patientId: 'PAT-010',
        instrumentId: 'KOOS_JR',
      });
      session = recordResponse(session, 'kj1', 2);
      expect(session.status).toBe('in_progress');
      expect(session.responses).toHaveLength(1);
      expect(session.responses[0]!.itemId).toBe('kj1');
      expect(session.responses[0]!.value).toBe(2);
    });

    it('throws for invalid item ID', () => {
      const session = createSession({
        patientId: 'PAT-011',
        instrumentId: 'KOOS_JR',
      });
      expect(() => recordResponse(session, 'fake_item', 0)).toThrow('not found');
    });

    it('throws for invalid response value', () => {
      const session = createSession({
        patientId: 'PAT-012',
        instrumentId: 'KOOS_JR',
      });
      expect(() => recordResponse(session, 'kj1', 99)).toThrow('Invalid response value');
    });

    it('replaces existing response for same item', () => {
      let session = createSession({
        patientId: 'PAT-013',
        instrumentId: 'KOOS_JR',
      });
      session = recordResponse(session, 'kj1', 2);
      session = recordResponse(session, 'kj1', 4);
      expect(session.responses.filter((r) => r.itemId === 'kj1')).toHaveLength(1);
      expect(session.responses.find((r) => r.itemId === 'kj1')!.value).toBe(4);
    });

    it('auto-completes when all items answered', () => {
      let session = createSession({
        patientId: 'PAT-014',
        instrumentId: 'KOOS_JR',
      });
      const instrument = getInstrument('KOOS_JR');
      for (const item of instrument.items) {
        session = recordResponse(session, item.id, 2);
      }
      expect(session.status).toBe('completed');
      expect(session.score).toBeDefined();
      expect(session.score).toBe(50); // all 2s on 0-4 scale -> 50
      expect(session.completedAt).toBeDefined();
    });

    it('records duration when provided', () => {
      let session = createSession({
        patientId: 'PAT-015',
        instrumentId: 'KOOS_JR',
      });
      session = recordResponse(session, 'kj1', 1, 5000);
      expect(session.responses[0]!.durationMs).toBe(5000);
    });
  });

  describe('completion rate tracking', () => {
    it('reports 0% completion for new session', () => {
      const session = createSession({
        patientId: 'PAT-020',
        instrumentId: 'KOOS_JR',
      });
      const stats = getCompletionStats(session);
      expect(stats.totalItems).toBe(7);
      expect(stats.answeredItems).toBe(0);
      expect(stats.completionRate).toBe(0);
    });

    it('reports partial completion correctly', () => {
      let session = createSession({
        patientId: 'PAT-021',
        instrumentId: 'KOOS_JR',
      });
      session = recordResponse(session, 'kj1', 1);
      session = recordResponse(session, 'kj2', 2);
      const stats = getCompletionStats(session);
      expect(stats.answeredItems).toBe(2);
      // 2/7 = 28.6%
      expect(stats.completionRate).toBeCloseTo(28.6, 0);
    });

    it('estimates remaining time based on average response time', () => {
      let session = createSession({
        patientId: 'PAT-022',
        instrumentId: 'KOOS_JR',
      });
      session = recordResponse(session, 'kj1', 1, 10000);
      session = recordResponse(session, 'kj2', 2, 8000);
      const stats = getCompletionStats(session);
      expect(stats.estimatedTimeRemainingMins).toBeGreaterThan(0);
    });
  });

  describe('FHIR QuestionnaireResponse generation', () => {
    it('generates valid FHIR resource from completed session', () => {
      let session = createSession({
        patientId: 'PAT-030',
        instrumentId: 'HOOS_JR',
        providerNPI: '1234567893',
        encounterId: 'ENC-100',
      });
      const instrument = getInstrument('HOOS_JR');
      for (const item of instrument.items) {
        session = recordResponse(session, item.id, 2);
      }

      const fhir = toFHIRQuestionnaireResponse(session);
      expect(fhir.resourceType).toBe('QuestionnaireResponse');
      expect(fhir.status).toBe('completed');
      expect(fhir.subject.reference).toBe('Patient/PAT-030');
      expect(fhir.subject.type).toBe('Patient');
      expect(fhir.encounter?.reference).toBe('Encounter/ENC-100');
      expect(fhir.author?.reference).toBe('Practitioner/1234567893');
      expect(fhir.item.length).toBe(instrument.items.length);
      expect(fhir.questionnaire).toContain('HOOS_JR');
    });

    it('throws for incomplete session', () => {
      const session = createSession({
        patientId: 'PAT-031',
        instrumentId: 'KOOS_JR',
      });
      expect(() => toFHIRQuestionnaireResponse(session)).toThrow('incomplete');
    });

    it('FHIR items have correct linkId and answer values', () => {
      let session = createSession({
        patientId: 'PAT-032',
        instrumentId: 'HOOS_JR',
      });
      const instrument = getInstrument('HOOS_JR');
      for (const item of instrument.items) {
        session = recordResponse(session, item.id, 3);
      }

      const fhir = toFHIRQuestionnaireResponse(session);
      for (const fhirItem of fhir.item) {
        expect(fhirItem.answer[0]!.valueInteger).toBe(3);
        expect(fhirItem.answer[0]!.valueCoding).toBeDefined();
        expect(fhirItem.answer[0]!.valueCoding!.code).toBe('3');
      }
    });
  });

  describe('skip logic (adaptive testing)', () => {
    it('getNextItem returns the first unanswered item', () => {
      const session = createSession({
        patientId: 'PAT-040',
        instrumentId: 'KOOS_JR',
      });
      const next = getNextItem(session);
      expect(next).toBeDefined();
      expect(next!.id).toBe('kj1');
    });

    it('getNextItem skips answered items', () => {
      let session = createSession({
        patientId: 'PAT-041',
        instrumentId: 'KOOS_JR',
      });
      session = recordResponse(session, 'kj1', 0);
      const next = getNextItem(session);
      expect(next!.id).toBe('kj2');
    });

    it('getNextItem returns null when all items answered', () => {
      let session = createSession({
        patientId: 'PAT-042',
        instrumentId: 'HOOS_JR',
      });
      const instrument = getInstrument('HOOS_JR');
      for (const item of instrument.items) {
        session = recordResponse(session, item.id, 1);
      }
      const next = getNextItem(session);
      expect(next).toBeNull();
    });
  });

  describe('completeSession', () => {
    it('sets status to completed and computes score', () => {
      let session = createSession({
        patientId: 'PAT-050',
        instrumentId: 'ODI',
      });
      const instrument = getInstrument('ODI');
      for (const item of instrument.items) {
        session = recordResponse(session, item.id, 3);
      }
      // Should auto-complete, but if we call manually:
      expect(session.status).toBe('completed');
      expect(session.score).toBe(60); // 3/5 * 100 = 60
      expect(session.interpretation).toBeDefined();
      expect(session.interpretation).toContain('Severe');
    });
  });
});
