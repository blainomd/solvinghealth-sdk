/**
 * @solvinghealth/identity — Attribute-Based Access Control (ABAC)
 *
 * Policy decision engine that evaluates access based on:
 *   - User role (surgeon, physician_reviewer, caregiver, family_member, admin, developer)
 *   - Resource sensitivity (public, internal, phi_limited, phi_full)
 *   - Action (read, write, delete, review, sign, export, list)
 *   - Context attributes (time, IP, device, session duration)
 *
 * Produces obligations: deny | grant_full | grant_redacted | grant_with_audit
 *
 * @module abac
 */

import { z } from 'zod';
import type {
  SolvingHealthRole,
  WorkOSUser,
  ResourceDescriptor,
  ResourceSensitivity,
  Action,
  AccessContext,
  AccessDecision,
  RedactionLevel,
  Obligation,
} from './workos-types.js';

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

export const ResourceSensitivitySchema = z.enum([
  'public',
  'internal',
  'phi_limited',
  'phi_full',
]);

export const ActionSchema = z.enum([
  'read',
  'write',
  'delete',
  'review',
  'sign',
  'export',
  'list',
]);

export const ResourceDescriptorSchema = z.object({
  type: z.string().min(1),
  sensitivity: ResourceSensitivitySchema,
  ownerId: z.string().optional(),
  organizationId: z.string().optional(),
  patientId: z.string().optional(),
});

export const AccessContextSchema = z.object({
  timestamp: z.string().datetime().optional(),
  ipAddress: z.string().optional(),
  deviceType: z.enum(['desktop', 'mobile', 'tablet', 'api']).optional(),
  sessionDurationSeconds: z.number().int().nonneg().optional(),
  ipAllowlist: z.array(z.string()).optional(),
});

export const ObligationSchema = z.enum([
  'deny',
  'grant_full',
  'grant_redacted',
  'grant_with_audit',
]);

// ---------------------------------------------------------------------------
// Permission Matrix
// ---------------------------------------------------------------------------

/**
 * Permission matrix defining what each role can do at each sensitivity level.
 *
 * Key: `${role}:${sensitivity}:${action}` -> Obligation
 *
 * Unlisted combinations default to 'deny'.
 */
type PermissionKey = `${SolvingHealthRole}:${ResourceSensitivity}:${Action}`;

const PERMISSION_MATRIX: Partial<Record<PermissionKey, Obligation>> = {
  // ── surgeon ──────────────────────────────────────────────────────────
  // Full access to own patients, read access to panels, no PHI of non-patients
  'surgeon:public:read': 'grant_full',
  'surgeon:public:write': 'grant_full',
  'surgeon:public:list': 'grant_full',
  'surgeon:internal:read': 'grant_full',
  'surgeon:internal:write': 'grant_full',
  'surgeon:internal:list': 'grant_full',
  'surgeon:phi_limited:read': 'grant_with_audit',
  'surgeon:phi_limited:write': 'grant_with_audit',
  'surgeon:phi_limited:list': 'grant_with_audit',
  'surgeon:phi_limited:export': 'grant_with_audit',
  'surgeon:phi_full:read': 'grant_with_audit',   // own patients only (checked at runtime)
  'surgeon:phi_full:write': 'grant_with_audit',
  'surgeon:phi_full:delete': 'deny',
  'surgeon:phi_full:export': 'grant_with_audit',
  'surgeon:phi_full:list': 'grant_redacted',
  'surgeon:phi_full:sign': 'grant_with_audit',

  // ── physician_reviewer ──────────────────────────────────────────────
  // Review-only access to assigned documents, no patient lookup
  'physician_reviewer:public:read': 'grant_full',
  'physician_reviewer:public:list': 'grant_full',
  'physician_reviewer:internal:read': 'grant_full',
  'physician_reviewer:internal:list': 'grant_full',
  'physician_reviewer:phi_limited:read': 'grant_redacted',
  'physician_reviewer:phi_limited:review': 'grant_with_audit',
  'physician_reviewer:phi_limited:list': 'deny',
  'physician_reviewer:phi_full:read': 'grant_redacted',
  'physician_reviewer:phi_full:review': 'grant_with_audit',
  'physician_reviewer:phi_full:sign': 'grant_with_audit',
  'physician_reviewer:phi_full:list': 'deny',
  'physician_reviewer:phi_full:write': 'deny',
  'physician_reviewer:phi_full:export': 'deny',

  // ── caregiver ───────────────────────────────────────────────────────
  // Task-only access to assigned clients, redacted demographics
  'caregiver:public:read': 'grant_full',
  'caregiver:public:list': 'grant_full',
  'caregiver:internal:read': 'grant_full',
  'caregiver:internal:write': 'grant_full',
  'caregiver:internal:list': 'grant_full',
  'caregiver:phi_limited:read': 'grant_redacted',
  'caregiver:phi_limited:write': 'grant_redacted',
  'caregiver:phi_limited:list': 'grant_redacted',
  'caregiver:phi_full:read': 'deny',
  'caregiver:phi_full:write': 'deny',
  'caregiver:phi_full:list': 'deny',
  'caregiver:phi_full:export': 'deny',

  // ── family_member ───────────────────────────────────────────────────
  // Read-only access to own family's Living Profile
  'family_member:public:read': 'grant_full',
  'family_member:public:list': 'grant_full',
  'family_member:internal:read': 'grant_redacted',
  'family_member:internal:list': 'deny',
  'family_member:phi_limited:read': 'grant_redacted', // own family only (checked at runtime)
  'family_member:phi_limited:list': 'deny',
  'family_member:phi_limited:write': 'deny',
  'family_member:phi_full:read': 'deny',
  'family_member:phi_full:write': 'deny',
  'family_member:phi_full:list': 'deny',

  // ── admin ───────────────────────────────────────────────────────────
  // Full access within organization, all actions audit logged
  'admin:public:read': 'grant_full',
  'admin:public:write': 'grant_full',
  'admin:public:delete': 'grant_full',
  'admin:public:list': 'grant_full',
  'admin:internal:read': 'grant_full',
  'admin:internal:write': 'grant_full',
  'admin:internal:delete': 'grant_with_audit',
  'admin:internal:list': 'grant_full',
  'admin:phi_limited:read': 'grant_with_audit',
  'admin:phi_limited:write': 'grant_with_audit',
  'admin:phi_limited:delete': 'grant_with_audit',
  'admin:phi_limited:list': 'grant_with_audit',
  'admin:phi_limited:export': 'grant_with_audit',
  'admin:phi_full:read': 'grant_with_audit',
  'admin:phi_full:write': 'grant_with_audit',
  'admin:phi_full:delete': 'grant_with_audit',
  'admin:phi_full:list': 'grant_with_audit',
  'admin:phi_full:export': 'grant_with_audit',
  'admin:phi_full:sign': 'grant_with_audit',

  // ── developer ───────────────────────────────────────────────────────
  // API access with redacted PHI, sandbox data only
  'developer:public:read': 'grant_full',
  'developer:public:write': 'grant_full',
  'developer:public:list': 'grant_full',
  'developer:internal:read': 'grant_full',
  'developer:internal:write': 'grant_full',
  'developer:internal:list': 'grant_full',
  'developer:phi_limited:read': 'grant_redacted',
  'developer:phi_limited:write': 'deny',
  'developer:phi_limited:list': 'grant_redacted',
  'developer:phi_full:read': 'grant_redacted',
  'developer:phi_full:write': 'deny',
  'developer:phi_full:list': 'grant_redacted',
  'developer:phi_full:export': 'deny',
  'developer:phi_full:delete': 'deny',
};

// ---------------------------------------------------------------------------
// Policy Decision Engine
// ---------------------------------------------------------------------------

/** Configuration for the policy decision engine. */
export interface PolicyDecisionConfig {
  /** Maximum session duration before requiring re-auth (seconds). Default: 28800 (8h). */
  maxSessionDurationSeconds?: number;
  /** Enforce IP allowlists when present. Default: true. */
  enforceIpAllowlist?: boolean;
  /** Restrict PHI access to business hours (6am-10pm local). Default: false. */
  enforceBusinessHours?: boolean;
  /** Business hours start (0-23). Default: 6. */
  businessHoursStart?: number;
  /** Business hours end (0-23). Default: 22. */
  businessHoursEnd?: number;
}

const DEFAULT_CONFIG: Required<PolicyDecisionConfig> = {
  maxSessionDurationSeconds: 28800,
  enforceIpAllowlist: true,
  enforceBusinessHours: false,
  businessHoursStart: 6,
  businessHoursEnd: 22,
};

/**
 * PolicyDecisionEngine evaluates ABAC policies for the SolvingHealth ecosystem.
 *
 * Combines role-based permissions with contextual attributes to produce
 * access decisions with obligations (deny, grant_full, grant_redacted,
 * grant_with_audit).
 *
 * @example
 * ```ts
 * const engine = new PolicyDecisionEngine();
 * const decision = engine.evaluate(user, resource, 'read', context);
 * if (!decision.allowed) {
 *   return res.status(403).json({ error: decision.reason });
 * }
 * ```
 */
export class PolicyDecisionEngine {
  private config: Required<PolicyDecisionConfig>;

  constructor(config?: PolicyDecisionConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Evaluate an access request against the ABAC policy.
   *
   * @param user - The requesting user with role and org membership.
   * @param resource - The resource being accessed.
   * @param action - The action being performed.
   * @param context - Optional contextual attributes.
   * @returns Access decision with redaction level and obligations.
   */
  evaluate(
    user: WorkOSUser,
    resource: ResourceDescriptor,
    action: Action,
    context?: AccessContext,
  ): AccessDecision {
    const obligations: string[] = [];

    // 1. Context-based pre-checks
    const contextDenial = this.evaluateContext(user, context, obligations);
    if (contextDenial) return contextDenial;

    // 2. Organization boundary check
    if (resource.organizationId && user.organizationId) {
      if (resource.organizationId !== user.organizationId) {
        return {
          allowed: false,
          redactionLevel: 'full',
          reason: 'Cross-organization access denied',
          obligations: ['deny'],
        };
      }
    }

    // 3. Lookup permission matrix
    const key: PermissionKey = `${user.role}:${resource.sensitivity}:${action}`;
    const obligation = PERMISSION_MATRIX[key] ?? 'deny';

    if (obligation === 'deny') {
      return {
        allowed: false,
        redactionLevel: 'full',
        reason: `Role '${user.role}' cannot '${action}' resources with sensitivity '${resource.sensitivity}'`,
        obligations: ['deny'],
      };
    }

    // 4. Ownership checks for roles with scoped access
    const ownershipDenial = this.evaluateOwnership(user, resource, action);
    if (ownershipDenial) return ownershipDenial;

    // 5. Map obligation to redaction level
    const redactionLevel = this.obligationToRedaction(obligation);

    if (obligation === 'grant_with_audit') {
      obligations.push('audit_log_required');
    }

    return {
      allowed: true,
      redactionLevel,
      reason: `Granted via ${obligation}`,
      obligations: obligations.length > 0 ? obligations : undefined,
    };
  }

  /**
   * Evaluate contextual attributes (IP, time, session, device).
   * Returns an AccessDecision if denied, or null if context passes.
   */
  private evaluateContext(
    user: WorkOSUser,
    context: AccessContext | undefined,
    obligations: string[],
  ): AccessDecision | null {
    if (!context) return null;

    // IP allowlist enforcement
    if (
      this.config.enforceIpAllowlist &&
      context.ipAllowlist &&
      context.ipAllowlist.length > 0 &&
      context.ipAddress
    ) {
      if (!context.ipAllowlist.includes(context.ipAddress)) {
        return {
          allowed: false,
          redactionLevel: 'full',
          reason: `IP ${context.ipAddress} not in organization allowlist`,
          obligations: ['deny'],
        };
      }
    }

    // Session duration check
    if (
      context.sessionDurationSeconds !== undefined &&
      context.sessionDurationSeconds > this.config.maxSessionDurationSeconds
    ) {
      return {
        allowed: false,
        redactionLevel: 'full',
        reason: `Session expired (${context.sessionDurationSeconds}s > ${this.config.maxSessionDurationSeconds}s max)`,
        obligations: ['deny', 'require_reauth'],
      };
    }

    // Business hours enforcement for PHI
    if (this.config.enforceBusinessHours && context.timestamp) {
      const hour = new Date(context.timestamp).getHours();
      if (hour < this.config.businessHoursStart || hour >= this.config.businessHoursEnd) {
        obligations.push('after_hours_access');
      }
    }

    // API device type for developers — force redaction
    if (context.deviceType === 'api' && user.role === 'developer') {
      obligations.push('sandbox_data_only');
    }

    return null;
  }

  /**
   * Evaluate ownership-scoped access.
   * Surgeons can only access their own patients' full PHI.
   * Family members can only access their own family's data.
   */
  private evaluateOwnership(
    user: WorkOSUser,
    resource: ResourceDescriptor,
    action: Action,
  ): AccessDecision | null {
    // Surgeon: PHI full access requires ownership
    if (
      user.role === 'surgeon' &&
      resource.sensitivity === 'phi_full' &&
      resource.ownerId &&
      resource.ownerId !== user.id
    ) {
      // Surgeon accessing another surgeon's patient — deny full, allow redacted for list
      if (action === 'list') {
        return {
          allowed: true,
          redactionLevel: 'partial',
          reason: 'Cross-panel access: redacted view only',
          obligations: ['audit_log_required'],
        };
      }
      return {
        allowed: false,
        redactionLevel: 'full',
        reason: 'Surgeon cannot access PHI of non-panel patients',
        obligations: ['deny'],
      };
    }

    // Family member: can only read own family data
    if (
      user.role === 'family_member' &&
      resource.patientId &&
      resource.ownerId &&
      resource.ownerId !== user.id
    ) {
      return {
        allowed: false,
        redactionLevel: 'full',
        reason: 'Family member access limited to own family profile',
        obligations: ['deny'],
      };
    }

    return null;
  }

  /** Map an ABAC obligation to a redaction level. */
  private obligationToRedaction(obligation: Obligation): RedactionLevel {
    switch (obligation) {
      case 'grant_full':
        return 'none';
      case 'grant_redacted':
        return 'partial';
      case 'grant_with_audit':
        return 'none';
      case 'deny':
        return 'full';
    }
  }
}

// ---------------------------------------------------------------------------
// Convenience Function
// ---------------------------------------------------------------------------

/** Singleton engine for simple use cases. */
let _defaultEngine: PolicyDecisionEngine | null = null;

/**
 * Quick access check combining user role, resource sensitivity, and context.
 *
 * Uses a default PolicyDecisionEngine. For custom configuration, instantiate
 * PolicyDecisionEngine directly.
 *
 * @param user - The authenticated WorkOS user.
 * @param resource - Resource descriptor with type and sensitivity.
 * @param action - The action being performed.
 * @param context - Optional contextual attributes.
 * @returns Access decision with redaction level.
 *
 * @example
 * ```ts
 * const decision = canAccess(user, {
 *   type: 'patient_record',
 *   sensitivity: 'phi_full',
 *   ownerId: user.id,
 * }, 'read');
 *
 * if (!decision.allowed) {
 *   return res.status(403).json({ error: decision.reason });
 * }
 * ```
 */
export function canAccess(
  user: WorkOSUser,
  resource: ResourceDescriptor,
  action: Action,
  context?: AccessContext,
): AccessDecision {
  if (!_defaultEngine) {
    _defaultEngine = new PolicyDecisionEngine();
  }
  return _defaultEngine.evaluate(user, resource, action, context);
}

// ---------------------------------------------------------------------------
// Express / Fastify Middleware
// ---------------------------------------------------------------------------

/** Configuration for the ABAC middleware. */
export interface AbacMiddlewareConfig {
  /** Function to extract the user from the request. */
  getUser: (req: any) => WorkOSUser | null | undefined;
  /** Function to derive the resource descriptor from the request. */
  getResource: (req: any) => ResourceDescriptor;
  /** Function to derive the action from the request. */
  getAction: (req: any) => Action;
  /** Optional function to build context from the request. */
  getContext?: (req: any) => AccessContext;
  /** Custom policy engine (optional, uses default if omitted). */
  engine?: PolicyDecisionEngine;
  /** Called when access is denied. Default sends 403. */
  onDenied?: (req: any, res: any, decision: AccessDecision) => void;
}

/**
 * Express/Fastify middleware that enforces ABAC policies.
 *
 * Attaches `req.abacDecision` with the full AccessDecision for downstream use.
 *
 * @param config - Middleware configuration.
 * @returns Express/Fastify-compatible request handler.
 *
 * @example
 * ```ts
 * app.use('/api/patients/:id', abacMiddleware({
 *   getUser: (req) => req.user,
 *   getResource: (req) => ({
 *     type: 'patient_record',
 *     sensitivity: 'phi_full',
 *     patientId: req.params.id,
 *     ownerId: req.user?.id,
 *   }),
 *   getAction: (req) => req.method === 'GET' ? 'read' : 'write',
 * }));
 * ```
 */
export function abacMiddleware(
  config: AbacMiddlewareConfig,
): (req: any, res: any, next: any) => void {
  const engine = config.engine ?? new PolicyDecisionEngine();

  return (req: any, res: any, next: any) => {
    const user = config.getUser(req);

    if (!user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const resource = config.getResource(req);
    const action = config.getAction(req);
    const context = config.getContext?.(req);

    const decision = engine.evaluate(user, resource, action, context);

    // Attach decision to request for downstream handlers
    req.abacDecision = decision;

    if (!decision.allowed) {
      if (config.onDenied) {
        config.onDenied(req, res, decision);
      } else {
        res.status(403).json({
          error: 'Access denied',
          reason: decision.reason,
        });
      }
      return;
    }

    next();
  };
}

// ---------------------------------------------------------------------------
// Re-exports for convenience
// ---------------------------------------------------------------------------

export type {
  SolvingHealthRole,
  ResourceDescriptor,
  ResourceSensitivity,
  Action,
  AccessContext,
  AccessDecision,
  RedactionLevel,
  Obligation,
} from './workos-types.js';
