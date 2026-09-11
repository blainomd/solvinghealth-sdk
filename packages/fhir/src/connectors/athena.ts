/**
 * @solvinghealth/fhir -- athenahealth FHIR R4 Connector
 *
 * Pre-configured connector for athenahealth's FHIR R4 API.
 * athenahealth uses OAuth2 client credentials for authentication.
 *
 * @see https://docs.athenahealth.com/api/guides/fhir-overview
 * @module @solvinghealth/fhir/connectors/athena
 * @license Apache-2.0
 */

import type { FHIRClientConfig } from '../types.js';
import { FHIRClient } from '../client.js';

/** athenahealth API environment */
export type AthenaEnvironment = 'preview' | 'production';

/** Configuration specific to athenahealth FHIR connections */
export interface AthenaConfig {
  /** OAuth2 client ID from athenahealth developer portal */
  clientId: string;
  /** OAuth2 client secret from athenahealth developer portal */
  clientSecret: string;
  /** API environment (default: 'production') */
  environment?: AthenaEnvironment;
  /** Practice ID for practice-scoped operations */
  practiceId?: string;
  /** Custom scopes */
  scopes?: string[];
}

/** athenahealth API base URLs by environment */
const ATHENA_BASE_URLS: Record<AthenaEnvironment, string> = {
  preview: 'https://api.preview.platform.athenahealth.com/fhir/r4',
  production: 'https://api.platform.athenahealth.com/fhir/r4',
};

/** athenahealth token endpoints by environment */
const ATHENA_TOKEN_URLS: Record<AthenaEnvironment, string> = {
  preview: 'https://api.preview.platform.athenahealth.com/oauth2/v1/token',
  production: 'https://api.platform.athenahealth.com/oauth2/v1/token',
};

/**
 * Create a FHIRClientConfig pre-configured for athenahealth's FHIR R4 API.
 *
 * Uses OAuth2 client credentials grant with the athenahealth developer
 * portal credentials. Supports both preview and production environments.
 *
 * @param config - athenahealth-specific configuration
 * @returns A FHIRClientConfig ready to pass to FHIRClient
 *
 * @example
 * ```typescript
 * import { FHIRClient } from '@solvinghealth/fhir';
 * import { createAthenaConfig } from '@solvinghealth/fhir/connectors/athena';
 *
 * const client = new FHIRClient(createAthenaConfig({
 *   clientId: 'my-client-id',
 *   clientSecret: 'my-client-secret',
 *   practiceId: '195900',
 *   environment: 'preview',
 * }));
 *
 * const patient = await client.patient.read('a-patient-id');
 * ```
 */
export function createAthenaConfig(config: AthenaConfig): FHIRClientConfig {
  const env = config.environment ?? 'production';
  const baseUrl = config.practiceId
    ? `${ATHENA_BASE_URLS[env]}/${config.practiceId}`
    : ATHENA_BASE_URLS[env];

  return {
    baseUrl,
    auth: {
      type: 'smart',
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      tokenUrl: ATHENA_TOKEN_URLS[env],
      scopes: config.scopes ?? [
        'system/Patient.read',
        'system/Observation.read',
        'system/Condition.read',
        'system/MedicationRequest.read',
        'system/Encounter.read',
        'system/Procedure.read',
        'system/AllergyIntolerance.read',
        'system/DocumentReference.read',
      ],
    },
    ehr: 'athena',
    rateLimit: 150, // athenahealth allows higher rate limits
    timeout: 30_000,
    retries: 3,
    retryDelay: 1000,
  };
}

/**
 * Create a FHIRClient pre-configured for athenahealth.
 * Convenience function that combines createAthenaConfig + new FHIRClient.
 *
 * @param config - athenahealth-specific configuration
 * @returns A configured FHIRClient instance
 */
export function createAthenaClient(config: AthenaConfig): FHIRClient {
  return new FHIRClient(createAthenaConfig(config));
}

/**
 * athenahealth-specific search capabilities and limitations.
 *
 * athenahealth supports a subset of standard FHIR search parameters.
 * Some parameters behave differently than the FHIR spec describes.
 */
export const ATHENA_SEARCH_NOTES = {
  Patient: {
    supported: ['identifier', 'name', 'family', 'given', 'birthdate', 'gender', 'phone', 'email', '_id'],
    notes: 'athenahealth requires at least one search parameter for Patient searches.',
  },
  Observation: {
    supported: ['patient', 'code', 'category', 'date', '_count'],
    notes: 'Observation searches require patient parameter.',
  },
  Condition: {
    supported: ['patient', 'clinical-status', 'category', 'code', 'onset-date'],
    notes: 'Condition searches require patient parameter.',
  },
  Encounter: {
    supported: ['patient', 'date', 'type', 'class', '_count'],
    notes: 'Encounter searches require patient parameter.',
  },
} as const;
