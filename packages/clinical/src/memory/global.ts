/**
 * @solvinghealth/clinical -- Global Memory Layer
 *
 * Layer 1 of the 3-layer agentic memory system.
 * Global memory persists across ALL sessions and ALL contexts.
 * It represents the agent's permanent identity and knowledge.
 *
 * Contains:
 * - Provider credentials and preferences
 * - Organization configuration
 * - Regulatory knowledge (AKS/Stark rules, CMS codes)
 * - Learned patterns from accumulated interactions
 * - Cross-patient clinical knowledge (de-identified)
 *
 * Global memory is READ-HEAVY, WRITE-RARE. Updates happen through
 * explicit promotion from project memory (see manager.ts).
 *
 * @module @solvinghealth/clinical/memory/global
 * @license PROPRIETARY -- SEE LICENSE
 */

import { z } from 'zod';

// ─── Types ──────────────────────────────────────────────────

/** A single entry in global memory */
export const GlobalMemoryEntrySchema = z.object({
  /** Unique entry ID */
  id: z.string(),
  /** Category of the memory */
  category: z.enum([
    'provider_identity',
    'organization',
    'regulatory',
    'clinical_pattern',
    'preference',
    'learned_rule',
  ]),
  /** Memory key (for lookup) */
  key: z.string(),
  /** Memory value (any structured data) */
  value: z.unknown(),
  /** When this memory was created */
  createdAt: z.string().datetime(),
  /** When this memory was last updated */
  updatedAt: z.string().datetime(),
  /** How many times this memory has been accessed */
  accessCount: z.number().int().nonnegative().default(0),
  /** How many times this memory has been reinforced (promoted from project) */
  reinforcementCount: z.number().int().nonnegative().default(0),
  /** Source of the memory (which session/project created it) */
  source: z.string().optional(),
  /** Confidence in this memory (0.0-1.0), increases with reinforcement */
  confidence: z.number().min(0).max(1).default(0.5),
});

export type GlobalMemoryEntry = z.infer<typeof GlobalMemoryEntrySchema>;

/** Configuration for the global memory store */
export interface GlobalMemoryConfig {
  /** Maximum number of entries (default: 10000) */
  maxEntries?: number;
  /** Minimum confidence to retain (entries below this are pruned) */
  minConfidence?: number;
}

// ─── Global Memory Store ────────────────────────────────────

/**
 * Layer 1: Global Memory Store.
 *
 * Persistent across all sessions. Contains the agent's identity,
 * organizational knowledge, and learned patterns.
 *
 * In production, this would be backed by a database. The in-memory
 * implementation here is for development and testing.
 *
 * @example
 * ```typescript
 * const globalMemory = new GlobalMemoryStore();
 *
 * // Store provider identity
 * globalMemory.set({
 *   category: 'provider_identity',
 *   key: 'primary_physician',
 *   value: { npi: '1649218389', name: 'Josh Emdur DO', specialty: 'Internal Medicine' },
 * });
 *
 * // Store a learned clinical pattern
 * globalMemory.set({
 *   category: 'clinical_pattern',
 *   key: 'knee_pain_common_codes',
 *   value: { codes: ['M17.11', 'M17.12', 'M25.561'], frequency: 'high' },
 * });
 *
 * // Retrieve
 * const physician = globalMemory.get('primary_physician');
 * const patterns = globalMemory.getByCategory('clinical_pattern');
 * ```
 */
export class GlobalMemoryStore {
  private readonly entries = new Map<string, GlobalMemoryEntry>();
  private readonly config: Required<GlobalMemoryConfig>;

  constructor(config?: GlobalMemoryConfig) {
    this.config = {
      maxEntries: config?.maxEntries ?? 10_000,
      minConfidence: config?.minConfidence ?? 0.1,
    };
  }

  /**
   * Store or update a global memory entry.
   *
   * @param params - Entry data (id and timestamps are auto-generated)
   * @returns The stored entry
   */
  set(params: {
    category: GlobalMemoryEntry['category'];
    key: string;
    value: unknown;
    source?: string;
    confidence?: number;
  }): GlobalMemoryEntry {
    const existing = this.entries.get(params.key);
    const now = new Date().toISOString();

    const entry: GlobalMemoryEntry = {
      id: existing?.id ?? crypto.randomUUID(),
      category: params.category,
      key: params.key,
      value: params.value,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      accessCount: existing?.accessCount ?? 0,
      reinforcementCount: (existing?.reinforcementCount ?? 0) + (existing ? 1 : 0),
      source: params.source,
      confidence: params.confidence ?? existing?.confidence ?? 0.5,
    };

    // Increase confidence with reinforcement
    if (existing) {
      entry.confidence = Math.min(1.0, entry.confidence + 0.1);
    }

    this.entries.set(params.key, entry);

    // Enforce capacity limit
    if (this.entries.size > this.config.maxEntries) {
      this.prune();
    }

    return entry;
  }

  /**
   * Retrieve a global memory entry by key.
   * Increments the access count.
   *
   * @param key - The memory key
   * @returns The entry, or undefined if not found
   */
  get(key: string): GlobalMemoryEntry | undefined {
    const entry = this.entries.get(key);
    if (entry) {
      entry.accessCount++;
    }
    return entry;
  }

  /**
   * Get all entries in a category.
   */
  getByCategory(category: GlobalMemoryEntry['category']): GlobalMemoryEntry[] {
    return [...this.entries.values()].filter(e => e.category === category);
  }

  /**
   * Search entries by key pattern (substring match).
   */
  search(query: string): GlobalMemoryEntry[] {
    const lower = query.toLowerCase();
    return [...this.entries.values()].filter(
      e => e.key.toLowerCase().includes(lower) ||
           JSON.stringify(e.value).toLowerCase().includes(lower)
    );
  }

  /**
   * Check if a key exists in global memory.
   */
  has(key: string): boolean {
    return this.entries.has(key);
  }

  /**
   * Delete a global memory entry.
   */
  delete(key: string): boolean {
    return this.entries.delete(key);
  }

  /**
   * Get total entry count.
   */
  get size(): number {
    return this.entries.size;
  }

  /**
   * Export all entries (for backup/migration).
   */
  export(): GlobalMemoryEntry[] {
    return [...this.entries.values()];
  }

  /**
   * Import entries (for restore/migration).
   */
  import(entries: GlobalMemoryEntry[]): void {
    for (const entry of entries) {
      this.entries.set(entry.key, entry);
    }
  }

  /**
   * Remove lowest-confidence entries to stay within capacity.
   */
  private prune(): void {
    const sorted = [...this.entries.entries()]
      .sort(([, a], [, b]) => a.confidence - b.confidence);

    const toRemove = sorted.slice(0, Math.floor(this.config.maxEntries * 0.1));
    for (const [key] of toRemove) {
      if ((this.entries.get(key)?.confidence ?? 0) < this.config.minConfidence) {
        this.entries.delete(key);
      }
    }
  }
}
