/**
 * @solvinghealth/identity — NPI Identity Management
 *
 * NPI validation (Luhn algorithm), NPPES Registry lookup types,
 * credential verification status tracking, and credential tier system
 * for the SolvingHealth physician network.
 *
 * MIT License
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

export const CredentialTierSchema = z.enum([
  'founding_authority',
  'expert',
  'network',
  'supervised',
]);
export type CredentialTier = z.infer<typeof CredentialTierSchema>;

export const CredentialStatusSchema = z.enum([
  'pending',
  'verified',
  'expired',
  'revoked',
  'suspended',
]);
export type CredentialStatus = z.infer<typeof CredentialStatusSchema>;

export const NPITypeSchema = z.enum(['NPI-1', 'NPI-2']);
export type NPIType = z.infer<typeof NPITypeSchema>;

export const StateLicenseSchema = z.object({
  state: z.string().length(2),
  licenseNumber: z.string(),
  licenseType: z.string().optional(),
  status: CredentialStatusSchema,
  expirationDate: z.string().optional(),
});
export type StateLicense = z.infer<typeof StateLicenseSchema>;

export const ProviderTaxonomySchema = z.object({
  code: z.string(),
  description: z.string(),
  isPrimary: z.boolean(),
});
export type ProviderTaxonomy = z.infer<typeof ProviderTaxonomySchema>;

export const NPIProfileSchema = z.object({
  /** NPI number (10 digits) */
  npi: z.string().regex(/^\d{10}$/),
  /** Entity type */
  type: NPITypeSchema,
  /** Provider name */
  name: z.object({
    first: z.string().optional(),
    last: z.string().optional(),
    middle: z.string().optional(),
    credential: z.string().optional(),
    organizationName: z.string().optional(),
  }),
  /** Taxonomies / specialties */
  taxonomies: z.array(ProviderTaxonomySchema),
  /** State licenses */
  stateLicenses: z.array(StateLicenseSchema),
  /** Practice address */
  practiceAddress: z.object({
    street: z.string(),
    city: z.string(),
    state: z.string().length(2),
    zip: z.string(),
    phone: z.string().optional(),
    fax: z.string().optional(),
  }).optional(),
  /** Mailing address */
  mailingAddress: z.object({
    street: z.string(),
    city: z.string(),
    state: z.string().length(2),
    zip: z.string(),
  }).optional(),
  /** Enumeration date */
  enumerationDate: z.string().optional(),
  /** Last update date */
  lastUpdated: z.string().optional(),
  /** NPI deactivation date (if deactivated) */
  deactivationDate: z.string().optional(),
  /** SolvingHealth-specific metadata */
  solvingHealth: z.object({
    credentialTier: CredentialTierSchema.optional(),
    verificationStatus: CredentialStatusSchema,
    verifiedAt: z.string().datetime().optional(),
    /** OIG exclusion check result */
    oigClearance: z.object({
      cleared: z.boolean(),
      checkedAt: z.string().datetime(),
    }).optional(),
  }).optional(),
});
export type NPIProfile = z.infer<typeof NPIProfileSchema>;

// ---------------------------------------------------------------------------
// NPI Validation (Luhn Algorithm)
// ---------------------------------------------------------------------------

/**
 * Validate an NPI number using the Luhn algorithm.
 *
 * The NPI validation uses a modified Luhn algorithm with the prefix "80840":
 * 1. Prepend "80840" to the NPI
 * 2. Starting from the rightmost digit, double every other digit
 * 3. If doubling produces a number > 9, subtract 9
 * 4. Sum all digits — result must be divisible by 10
 *
 * @param npi - The NPI number to validate
 * @returns Whether the NPI passes Luhn validation
 */
export function validateNPI(npi: string): { valid: boolean; error?: string } {
  // Format check
  if (!/^\d{10}$/.test(npi)) {
    return { valid: false, error: 'NPI must be exactly 10 digits' };
  }

  // Individual NPI starts with 1, Organization with 2
  const entityType = npi[0];
  if (entityType !== '1' && entityType !== '2') {
    return { valid: false, error: 'NPI must start with 1 (individual) or 2 (organization)' };
  }

  // Luhn check with "80840" prefix
  const prefixed = '80840' + npi;
  let sum = 0;
  let alternate = false;

  for (let i = prefixed.length - 1; i >= 0; i--) {
    let digit = parseInt(prefixed[i]!, 10);
    if (alternate) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    alternate = !alternate;
  }

  if (sum % 10 !== 0) {
    return { valid: false, error: 'NPI fails Luhn checksum validation' };
  }

  return { valid: true };
}

/**
 * Determine the NPI entity type.
 */
export function getNPIType(npi: string): NPIType {
  return npi.startsWith('1') ? 'NPI-1' : 'NPI-2';
}

// ---------------------------------------------------------------------------
// NPPES Registry Integration
// ---------------------------------------------------------------------------

/**
 * Build the NPPES NPI Registry API URL for a single NPI lookup.
 *
 * @param npi - The NPI to look up
 * @returns Full NPPES API URL
 */
export function buildNPPESLookupUrl(npi: string): string {
  const validation = validateNPI(npi);
  if (!validation.valid) {
    throw new Error(`Invalid NPI: ${validation.error}`);
  }
  return `https://npiregistry.cms.hhs.gov/api/?number=${npi}&version=2.1`;
}

/**
 * Build the NPPES search URL with multiple criteria.
 *
 * @param params - Search parameters
 * @returns NPPES API search URL
 */
export function buildNPPESSearchUrl(params: {
  firstName?: string;
  lastName?: string;
  organizationName?: string;
  taxonomyDescription?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  limit?: number;
}): string {
  const query = new URLSearchParams({ version: '2.1' });

  if (params.firstName) query.set('first_name', params.firstName);
  if (params.lastName) query.set('last_name', params.lastName);
  if (params.organizationName) query.set('organization_name', params.organizationName);
  if (params.taxonomyDescription) query.set('taxonomy_description', params.taxonomyDescription);
  if (params.city) query.set('city', params.city);
  if (params.state) query.set('state', params.state);
  if (params.postalCode) query.set('postal_code', params.postalCode);
  if (params.limit) query.set('limit', String(Math.min(params.limit, 200)));

  return `https://npiregistry.cms.hhs.gov/api/?${query.toString()}`;
}

/**
 * Parse NPPES API response into NPIProfile.
 *
 * @param nppesResponse - Raw response from NPPES API
 * @returns Parsed NPIProfile
 */
export function parseNPPESResponse(nppesResponse: Record<string, unknown>): NPIProfile {
  const result = nppesResponse as Record<string, unknown>;
  const basic = result['basic'] as Record<string, string> | undefined;
  const taxonomies = (result['taxonomies'] as Array<Record<string, unknown>>) ?? [];
  const addresses = (result['addresses'] as Array<Record<string, string>>) ?? [];

  const practiceAddr = addresses.find((a) => a['address_purpose'] === 'LOCATION');
  const mailingAddr = addresses.find((a) => a['address_purpose'] === 'MAILING');

  return {
    npi: String(result['number'] ?? ''),
    type: String(result['enumeration_type'] ?? 'NPI-1') as NPIType,
    name: {
      first: basic?.['first_name'],
      last: basic?.['last_name'],
      middle: basic?.['middle_name'],
      credential: basic?.['credential'],
      organizationName: basic?.['organization_name'],
    },
    taxonomies: taxonomies.map((t) => ({
      code: String(t['code'] ?? ''),
      description: String(t['desc'] ?? ''),
      isPrimary: Boolean(t['primary']),
    })),
    stateLicenses: taxonomies
      .filter((t) => t['state'] && t['license'])
      .map((t) => ({
        state: String(t['state']),
        licenseNumber: String(t['license']),
        status: 'verified' as const,
      })),
    practiceAddress: practiceAddr ? {
      street: practiceAddr['address_1'] ?? '',
      city: practiceAddr['city'] ?? '',
      state: practiceAddr['state'] ?? '',
      zip: practiceAddr['postal_code'] ?? '',
      phone: practiceAddr['telephone_number'],
      fax: practiceAddr['fax_number'],
    } : undefined,
    mailingAddress: mailingAddr ? {
      street: mailingAddr['address_1'] ?? '',
      city: mailingAddr['city'] ?? '',
      state: mailingAddr['state'] ?? '',
      zip: mailingAddr['postal_code'] ?? '',
    } : undefined,
    enumerationDate: basic?.['enumeration_date'],
    lastUpdated: basic?.['last_updated'],
    deactivationDate: basic?.['deactivation_date'],
  };
}

// ---------------------------------------------------------------------------
// Credential Tier System
// ---------------------------------------------------------------------------

/**
 * SolvingHealth Credential Tier definitions.
 *
 * Tiers determine the provider's role in the physician network:
 * - Founding Authority: Original physician partners (Josh Emdur, etc.)
 * - Expert: Board-certified specialists with full attestation rights
 * - Network: Licensed physicians with standard review capabilities
 * - Supervised: NPs, PAs, residents under physician supervision
 */
export const CREDENTIAL_TIERS: Record<CredentialTier, {
  label: string;
  description: string;
  requirements: string[];
  capabilities: string[];
}> = {
  founding_authority: {
    label: 'Founding Authority',
    description: 'Original physician partners with full platform governance',
    requirements: [
      'Active medical license in at least one state',
      'Board certification in primary specialty',
      'Founding partner agreement executed',
      'Complete OIG/SAM exclusion clearance',
    ],
    capabilities: [
      'Full ClinicalSwipe attestation authority',
      'LMN signing authority (all 50 states if licensed)',
      'Protocol creation and validation',
      'Platform governance voting rights',
      'Revenue share on ClinicalSwipe reviews',
    ],
  },
  expert: {
    label: 'Expert',
    description: 'Board-certified specialist with full attestation rights',
    requirements: [
      'Active medical license',
      'Board certification in relevant specialty',
      'OIG/SAM exclusion clearance',
      'Completed SolvingHealth credentialing',
    ],
    capabilities: [
      'ClinicalSwipe review and attestation',
      'LMN signing (licensed states only)',
      'Protocol review and feedback',
      'Specialty-specific AI training data contribution',
    ],
  },
  network: {
    label: 'Network',
    description: 'Licensed physician with standard review capabilities',
    requirements: [
      'Active medical license in at least one state',
      'OIG/SAM exclusion clearance',
      'Basic credentialing completed',
    ],
    capabilities: [
      'ClinicalSwipe review (specialty-limited)',
      'Standard encounter documentation',
      'PROM interpretation and clinical correlation',
    ],
  },
  supervised: {
    label: 'Supervised',
    description: 'Mid-level provider or trainee under physician supervision',
    requirements: [
      'Valid NPI',
      'Active license (NP, PA, or resident credentials)',
      'Supervising physician identified and verified',
      'OIG/SAM exclusion clearance',
    ],
    capabilities: [
      'Data entry and documentation',
      'PROM collection facilitation',
      'Supervised encounter support',
      'No independent attestation authority',
    ],
  },
};

/**
 * Determine the appropriate credential tier based on provider profile.
 *
 * @param profile - NPI profile data
 * @param isFoundingPartner - Whether this provider is a founding partner
 * @returns Recommended credential tier
 */
export function determineCredentialTier(
  profile: NPIProfile,
  isFoundingPartner = false,
): CredentialTier {
  if (isFoundingPartner) {
    return 'founding_authority';
  }

  const primaryTaxonomy = profile.taxonomies.find((t) => t.isPrimary);
  if (!primaryTaxonomy) {
    return 'supervised';
  }

  const desc = primaryTaxonomy.description.toLowerCase();

  // Check for mid-level providers
  if (
    desc.includes('nurse practitioner') ||
    desc.includes('physician assistant') ||
    desc.includes('resident')
  ) {
    return 'supervised';
  }

  // Check for board-certified specialists
  if (profile.type === 'NPI-1' && profile.name.credential) {
    const cred = profile.name.credential.toUpperCase();
    if (cred.includes('MD') || cred.includes('DO')) {
      return 'expert';
    }
  }

  return 'network';
}
