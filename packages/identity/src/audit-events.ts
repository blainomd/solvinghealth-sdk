/**
 * @solvinghealth/identity — WorkOS Audit Log Events
 *
 * Defines all audit event types for the SolvingHealth ecosystem and provides
 * a typed function to emit events to the WorkOS Audit Logs API.
 *
 * Event categories:
 *   - auth.* — Authentication events
 *   - clinicalswipe.* — ClinicalSwipe review workflow
 *   - lmn.* — Letter of Medical Necessity lifecycle
 *   - encounter.* — Patient encounter tracking
 *   - phi.* — Protected Health Information access
 *   - compliance.* — Compliance and regulatory events
 *   - prom.* — Patient-Reported Outcome Measures
 *   - caregiver.* — Caregiver shift management
 *   - billing.* — Claims and billing events
 *
 * @module audit-events
 */

import { z } from 'zod';
import { WorkOS } from '@workos-inc/node';

// ---------------------------------------------------------------------------
// Audit Event Type Registry
// ---------------------------------------------------------------------------

/**
 * All audit event types in the SolvingHealth ecosystem.
 * Format: `domain.action` following WorkOS naming conventions.
 */
export const AUDIT_EVENT_TYPES = {
  // Authentication
  AUTH_LOGIN: 'auth.login',
  AUTH_LOGOUT: 'auth.logout',
  AUTH_FAILED_LOGIN: 'auth.failed_login',

  // ClinicalSwipe
  CLINICALSWIPE_REVIEW_SUBMITTED: 'clinicalswipe.review.submitted',
  CLINICALSWIPE_REVIEW_APPROVED: 'clinicalswipe.review.approved',
  CLINICALSWIPE_REVIEW_REJECTED: 'clinicalswipe.review.rejected',

  // Letter of Medical Necessity
  LMN_GENERATED: 'lmn.generated',
  LMN_SIGNED: 'lmn.signed',
  LMN_DELIVERED: 'lmn.delivered',

  // Encounters
  ENCOUNTER_CREATED: 'encounter.created',
  ENCOUNTER_BILLED: 'encounter.billed',

  // PHI Access
  PHI_ACCESSED: 'phi.accessed',
  PHI_EXPORTED: 'phi.exported',
  PHI_REDACTED: 'phi.redacted',

  // Compliance
  COMPLIANCE_VIOLATION_DETECTED: 'compliance.violation_detected',
  COMPLIANCE_OVERRIDE_REQUESTED: 'compliance.override_requested',

  // Patient-Reported Outcomes
  PROM_COLLECTED: 'prom.collected',
  PROM_SCORED: 'prom.scored',

  // Caregiver
  CAREGIVER_SHIFT_STARTED: 'caregiver.shift_started',
  CAREGIVER_SHIFT_ENDED: 'caregiver.shift_ended',

  // Billing
  BILLING_CLAIM_GENERATED: 'billing.claim_generated',
  BILLING_CLAIM_SUBMITTED: 'billing.claim_submitted',
} as const;

export type AuditEventType = (typeof AUDIT_EVENT_TYPES)[keyof typeof AUDIT_EVENT_TYPES];

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

/** WorkOS audit event actor (who performed the action). */
export const AuditActorSchema = z.object({
  /** Actor ID (typically WorkOS user ID). */
  id: z.string().min(1),
  /** Actor type: 'user' for humans, 'system' for automated processes. */
  type: z.enum(['user', 'system']),
  /** Display name. */
  name: z.string().optional(),
  /** Actor metadata (email, role, IP, etc.). */
  metadata: z.record(z.string()).optional(),
});

export type AuditActor = z.infer<typeof AuditActorSchema>;

/** WorkOS audit event target (what was acted upon). */
export const AuditTargetSchema = z.object({
  /** Target resource ID. */
  id: z.string().min(1),
  /** Target type (e.g., 'patient_record', 'lmn', 'encounter', 'review'). */
  type: z.string().min(1),
  /** Display name of the target. */
  name: z.string().optional(),
  /** Additional target metadata. */
  metadata: z.record(z.string()).optional(),
});

export type AuditTarget = z.infer<typeof AuditTargetSchema>;

/** Full audit event for submission to WorkOS. */
export const AuditEventSchema = z.object({
  /** The event action (must be a registered AUDIT_EVENT_TYPES value). */
  action: z.string().min(1),
  /** When the event occurred (ISO-8601). Defaults to now. */
  occurredAt: z.string().datetime().optional(),
  /** The actor who performed the action. */
  actor: AuditActorSchema,
  /** The targets of the action. */
  targets: z.array(AuditTargetSchema).min(1),
  /** The WorkOS organization ID this event belongs to. */
  organizationId: z.string().min(1),
  /** Freeform event metadata. */
  metadata: z.record(z.unknown()).optional(),
  /** Event version for schema evolution. */
  version: z.number().int().positive().optional(),
});

export type AuditEvent = z.infer<typeof AuditEventSchema>;

// ---------------------------------------------------------------------------
// Event Builder Helpers
// ---------------------------------------------------------------------------

/**
 * Build an audit actor from a user object.
 *
 * @param user - Object with at minimum `id` and `email`.
 * @param ipAddress - Optional IP address of the request.
 * @returns A properly formatted AuditActor.
 */
export function buildActor(
  user: { id: string; email: string; firstName?: string | null; lastName?: string | null; role?: string },
  ipAddress?: string,
): AuditActor {
  const name = [user.firstName, user.lastName].filter(Boolean).join(' ') || undefined;
  return {
    id: user.id,
    type: 'user',
    name,
    metadata: {
      email: user.email,
      ...(user.role && { role: user.role }),
      ...(ipAddress && { ip_address: ipAddress }),
    },
  };
}

/**
 * Build a system actor for automated events (AI agents, cron jobs, etc.).
 *
 * @param systemId - Identifier for the system component.
 * @param systemName - Human-readable name.
 * @returns A properly formatted AuditActor for system events.
 */
export function buildSystemActor(systemId: string, systemName: string): AuditActor {
  return {
    id: systemId,
    type: 'system',
    name: systemName,
  };
}

/**
 * Build an audit target.
 *
 * @param id - Resource ID.
 * @param type - Resource type.
 * @param name - Optional display name.
 * @param metadata - Optional additional metadata.
 * @returns A properly formatted AuditTarget.
 */
export function buildTarget(
  id: string,
  type: string,
  name?: string,
  metadata?: Record<string, string>,
): AuditTarget {
  return { id, type, name, metadata };
}

// ---------------------------------------------------------------------------
// Event Emission
// ---------------------------------------------------------------------------

/** Options for the audit event emitter. */
export interface AuditEmitterConfig {
  /** WorkOS API key. Defaults to process.env.WORKOS_API_KEY. */
  apiKey?: string;
  /** Default organization ID. Can be overridden per event. */
  defaultOrganizationId?: string;
  /** Event version to stamp on all events. Default: 1. */
  defaultVersion?: number;
  /** Called on emit failure. Default: console.error. */
  onError?: (error: Error, event: AuditEvent) => void;
}

/**
 * Create an audit event and send it to the WorkOS Audit Logs API.
 *
 * Validates the event with Zod before sending. Failed validation throws
 * synchronously; API errors are caught and forwarded to onError.
 *
 * @param event - The audit event to emit.
 * @param config - Optional emitter configuration.
 * @returns Promise that resolves when the event is accepted by WorkOS.
 *
 * @example
 * ```ts
 * await createAuditEvent({
 *   action: AUDIT_EVENT_TYPES.LMN_SIGNED,
 *   actor: buildActor(user, req.ip),
 *   targets: [buildTarget(lmnId, 'lmn', 'LMN-2026-0042')],
 *   organizationId: WORKOS_ORGANIZATIONS.COOP_CARE,
 *   metadata: { patientId: '...', icd10: 'M17.11' },
 * });
 * ```
 */
export async function createAuditEvent(
  event: AuditEvent,
  config?: AuditEmitterConfig,
): Promise<void> {
  // Validate
  const validated = AuditEventSchema.parse(event);

  const apiKey = config?.apiKey ?? process.env.WORKOS_API_KEY;
  if (!apiKey) {
    throw new Error('WORKOS_API_KEY is required for audit event emission');
  }

  const workos = new WorkOS(apiKey);
  const onError = config?.onError ?? ((err: Error) => console.error('[SolvingHealth Audit]', err.message));

  try {
    await workos.auditLogs.createEvent(validated.organizationId, {
      action: validated.action,
      occurredAt: validated.occurredAt ? new Date(validated.occurredAt) : new Date(),
      actor: {
        id: validated.actor.id,
        type: validated.actor.type,
        name: validated.actor.name,
        metadata: validated.actor.metadata,
      },
      targets: validated.targets.map((t) => ({
        id: t.id,
        type: t.type,
        name: t.name,
        metadata: t.metadata,
      })),
      version: validated.version ?? config?.defaultVersion ?? 1,
      metadata: validated.metadata as Record<string, string> | undefined,
    });
  } catch (error) {
    onError(error instanceof Error ? error : new Error(String(error)), validated);
  }
}

// ---------------------------------------------------------------------------
// Batch Emission
// ---------------------------------------------------------------------------

/**
 * Emit multiple audit events. Events are sent sequentially to respect
 * WorkOS rate limits. Failures are collected, not thrown.
 *
 * @param events - Array of audit events.
 * @param config - Optional emitter configuration.
 * @returns Array of errors (empty if all succeeded).
 */
export async function createAuditEvents(
  events: AuditEvent[],
  config?: AuditEmitterConfig,
): Promise<Error[]> {
  const errors: Error[] = [];

  for (const event of events) {
    try {
      await createAuditEvent(event, {
        ...config,
        onError: (err) => {
          errors.push(err);
        },
      });
    } catch (err) {
      errors.push(err instanceof Error ? err : new Error(String(err)));
    }
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Pre-built Event Factories
// ---------------------------------------------------------------------------

/**
 * Create a PHI access audit event. Use this whenever PHI is read or displayed.
 *
 * @param actor - The user/system accessing PHI.
 * @param resourceId - ID of the PHI resource.
 * @param resourceType - Type of PHI (e.g., 'patient_record', 'living_profile').
 * @param organizationId - WorkOS organization ID.
 * @param metadata - Additional context (reason, patient ID, etc.).
 */
export function phiAccessEvent(
  actor: AuditActor,
  resourceId: string,
  resourceType: string,
  organizationId: string,
  metadata?: Record<string, string>,
): AuditEvent {
  return {
    action: AUDIT_EVENT_TYPES.PHI_ACCESSED,
    actor,
    targets: [buildTarget(resourceId, resourceType)],
    organizationId,
    metadata: {
      ...metadata,
      hipaa_event: 'true',
    },
  };
}

/**
 * Create an LMN lifecycle event.
 *
 * @param action - One of lmn.generated, lmn.signed, lmn.delivered.
 * @param actor - The physician or system generating/signing the LMN.
 * @param lmnId - The LMN document ID.
 * @param organizationId - WorkOS organization ID.
 * @param metadata - Additional context (patient ID, ICD-10, etc.).
 */
export function lmnEvent(
  action: 'lmn.generated' | 'lmn.signed' | 'lmn.delivered',
  actor: AuditActor,
  lmnId: string,
  organizationId: string,
  metadata?: Record<string, string>,
): AuditEvent {
  return {
    action,
    actor,
    targets: [buildTarget(lmnId, 'lmn')],
    organizationId,
    metadata,
  };
}

/**
 * Create an encounter billing event.
 *
 * @param action - One of encounter.created, encounter.billed.
 * @param actor - The surgeon or system.
 * @param encounterId - Encounter ID.
 * @param organizationId - WorkOS organization ID.
 * @param metadata - CPT codes, billing amounts, etc.
 */
export function encounterEvent(
  action: 'encounter.created' | 'encounter.billed',
  actor: AuditActor,
  encounterId: string,
  organizationId: string,
  metadata?: Record<string, string>,
): AuditEvent {
  return {
    action,
    actor,
    targets: [buildTarget(encounterId, 'encounter')],
    organizationId,
    metadata,
  };
}

/**
 * Create a compliance event.
 *
 * @param action - violation_detected or override_requested.
 * @param actor - The user or system triggering the compliance event.
 * @param resourceId - The resource that triggered the compliance event.
 * @param resourceType - Type of resource.
 * @param organizationId - WorkOS organization ID.
 * @param metadata - Violation details, severity, etc.
 */
export function complianceEvent(
  action: 'compliance.violation_detected' | 'compliance.override_requested',
  actor: AuditActor,
  resourceId: string,
  resourceType: string,
  organizationId: string,
  metadata?: Record<string, string>,
): AuditEvent {
  return {
    action,
    actor,
    targets: [buildTarget(resourceId, resourceType)],
    organizationId,
    metadata: {
      ...metadata,
      compliance_event: 'true',
    },
  };
}
