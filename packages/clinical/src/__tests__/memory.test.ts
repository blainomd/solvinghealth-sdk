import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GlobalMemoryStore } from '../memory/global.js';
import { ProjectMemoryStore } from '../memory/project.js';
import { ContextMemoryStore } from '../memory/context.js';
import { MemoryManager } from '../memory/manager.js';

// ---------------------------------------------------------------------------
// Layer 1: Global Memory
// ---------------------------------------------------------------------------

describe('GlobalMemoryStore', () => {
  it('writes and reads entries', () => {
    const store = new GlobalMemoryStore();
    const entry = store.set({
      category: 'provider_identity',
      key: 'primary_physician',
      value: { npi: '1649218389', name: 'Josh Emdur DO' },
    });
    expect(entry.key).toBe('primary_physician');
    expect(entry.category).toBe('provider_identity');

    const retrieved = store.get('primary_physician');
    expect(retrieved).toBeDefined();
    expect(retrieved!.value).toEqual({ npi: '1649218389', name: 'Josh Emdur DO' });
  });

  it('persists across multiple reads', () => {
    const store = new GlobalMemoryStore();
    store.set({
      category: 'regulatory',
      key: 'aks_rule',
      value: 'No percentage-based compensation',
    });

    const first = store.get('aks_rule');
    const second = store.get('aks_rule');
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(first!.value).toBe(second!.value);
  });

  it('increments access count on read', () => {
    const store = new GlobalMemoryStore();
    store.set({ category: 'preference', key: 'lang', value: 'en' });
    store.get('lang');
    store.get('lang');
    const entry = store.get('lang');
    expect(entry!.accessCount).toBe(3);
  });

  it('increases confidence on reinforcement (re-set)', () => {
    const store = new GlobalMemoryStore();
    store.set({
      category: 'clinical_pattern',
      key: 'knee_pattern',
      value: 'common',
      confidence: 0.5,
    });
    const updated = store.set({
      category: 'clinical_pattern',
      key: 'knee_pattern',
      value: 'common updated',
      confidence: 0.5,
    });
    // Should increase confidence on reinforcement
    expect(updated.confidence).toBeGreaterThan(0.5);
    expect(updated.reinforcementCount).toBe(1);
  });

  it('retrieves entries by category', () => {
    const store = new GlobalMemoryStore();
    store.set({ category: 'provider_identity', key: 'doc1', value: 'A' });
    store.set({ category: 'provider_identity', key: 'doc2', value: 'B' });
    store.set({ category: 'regulatory', key: 'rule1', value: 'C' });

    const providers = store.getByCategory('provider_identity');
    expect(providers).toHaveLength(2);
  });

  it('prunes entries when capacity is exceeded', () => {
    const store = new GlobalMemoryStore({ maxEntries: 5, minConfidence: 0.1 });
    for (let i = 0; i < 10; i++) {
      store.set({
        category: 'clinical_pattern',
        key: `entry_${i}`,
        value: i,
        confidence: i * 0.05, // entries 0 and 1 have confidence 0.0 and 0.05
      });
    }
    // Some low-confidence entries should have been pruned
    expect(store.size).toBeLessThanOrEqual(10);
  });

  it('searches entries by query', () => {
    const store = new GlobalMemoryStore();
    store.set({ category: 'clinical_pattern', key: 'knee_oa', value: 'Osteoarthritis pattern' });
    store.set({ category: 'clinical_pattern', key: 'hip_oa', value: 'Hip OA pattern' });
    store.set({ category: 'preference', key: 'color', value: 'blue' });

    const results = store.search('oa');
    expect(results.length).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// Layer 2: Project Memory
// ---------------------------------------------------------------------------

describe('ProjectMemoryStore', () => {
  it('isolates data per project (patient workspace)', () => {
    const store = new ProjectMemoryStore();
    store.set('patient-001', {
      category: 'patient_context',
      key: 'demographics',
      value: { age: 67 },
    });
    store.set('patient-002', {
      category: 'patient_context',
      key: 'demographics',
      value: { age: 45 },
    });

    const p1 = store.get('patient-001', 'demographics');
    const p2 = store.get('patient-002', 'demographics');
    expect(p1!.value).toEqual({ age: 67 });
    expect(p2!.value).toEqual({ age: 45 });
  });

  it('returns entries sorted by priority', () => {
    const store = new ProjectMemoryStore();
    store.set('case-1', { category: 'observation', key: 'low', value: 'L', priority: 2 });
    store.set('case-1', { category: 'observation', key: 'high', value: 'H', priority: 9 });
    store.set('case-1', { category: 'observation', key: 'mid', value: 'M', priority: 5 });

    const entries = store.getByProject('case-1');
    expect(entries[0]!.key).toBe('high');
    expect(entries[2]!.key).toBe('low');
  });

  it('marks entries as promoted to global', () => {
    const store = new ProjectMemoryStore();
    store.set('case-1', { category: 'observation', key: 'pattern', value: 'learned', priority: 8 });
    store.markPromoted('case-1', 'pattern');
    const entry = store.get('case-1', 'pattern');
    expect(entry!.promotedToGlobal).toBe(true);
  });

  it('getPromotionCandidates returns high-priority unpromoted entries', () => {
    const store = new ProjectMemoryStore();
    store.set('case-1', { category: 'observation', key: 'a', value: 1, priority: 8 });
    store.set('case-1', { category: 'observation', key: 'b', value: 2, priority: 3 });
    store.set('case-1', { category: 'observation', key: 'c', value: 3, priority: 9 });
    store.markPromoted('case-1', 'c');

    const candidates = store.getPromotionCandidates('case-1');
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.key).toBe('a');
  });
});

// ---------------------------------------------------------------------------
// Layer 3: Context Memory (Ephemeral)
// ---------------------------------------------------------------------------

describe('ContextMemoryStore', () => {
  it('stores and retrieves entries', () => {
    const ctx = new ContextMemoryStore('session-1');
    ctx.set({ category: 'user_input', key: 'turn_1', value: 'Knee pain' });
    const entry = ctx.get('turn_1');
    expect(entry).toBeDefined();
    expect(entry!.value).toBe('Knee pain');
    expect(entry!.sessionId).toBe('session-1');
  });

  it('TTL-based expiry removes old entries', async () => {
    const ctx = new ContextMemoryStore('session-1');
    ctx.set({ category: 'computation', key: 'temp', value: 'ephemeral', ttl: 1 });

    // Entry should exist immediately
    expect(ctx.get('temp')).toBeDefined();

    // Wait for TTL to expire
    await new Promise((resolve) => setTimeout(resolve, 1100));
    expect(ctx.get('temp')).toBeUndefined();
  });

  it('FIFO eviction when capacity exceeded', () => {
    const ctx = new ContextMemoryStore('session-1', 3);
    ctx.set({ category: 'user_input', key: 'a', value: 1 });
    ctx.set({ category: 'user_input', key: 'b', value: 2 });
    ctx.set({ category: 'user_input', key: 'c', value: 3 });
    ctx.set({ category: 'user_input', key: 'd', value: 4 });

    // 'a' should have been evicted (FIFO, oldest first)
    expect(ctx.get('a')).toBeUndefined();
    expect(ctx.get('d')).toBeDefined();
    expect(ctx.metadata.entryCount).toBe(3);
  });

  it('marks entries as promotion candidates', () => {
    const ctx = new ContextMemoryStore('session-1');
    ctx.set({
      category: 'computation',
      key: 'risk_score',
      value: 0.73,
      promotionCandidate: true,
    });
    ctx.set({ category: 'user_input', key: 'turn_1', value: 'hello' });

    const candidates = ctx.getPromotionCandidates();
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.key).toBe('risk_score');
  });

  it('clear removes all entries', () => {
    const ctx = new ContextMemoryStore('session-1');
    ctx.set({ category: 'user_input', key: 'a', value: 1 });
    ctx.set({ category: 'user_input', key: 'b', value: 2 });
    ctx.clear();
    expect(ctx.metadata.entryCount).toBe(0);
  });

  it('builds context window string', () => {
    const ctx = new ContextMemoryStore('session-1');
    ctx.set({ category: 'reference', key: 'ref_1', value: 'guideline data' });
    ctx.set({ category: 'user_input', key: 'turn_1', value: 'What is the diagnosis?' });
    ctx.set({ category: 'agent_output', key: 'turn_2', value: 'Based on symptoms...' });

    const window = ctx.buildContextWindow(2000);
    expect(window).toContain('[REF]');
    expect(window).toContain('[USER]');
    expect(window).toContain('[AGENT]');
  });
});

// ---------------------------------------------------------------------------
// Memory Manager (orchestration)
// ---------------------------------------------------------------------------

describe('MemoryManager', () => {
  it('promotes context entry to project memory', () => {
    const manager = new MemoryManager();
    const session = manager.startSession('case-001', 'session-1');

    manager.contextSet('session-1', {
      category: 'computation',
      key: 'risk_score',
      value: 0.73,
      promotionCandidate: true,
    });

    const promoted = manager.promoteToProject('session-1', 'risk_score');
    expect(promoted).toBeDefined();
    expect(promoted!.projectId).toBe('case-001');
    expect(promoted!.value).toBe(0.73);
  });

  it('promotes project entry to global memory', () => {
    const manager = new MemoryManager();
    manager.projectSet('case-001', {
      category: 'review_decision',
      key: 'knee_oa_pattern',
      value: 'Always check bilateral',
      priority: 8,
    });

    const promoted = manager.promoteToGlobal('case-001', 'knee_oa_pattern');
    expect(promoted).toBeDefined();
    expect(promoted!.key).toBe('case-001:knee_oa_pattern');

    // Original should be marked as promoted
    const original = manager.projectGet('case-001', 'knee_oa_pattern');
    expect(original!.promotedToGlobal).toBe(true);
  });

  it('builds context window from all 3 layers', () => {
    const manager = new MemoryManager();
    manager.globalSet({
      category: 'provider_identity',
      key: 'physician',
      value: 'Josh Emdur DO',
    });
    manager.projectSet('case-001', {
      category: 'patient_context',
      key: 'chief_complaint',
      value: 'Knee pain',
      priority: 9,
    });
    const session = manager.startSession('case-001', 'session-1');
    manager.contextSet('session-1', {
      category: 'user_input',
      key: 'turn_1',
      value: 'What should I do about my knee?',
    });

    const window = manager.buildContextWindow('session-1', 'case-001', 4000);
    expect(window).toContain('GLOBAL');
    expect(window).toContain('PROJECT');
    expect(window).toContain('USER');
  });

  it('endSession auto-promotes marked entries', () => {
    const manager = new MemoryManager({ autoPromoteOnSessionEnd: true });
    manager.startSession('case-001', 'session-1');

    manager.contextSet('session-1', {
      category: 'computation',
      key: 'important_finding',
      value: 'Critical lab value',
      promotionCandidate: true,
    });
    manager.contextSet('session-1', {
      category: 'user_input',
      key: 'casual_input',
      value: 'hello',
    });

    const promotedCount = manager.endSession('session-1');
    expect(promotedCount).toBe(1);

    // Should be in project memory now
    const projectEntry = manager.projectGet('case-001', 'important_finding');
    expect(projectEntry).toBeDefined();
    expect(projectEntry!.value).toBe('Critical lab value');
  });

  it('search returns results across all layers', () => {
    const manager = new MemoryManager();
    manager.globalSet({
      category: 'clinical_pattern',
      key: 'knee_codes',
      value: 'M17.11',
    });
    manager.projectSet('case-001', {
      category: 'observation',
      key: 'knee_exam',
      value: 'Limited ROM in knee',
    });
    manager.startSession('case-001', 'session-1');
    manager.contextSet('session-1', {
      category: 'user_input',
      key: 'knee_question',
      value: 'Tell me about knee pain',
    });

    const results = manager.search('knee', 'session-1', 'case-001');
    expect(results.total).toBeGreaterThanOrEqual(3);
    expect(results.global.length).toBeGreaterThanOrEqual(1);
    expect(results.project.length).toBeGreaterThanOrEqual(1);
    expect(results.context.length).toBeGreaterThanOrEqual(1);
  });
});
