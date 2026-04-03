import { describe, it, expect } from 'vitest';
import {
  PolicyDecisionEngine,
  canAccess,
  type AccessContext,
} from '../abac.js';
import type {
  WorkOSUser,
  ResourceDescriptor,
} from '../workos-types.js';

// ---------------------------------------------------------------------------
// Test Fixtures
// ---------------------------------------------------------------------------

function makeUser(
  overrides?: Partial<WorkOSUser>,
): WorkOSUser {
  return {
    id: 'user-001',
    email: 'test@solvinghealth.com',
    firstName: 'Test',
    lastName: 'User',
    organizationId: 'org-001',
    role: 'surgeon',
    workosRole: 'surgeon',
    profilePictureUrl: null,
    emailVerified: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeResource(
  overrides?: Partial<ResourceDescriptor>,
): ResourceDescriptor {
  return {
    type: 'patient_record',
    sensitivity: 'phi_full',
    ownerId: 'user-001',
    organizationId: 'org-001',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Surgeon Role
// ---------------------------------------------------------------------------

describe('Surgeon access', () => {
  const engine = new PolicyDecisionEngine();
  const surgeon = makeUser({ role: 'surgeon', id: 'surgeon-001' });

  it('can access own patient PHI', () => {
    const resource = makeResource({
      sensitivity: 'phi_full',
      ownerId: 'surgeon-001',
      organizationId: 'org-001',
    });
    const decision = engine.evaluate(surgeon, resource, 'read');
    expect(decision.allowed).toBe(true);
    expect(decision.obligations).toContain('audit_log_required');
  });

  it('cannot access non-patient PHI (different owner)', () => {
    const resource = makeResource({
      sensitivity: 'phi_full',
      ownerId: 'other-surgeon-999',
      organizationId: 'org-001',
    });
    const decision = engine.evaluate(surgeon, resource, 'read');
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain('non-panel');
  });

  it('can list non-panel PHI but gets redacted view', () => {
    const resource = makeResource({
      sensitivity: 'phi_full',
      ownerId: 'other-surgeon-999',
      organizationId: 'org-001',
    });
    const decision = engine.evaluate(surgeon, resource, 'list');
    expect(decision.allowed).toBe(true);
    expect(decision.redactionLevel).toBe('partial');
  });

  it('cannot delete PHI full records', () => {
    const resource = makeResource({
      sensitivity: 'phi_full',
      ownerId: 'surgeon-001',
      organizationId: 'org-001',
    });
    const decision = engine.evaluate(surgeon, resource, 'delete');
    expect(decision.allowed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Physician Reviewer Role
// ---------------------------------------------------------------------------

describe('Physician Reviewer access', () => {
  const engine = new PolicyDecisionEngine();
  const reviewer = makeUser({ role: 'physician_reviewer', id: 'reviewer-001' });

  it('has review-only access to assigned documents', () => {
    const resource = makeResource({
      sensitivity: 'phi_full',
      organizationId: 'org-001',
    });
    const decision = engine.evaluate(reviewer, resource, 'review');
    expect(decision.allowed).toBe(true);
    expect(decision.obligations).toContain('audit_log_required');
  });

  it('can sign PHI full documents', () => {
    const resource = makeResource({
      sensitivity: 'phi_full',
      organizationId: 'org-001',
    });
    const decision = engine.evaluate(reviewer, resource, 'sign');
    expect(decision.allowed).toBe(true);
  });

  it('cannot write to PHI full records', () => {
    const resource = makeResource({
      sensitivity: 'phi_full',
      organizationId: 'org-001',
    });
    const decision = engine.evaluate(reviewer, resource, 'write');
    expect(decision.allowed).toBe(false);
  });

  it('cannot export PHI full records', () => {
    const resource = makeResource({
      sensitivity: 'phi_full',
      organizationId: 'org-001',
    });
    const decision = engine.evaluate(reviewer, resource, 'export');
    expect(decision.allowed).toBe(false);
  });

  it('cannot list PHI full records', () => {
    const resource = makeResource({
      sensitivity: 'phi_full',
      organizationId: 'org-001',
    });
    const decision = engine.evaluate(reviewer, resource, 'list');
    expect(decision.allowed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Caregiver Role
// ---------------------------------------------------------------------------

describe('Caregiver access', () => {
  const engine = new PolicyDecisionEngine();
  const caregiver = makeUser({ role: 'caregiver', id: 'caregiver-001' });

  it('has task-only, redacted access to PHI limited', () => {
    const resource = makeResource({
      sensitivity: 'phi_limited',
      organizationId: 'org-001',
    });
    const decision = engine.evaluate(caregiver, resource, 'read');
    expect(decision.allowed).toBe(true);
    expect(decision.redactionLevel).toBe('partial');
  });

  it('cannot access PHI full records at all', () => {
    const resource = makeResource({
      sensitivity: 'phi_full',
      organizationId: 'org-001',
    });
    const readDecision = engine.evaluate(caregiver, resource, 'read');
    expect(readDecision.allowed).toBe(false);

    const writeDecision = engine.evaluate(caregiver, resource, 'write');
    expect(writeDecision.allowed).toBe(false);
  });

  it('can read internal resources', () => {
    const resource = makeResource({
      sensitivity: 'internal',
      organizationId: 'org-001',
    });
    const decision = engine.evaluate(caregiver, resource, 'read');
    expect(decision.allowed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Family Member Role
// ---------------------------------------------------------------------------

describe('Family Member access', () => {
  const engine = new PolicyDecisionEngine();
  const familyMember = makeUser({
    role: 'family_member',
    id: 'family-001',
  });

  it('read-only own family data (PHI limited)', () => {
    const resource = makeResource({
      sensitivity: 'phi_limited',
      ownerId: 'family-001',
      organizationId: 'org-001',
    });
    const decision = engine.evaluate(familyMember, resource, 'read');
    expect(decision.allowed).toBe(true);
    expect(decision.redactionLevel).toBe('partial');
  });

  it('cannot access another family profile', () => {
    const resource = makeResource({
      sensitivity: 'phi_limited',
      ownerId: 'other-family-999',
      patientId: 'patient-999',
      organizationId: 'org-001',
    });
    const decision = engine.evaluate(familyMember, resource, 'read');
    expect(decision.allowed).toBe(false);
  });

  it('cannot write to any PHI', () => {
    const resource = makeResource({
      sensitivity: 'phi_limited',
      ownerId: 'family-001',
      organizationId: 'org-001',
    });
    const decision = engine.evaluate(familyMember, resource, 'write');
    expect(decision.allowed).toBe(false);
  });

  it('cannot access PHI full', () => {
    const resource = makeResource({
      sensitivity: 'phi_full',
      ownerId: 'family-001',
      organizationId: 'org-001',
    });
    const decision = engine.evaluate(familyMember, resource, 'read');
    expect(decision.allowed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Developer Role
// ---------------------------------------------------------------------------

describe('Developer access', () => {
  const engine = new PolicyDecisionEngine();
  const developer = makeUser({ role: 'developer', id: 'dev-001' });

  it('gets redacted PHI (sandbox only)', () => {
    const resource = makeResource({
      sensitivity: 'phi_full',
      organizationId: 'org-001',
    });
    const decision = engine.evaluate(developer, resource, 'read');
    expect(decision.allowed).toBe(true);
    expect(decision.redactionLevel).toBe('partial');
  });

  it('cannot write to PHI', () => {
    const resource = makeResource({
      sensitivity: 'phi_full',
      organizationId: 'org-001',
    });
    const decision = engine.evaluate(developer, resource, 'write');
    expect(decision.allowed).toBe(false);
  });

  it('cannot export PHI', () => {
    const resource = makeResource({
      sensitivity: 'phi_full',
      organizationId: 'org-001',
    });
    const decision = engine.evaluate(developer, resource, 'export');
    expect(decision.allowed).toBe(false);
  });

  it('full access to public resources', () => {
    const resource = makeResource({
      sensitivity: 'public',
      organizationId: 'org-001',
    });
    const decision = engine.evaluate(developer, resource, 'read');
    expect(decision.allowed).toBe(true);
    expect(decision.redactionLevel).toBe('none');
  });

  it('API device type adds sandbox obligation', () => {
    const resource = makeResource({
      sensitivity: 'internal',
      organizationId: 'org-001',
    });
    const context: AccessContext = { deviceType: 'api' };
    const decision = engine.evaluate(developer, resource, 'read', context);
    expect(decision.allowed).toBe(true);
    expect(decision.obligations).toContain('sandbox_data_only');
  });
});

// ---------------------------------------------------------------------------
// Admin Role
// ---------------------------------------------------------------------------

describe('Admin access', () => {
  const engine = new PolicyDecisionEngine();
  const admin = makeUser({ role: 'admin', id: 'admin-001' });

  it('full access with audit logging for PHI', () => {
    const resource = makeResource({
      sensitivity: 'phi_full',
      organizationId: 'org-001',
    });
    const decision = engine.evaluate(admin, resource, 'read');
    expect(decision.allowed).toBe(true);
    expect(decision.obligations).toContain('audit_log_required');
  });

  it('can delete PHI (with audit)', () => {
    const resource = makeResource({
      sensitivity: 'phi_full',
      organizationId: 'org-001',
    });
    const decision = engine.evaluate(admin, resource, 'delete');
    expect(decision.allowed).toBe(true);
    expect(decision.obligations).toContain('audit_log_required');
  });

  it('can sign PHI full documents', () => {
    const resource = makeResource({
      sensitivity: 'phi_full',
      organizationId: 'org-001',
    });
    const decision = engine.evaluate(admin, resource, 'sign');
    expect(decision.allowed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Context Attributes
// ---------------------------------------------------------------------------

describe('Context-based access', () => {
  it('after-hours access triggers additional audit obligation', () => {
    const engine = new PolicyDecisionEngine({
      enforceBusinessHours: true,
      businessHoursStart: 6,
      businessHoursEnd: 22,
    });
    const admin = makeUser({ role: 'admin', id: 'admin-001' });
    const resource = makeResource({
      sensitivity: 'phi_full',
      organizationId: 'org-001',
    });

    // 2AM access
    const context: AccessContext = {
      timestamp: '2026-04-03T02:00:00Z',
    };
    const decision = engine.evaluate(admin, resource, 'read', context);
    expect(decision.allowed).toBe(true);
    expect(decision.obligations).toContain('audit_log_required');
  });

  it('expired session is denied', () => {
    const engine = new PolicyDecisionEngine({ maxSessionDurationSeconds: 3600 });
    const admin = makeUser({ role: 'admin', id: 'admin-001' });
    const resource = makeResource({
      sensitivity: 'public',
      organizationId: 'org-001',
    });

    const context: AccessContext = {
      sessionDurationSeconds: 7200, // 2 hours > 1 hour max
    };
    const decision = engine.evaluate(admin, resource, 'read', context);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain('Session expired');
  });

  it('IP not in allowlist is denied', () => {
    const engine = new PolicyDecisionEngine({ enforceIpAllowlist: true });
    const admin = makeUser({ role: 'admin', id: 'admin-001' });
    const resource = makeResource({
      sensitivity: 'public',
      organizationId: 'org-001',
    });

    const context: AccessContext = {
      ipAddress: '192.168.1.100',
      ipAllowlist: ['10.0.0.1', '10.0.0.2'],
    };
    const decision = engine.evaluate(admin, resource, 'read', context);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain('not in organization allowlist');
  });
});

// ---------------------------------------------------------------------------
// Cross-Organization Boundary
// ---------------------------------------------------------------------------

describe('Organization boundary', () => {
  const engine = new PolicyDecisionEngine();

  it('cross-org access is denied', () => {
    const user = makeUser({ organizationId: 'org-001' });
    const resource = makeResource({ organizationId: 'org-999' });
    const decision = engine.evaluate(user, resource, 'read');
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain('Cross-organization');
  });
});

// ---------------------------------------------------------------------------
// Obligation System
// ---------------------------------------------------------------------------

describe('Obligation system', () => {
  const engine = new PolicyDecisionEngine();

  it('deny produces redactionLevel full', () => {
    const caregiver = makeUser({ role: 'caregiver' });
    const resource = makeResource({
      sensitivity: 'phi_full',
      organizationId: 'org-001',
    });
    const decision = engine.evaluate(caregiver, resource, 'read');
    expect(decision.allowed).toBe(false);
    expect(decision.redactionLevel).toBe('full');
    expect(decision.obligations).toContain('deny');
  });

  it('grant_full produces redactionLevel none', () => {
    const surgeon = makeUser({ role: 'surgeon' });
    const resource = makeResource({
      sensitivity: 'public',
      organizationId: 'org-001',
    });
    const decision = engine.evaluate(surgeon, resource, 'read');
    expect(decision.allowed).toBe(true);
    expect(decision.redactionLevel).toBe('none');
  });

  it('grant_redacted produces redactionLevel partial', () => {
    const developer = makeUser({ role: 'developer' });
    const resource = makeResource({
      sensitivity: 'phi_full',
      organizationId: 'org-001',
    });
    const decision = engine.evaluate(developer, resource, 'read');
    expect(decision.allowed).toBe(true);
    expect(decision.redactionLevel).toBe('partial');
  });

  it('grant_with_audit includes audit_log_required obligation', () => {
    const admin = makeUser({ role: 'admin' });
    const resource = makeResource({
      sensitivity: 'phi_full',
      organizationId: 'org-001',
    });
    const decision = engine.evaluate(admin, resource, 'read');
    expect(decision.allowed).toBe(true);
    expect(decision.obligations).toContain('audit_log_required');
  });
});

// ---------------------------------------------------------------------------
// canAccess convenience function
// ---------------------------------------------------------------------------

describe('canAccess', () => {
  it('works as a convenience wrapper', () => {
    const user = makeUser({ role: 'surgeon', id: 'surgeon-001' });
    const resource = makeResource({
      sensitivity: 'phi_full',
      ownerId: 'surgeon-001',
      organizationId: 'org-001',
    });
    const decision = canAccess(user, resource, 'read');
    expect(decision.allowed).toBe(true);
  });
});
