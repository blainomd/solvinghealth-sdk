/**
 * @solvinghealth/hipaa -- Immutable Audit Log
 *
 * Append-only audit trail with cryptographic hash chain integrity.
 * Each entry includes a SHA-256 hash of the previous entry, creating
 * a tamper-evident chain similar to a blockchain.
 *
 * Entries are stored in JSON Lines format for efficient append operations
 * and streaming reads. The hash chain guarantees that any modification
 * to historical entries is detectable.
 *
 * HIPAA requires audit logs be retained for 6 years minimum.
 * CMS requires 7 years for Medicare-related records.
 *
 * @module @solvinghealth/hipaa/audit-log
 * @license MIT
 */

import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';

// ─── Types ──────────────────────────────────────────────────

/** Actions that can be audited */
export type AuditAction =
  | 'read'
  | 'write'
  | 'update'
  | 'delete'
  | 'export'
  | 'share'
  | 'login'
  | 'logout'
  | 'access_denied'
  | 'phi_detected'
  | 'encryption'
  | 'decryption';

/** Outcome of the audited action */
export type AuditOutcome = 'success' | 'denied' | 'error';

/** Schema for validating audit entry input */
export const AuditEntryInputSchema = z.object({
  /** Actor performing the action (NPI, user ID, or 'system') */
  actor: z.string().min(1),
  /** Role of the actor */
  actorRole: z.string().optional(),
  /** The action performed */
  action: z.nativeEnum({
    read: 'read',
    write: 'write',
    update: 'update',
    delete: 'delete',
    export: 'export',
    share: 'share',
    login: 'login',
    logout: 'logout',
    access_denied: 'access_denied',
    phi_detected: 'phi_detected',
    encryption: 'encryption',
    decryption: 'decryption',
  } as const),
  /** Type of resource accessed */
  resourceType: z.string(),
  /** ID of the resource accessed */
  resourceId: z.string(),
  /** Whether PHI was accessed in this action */
  phiAccessed: z.boolean().default(false),
  /** Which specific PHI fields were accessed */
  phiFields: z.array(z.string()).optional(),
  /** Outcome of the action */
  outcome: z.enum(['success', 'denied', 'error']),
  /** Reason for denial or error */
  reason: z.string().optional(),
  /** IP address of the actor */
  ipAddress: z.string().optional(),
  /** User agent of the actor's client */
  userAgent: z.string().optional(),
  /** Additional metadata */
  metadata: z.record(z.unknown()).optional(),
});

export type AuditEntryInput = z.infer<typeof AuditEntryInputSchema>;

/** A complete audit entry with generated fields */
export interface AuditEntry extends AuditEntryInput {
  /** Unique entry ID */
  id: string;
  /** ISO 8601 timestamp */
  timestamp: string;
  /** SHA-256 hash of this entry's content */
  entryHash: string;
  /** SHA-256 hash of the previous entry (empty string for first entry) */
  previousHash: string;
  /** Sequence number in the chain */
  sequence: number;
}

/** Query filters for searching audit entries */
export interface AuditQueryFilters {
  /** Filter by actor */
  actor?: string;
  /** Filter by action type */
  action?: AuditAction;
  /** Filter by resource type */
  resourceType?: string;
  /** Filter by resource ID */
  resourceId?: string;
  /** Filter by outcome */
  outcome?: AuditOutcome;
  /** Filter entries with PHI access */
  phiAccessed?: boolean;
  /** Start of date range (ISO 8601) */
  startDate?: string;
  /** End of date range (ISO 8601) */
  endDate?: string;
  /** Maximum number of results */
  limit?: number;
  /** Offset for pagination */
  offset?: number;
}

/** Storage backend interface for audit entries */
export interface AuditStore {
  /** Append an entry to the store */
  append(entry: AuditEntry): Promise<void>;
  /** Query entries matching filters */
  query(filters: AuditQueryFilters): Promise<AuditEntry[]>;
  /** Get the last entry (for hash chain) */
  getLastEntry(): Promise<AuditEntry | null>;
  /** Get entry count */
  count(): Promise<number>;
  /** Verify the hash chain integrity */
  verifyChain(startSequence?: number, endSequence?: number): Promise<ChainVerificationResult>;
}

/** Result of hash chain verification */
export interface ChainVerificationResult {
  /** Whether the chain is intact */
  valid: boolean;
  /** Number of entries verified */
  entriesChecked: number;
  /** First broken link (if any) */
  brokenAt?: number;
  /** Description of the break */
  breakDescription?: string;
}

// ─── Hash Functions ─────────────────────────────────────────

/**
 * Compute SHA-256 hash of an audit entry's content.
 * The hash covers all content fields but NOT the hash fields themselves.
 */
function computeEntryHash(entry: Omit<AuditEntry, 'entryHash'>): string {
  const content = JSON.stringify({
    id: entry.id,
    timestamp: entry.timestamp,
    actor: entry.actor,
    actorRole: entry.actorRole,
    action: entry.action,
    resourceType: entry.resourceType,
    resourceId: entry.resourceId,
    phiAccessed: entry.phiAccessed,
    phiFields: entry.phiFields,
    outcome: entry.outcome,
    reason: entry.reason,
    ipAddress: entry.ipAddress,
    userAgent: entry.userAgent,
    metadata: entry.metadata,
    previousHash: entry.previousHash,
    sequence: entry.sequence,
  });

  return createHash('sha256').update(content).digest('hex');
}

// ─── In-Memory Store ────────────────────────────────────────

/**
 * In-memory audit store for development and testing.
 * NOT suitable for production -- use a persistent store.
 */
export class InMemoryAuditStore implements AuditStore {
  private entries: AuditEntry[] = [];

  async append(entry: AuditEntry): Promise<void> {
    this.entries.push(entry);
  }

  async query(filters: AuditQueryFilters): Promise<AuditEntry[]> {
    let results = [...this.entries];

    if (filters.actor) {
      results = results.filter(e => e.actor === filters.actor);
    }
    if (filters.action) {
      results = results.filter(e => e.action === filters.action);
    }
    if (filters.resourceType) {
      results = results.filter(e => e.resourceType === filters.resourceType);
    }
    if (filters.resourceId) {
      results = results.filter(e => e.resourceId === filters.resourceId);
    }
    if (filters.outcome) {
      results = results.filter(e => e.outcome === filters.outcome);
    }
    if (filters.phiAccessed !== undefined) {
      results = results.filter(e => e.phiAccessed === filters.phiAccessed);
    }
    if (filters.startDate) {
      results = results.filter(e => e.timestamp >= filters.startDate!);
    }
    if (filters.endDate) {
      results = results.filter(e => e.timestamp <= filters.endDate!);
    }

    const offset = filters.offset ?? 0;
    const limit = filters.limit ?? 100;
    return results.slice(offset, offset + limit);
  }

  async getLastEntry(): Promise<AuditEntry | null> {
    return this.entries.length > 0 ? this.entries[this.entries.length - 1]! : null;
  }

  async count(): Promise<number> {
    return this.entries.length;
  }

  async verifyChain(startSequence?: number, endSequence?: number): Promise<ChainVerificationResult> {
    const start = startSequence ?? 0;
    const end = endSequence ?? this.entries.length - 1;
    let entriesChecked = 0;

    for (let i = start; i <= end && i < this.entries.length; i++) {
      const entry = this.entries[i]!;
      entriesChecked++;

      // Verify entry hash
      const expectedHash = computeEntryHash({
        ...entry,
      });

      if (entry.entryHash !== expectedHash) {
        return {
          valid: false,
          entriesChecked,
          brokenAt: entry.sequence,
          breakDescription: `Entry ${entry.sequence} hash mismatch: content has been modified`,
        };
      }

      // Verify chain link
      if (i > 0) {
        const prevEntry = this.entries[i - 1]!;
        if (entry.previousHash !== prevEntry.entryHash) {
          return {
            valid: false,
            entriesChecked,
            brokenAt: entry.sequence,
            breakDescription: `Entry ${entry.sequence} previousHash does not match entry ${prevEntry.sequence} entryHash`,
          };
        }
      }
    }

    return { valid: true, entriesChecked };
  }
}

// ─── Audit Logger ───────────────────────────────────────────

/**
 * Immutable, append-only audit logger with cryptographic hash chain.
 *
 * Every entry includes:
 * - Unique ID and ISO 8601 timestamp
 * - Actor (NPI or system), action, resource, outcome
 * - PHI access flag and field list
 * - SHA-256 hash of entry content
 * - SHA-256 hash of previous entry (chain link)
 * - Monotonically increasing sequence number
 *
 * The hash chain makes any tampering with historical entries detectable.
 *
 * @example
 * ```typescript
 * const logger = new AuditLogger(new InMemoryAuditStore());
 *
 * await logger.log({
 *   actor: '1649218389', // NPI
 *   action: 'read',
 *   resourceType: 'Patient',
 *   resourceId: 'patient-123',
 *   phiAccessed: true,
 *   phiFields: ['name', 'dob', 'ssn'],
 *   outcome: 'success',
 * });
 *
 * const entries = await logger.query({ actor: '1649218389' });
 * const integrity = await logger.verifyIntegrity();
 * ```
 */
export class AuditLogger {
  private sequence = 0;
  private lastHash = '';

  constructor(private readonly store: AuditStore) {}

  /**
   * Initialize the logger by loading the last entry from the store.
   * Call this once before logging to resume the hash chain.
   */
  async initialize(): Promise<void> {
    const lastEntry = await this.store.getLastEntry();
    if (lastEntry) {
      this.sequence = lastEntry.sequence;
      this.lastHash = lastEntry.entryHash;
    }
  }

  /**
   * Log an audit entry. The entry is validated, timestamped, hashed,
   * and appended to the store.
   *
   * @param input - The audit entry data
   * @returns The complete audit entry with generated fields
   */
  async log(input: AuditEntryInput): Promise<AuditEntry> {
    // Validate input
    const validated = AuditEntryInputSchema.parse(input);

    this.sequence++;

    const entry: Omit<AuditEntry, 'entryHash'> = {
      ...validated,
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      previousHash: this.lastHash,
      sequence: this.sequence,
    };

    const entryHash = computeEntryHash(entry);
    const completeEntry: AuditEntry = { ...entry, entryHash };

    this.lastHash = entryHash;

    await this.store.append(completeEntry);

    return completeEntry;
  }

  /**
   * Query audit entries matching the given filters.
   */
  async query(filters: AuditQueryFilters): Promise<AuditEntry[]> {
    return this.store.query(filters);
  }

  /**
   * Verify the integrity of the hash chain.
   * Detects any tampering with historical entries.
   */
  async verifyIntegrity(startSequence?: number, endSequence?: number): Promise<ChainVerificationResult> {
    return this.store.verifyChain(startSequence, endSequence);
  }

  /**
   * Get the total number of audit entries.
   */
  async count(): Promise<number> {
    return this.store.count();
  }

  /**
   * Export audit entries as JSON Lines format.
   *
   * @param filters - Optional filters to narrow the export
   * @returns JSON Lines string (one JSON object per line)
   */
  async exportAsJSONLines(filters?: AuditQueryFilters): Promise<string> {
    const entries = await this.store.query(filters ?? { limit: 10_000 });
    return entries.map(e => JSON.stringify(e)).join('\n') + '\n';
  }
}
