/**
 * @solvinghealth/clinical -- Project Memory Layer
 *
 * Layer 2 of the 3-layer agentic memory system.
 * Project memory persists across sessions within a specific
 * project workspace (e.g., a patient case, a clinical study,
 * a care plan development effort).
 *
 * Contains:
 * - Patient-specific clinical context (de-identified)
 * - Accumulated clinical notes and observations
 * - Treatment plan history
 * - Physician review history
 * - Project-specific learned patterns
 *
 * Project memory is READ-WRITE with moderate frequency.
 * Entries can be promoted to global memory when patterns
 * are observed across multiple projects.
 *
 * @module @solvinghealth/clinical/memory/project
 * @license PROPRIETARY -- SEE LICENSE
 */

import { z } from 'zod';

// ─── Types ──────────────────────────────────────────────────

/** A single entry in project memory */
export const ProjectMemoryEntrySchema = z.object({
  /** Unique entry ID */
  id: z.string(),
  /** Project this entry belongs to */
  projectId: z.string(),
  /** Category of the memory */
  category: z.enum([
    'patient_context',
    'clinical_note',
    'treatment_history',
    'review_decision',
    'observation',
    'medication',
    'lab_result',
    'assessment',
    'plan_item',
    'care_team',
  ]),
  /** Memory key (for lookup within the project) */
  key: z.string(),
  /** Memory value */
  value: z.unknown(),
  /** When this entry was created */
  createdAt: z.string().datetime(),
  /** When this entry was last updated */
  updatedAt: z.string().datetime(),
  /** Which session created this entry */
  sessionId: z.string().optional(),
  /** Tags for filtering */
  tags: z.array(z.string()).optional(),
  /** Whether this entry has been promoted to global memory */
  promotedToGlobal: z.boolean().default(false),
  /** Priority: higher priority entries surface first in context */
  priority: z.number().int().min(0).max(10).default(5),
  /** Expiration date (ISO 8601, optional) */
  expiresAt: z.string().datetime().optional(),
});

export type ProjectMemoryEntry = z.infer<typeof ProjectMemoryEntrySchema>;

/** Configuration for project memory */
export interface ProjectMemoryConfig {
  /** Maximum entries per project (default: 5000) */
  maxEntriesPerProject?: number;
  /** Auto-expire entries older than N days (0 = never, default: 0) */
  autoExpireDays?: number;
}

// ─── Project Memory Store ───────────────────────────────────

/**
 * Layer 2: Project Memory Store.
 *
 * Scoped to a specific project (patient case, care plan, etc.).
 * Persists across multiple sessions within that project.
 *
 * @example
 * ```typescript
 * const projectMemory = new ProjectMemoryStore();
 *
 * // Create a project for a patient case
 * projectMemory.set('case-001', {
 *   category: 'patient_context',
 *   key: 'demographics',
 *   value: { age: 67, sex: 'male', conditions: ['Osteoarthritis', 'HTN'] },
 *   priority: 8,
 * });
 *
 * projectMemory.set('case-001', {
 *   category: 'treatment_history',
 *   key: 'physical_therapy_2026',
 *   value: { started: '2026-01-15', provider: 'PT Smith', status: 'ongoing' },
 *   tags: ['msk', 'conservative'],
 * });
 *
 * // Retrieve by project
 * const context = projectMemory.getByProject('case-001');
 * const treatments = projectMemory.getByCategory('case-001', 'treatment_history');
 * ```
 */
export class ProjectMemoryStore {
  private readonly projects = new Map<string, Map<string, ProjectMemoryEntry>>();
  private readonly config: Required<ProjectMemoryConfig>;

  constructor(config?: ProjectMemoryConfig) {
    this.config = {
      maxEntriesPerProject: config?.maxEntriesPerProject ?? 5000,
      autoExpireDays: config?.autoExpireDays ?? 0,
    };
  }

  /**
   * Store or update an entry in a project.
   *
   * @param projectId - The project identifier
   * @param params - Entry data
   * @returns The stored entry
   */
  set(projectId: string, params: {
    category: ProjectMemoryEntry['category'];
    key: string;
    value: unknown;
    sessionId?: string;
    tags?: string[];
    priority?: number;
    expiresAt?: string;
  }): ProjectMemoryEntry {
    if (!this.projects.has(projectId)) {
      this.projects.set(projectId, new Map());
    }

    const project = this.projects.get(projectId)!;
    const existing = project.get(params.key);
    const now = new Date().toISOString();

    const entry: ProjectMemoryEntry = {
      id: existing?.id ?? crypto.randomUUID(),
      projectId,
      category: params.category,
      key: params.key,
      value: params.value,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      sessionId: params.sessionId,
      tags: params.tags ?? existing?.tags,
      promotedToGlobal: existing?.promotedToGlobal ?? false,
      priority: params.priority ?? existing?.priority ?? 5,
      expiresAt: params.expiresAt,
    };

    project.set(params.key, entry);

    // Enforce capacity
    if (project.size > this.config.maxEntriesPerProject) {
      this.pruneProject(projectId);
    }

    return entry;
  }

  /**
   * Get an entry by key within a project.
   */
  get(projectId: string, key: string): ProjectMemoryEntry | undefined {
    return this.projects.get(projectId)?.get(key);
  }

  /**
   * Get all entries for a project, sorted by priority (descending).
   */
  getByProject(projectId: string): ProjectMemoryEntry[] {
    const project = this.projects.get(projectId);
    if (!project) return [];

    const now = new Date().toISOString();
    return [...project.values()]
      .filter(e => !e.expiresAt || e.expiresAt > now)
      .sort((a, b) => b.priority - a.priority);
  }

  /**
   * Get entries in a category within a project.
   */
  getByCategory(projectId: string, category: ProjectMemoryEntry['category']): ProjectMemoryEntry[] {
    return this.getByProject(projectId).filter(e => e.category === category);
  }

  /**
   * Get entries matching tags.
   */
  getByTags(projectId: string, tags: string[]): ProjectMemoryEntry[] {
    return this.getByProject(projectId).filter(
      e => e.tags?.some(t => tags.includes(t))
    );
  }

  /**
   * Search entries within a project.
   */
  search(projectId: string, query: string): ProjectMemoryEntry[] {
    const lower = query.toLowerCase();
    return this.getByProject(projectId).filter(
      e => e.key.toLowerCase().includes(lower) ||
           JSON.stringify(e.value).toLowerCase().includes(lower)
    );
  }

  /**
   * Mark an entry as promoted to global memory.
   */
  markPromoted(projectId: string, key: string): void {
    const entry = this.get(projectId, key);
    if (entry) {
      entry.promotedToGlobal = true;
      entry.updatedAt = new Date().toISOString();
    }
  }

  /**
   * Get entries eligible for promotion to global memory.
   * Criteria: high priority, not already promoted, accessed multiple times.
   */
  getPromotionCandidates(projectId: string): ProjectMemoryEntry[] {
    return this.getByProject(projectId).filter(
      e => !e.promotedToGlobal && e.priority >= 7
    );
  }

  /**
   * Delete an entry.
   */
  delete(projectId: string, key: string): boolean {
    return this.projects.get(projectId)?.delete(key) ?? false;
  }

  /**
   * Delete an entire project.
   */
  deleteProject(projectId: string): boolean {
    return this.projects.delete(projectId);
  }

  /**
   * List all project IDs.
   */
  listProjects(): string[] {
    return [...this.projects.keys()];
  }

  /**
   * Get entry count for a project.
   */
  projectSize(projectId: string): number {
    return this.projects.get(projectId)?.size ?? 0;
  }

  /**
   * Remove expired and lowest-priority entries from a project.
   */
  private pruneProject(projectId: string): void {
    const project = this.projects.get(projectId);
    if (!project) return;

    const now = new Date().toISOString();

    // Remove expired entries
    for (const [key, entry] of project.entries()) {
      if (entry.expiresAt && entry.expiresAt < now) {
        project.delete(key);
      }
    }

    // If still over capacity, remove lowest priority
    if (project.size > this.config.maxEntriesPerProject) {
      const sorted = [...project.entries()]
        .sort(([, a], [, b]) => a.priority - b.priority);

      const excess = project.size - this.config.maxEntriesPerProject;
      for (let i = 0; i < excess; i++) {
        const entry = sorted[i];
        if (entry) {
          project.delete(entry[0]);
        }
      }
    }
  }
}
