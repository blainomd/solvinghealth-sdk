/**
 * @solvinghealth/billing — NPI-to-Billing-Code Mapper
 *
 * Given an NPI, determines provider taxonomy, specialty, and state licenses,
 * then maps the specialty to eligible billing codes. Uses the NPPES NPI
 * Registry API format.
 *
 * PROPRIETARY — SolvingHealth LLC. All rights reserved.
 */

import { z } from 'zod';
import { type BillingCode, BILLING_CODES, type CodeCategory } from './codes.js';

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

export const TaxonomySchema = z.object({
  code: z.string(),
  desc: z.string(),
  primary: z.boolean(),
  state: z.string().optional(),
  license: z.string().optional(),
});
export type Taxonomy = z.infer<typeof TaxonomySchema>;

export const NPPESResultSchema = z.object({
  /** NPI number */
  number: z.string().regex(/^\d{10}$/),
  /** Entity type: 1 = individual, 2 = organization */
  enumeration_type: z.enum(['NPI-1', 'NPI-2']),
  /** Provider basic info */
  basic: z.object({
    first_name: z.string().optional(),
    last_name: z.string().optional(),
    organization_name: z.string().optional(),
    credential: z.string().optional(),
    gender: z.string().optional(),
    enumeration_date: z.string().optional(),
    last_updated: z.string().optional(),
    status: z.string().optional(),
  }),
  /** Provider taxonomies (specialties) */
  taxonomies: z.array(TaxonomySchema),
  /** Practice addresses */
  addresses: z.array(z.object({
    address_purpose: z.string(),
    address_1: z.string(),
    city: z.string(),
    state: z.string(),
    postal_code: z.string(),
    telephone_number: z.string().optional(),
  })),
});
export type NPPESResult = z.infer<typeof NPPESResultSchema>;

export const NPIEligibilityResultSchema = z.object({
  npi: z.string(),
  providerName: z.string(),
  credential: z.string().optional(),
  primarySpecialty: z.string(),
  taxonomyCode: z.string(),
  stateLicenses: z.array(z.object({
    state: z.string(),
    license: z.string(),
  })),
  eligibleCodes: z.array(z.object({
    code: z.string(),
    description: z.string(),
    category: z.string(),
    paymentCents: z.number(),
  })),
  restrictions: z.array(z.string()),
});
export type NPIEligibilityResult = z.infer<typeof NPIEligibilityResultSchema>;

// ---------------------------------------------------------------------------
// Specialty-to-Code Mapping
// ---------------------------------------------------------------------------

/**
 * Maps provider taxonomy/specialty keywords to eligible billing code categories.
 * This is the proprietary intelligence layer — knowing which codes each
 * specialty can legally bill.
 */
const SPECIALTY_CODE_MAP: Record<string, { categories: CodeCategory[]; restrictions: string[] }> = {
  // Orthopedic Surgery
  'orthopedic': {
    categories: ['RTM', 'TCM', 'ACP', 'CTS', 'CAREGIVER_TRAINING', 'TEAM', 'ACCESS'],
    restrictions: [
      'Cannot bill CCM directly — refer to PCP or use incident-to billing',
      'RTM requires MSK-specific device/app for data collection',
      'TEAM participation requires CMS enrollment',
    ],
  },
  // Primary Care
  'family medicine': {
    categories: ['CCM', 'RTM', 'TCM', 'ACP', 'PIN', 'CHI', 'CTS', 'CAREGIVER_TRAINING', 'RPM', 'BHI'],
    restrictions: [
      'CCM requires 2+ chronic conditions and documented care plan',
      'BHI requires documented behavioral health diagnosis',
    ],
  },
  'internal medicine': {
    categories: ['CCM', 'RTM', 'TCM', 'ACP', 'PIN', 'CHI', 'CTS', 'CAREGIVER_TRAINING', 'RPM', 'BHI'],
    restrictions: [
      'CCM requires 2+ chronic conditions and documented care plan',
    ],
  },
  // Cardiology
  'cardiology': {
    categories: ['CCM', 'RTM', 'TCM', 'ACP', 'RPM', 'ACCESS'],
    restrictions: [
      'RPM requires FDA-cleared monitoring device',
      'ACCESS CKM track requires CMS enrollment',
    ],
  },
  // Endocrinology
  'endocrinology': {
    categories: ['CCM', 'RTM', 'TCM', 'ACP', 'RPM'],
    restrictions: [
      'RTM data collection must use validated devices',
    ],
  },
  // Psychiatry
  'psychiatry': {
    categories: ['CCM', 'TCM', 'ACP', 'BHI', 'PIN', 'CHI'],
    restrictions: [
      'BHI requires structured assessment tools',
      'CoCM model preferred for collaborative care',
    ],
  },
  // Physical Therapy / Physiatry
  'physical therapy': {
    categories: ['RTM'],
    restrictions: [
      'PT can only bill RTM codes (98975-98981), not CCM or RPM',
      'Must use CMS-approved MSK monitoring platform',
    ],
  },
  'physical medicine': {
    categories: ['CCM', 'RTM', 'TCM', 'ACP', 'RPM'],
    restrictions: [
      'RTM is primary revenue opportunity for physiatry',
    ],
  },
  // Geriatrics
  'geriatric': {
    categories: ['CCM', 'RTM', 'TCM', 'ACP', 'PIN', 'CHI', 'CTS', 'CAREGIVER_TRAINING', 'RPM', 'BHI'],
    restrictions: [
      'Triple-stack opportunity: CCM + RPM + BHI',
      '99483 cognitive assessment is high-value for dementia patients',
    ],
  },
  // Neurology
  'neurology': {
    categories: ['CCM', 'RTM', 'TCM', 'ACP', 'CTS', 'RPM'],
    restrictions: [
      '99483 cognitive assessment available for dementia workup',
    ],
  },
  // Nurse Practitioner
  'nurse practitioner': {
    categories: ['CCM', 'RTM', 'TCM', 'ACP', 'PIN', 'CHI', 'CAREGIVER_TRAINING', 'RPM', 'BHI'],
    restrictions: [
      'Must bill under own NPI or incident-to supervising physician',
      'State scope-of-practice laws may restrict some codes',
    ],
  },
  // Physician Assistant
  'physician assistant': {
    categories: ['CCM', 'RTM', 'TCM', 'ACP', 'PIN', 'CHI', 'CAREGIVER_TRAINING', 'RPM'],
    restrictions: [
      'Must bill under own NPI or incident-to supervising physician',
      'State scope-of-practice laws may restrict some codes',
    ],
  },
};

// ---------------------------------------------------------------------------
// Mapper Functions
// ---------------------------------------------------------------------------

/**
 * Determine the primary specialty from NPPES taxonomy data.
 */
function extractPrimarySpecialty(taxonomies: Taxonomy[]): { specialty: string; taxonomyCode: string } {
  const primary = taxonomies.find((t) => t.primary) ?? taxonomies[0];
  if (!primary) {
    return { specialty: 'Unknown', taxonomyCode: '' };
  }
  return { specialty: primary.desc, taxonomyCode: primary.code };
}

/**
 * Match a specialty description to our internal mapping keys.
 * Returns the best matching key or undefined.
 */
function matchSpecialtyKey(specialty: string): string | undefined {
  const lower = specialty.toLowerCase();
  for (const key of Object.keys(SPECIALTY_CODE_MAP)) {
    if (lower.includes(key)) {
      return key;
    }
  }
  return undefined;
}

/**
 * Extract state licenses from NPPES taxonomy data.
 */
function extractStateLicenses(taxonomies: Taxonomy[]): Array<{ state: string; license: string }> {
  const licenses: Array<{ state: string; license: string }> = [];
  for (const tax of taxonomies) {
    if (tax.state && tax.license) {
      licenses.push({ state: tax.state, license: tax.license });
    }
  }
  return licenses;
}

/**
 * Get eligible billing codes for a set of code categories.
 */
function getEligibleCodes(categories: CodeCategory[]): Array<{
  code: string;
  description: string;
  category: string;
  paymentCents: number;
}> {
  const results: Array<{
    code: string;
    description: string;
    category: string;
    paymentCents: number;
  }> = [];

  for (const entry of BILLING_CODES.values()) {
    if (categories.includes(entry.category)) {
      results.push({
        code: entry.code,
        description: entry.description,
        category: entry.category,
        paymentCents: entry.paymentCents,
      });
    }
  }

  return results;
}

/**
 * Map an NPI (via NPPES result data) to eligible billing codes.
 *
 * @param nppesData - Provider data from NPPES NPI Registry API
 * @returns Eligibility result with codes and restrictions
 */
export function mapNPIToEligibleCodes(nppesData: NPPESResult): NPIEligibilityResult {
  const parsed = NPPESResultSchema.parse(nppesData);

  const providerName = parsed.basic.organization_name ??
    `${parsed.basic.first_name ?? ''} ${parsed.basic.last_name ?? ''}`.trim();

  const { specialty, taxonomyCode } = extractPrimarySpecialty(parsed.taxonomies);
  const stateLicenses = extractStateLicenses(parsed.taxonomies);

  const matchedKey = matchSpecialtyKey(specialty);

  if (!matchedKey) {
    return {
      npi: parsed.number,
      providerName,
      credential: parsed.basic.credential ?? undefined,
      primarySpecialty: specialty,
      taxonomyCode,
      stateLicenses,
      eligibleCodes: [],
      restrictions: [
        `Specialty "${specialty}" not yet mapped in SolvingHealth billing engine. Contact support for manual review.`,
      ],
    };
  }

  const mapping = SPECIALTY_CODE_MAP[matchedKey]!;
  const eligibleCodes = getEligibleCodes(mapping.categories);

  return {
    npi: parsed.number,
    providerName,
    credential: parsed.basic.credential ?? undefined,
    primarySpecialty: specialty,
    taxonomyCode,
    stateLicenses,
    eligibleCodes,
    restrictions: mapping.restrictions,
  };
}

/**
 * Build the NPPES API URL for a given NPI.
 * Use this to fetch data before calling mapNPIToEligibleCodes.
 */
export function buildNPPESUrl(npi: string): string {
  return `https://npiregistry.cms.hhs.gov/api/?number=${encodeURIComponent(npi)}&version=2.1`;
}

/**
 * Build the NPPES search URL for provider name lookup.
 */
export function buildNPPESSearchUrl(params: {
  firstName?: string;
  lastName?: string;
  state?: string;
  taxonomyDescription?: string;
}): string {
  const query = new URLSearchParams({ version: '2.1' });
  if (params.firstName) query.set('first_name', params.firstName);
  if (params.lastName) query.set('last_name', params.lastName);
  if (params.state) query.set('state', params.state);
  if (params.taxonomyDescription) query.set('taxonomy_description', params.taxonomyDescription);
  return `https://npiregistry.cms.hhs.gov/api/?${query.toString()}`;
}
