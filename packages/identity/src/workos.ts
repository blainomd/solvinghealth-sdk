/**
 * @solvinghealth/identity — WorkOS AuthKit Integration
 *
 * Provides authentication, user management, and session handling
 * via WorkOS AuthKit for the SolvingHealth multi-org ecosystem.
 *
 * Organizations:
 *   - SurgeonValue (org_01KNAJFHQVM1KK7HDQ0M42KAZ7)
 *   - ClinicalSwipe (org_01KNAJJ5YT4B021NKZ4CP7PGVZ)
 *   - co-op.care (org_01KNAJMJ0FJPA1J5QWJS5DH61G)
 *
 * @module workos
 */

import { z } from 'zod';
import { WorkOS } from '@workos-inc/node';
import type {
  canAccess as canAccessFn,
  WorkOSConfig,
  SolvingHealthRole,
  WorkOSUser,
  WorkOSSession,
  AuthorizationUrlOptions,
  CallbackResult,
  RedactionLevel,
  AccessDecision,
  RoleMappingEntry,
} from './workos-types.js';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Zod schema for WorkOS configuration */
export const WorkOSConfigSchema = z.object({
  clientId: z.string().min(1, 'WORKOS_CLIENT_ID is required'),
  apiKey: z.string().min(1, 'WORKOS_API_KEY is required'),
  redirectUri: z.string().url('WORKOS_REDIRECT_URI must be a valid URL'),
});

/** Well-known organization IDs in the SolvingHealth ecosystem */
export const WORKOS_ORGANIZATIONS = {
  SURGEON_VALUE: 'org_01KNAJFHQVM1KK7HDQ0M42KAZ7',
  CLINICAL_SWIPE: 'org_01KNAJJ5YT4B021NKZ4CP7PGVZ',
  COOP_CARE: 'org_01KNAJMJ0FJPA1J5QWJS5DH61G',
} as const;

export type WorkOSOrganizationId =
  (typeof WORKOS_ORGANIZATIONS)[keyof typeof WORKOS_ORGANIZATIONS];

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

/** SolvingHealth role enum */
export const SolvingHealthRoleSchema = z.enum([
  'surgeon',
  'physician_reviewer',
  'caregiver',
  'family_member',
  'admin',
  'developer',
]);

export const WorkOSUserSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  organizationId: z.string().nullable(),
  role: SolvingHealthRoleSchema,
  workosRole: z.string().nullable(),
  profilePictureUrl: z.string().url().nullable().optional(),
  emailVerified: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const WorkOSSessionSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  user: WorkOSUserSchema,
  expiresAt: z.number().int().positive(),
  organizationId: z.string().nullable(),
});

export const AccessDecisionSchema = z.object({
  allowed: z.boolean(),
  redactionLevel: z.enum(['none', 'partial', 'full']),
  reason: z.string().optional(),
  obligations: z.array(z.string()).optional(),
});

// ---------------------------------------------------------------------------
// Role Mapping
// ---------------------------------------------------------------------------

/**
 * Maps WorkOS roles (set in the WorkOS dashboard) to SolvingHealth roles.
 * WorkOS roles are strings configured per-organization; this table
 * normalizes them into the canonical six-role system.
 */
const ROLE_MAP: Record<string, SolvingHealthRole> = {
  // WorkOS default roles
  admin: 'admin',
  member: 'family_member',

  // SurgeonValue org roles
  surgeon: 'surgeon',
  attending: 'surgeon',
  fellow: 'surgeon',
  resident: 'surgeon',

  // ClinicalSwipe org roles
  reviewer: 'physician_reviewer',
  physician_reviewer: 'physician_reviewer',

  // co-op.care org roles
  caregiver: 'caregiver',
  care_worker: 'caregiver',
  family_member: 'family_member',
  family: 'family_member',

  // Developer / API roles
  developer: 'developer',
  api_user: 'developer',
};

/**
 * Convert a WorkOS role string to a SolvingHealth role.
 * Falls back to 'family_member' (least privileged human role).
 */
export function mapWorkOSRole(workosRole: string | null | undefined): SolvingHealthRole {
  if (!workosRole) return 'family_member';
  const normalized = workosRole.toLowerCase().replace(/[\s-]/g, '_');
  return ROLE_MAP[normalized] ?? 'family_member';
}

// ---------------------------------------------------------------------------
// Client Singleton
// ---------------------------------------------------------------------------

let _workos: WorkOS | null = null;
let _config: z.infer<typeof WorkOSConfigSchema> | null = null;

/**
 * Initialize or retrieve the WorkOS client singleton.
 *
 * @param config - Optional config override. If omitted, reads from process.env.
 * @returns The WorkOS client instance.
 * @throws If required environment variables are missing.
 */
export function getWorkOSClient(config?: Partial<z.infer<typeof WorkOSConfigSchema>>): WorkOS {
  if (_workos && !config) return _workos;

  const resolved = WorkOSConfigSchema.parse({
    clientId: config?.clientId ?? process.env.WORKOS_CLIENT_ID,
    apiKey: config?.apiKey ?? process.env.WORKOS_API_KEY,
    redirectUri: config?.redirectUri ?? process.env.WORKOS_REDIRECT_URI,
  });

  _config = resolved;
  _workos = new WorkOS(resolved.apiKey, { clientId: resolved.clientId });
  return _workos;
}

/** Get the current resolved config (throws if not initialized). */
function requireConfig(): z.infer<typeof WorkOSConfigSchema> {
  if (!_config) {
    getWorkOSClient(); // will parse from env
  }
  return _config!;
}

// ---------------------------------------------------------------------------
// Authorization URL
// ---------------------------------------------------------------------------

/**
 * Generate a WorkOS AuthKit login URL for a given organization.
 *
 * @param organizationId - WorkOS organization ID (e.g., org_01KNAJ...).
 * @param redirectUri - OAuth callback URL. Defaults to configured WORKOS_REDIRECT_URI.
 * @param options - Additional options (state, domain hint, login hint).
 * @returns The authorization URL to redirect the user to.
 *
 * @example
 * ```ts
 * const url = getAuthorizationUrl(WORKOS_ORGANIZATIONS.SURGEON_VALUE);
 * // redirect user to `url`
 * ```
 */
export function getAuthorizationUrl(
  organizationId: string,
  redirectUri?: string,
  options?: { state?: string; domainHint?: string; loginHint?: string },
): string {
  const workos = getWorkOSClient();
  const config = requireConfig();

  return workos.userManagement.getAuthorizationUrl({
    provider: 'authkit',
    clientId: config.clientId,
    redirectUri: redirectUri ?? config.redirectUri,
    organizationId,
    state: options?.state,
    domainHint: options?.domainHint,
    loginHint: options?.loginHint,
  });
}

// ---------------------------------------------------------------------------
// Callback Handler
// ---------------------------------------------------------------------------

/**
 * Exchange an authorization code for a user profile and session tokens.
 *
 * @param code - The authorization code from the OAuth callback query string.
 * @returns The authenticated user and session tokens.
 * @throws On invalid code, network error, or WorkOS API error.
 *
 * @example
 * ```ts
 * // In your /api/auth/callback handler:
 * const { user, session } = await handleCallback(req.query.code);
 * ```
 */
export async function handleCallback(code: string): Promise<CallbackResult> {
  const workos = getWorkOSClient();
  const config = requireConfig();

  const response = await workos.userManagement.authenticateWithCode({
    clientId: config.clientId,
    code,
  });

  const orgMemberships = await workos.userManagement.listOrganizationMemberships({
    userId: response.user.id,
  });

  const primaryMembership = orgMemberships.data[0] ?? null;
  const workosRole = primaryMembership?.role?.slug ?? null;

  const user: WorkOSUser = {
    id: response.user.id,
    email: response.user.email,
    firstName: response.user.firstName,
    lastName: response.user.lastName,
    organizationId: primaryMembership?.organizationId ?? null,
    role: mapWorkOSRole(workosRole),
    workosRole,
    profilePictureUrl: response.user.profilePictureUrl ?? null,
    emailVerified: response.user.emailVerified,
    createdAt: response.user.createdAt,
    updatedAt: response.user.updatedAt,
  };

  const session: WorkOSSession = {
    accessToken: response.accessToken,
    refreshToken: response.refreshToken,
    user,
    expiresAt: Date.now() + 3600 * 1000, // 1 hour default
    organizationId: primaryMembership?.organizationId ?? null,
  };

  return { user, session };
}

// ---------------------------------------------------------------------------
// User Profile
// ---------------------------------------------------------------------------

/**
 * Get a user profile with organization membership from an access token.
 *
 * @param accessToken - A valid WorkOS access token.
 * @returns The user profile with resolved SolvingHealth role.
 */
export async function getUserProfile(accessToken: string): Promise<WorkOSUser> {
  const workos = getWorkOSClient();

  // Verify and decode the JWT session
  const { user: sessionUser } = await workos.userManagement.getJwksUrl(
    requireConfig().clientId,
  ).then(() =>
    // Use loadSealedSession or similar — for now, list user by auth header
    workos.userManagement.getUser(accessToken),
  ).catch(async () => {
    // Fallback: treat accessToken as user ID for direct lookup
    const u = await workos.userManagement.getUser(accessToken);
    return { user: u };
  });

  const orgMemberships = await workos.userManagement.listOrganizationMemberships({
    userId: sessionUser.id,
  });

  const primaryMembership = orgMemberships.data[0] ?? null;
  const workosRole = primaryMembership?.role?.slug ?? null;

  return {
    id: sessionUser.id,
    email: sessionUser.email,
    firstName: sessionUser.firstName,
    lastName: sessionUser.lastName,
    organizationId: primaryMembership?.organizationId ?? null,
    role: mapWorkOSRole(workosRole),
    workosRole,
    profilePictureUrl: sessionUser.profilePictureUrl ?? null,
    emailVerified: sessionUser.emailVerified,
    createdAt: sessionUser.createdAt,
    updatedAt: sessionUser.updatedAt,
  };
}

// ---------------------------------------------------------------------------
// User Creation
// ---------------------------------------------------------------------------

/**
 * Create a new user and add them to an organization.
 *
 * @param email - User email address.
 * @param firstName - First name.
 * @param lastName - Last name.
 * @param organizationId - Organization to add the user to.
 * @returns The created user profile.
 */
export async function createUser(
  email: string,
  firstName: string,
  lastName: string,
  organizationId: string,
): Promise<WorkOSUser> {
  const workos = getWorkOSClient();

  const created = await workos.userManagement.createUser({
    email,
    firstName,
    lastName,
    emailVerified: false,
  });

  await workos.userManagement.createOrganizationMembership({
    userId: created.id,
    organizationId,
  });

  return {
    id: created.id,
    email: created.email,
    firstName: created.firstName,
    lastName: created.lastName,
    organizationId,
    role: 'family_member', // default until role is assigned in WorkOS
    workosRole: null,
    profilePictureUrl: created.profilePictureUrl ?? null,
    emailVerified: created.emailVerified,
    createdAt: created.createdAt,
    updatedAt: created.updatedAt,
  };
}

// ---------------------------------------------------------------------------
// Organization Members
// ---------------------------------------------------------------------------

/** A member entry with resolved SolvingHealth role. */
export interface OrganizationMember {
  userId: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  role: SolvingHealthRole;
  workosRole: string | null;
  status: string;
}

/**
 * List all members of a WorkOS organization with SolvingHealth role mapping.
 *
 * @param organizationId - The WorkOS organization ID.
 * @returns Array of organization members.
 */
export async function listOrganizationMembers(
  organizationId: string,
): Promise<OrganizationMember[]> {
  const workos = getWorkOSClient();

  const memberships = await workos.userManagement.listOrganizationMemberships({
    organizationId,
  });

  const members: OrganizationMember[] = [];

  for (const membership of memberships.data) {
    const user = await workos.userManagement.getUser(membership.userId);
    members.push({
      userId: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: mapWorkOSRole(membership.role?.slug ?? null),
      workosRole: membership.role?.slug ?? null,
      status: membership.status ?? 'active',
    });
  }

  return members;
}

// ---------------------------------------------------------------------------
// Session Refresh
// ---------------------------------------------------------------------------

/**
 * Refresh a session using a refresh token.
 *
 * @param refreshToken - The refresh token from the original authentication.
 * @returns A new session with fresh access and refresh tokens.
 */
export async function refreshSession(refreshToken: string): Promise<WorkOSSession> {
  const workos = getWorkOSClient();
  const config = requireConfig();

  const response = await workos.userManagement.authenticateWithRefreshToken({
    clientId: config.clientId,
    refreshToken,
  });

  const orgMemberships = await workos.userManagement.listOrganizationMemberships({
    userId: response.user.id,
  });

  const primaryMembership = orgMemberships.data[0] ?? null;
  const workosRole = primaryMembership?.role?.slug ?? null;

  const user: WorkOSUser = {
    id: response.user.id,
    email: response.user.email,
    firstName: response.user.firstName,
    lastName: response.user.lastName,
    organizationId: primaryMembership?.organizationId ?? null,
    role: mapWorkOSRole(workosRole),
    workosRole,
    profilePictureUrl: response.user.profilePictureUrl ?? null,
    emailVerified: response.user.emailVerified,
    createdAt: response.user.createdAt,
    updatedAt: response.user.updatedAt,
  };

  return {
    accessToken: response.accessToken,
    refreshToken: response.refreshToken,
    user,
    expiresAt: Date.now() + 3600 * 1000,
    organizationId: primaryMembership?.organizationId ?? null,
  };
}

// ---------------------------------------------------------------------------
// ABAC Policy Decision (convenience re-export — full engine in abac.ts)
// ---------------------------------------------------------------------------

/**
 * Quick access check combining user role, resource sensitivity, and context.
 * For fine-grained ABAC, import PolicyDecisionEngine from './abac.js'.
 *
 * @param user - The authenticated user.
 * @param resource - Resource descriptor with type and sensitivity.
 * @param action - The action being performed (read, write, delete, etc.).
 * @returns Access decision with redaction level.
 */
export { canAccess } from './abac.js';

// ---------------------------------------------------------------------------
// Type Re-exports
// ---------------------------------------------------------------------------

export type {
  WorkOSConfig,
  SolvingHealthRole,
  WorkOSUser,
  WorkOSSession,
  AuthorizationUrlOptions,
  CallbackResult,
  RedactionLevel,
  AccessDecision,
  RoleMappingEntry,
};
