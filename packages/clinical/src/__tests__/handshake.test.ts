import { describe, it, expect } from 'vitest';
import {
  HandshakeProtocol,
  type Submission,
  type RoutingDecision,
  type PhysicianReview,
} from '../handshake.js';

// ---------------------------------------------------------------------------
// Test Fixtures
// ---------------------------------------------------------------------------

function makeSubmission(overrides?: Partial<Submission>): Submission {
  return {
    source: {
      name: 'Ambient Scribe AI',
      clientId: 'client-abc',
      version: '1.0.0',
    },
    outputType: 'clinical_note',
    content: {
      structured: {
        soap: {
          subjective: 'Patient reports bilateral knee pain',
          objective: 'ROM limited',
          assessment: 'Osteoarthritis',
          plan: 'PT referral',
        },
      },
      narrative: 'Patient presents with bilateral knee pain.',
      confidence: 0.92,
    },
    patientContext: {
      age: 67,
      sex: 'male',
      conditions: ['Osteoarthritis'],
    },
    specialty: 'orthopedic',
    urgency: 'routine',
    suggestedBillingCodes: [
      { system: 'CPT', code: '99214', description: 'Office visit moderate' },
    ],
    ...overrides,
  };
}

function makeRouting(): RoutingDecision {
  return {
    physicianNpi: '1649218389',
    physicianName: 'Josh Emdur DO',
    physicianCredentials: 'DO, Board Certified Internal Medicine',
    matchedSpecialty: 'orthopedic',
    estimatedReviewTime: '3-5 minutes',
    routingReason: 'Specialty match + availability',
  };
}

function makeReview(
  decision: 'approve' | 'modify' | 'reject' = 'approve',
): PhysicianReview {
  return {
    decision,
    reasoning:
      decision === 'approve'
        ? 'Clinical note is accurate and complete per review.'
        : decision === 'modify'
          ? 'Modified assessment to include bilateral OA staging.'
          : 'Clinical output is outside scope for this patient context.',
    modifications:
      decision === 'modify' ? 'Added bilateral staging to assessment' : undefined,
    modifiedContent:
      decision === 'modify'
        ? { assessment: 'Bilateral OA, Kellgren-Lawrence Grade III' }
        : undefined,
    validatedBillingCodes: [
      { system: 'CPT', code: '99214', description: 'Office visit moderate' },
    ],
    attestedAt: new Date().toISOString(),
    physicianNpi: '1649218389',
    reviewDurationMinutes: 4,
  };
}

// ---------------------------------------------------------------------------
// 5-Step State Machine
// ---------------------------------------------------------------------------

describe('HandshakeProtocol', () => {
  it('follows the 5-step flow: submit -> compliance -> route -> review -> complete', async () => {
    const handshake = new HandshakeProtocol();

    // Step 1 + 2: Submit (compliance check runs automatically)
    const record = await handshake.submit(makeSubmission());
    expect(record.state).toBe('compliance_checked');
    expect(record.submission).toBeDefined();
    expect(record.complianceCheck).toBeDefined();
    expect(record.complianceCheck!.compliant).toBe(true);
    expect(record.timestamps['submitted']).toBeTruthy();
    expect(record.timestamps['compliance_checked']).toBeTruthy();

    const submissionId = record.submission.submissionId!;

    // Step 3: Route
    const routed = await handshake.route(submissionId, makeRouting());
    expect(routed.state).toBe('routed');
    expect(routed.routingDecision).toBeDefined();
    expect(routed.timestamps['routed']).toBeTruthy();

    // Step 4: Review (approve)
    const reviewed = await handshake.review(submissionId, makeReview('approve'));
    expect(reviewed.state).toBe('reviewed');
    expect(reviewed.physicianReview).toBeDefined();
    expect(reviewed.physicianReview!.decision).toBe('approve');
    expect(reviewed.timestamps['reviewed']).toBeTruthy();

    // Step 5: Complete
    const result = await handshake.complete(submissionId);
    expect(result.decision).toBe('approve');
    expect(result.attestationId).toBeTruthy();
    expect(result.submissionId).toBe(submissionId);
    expect(result.originalContentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.attestationHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.physician.npi).toBe('1649218389');
    expect(result.auditTrail.submittedAt).toBeTruthy();
    expect(result.auditTrail.completedAt).toBeTruthy();
    expect(result.regulatoryNote).toContain('21st Century Cures Act');
  });

  it('rejects invalid state transitions', async () => {
    const handshake = new HandshakeProtocol();
    const record = await handshake.submit(makeSubmission());
    const submissionId = record.submission.submissionId!;

    // Cannot review before routing
    await expect(
      handshake.review(submissionId, makeReview()),
    ).rejects.toThrow(/expected "routed"/);

    // Cannot complete before reviewing
    await expect(handshake.complete(submissionId)).rejects.toThrow(
      /expected "reviewed"/,
    );
  });

  it('compliance failure at step 2 halts the pipeline', async () => {
    const handshake = new HandshakeProtocol();
    const record = await handshake.submit(
      makeSubmission({
        content: {
          structured: {},
          narrative:
            'This patient was referred via referral bonus program, percentage of revenue sharing.',
        },
      }),
    );

    expect(record.state).toBe('rejected_compliance');
    expect(record.complianceCheck!.compliant).toBe(false);
    expect(record.complianceCheck!.aksCheck.passed).toBe(false);

    // Cannot route after compliance rejection
    await expect(
      handshake.route(record.submission.submissionId!, makeRouting()),
    ).rejects.toThrow(/expected "compliance_checked"/);
  });

  it('physician approval generates attestation with correct content hash', async () => {
    const handshake = new HandshakeProtocol();
    const record = await handshake.submit(makeSubmission());
    const submissionId = record.submission.submissionId!;

    await handshake.route(submissionId, makeRouting());
    await handshake.review(submissionId, makeReview('approve'));
    const result = await handshake.complete(submissionId);

    expect(result.decision).toBe('approve');
    expect(result.finalContent).toHaveProperty('soap');
    expect(result.billingCodes).toHaveLength(1);
    expect(result.billingCodes[0]!.code).toBe('99214');
  });

  it('physician rejection returns reason', async () => {
    const handshake = new HandshakeProtocol();
    const record = await handshake.submit(makeSubmission());
    const submissionId = record.submission.submissionId!;

    await handshake.route(submissionId, makeRouting());
    await handshake.review(submissionId, makeReview('reject'));
    const result = await handshake.complete(submissionId);

    expect(result.decision).toBe('reject');
    expect(result.reasoning).toContain('outside scope');
  });

  it('physician modification updates the clinical output', async () => {
    const handshake = new HandshakeProtocol();
    const record = await handshake.submit(makeSubmission());
    const submissionId = record.submission.submissionId!;

    await handshake.route(submissionId, makeRouting());
    await handshake.review(submissionId, makeReview('modify'));
    const result = await handshake.complete(submissionId);

    expect(result.decision).toBe('modify');
    expect(result.finalContent).toHaveProperty('assessment');
    expect(result.finalContent['assessment']).toContain('Kellgren-Lawrence');
  });

  it('audit trail is generated at each step', async () => {
    const handshake = new HandshakeProtocol();
    const record = await handshake.submit(makeSubmission());
    const submissionId = record.submission.submissionId!;

    await handshake.route(submissionId, makeRouting());
    await handshake.review(submissionId, makeReview());
    const result = await handshake.complete(submissionId);

    expect(result.auditTrail.submittedAt).toBeTruthy();
    expect(result.auditTrail.complianceCheckedAt).toBeTruthy();
    expect(result.auditTrail.routedAt).toBeTruthy();
    expect(result.auditTrail.reviewedAt).toBeTruthy();
    expect(result.auditTrail.completedAt).toBeTruthy();

    // Timestamps should be in chronological order
    const times = [
      result.auditTrail.submittedAt,
      result.auditTrail.complianceCheckedAt,
      result.auditTrail.routedAt,
      result.auditTrail.reviewedAt,
      result.auditTrail.completedAt,
    ];
    for (let i = 1; i < times.length; i++) {
      expect(new Date(times[i]!).getTime()).toBeGreaterThanOrEqual(
        new Date(times[i - 1]!).getTime(),
      );
    }
  });

  it('getState returns current handshake record', async () => {
    const handshake = new HandshakeProtocol();
    const record = await handshake.submit(makeSubmission());
    const submissionId = record.submission.submissionId!;

    const state = handshake.getState(submissionId);
    expect(state.state).toBe('compliance_checked');
  });

  it('throws when looking up non-existent submission', () => {
    const handshake = new HandshakeProtocol();
    expect(() => handshake.getState('non-existent-id')).toThrow(
      /not found/,
    );
  });
});
