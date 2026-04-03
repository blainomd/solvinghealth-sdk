/**
 * @solvinghealth/clinical -- Context Memory Layer
 *
 * Layer 3 of the 3-layer agentic memory system.
 * Context memory is ephemeral, scoped to a single session.
 * It holds the working set of information relevant to the
 * current interaction.
 *
 * Contains:
 * - Current conversation context
 * - Active references from project and global memory
 * - Temporary computations and intermediate results
 * - Session-specific flags and state
 *
 * Context memory is WRITE-HEAVY, READ-HEAVY, and fully
 * disposable. Important entries should be promoted to
 * project memory before the session ends.
 *
 * @module @solvinghealth/clinical/memory/context
 * @license PROPRIETARY -- SEE LICENSE
 */

import { z } from 'zod';

// ─── Types ──────────────────────────────────────────────────

/** A single entry in context memory */
export const ContextMemoryEntrySchema = z.object({
  /** Unique entry ID */
  id: z.string(),
  /** Session this entry belongs to */
  sessionId: z.string(),
  /** Category of the context reference */
  category: z.enum([
    'conversation',
    'reference',
    'computation',
    'flag',
    'state',
    'user_input',
    'agent_output',
    'validation_result',
  ]),
  /** Memory key */
  key: z.string(),
  /** Memory value */
  value: z.unknown(),
  /** When this entry was created */
  createdAt: z.string().datetime(),
  /** Sequence number within the session */
  sequence: z.number().int().nonnegative(),
  /** Whether this entry should be considered for promotion to project memory */
  promotionCandidate: z.boolean().default(false),
  /** TTL in seconds (0 = session lifetime, default: 0) */
  ttl: z.number().int().nonnegative().default(0),
});

export type ContextMemoryEntry = z.infer<typeof ContextMemoryEntrySchema>;

// ─── Context Memory Store ───────────────────────────────────

/**
 * Layer 3: Context Memory Store.
 *
 * Ephemeral, session-scoped memory that holds the working set
 * for the current interaction. Automatically garbage-collected
 * when the session ends or entries expire.
 *
 * @example
 * ```typescript
 * const context = new ContextMemoryStore('session-abc');
 *
 * // Track conversation turns
 * context.set({
 *   category: 'user_input',
 *   key: 'turn_1',
 *   value: 'Patient reports chest pain with exertion',
 * });
 *
 * // Store intermediate computations
 * context.set({
 *   category: 'computation',
 *   key: 'risk_score',
 *   value: { score: 0.73, factors: ['age', 'hypertension', 'exertional_symptoms'] },
 *   promotionCandidate: true, // Mark for promotion to project memory
 * });
 *
 * // Get promotion candidates at end of session
 * const toPromote = context.getPromotionCandidates();
 * ```
 */
export class ContextMemoryStore {
  private readonly entries = new Map<string, ContextMemoryEntry>();
  private sequence = 0;
  private readonly sessionId: string;
  private readonly createdAt: string;
  private readonly maxEntries: number;

  constructor(sessionId: string, maxEntries: number = 1000) {
    this.sessionId = sessionId;
    this.createdAt = new Date().toISOString();
    this.maxEntries = maxEntries;
  }

  /**
   * Store a context entry.
   *
   * @param params - Entry data
   * @returns The stored entry
   */
  set(params: {
    category: ContextMemoryEntry['category'];
    key: string;
    value: unknown;
    promotionCandidate?: boolean;
    ttl?: number;
  }): ContextMemoryEntry {
    this.sequence++;

    const entry: ContextMemoryEntry = {
      id: crypto.randomUUID(),
      sessionId: this.sessionId,
      category: params.category,
      key: params.key,
      value: params.value,
      createdAt: new Date().toISOString(),
      sequence: this.sequence,
      promotionCandidate: params.promotionCandidate ?? false,
      ttl: params.ttl ?? 0,
    };

    this.entries.set(params.key, entry);

    // Enforce capacity (FIFO eviction)
    if (this.entries.size > this.maxEntries) {
      const oldest = [...this.entries.entries()]
        .sort(([, a], [, b]) => a.sequence - b.sequence)[0];
      if (oldest) {
        this.entries.delete(oldest[0]);
      }
    }

    return entry;
  }

  /**
   * Get an entry by key.
   */
  get(key: string): ContextMemoryEntry | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;

    // Check TTL expiration
    if (entry.ttl > 0) {
      const age = (Date.now() - new Date(entry.createdAt).getTime()) / 1000;
      if (age > entry.ttl) {
        this.entries.delete(key);
        return undefined;
      }
    }

    return entry;
  }

  /**
   * Get all entries, ordered by sequence.
   */
  getAll(): ContextMemoryEntry[] {
    this.expireEntries();
    return [...this.entries.values()].sort((a, b) => a.sequence - b.sequence);
  }

  /**
   * Get entries by category.
   */
  getByCategory(category: ContextMemoryEntry['category']): ContextMemoryEntry[] {
    return this.getAll().filter(e => e.category === category);
  }

  /**
   * Get the conversation history (user_input and agent_output entries).
   */
  getConversationHistory(): ContextMemoryEntry[] {
    return this.getAll().filter(
      e => e.category === 'user_input' || e.category === 'agent_output'
    );
  }

  /**
   * Get entries marked as promotion candidates.
   */
  getPromotionCandidates(): ContextMemoryEntry[] {
    return this.getAll().filter(e => e.promotionCandidate);
  }

  /**
   * Build a context window string suitable for injection into an LLM prompt.
   * Returns the most relevant entries formatted for the model.
   *
   * @param maxTokens - Approximate max tokens for the context (rough: 4 chars per token)
   * @returns Formatted context string
   */
  buildContextWindow(maxTokens: number = 2000): string {
    const maxChars = maxTokens * 4;
    const entries = this.getAll();
    const parts: string[] = [];
    let charCount = 0;

    // References first (highest value)
    for (const entry of entries.filter(e => e.category === 'reference')) {
      const line = `[REF] ${entry.key}: ${JSON.stringify(entry.value)}`;
      if (charCount + line.length > maxChars) break;
      parts.push(line);
      charCount += line.length;
    }

    // Then flags/state
    for (const entry of entries.filter(e => e.category === 'flag' || e.category === 'state')) {
      const line = `[STATE] ${entry.key}: ${JSON.stringify(entry.value)}`;
      if (charCount + line.length > maxChars) break;
      parts.push(line);
      charCount += line.length;
    }

    // Then recent conversation
    const conversation = this.getConversationHistory().slice(-10); // Last 10 turns
    for (const entry of conversation) {
      const role = entry.category === 'user_input' ? 'USER' : 'AGENT';
      const line = `[${role}] ${entry.value as string}`;
      if (charCount + line.length > maxChars) break;
      parts.push(line);
      charCount += line.length;
    }

    return parts.join('\n');
  }

  /**
   * Delete an entry.
   */
  delete(key: string): boolean {
    return this.entries.delete(key);
  }

  /**
   * Clear all context memory (end of session).
   */
  clear(): void {
    this.entries.clear();
    this.sequence = 0;
  }

  /**
   * Get session metadata.
   */
  get metadata(): { sessionId: string; createdAt: string; entryCount: number; sequence: number } {
    return {
      sessionId: this.sessionId,
      createdAt: this.createdAt,
      entryCount: this.entries.size,
      sequence: this.sequence,
    };
  }

  /**
   * Remove expired entries.
   */
  private expireEntries(): void {
    const now = Date.now();
    for (const [key, entry] of this.entries.entries()) {
      if (entry.ttl > 0) {
        const age = (now - new Date(entry.createdAt).getTime()) / 1000;
        if (age > entry.ttl) {
          this.entries.delete(key);
        }
      }
    }
  }
}
