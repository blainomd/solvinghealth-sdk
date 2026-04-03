import { describe, it, expect, beforeEach } from 'vitest';
import {
  AuditLogger,
  InMemoryAuditStore,
  type AuditEntryInput,
} from '../audit-log.js';

// ---------------------------------------------------------------------------
// Test Fixtures
// ---------------------------------------------------------------------------

function makeEntry(overrides?: Partial<AuditEntryInput>): AuditEntryInput {
  return {
    actor: '1649218389',
    actorRole: 'physician',
    action: 'read',
    resourceType: 'Patient',
    resourceId: 'patient-123',
    phiAccessed: false,
    outcome: 'success',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Append-Only Behavior
// ---------------------------------------------------------------------------

describe('AuditLogger', () => {
  let store: InMemoryAuditStore;
  let logger: AuditLogger;

  beforeEach(() => {
    store = new InMemoryAuditStore();
    logger = new AuditLogger(store);
  });

  it('appends entries with sequential IDs and timestamps', async () => {
    const entry1 = await logger.log(makeEntry());
    const entry2 = await logger.log(makeEntry({ action: 'write' }));

    expect(entry1.sequence).toBe(1);
    expect(entry2.sequence).toBe(2);
    expect(entry1.timestamp).toBeTruthy();
    expect(entry2.timestamp).toBeTruthy();
    expect(entry1.id).not.toBe(entry2.id);
  });

  it('entries cannot be modified after creation (append-only by design)', async () => {
    const entry = await logger.log(makeEntry());
    const count = await logger.count();
    expect(count).toBe(1);

    // Log another -- previous entry stays intact
    await logger.log(makeEntry({ action: 'write' }));
    const entries = await logger.query({ actor: '1649218389' });
    expect(entries).toHaveLength(2);
    expect(entries[0]!.action).toBe('read');
    expect(entries[1]!.action).toBe('write');
  });

  // ---------------------------------------------------------------------------
  // Hash Chain
  // ---------------------------------------------------------------------------

  it('each entry hash includes previous entry hash', async () => {
    const entry1 = await logger.log(makeEntry());
    const entry2 = await logger.log(makeEntry({ action: 'write' }));
    const entry3 = await logger.log(makeEntry({ action: 'delete' }));

    // First entry has empty previousHash
    expect(entry1.previousHash).toBe('');

    // Subsequent entries chain to the previous
    expect(entry2.previousHash).toBe(entry1.entryHash);
    expect(entry3.previousHash).toBe(entry2.entryHash);

    // Each entry has a unique hash
    expect(entry1.entryHash).not.toBe(entry2.entryHash);
    expect(entry2.entryHash).not.toBe(entry3.entryHash);
  });

  it('verifies an intact hash chain', async () => {
    await logger.log(makeEntry());
    await logger.log(makeEntry({ action: 'write' }));
    await logger.log(makeEntry({ action: 'export' }));

    const verification = await logger.verifyIntegrity();
    expect(verification.valid).toBe(true);
    expect(verification.entriesChecked).toBe(3);
  });

  it('detects tampered entries in the hash chain', async () => {
    await logger.log(makeEntry());
    await logger.log(makeEntry({ action: 'write' }));
    await logger.log(makeEntry({ action: 'export' }));

    // Tamper with the store directly
    const entries = await store.query({ limit: 10 });
    // Mutate entry 1's action (simulating tampering)
    (entries[1] as any).action = 'delete';

    const verification = await store.verifyChain();
    expect(verification.valid).toBe(false);
    expect(verification.brokenAt).toBeDefined();
  });

  // ---------------------------------------------------------------------------
  // JSON Lines Export
  // ---------------------------------------------------------------------------

  it('exports as JSON Lines format', async () => {
    await logger.log(makeEntry());
    await logger.log(makeEntry({ action: 'write' }));

    const jsonLines = await logger.exportAsJSONLines();
    const lines = jsonLines.trim().split('\n');
    expect(lines).toHaveLength(2);

    // Each line should be valid JSON
    for (const line of lines) {
      const parsed = JSON.parse(line);
      expect(parsed.id).toBeTruthy();
      expect(parsed.actor).toBe('1649218389');
      expect(parsed.entryHash).toBeTruthy();
    }
  });

  // ---------------------------------------------------------------------------
  // PHI Access Flag
  // ---------------------------------------------------------------------------

  it('correctly sets PHI access flag', async () => {
    const entry = await logger.log(
      makeEntry({
        phiAccessed: true,
        phiFields: ['name', 'dob', 'ssn'],
      }),
    );
    expect(entry.phiAccessed).toBe(true);
    expect(entry.phiFields).toEqual(['name', 'dob', 'ssn']);
  });

  it('queries PHI-accessed entries', async () => {
    await logger.log(makeEntry({ phiAccessed: false }));
    await logger.log(makeEntry({ phiAccessed: true, phiFields: ['ssn'] }));
    await logger.log(makeEntry({ phiAccessed: true, phiFields: ['dob'] }));

    const phiEntries = await logger.query({ phiAccessed: true });
    expect(phiEntries).toHaveLength(2);
  });

  // ---------------------------------------------------------------------------
  // Query Filters
  // ---------------------------------------------------------------------------

  it('filters by action type', async () => {
    await logger.log(makeEntry({ action: 'read' }));
    await logger.log(makeEntry({ action: 'write' }));
    await logger.log(makeEntry({ action: 'read' }));

    const reads = await logger.query({ action: 'read' });
    expect(reads).toHaveLength(2);
  });

  it('filters by outcome', async () => {
    await logger.log(makeEntry({ outcome: 'success' }));
    await logger.log(makeEntry({ outcome: 'denied' }));

    const denied = await logger.query({ outcome: 'denied' });
    expect(denied).toHaveLength(1);
    expect(denied[0]!.outcome).toBe('denied');
  });

  // ---------------------------------------------------------------------------
  // Initialize (resume chain)
  // ---------------------------------------------------------------------------

  it('initializes from existing store to resume hash chain', async () => {
    await logger.log(makeEntry());
    await logger.log(makeEntry({ action: 'write' }));

    // Create a new logger on the same store
    const newLogger = new AuditLogger(store);
    await newLogger.initialize();

    const entry3 = await newLogger.log(makeEntry({ action: 'export' }));
    expect(entry3.sequence).toBe(3);

    // Verify chain is still intact
    const verification = await store.verifyChain();
    expect(verification.valid).toBe(true);
  });
});
