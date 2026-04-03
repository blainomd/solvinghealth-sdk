/**
 * @solvinghealth/identity — WorkOS Type Definitions
 *
 * Shared types used across workos.ts, abac.ts, and audit-events.ts.
 *
 * @module workos-types
 */

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

/** The six canonical roles in the SolvingHealth ecosystem. */
export type SolvingHealthRole =
  | 'surgeon'
  | 'physician_reviewer'
  | 'caregiver'
  | 'family_member'
  | 'admin'
  | 'developer';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface WorkOSConfig {
  clientId: string;
  apiKey: string;
  redirectUri: string;
}

// ---------------------------------------------------------------------------
// User & Session
// ---------------------------------------------------------------------------

export interface WorkOSUser {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  organizationId: string | null;
  role: SolvingHealthRole;
  workosRole: string | null;
  profilePictureUrl: string | null;
  emailVerified: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface WorkOSSession {
  accessToken: string;
  refreshToken: string;
  user: WorkOSUser;
  expiresAt: number;
  organizationId: string | null;
}

// ---------------------------------------------------------------------------
// Authorization
// ---------------------------------------------------------------------------

export interface AuthorizationUrlOptions {
  state?: string;
  domainHint?: string;
  loginHint?: string;
}

export interface CallbackResult {
  user: WorkOSUser;
  session: WorkOSSession;
}

// ---------------------------------------------------------------------------
// Access Control
// ---------------------------------------------------------------------------

export type RedactionLevel = 'none' | 'partial' | 'full';

export interface AccessDecision {
  allowed: boolean;
  redactionLevel: RedactionLevel;
  reason?: string;
  obligations?: string[];
}

export type ResourceSensitivity = 'public' | 'internal' | 'phi_limited' | 'phi_full';

export interface ResourceDescriptor {
  type: string;
  sensitivity: ResourceSensitivity;
  ownerId?: string;
  organizationId?: string;
  patientId?: string;
}

export type Action = 'read' | 'write' | 'delete' | 'review' | 'sign' | 'export' | 'list';

// ---------------------------------------------------------------------------
// Role Mapping
// ---------------------------------------------------------------------------

export interface RoleMappingEntry {
  workosRole: string;
  solvingHealthRole: SolvingHealthRole;
}

// ---------------------------------------------------------------------------
// ABAC Context
// ---------------------------------------------------------------------------

export interface AccessContext {
  /** ISO-8601 timestamp of the request */
  timestamp?: string;
  /** Client IP address */
  ipAddress?: string;
  /** Device type: desktop, mobile, tablet, api */
  deviceType?: 'desktop' | 'mobile' | 'tablet' | 'api';
  /** Session duration in seconds */
  sessionDurationSeconds?: number;
  /** IP allowlist for the organization (if configured) */
  ipAllowlist?: string[];
}

// ---------------------------------------------------------------------------
// ABAC Obligation
// ---------------------------------------------------------------------------

export type Obligation =
  | 'deny'
  | 'grant_full'
  | 'grant_redacted'
  | 'grant_with_audit';

// ---------------------------------------------------------------------------
// canAccess function type
// ---------------------------------------------------------------------------

export type canAccess = (
  user: WorkOSUser,
  resource: ResourceDescriptor,
  action: Action,
  context?: AccessContext,
) => AccessDecision;
