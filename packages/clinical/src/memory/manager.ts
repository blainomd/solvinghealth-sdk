/**
 * @solvinghealth/clinical -- Memory Manager
 *
 * Orchestrates the 3-layer agentic memory hierarchy:
 * - Layer 1 (Global): permanent identity and cross-project knowledge
 * - Layer 2 (Project): per-patient/per-case workspace
 * - Layer 3 (Context): ephemeral per-session working memory
 *
 * The manager handles:
 * - Memory promotion (context -> project -> global)
 * - Capacity management across all layers
 * - Context window assembly from all three layers
 * - Session lifecycle (start, end, promotion flush)
 *
 * @module @solvinghealth/clinical/memory/manager
 * @license PROPRIETARY -- SEE LICENSE
 */

import { GlobalMemoryStore, type GlobalMemoryEntry } from './global.js';
import { ProjectMemoryStore, type ProjectMemoryEntry } from './project.js';
import { ContextMemoryStore, type ContextMemoryEntry } from './context.js';

// ─── Types ──────────────────────────────────────────────────

/** Configuration for the memory manager */
export interface MemoryManagerConfig {
  /** Maximum global memory entries */
  globalMaxEntries?: number;
  /** Maximum entries per project */
  projectMaxEntries?: number;
  /** Maximum entries per context session */
  contextMaxEntries?: number;
  /** Auto-promote context entries to project on session end */
  autoPromoteOnSessionEnd?: boolean;
  /** Minimum confidence for global promotion */
  globalPromotionThreshold?: number;
}

/** A unified memory query result combining entries from all layers */
export interface UnifiedMemoryResult {
  /** Entries from global memory */
  global: GlobalMemoryEntry[];
  /** Entries from project memory */
  project: ProjectMemoryEntry[];
  /** Entries from context memory */
  context: ContextMemoryEntry[];
  /** Total entries found */
  total: number;
}

/** Session metadata */
export interface SessionInfo {
  /** Session ID */
  sessionId: string;
  /** Associated project ID */
  projectId: string;
  /** When the session started */
  startedAt: string;
  /** Whether the session is active */
  active: boolean;
}

// ─── Memory Manager ────────────────────────────────────────

/**
 * Memory Manager -- orchestrates the 3-layer agentic memory system.
 *
 * Manages the flow of information between ephemeral context memory,
 * persistent project memory, and permanent global memory. Handles
 * promotion logic, capacity management, and context window assembly.
 *
 * @example
 * ```typescript
 * const memory = new MemoryManager();
 *
 * // Start a session for a patient case
 * const session = memory.startSession('case-patient-67', 'session-001');
 *
 * // Store context-level information
 * memory.contextSet('session-001', {
 *   category: 'user_input',
 *   key: 'turn_1',
 *   value: 'Patient reports knee pain after walking',
 * });
 *
 * // Store project-level information
 * memory.projectSet('case-patient-67', {
 *   category: 'patient_context',
 *   key: 'chief_complaint',
 *   value: { complaint: 'Bilateral knee pain', onset: '6 months', aggravating: 'walking' },
 *   priority: 9,
 * });
 *
 * // Build context window for LLM
 * const contextWindow = memory.buildContextWindow('session-001', 'case-patient-67');
 *
 * // End session (auto-promotes marked entries)
 * memory.endSession('session-001');
 * ```
 */
export class MemoryManager {
  public readonly global: GlobalMemoryStore;
  public readonly project: ProjectMemoryStore;
  private readonly sessions = new Map<string, { context: ContextMemoryStore; info: SessionInfo }>();
  private readonly config: Required<MemoryManagerConfig>;

  constructor(config?: MemoryManagerConfig) {
    this.config = {
      globalMaxEntries: config?.globalMaxEntries ?? 10_000,
      projectMaxEntries: config?.projectMaxEntries ?? 5_000,
      contextMaxEntries: config?.contextMaxEntries ?? 1_000,
      autoPromoteOnSessionEnd: config?.autoPromoteOnSessionEnd ?? true,
      globalPromotionThreshold: config?.globalPromotionThreshold ?? 0.8,
    };

    this.global = new GlobalMemoryStore({
      maxEntries: this.config.globalMaxEntries,
    });

    this.project = new ProjectMemoryStore({
      maxEntriesPerProject: this.config.projectMaxEntries,
    });
  }

  // ─── Session Management ─────────────────────────────────

  /**
   * Start a new session.
   *
   * @param projectId - The project to associate with this session
   * @param sessionId - Optional session ID (generated if not provided)
   * @returns Session info
   */
  startSession(projectId: string, sessionId?: string): SessionInfo {
    const id = sessionId ?? crypto.randomUUID();
    const context = new ContextMemoryStore(id, this.config.contextMaxEntries);

    const info: SessionInfo = {
      sessionId: id,
      projectId,
      startedAt: new Date().toISOString(),
      active: true,
    };

    this.sessions.set(id, { context, info });
    return info;
  }

  /**
   * End a session. Optionally promotes marked entries to project memory.
   *
   * @param sessionId - The session to end
   * @returns Number of entries promoted
   */
  endSession(sessionId: string): number {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    let promoted = 0;

    if (this.config.autoPromoteOnSessionEnd) {
      const candidates = session.context.getPromotionCandidates();
      for (const candidate of candidates) {
        this.promoteToProject(sessionId, candidate.key);
        promoted++;
      }
    }

    session.info.active = false;
    session.context.clear();

    return promoted;
  }

  /**
   * Get session info.
   */
  getSession(sessionId: string): SessionInfo | undefined {
    return this.sessions.get(sessionId)?.info;
  }

  /**
   * List active sessions.
   */
  listActiveSessions(): SessionInfo[] {
    return [...this.sessions.values()]
      .filter(s => s.info.active)
      .map(s => s.info);
  }

  // ─── Context Operations ─────────────────────────────────

  /**
   * Set a context memory entry.
   */
  contextSet(sessionId: string, params: Parameters<ContextMemoryStore['set']>[0]): ContextMemoryEntry {
    const session = this.getActiveSession(sessionId);
    return session.context.set(params);
  }

  /**
   * Get a context memory entry.
   */
  contextGet(sessionId: string, key: string): ContextMemoryEntry | undefined {
    const session = this.getActiveSession(sessionId);
    return session.context.get(key);
  }

  // ─── Project Operations ─────────────────────────────────

  /**
   * Set a project memory entry.
   */
  projectSet(projectId: string, params: Parameters<ProjectMemoryStore['set']>[1]): ProjectMemoryEntry {
    return this.project.set(projectId, params);
  }

  /**
   * Get a project memory entry.
   */
  projectGet(projectId: string, key: string): ProjectMemoryEntry | undefined {
    return this.project.get(projectId, key);
  }

  // ─── Global Operations ──────────────────────────────────

  /**
   * Set a global memory entry.
   */
  globalSet(params: Parameters<GlobalMemoryStore['set']>[0]): GlobalMemoryEntry {
    return this.global.set(params);
  }

  /**
   * Get a global memory entry.
   */
  globalGet(key: string): GlobalMemoryEntry | undefined {
    return this.global.get(key);
  }

  // ─── Promotion Logic ───────────────────────────────────

  /**
   * Promote a context entry to project memory.
   *
   * @param sessionId - The session containing the entry
   * @param key - The entry key to promote
   * @returns The project memory entry
   */
  promoteToProject(sessionId: string, key: string): ProjectMemoryEntry | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) return undefined;

    const entry = session.context.get(key);
    if (!entry) return undefined;

    const projectEntry = this.project.set(session.info.projectId, {
      category: this.mapContextToProjectCategory(entry.category),
      key: entry.key,
      value: entry.value,
      sessionId,
      priority: entry.promotionCandidate ? 7 : 5,
    });

    return projectEntry;
  }

  /**
   * Promote a project entry to global memory.
   * Only entries with sufficient reinforcement should be promoted.
   *
   * @param projectId - The project containing the entry
   * @param key - The entry key to promote
   * @returns The global memory entry
   */
  promoteToGlobal(projectId: string, key: string): GlobalMemoryEntry | undefined {
    const entry = this.project.get(projectId, key);
    if (!entry) return undefined;

    const globalEntry = this.global.set({
      category: this.mapProjectToGlobalCategory(entry.category),
      key: `${projectId}:${entry.key}`,
      value: entry.value,
      source: projectId,
    });

    this.project.markPromoted(projectId, key);

    return globalEntry;
  }

  // ─── Context Window Assembly ────────────────────────────

  /**
   * Build a complete context window from all three memory layers.
   *
   * Priority order:
   * 1. Global identity/config (always included)
   * 2. Project-level patient context (high priority)
   * 3. Session context (recent conversation, computations)
   *
   * @param sessionId - The current session
   * @param projectId - The current project
   * @param maxTokens - Approximate max tokens (4 chars per token)
   * @returns Formatted context string for LLM injection
   */
  buildContextWindow(sessionId: string, projectId: string, maxTokens: number = 4000): string {
    const maxChars = maxTokens * 4;
    const parts: string[] = [];
    let charCount = 0;

    // 1. Global identity (allocate 20% of budget)
    const globalBudget = Math.floor(maxChars * 0.2);
    const globalEntries = this.global.getByCategory('provider_identity')
      .concat(this.global.getByCategory('organization'))
      .concat(this.global.getByCategory('preference'));

    for (const entry of globalEntries) {
      const line = `[GLOBAL:${entry.category}] ${entry.key}: ${JSON.stringify(entry.value)}`;
      if (charCount + line.length > globalBudget) break;
      parts.push(line);
      charCount += line.length;
    }

    // 2. Project context (allocate 40% of budget)
    const projectBudget = Math.floor(maxChars * 0.4) + charCount;
    const projectEntries = this.project.getByProject(projectId);

    for (const entry of projectEntries) {
      const line = `[PROJECT:${entry.category}] ${entry.key}: ${JSON.stringify(entry.value)}`;
      if (charCount + line.length > projectBudget) break;
      parts.push(line);
      charCount += line.length;
    }

    // 3. Session context (remaining budget)
    const session = this.sessions.get(sessionId);
    if (session) {
      const remaining = maxChars - charCount;
      const contextStr = session.context.buildContextWindow(Math.floor(remaining / 4));
      if (contextStr) {
        parts.push(contextStr);
      }
    }

    return parts.join('\n');
  }

  /**
   * Search across all memory layers.
   */
  search(query: string, sessionId?: string, projectId?: string): UnifiedMemoryResult {
    const globalResults = this.global.search(query);
    const projectResults = projectId ? this.project.search(projectId, query) : [];

    let contextResults: ContextMemoryEntry[] = [];
    if (sessionId) {
      const session = this.sessions.get(sessionId);
      if (session) {
        contextResults = session.context.getAll().filter(
          e => e.key.toLowerCase().includes(query.toLowerCase()) ||
               JSON.stringify(e.value).toLowerCase().includes(query.toLowerCase())
        );
      }
    }

    return {
      global: globalResults,
      project: projectResults,
      context: contextResults,
      total: globalResults.length + projectResults.length + contextResults.length,
    };
  }

  // ─── Private Helpers ────────────────────────────────────

  private getActiveSession(sessionId: string): { context: ContextMemoryStore; info: SessionInfo } {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    if (!session.info.active) {
      throw new Error(`Session ${sessionId} is no longer active`);
    }
    return session;
  }

  private mapContextToProjectCategory(
    category: ContextMemoryEntry['category'],
  ): ProjectMemoryEntry['category'] {
    const mapping: Record<string, ProjectMemoryEntry['category']> = {
      'conversation': 'clinical_note',
      'reference': 'patient_context',
      'computation': 'assessment',
      'flag': 'observation',
      'state': 'observation',
      'user_input': 'clinical_note',
      'agent_output': 'clinical_note',
      'validation_result': 'assessment',
    };
    return mapping[category] ?? 'observation';
  }

  private mapProjectToGlobalCategory(
    category: ProjectMemoryEntry['category'],
  ): GlobalMemoryEntry['category'] {
    const mapping: Record<string, GlobalMemoryEntry['category']> = {
      'patient_context': 'clinical_pattern',
      'clinical_note': 'clinical_pattern',
      'treatment_history': 'clinical_pattern',
      'review_decision': 'learned_rule',
      'observation': 'clinical_pattern',
      'medication': 'clinical_pattern',
      'lab_result': 'clinical_pattern',
      'assessment': 'clinical_pattern',
      'plan_item': 'clinical_pattern',
      'care_team': 'organization',
    };
    return mapping[category] ?? 'clinical_pattern';
  }
}
