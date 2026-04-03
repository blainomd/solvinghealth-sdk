/**
 * @solvinghealth/clinical -- Encounter ID Engine
 *
 * Generates deterministic encounter identifiers that link
 * patient-provider-date-facility across disparate EHR systems.
 *
 * The encounter ID is a SHA-256 hash of normalized components,
 * enabling cross-system deduplication without sharing PHI.
 * Two EHR systems that have the same patient visiting the same
 * provider on the same date will generate the same encounter ID.
 *
 * This is one of SolvingHealth's proprietary intelligence products --
 * the ability to link encounters across Epic, Cerner, athena, and
 * other systems without a master patient index.
 *
 * @module @solvinghealth/clinical/encounter-id
 * @license PROPRIETARY -- SEE LICENSE
 */

import { createHash } from 'node:crypto';
import { z } from 'zod';

// ─── Types ──────────────────────────────────────────────────

/** Components used to generate a deterministic encounter ID */
export const EncounterComponentsSchema = z.object({
  /** Patient identifier (MRN, FHIR ID, or other unique ID) */
  patientId: z.string().min(1),
  /** Patient identifier system (e.g., 'urn:oid:1.2.3.4.5', 'epic', 'cerner') */
  patientIdSystem: z.string().min(1),
  /** Provider NPI (10-digit) */
  providerNpi: z.string().regex(/^\d{10}$/, 'NPI must be 10 digits'),
  /** Encounter date (YYYY-MM-DD) */
  encounterDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
  /** Facility identifier (NPI, CMS certification number, or name) */
  facilityId: z.string().min(1).optional(),
  /** Encounter type (e.g., 'office', 'telehealth', 'inpatient', 'home') */
  encounterType: z.enum(['office', 'telehealth', 'inpatient', 'outpatient', 'emergency', 'home', 'other']).optional(),
  /** Additional disambiguation salt for same-day multiple encounters */
  sequenceNumber: z.number().int().nonnegative().default(0),
});

export type EncounterComponents = z.infer<typeof EncounterComponentsSchema>;

/** A generated encounter ID with metadata */
export interface EncounterID {
  /** The deterministic encounter ID (SHA-256 hex) */
  id: string;
  /** Shortened encounter ID for display (first 12 chars) */
  shortId: string;
  /** The normalized input components used to generate the ID */
  normalizedComponents: NormalizedComponents;
  /** When this ID was generated */
  generatedAt: string;
  /** Version of the ID generation algorithm */
  algorithmVersion: number;
}

/** Normalized components after cleaning */
interface NormalizedComponents {
  patientId: string;
  patientIdSystem: string;
  providerNpi: string;
  encounterDate: string;
  facilityId: string;
  encounterType: string;
  sequenceNumber: number;
}

/** Result of a collision check */
export interface CollisionCheckResult {
  /** Whether a collision was detected */
  hasCollision: boolean;
  /** The colliding encounter ID (if any) */
  collidingId?: string;
  /** Suggested resolution */
  suggestion?: string;
}

// ─── Normalization ──────────────────────────────────────────

/**
 * Normalize encounter components for deterministic hashing.
 * Ensures that equivalent inputs produce the same hash regardless
 * of casing, whitespace, or formatting differences.
 */
function normalizeComponents(components: EncounterComponents): NormalizedComponents {
  return {
    patientId: components.patientId.trim().toLowerCase(),
    patientIdSystem: components.patientIdSystem.trim().toLowerCase(),
    providerNpi: components.providerNpi.trim(),
    encounterDate: components.encounterDate.trim(),
    facilityId: (components.facilityId ?? 'unknown').trim().toLowerCase(),
    encounterType: (components.encounterType ?? 'other').trim().toLowerCase(),
    sequenceNumber: components.sequenceNumber ?? 0,
  };
}

/**
 * Create the canonical string representation for hashing.
 * The format is fixed to ensure determinism across implementations.
 */
function canonicalize(normalized: NormalizedComponents): string {
  return [
    `patient:${normalized.patientIdSystem}|${normalized.patientId}`,
    `provider:${normalized.providerNpi}`,
    `date:${normalized.encounterDate}`,
    `facility:${normalized.facilityId}`,
    `type:${normalized.encounterType}`,
    `seq:${normalized.sequenceNumber}`,
  ].join('\n');
}

// ─── Encounter ID Generator ────────────────────────────────

/** Current algorithm version */
const ALGORITHM_VERSION = 1;

/**
 * Generate a deterministic encounter ID from components.
 *
 * The ID is a SHA-256 hash of normalized patient-provider-date-facility
 * components. Two systems with the same encounter data will produce
 * the same ID, enabling cross-system deduplication.
 *
 * @param components - Encounter components to hash
 * @returns EncounterID with the deterministic hash
 *
 * @example
 * ```typescript
 * const eid = generateEncounterId({
 *   patientId: 'MRN-12345',
 *   patientIdSystem: 'epic',
 *   providerNpi: '1649218389',
 *   encounterDate: '2026-04-03',
 *   facilityId: 'BCH-001',
 *   encounterType: 'office',
 * });
 *
 * console.log(eid.id);      // "a1b2c3d4..." (deterministic SHA-256)
 * console.log(eid.shortId); // "a1b2c3d4e5f6"
 * ```
 */
export function generateEncounterId(components: EncounterComponents): EncounterID {
  const validated = EncounterComponentsSchema.parse(components);
  const normalized = normalizeComponents(validated);
  const canonical = canonicalize(normalized);

  const hash = createHash('sha256')
    .update(`v${ALGORITHM_VERSION}:${canonical}`)
    .digest('hex');

  return {
    id: hash,
    shortId: hash.substring(0, 12),
    normalizedComponents: normalized,
    generatedAt: new Date().toISOString(),
    algorithmVersion: ALGORITHM_VERSION,
  };
}

/**
 * Verify that a given encounter ID matches the expected components.
 *
 * @param encounterId - The encounter ID to verify
 * @param components - The expected components
 * @returns true if the ID matches the components
 */
export function verifyEncounterId(encounterId: string, components: EncounterComponents): boolean {
  const generated = generateEncounterId(components);
  return generated.id === encounterId;
}

/**
 * Encounter ID registry for tracking and deduplication.
 *
 * Maintains an in-memory registry of generated encounter IDs
 * and detects collisions when the same patient-provider-date
 * combination appears multiple times.
 *
 * In production, this would be backed by a database.
 */
export class EncounterIdRegistry {
  private readonly registry = new Map<string, EncounterID>();
  private readonly byPatient = new Map<string, Set<string>>();
  private readonly byProvider = new Map<string, Set<string>>();
  private readonly byDate = new Map<string, Set<string>>();

  /**
   * Register an encounter and check for collisions.
   *
   * @param components - Encounter components
   * @returns The encounter ID and collision check result
   */
  register(components: EncounterComponents): { encounterID: EncounterID; collision: CollisionCheckResult } {
    const eid = generateEncounterId(components);

    // Check for exact collision
    const existing = this.registry.get(eid.id);
    if (existing) {
      return {
        encounterID: existing,
        collision: {
          hasCollision: true,
          collidingId: existing.id,
          suggestion: 'This encounter was already registered. If this is a different encounter on the same day, increment the sequenceNumber.',
        },
      };
    }

    // Register the ID
    this.registry.set(eid.id, eid);

    // Build indices
    const patientKey = `${eid.normalizedComponents.patientIdSystem}|${eid.normalizedComponents.patientId}`;
    if (!this.byPatient.has(patientKey)) {
      this.byPatient.set(patientKey, new Set());
    }
    this.byPatient.get(patientKey)!.add(eid.id);

    if (!this.byProvider.has(eid.normalizedComponents.providerNpi)) {
      this.byProvider.set(eid.normalizedComponents.providerNpi, new Set());
    }
    this.byProvider.get(eid.normalizedComponents.providerNpi)!.add(eid.id);

    if (!this.byDate.has(eid.normalizedComponents.encounterDate)) {
      this.byDate.set(eid.normalizedComponents.encounterDate, new Set());
    }
    this.byDate.get(eid.normalizedComponents.encounterDate)!.add(eid.id);

    return {
      encounterID: eid,
      collision: { hasCollision: false },
    };
  }

  /**
   * Find all encounters for a patient.
   */
  findByPatient(patientId: string, patientIdSystem: string): EncounterID[] {
    const key = `${patientIdSystem.toLowerCase()}|${patientId.toLowerCase()}`;
    const ids = this.byPatient.get(key);
    if (!ids) return [];
    return [...ids].map(id => this.registry.get(id)!).filter(Boolean);
  }

  /**
   * Find all encounters for a provider on a given date.
   */
  findByProviderDate(providerNpi: string, date: string): EncounterID[] {
    const providerIds = this.byProvider.get(providerNpi);
    const dateIds = this.byDate.get(date);
    if (!providerIds || !dateIds) return [];

    const intersection = [...providerIds].filter(id => dateIds.has(id));
    return intersection.map(id => this.registry.get(id)!).filter(Boolean);
  }

  /**
   * Get the total number of registered encounters.
   */
  get size(): number {
    return this.registry.size;
  }

  /**
   * Look up an encounter by its ID.
   */
  get(encounterId: string): EncounterID | undefined {
    return this.registry.get(encounterId);
  }
}
