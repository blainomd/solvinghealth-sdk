import { describe, it, expect } from 'vitest';
import {
  generateEncounterId,
  verifyEncounterId,
  EncounterIdRegistry,
  type EncounterComponents,
} from '../encounter-id.js';

// ---------------------------------------------------------------------------
// Deterministic ID Generation
// ---------------------------------------------------------------------------

describe('generateEncounterId', () => {
  const baseComponents: EncounterComponents = {
    patientId: 'MRN-12345',
    patientIdSystem: 'epic',
    providerNpi: '1649218389',
    encounterDate: '2026-04-03',
    facilityId: 'BCH-001',
    encounterType: 'office',
    sequenceNumber: 0,
  };

  it('produces the same ID for identical inputs', () => {
    const id1 = generateEncounterId(baseComponents);
    const id2 = generateEncounterId(baseComponents);
    expect(id1.id).toBe(id2.id);
    expect(id1.shortId).toBe(id2.shortId);
  });

  it('produces different IDs for different patient IDs', () => {
    const id1 = generateEncounterId(baseComponents);
    const id2 = generateEncounterId({
      ...baseComponents,
      patientId: 'MRN-99999',
    });
    expect(id1.id).not.toBe(id2.id);
  });

  it('produces different IDs for different dates', () => {
    const id1 = generateEncounterId(baseComponents);
    const id2 = generateEncounterId({
      ...baseComponents,
      encounterDate: '2026-04-04',
    });
    expect(id1.id).not.toBe(id2.id);
  });

  it('produces different IDs for different providers', () => {
    const id1 = generateEncounterId(baseComponents);
    const id2 = generateEncounterId({
      ...baseComponents,
      providerNpi: '1234567893',
    });
    expect(id1.id).not.toBe(id2.id);
  });

  it('normalizes casing (case-insensitive patient ID)', () => {
    const id1 = generateEncounterId({
      ...baseComponents,
      patientId: 'MRN-12345',
    });
    const id2 = generateEncounterId({
      ...baseComponents,
      patientId: 'mrn-12345',
    });
    expect(id1.id).toBe(id2.id);
  });

  it('generates a valid SHA-256 hex string (64 characters)', () => {
    const eid = generateEncounterId(baseComponents);
    expect(eid.id).toMatch(/^[a-f0-9]{64}$/);
  });

  it('generates a 12-character short ID', () => {
    const eid = generateEncounterId(baseComponents);
    expect(eid.shortId).toHaveLength(12);
    expect(eid.shortId).toBe(eid.id.substring(0, 12));
  });

  it('includes algorithm version', () => {
    const eid = generateEncounterId(baseComponents);
    expect(eid.algorithmVersion).toBe(1);
  });

  it('includes generatedAt timestamp', () => {
    const eid = generateEncounterId(baseComponents);
    expect(eid.generatedAt).toBeTruthy();
    // Should be a valid ISO string
    expect(() => new Date(eid.generatedAt)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Verify Encounter ID
// ---------------------------------------------------------------------------

describe('verifyEncounterId', () => {
  it('returns true for matching components', () => {
    const components: EncounterComponents = {
      patientId: 'MRN-12345',
      patientIdSystem: 'epic',
      providerNpi: '1649218389',
      encounterDate: '2026-04-03',
      facilityId: 'BCH-001',
      encounterType: 'office',
      sequenceNumber: 0,
    };
    const eid = generateEncounterId(components);
    expect(verifyEncounterId(eid.id, components)).toBe(true);
  });

  it('returns false for non-matching components', () => {
    const components: EncounterComponents = {
      patientId: 'MRN-12345',
      patientIdSystem: 'epic',
      providerNpi: '1649218389',
      encounterDate: '2026-04-03',
      facilityId: 'BCH-001',
      encounterType: 'office',
      sequenceNumber: 0,
    };
    const eid = generateEncounterId(components);
    const altered = { ...components, patientId: 'MRN-00000' };
    expect(verifyEncounterId(eid.id, altered)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Registry & Collision Detection
// ---------------------------------------------------------------------------

describe('EncounterIdRegistry', () => {
  it('detects collision on duplicate registration', () => {
    const registry = new EncounterIdRegistry();
    const components: EncounterComponents = {
      patientId: 'MRN-12345',
      patientIdSystem: 'epic',
      providerNpi: '1649218389',
      encounterDate: '2026-04-03',
      facilityId: 'BCH-001',
      encounterType: 'office',
      sequenceNumber: 0,
    };
    const first = registry.register(components);
    expect(first.collision.hasCollision).toBe(false);

    const second = registry.register(components);
    expect(second.collision.hasCollision).toBe(true);
    expect(second.collision.collidingId).toBe(first.encounterID.id);
  });

  it('no collision with different sequence numbers (same-day multiple encounters)', () => {
    const registry = new EncounterIdRegistry();
    const base: EncounterComponents = {
      patientId: 'MRN-12345',
      patientIdSystem: 'epic',
      providerNpi: '1649218389',
      encounterDate: '2026-04-03',
      facilityId: 'BCH-001',
      encounterType: 'office',
      sequenceNumber: 0,
    };
    const first = registry.register(base);
    const second = registry.register({ ...base, sequenceNumber: 1 });
    expect(first.collision.hasCollision).toBe(false);
    expect(second.collision.hasCollision).toBe(false);
    expect(first.encounterID.id).not.toBe(second.encounterID.id);
  });

  it('cross-system deduplication: same patient data from two systems', () => {
    const registry = new EncounterIdRegistry();
    // Epic system
    const epicResult = registry.register({
      patientId: 'MRN-12345',
      patientIdSystem: 'epic',
      providerNpi: '1649218389',
      encounterDate: '2026-04-03',
      sequenceNumber: 0,
    });
    // Cerner system with same patient
    const cernerResult = registry.register({
      patientId: 'MRN-12345',
      patientIdSystem: 'cerner',
      providerNpi: '1649218389',
      encounterDate: '2026-04-03',
      sequenceNumber: 0,
    });
    // Different patient ID systems = different encounter IDs (expected)
    expect(epicResult.encounterID.id).not.toBe(cernerResult.encounterID.id);
    expect(registry.size).toBe(2);
  });

  it('findByPatient returns correct encounters', () => {
    const registry = new EncounterIdRegistry();
    registry.register({
      patientId: 'MRN-12345',
      patientIdSystem: 'epic',
      providerNpi: '1649218389',
      encounterDate: '2026-04-01',
      sequenceNumber: 0,
    });
    registry.register({
      patientId: 'MRN-12345',
      patientIdSystem: 'epic',
      providerNpi: '1649218389',
      encounterDate: '2026-04-02',
      sequenceNumber: 0,
    });
    registry.register({
      patientId: 'MRN-99999',
      patientIdSystem: 'epic',
      providerNpi: '1649218389',
      encounterDate: '2026-04-01',
      sequenceNumber: 0,
    });

    const encounters = registry.findByPatient('MRN-12345', 'epic');
    expect(encounters).toHaveLength(2);
  });

  it('findByProviderDate returns correct encounters', () => {
    const registry = new EncounterIdRegistry();
    registry.register({
      patientId: 'MRN-001',
      patientIdSystem: 'epic',
      providerNpi: '1649218389',
      encounterDate: '2026-04-03',
      sequenceNumber: 0,
    });
    registry.register({
      patientId: 'MRN-002',
      patientIdSystem: 'epic',
      providerNpi: '1649218389',
      encounterDate: '2026-04-03',
      sequenceNumber: 0,
    });
    registry.register({
      patientId: 'MRN-003',
      patientIdSystem: 'epic',
      providerNpi: '1649218389',
      encounterDate: '2026-04-04',
      sequenceNumber: 0,
    });

    const encounters = registry.findByProviderDate('1649218389', '2026-04-03');
    expect(encounters).toHaveLength(2);
  });
});
