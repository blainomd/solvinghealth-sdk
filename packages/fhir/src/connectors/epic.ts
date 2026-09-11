/**
 * @solvinghealth/fhir -- Epic FHIR R4 Connector
 *
 * Pre-configured connector for Epic's FHIR R4 API with OAuth2
 * SMART on FHIR backend services authentication.
 *
 * Epic uses a JWT-based backend services auth flow where the client
 * signs a JWT assertion with an RSA private key registered with Epic.
 *
 * @see https://fhir.epic.com/Documentation?docId=oauth2
 * @module @solvinghealth/fhir/connectors/epic
 * @license Apache-2.0
 */

import type { FHIRClientConfig } from '../types.js';
import { FHIRClient } from '../client.js';

/** Configuration specific to Epic FHIR connections */
export interface EpicConfig {
  /** Epic FHIR R4 base URL (e.g., https://fhir.epic.com/interconnect-fhir-oauth/api/FHIR/R4) */
  fhirBaseUrl: string;
  /** Epic OAuth2 base URL (e.g., https://fhir.epic.com/interconnect-fhir-oauth) */
  baseUrl: string;
  /** Client ID registered with Epic's App Orchard */
  clientId: string;
  /** RSA private key (PEM format) for JWT signing */
  privateKey: string;
  /** Custom scopes (default: system/*.read system/*.write) */
  scopes?: string[];
}

/**
 * Epic-specific FHIR R4 scopes organized by resource type.
 * Use these to request only the access you need.
 */
export const EPIC_SCOPES = {
  /** Read patient demographics */
  PATIENT_READ: 'system/Patient.read',
  /** Read clinical observations (vitals, labs) */
  OBSERVATION_READ: 'system/Observation.read',
  /** Read conditions/problem list */
  CONDITION_READ: 'system/Condition.read',
  /** Read medication requests */
  MEDICATION_READ: 'system/MedicationRequest.read',
  /** Read encounters */
  ENCOUNTER_READ: 'system/Encounter.read',
  /** Read procedures */
  PROCEDURE_READ: 'system/Procedure.read',
  /** Read allergies */
  ALLERGY_READ: 'system/AllergyIntolerance.read',
  /** Read diagnostic reports */
  DIAGNOSTIC_READ: 'system/DiagnosticReport.read',
  /** Read document references */
  DOCUMENT_READ: 'system/DocumentReference.read',
  /** Read care plans */
  CARE_PLAN_READ: 'system/CarePlan.read',
  /** Write observations */
  OBSERVATION_WRITE: 'system/Observation.write',
  /** Write document references */
  DOCUMENT_WRITE: 'system/DocumentReference.write',
  /** All read access */
  ALL_READ: 'system/*.read',
  /** All write access */
  ALL_WRITE: 'system/*.write',
} as const;

/**
 * Create a FHIRClientConfig pre-configured for Epic's FHIR R4 API.
 *
 * Uses backend services (JWT assertion) authentication, which is
 * required for server-to-server integrations with Epic.
 *
 * @param config - Epic-specific configuration
 * @returns A FHIRClientConfig ready to pass to FHIRClient
 *
 * @example
 * ```typescript
 * import { FHIRClient } from '@solvinghealth/fhir';
 * import { createEpicConfig } from '@solvinghealth/fhir/connectors/epic';
 *
 * const client = new FHIRClient(createEpicConfig({
 *   fhirBaseUrl: 'https://fhir.epic.com/interconnect-fhir-oauth/api/FHIR/R4',
 *   baseUrl: 'https://fhir.epic.com/interconnect-fhir-oauth',
 *   clientId: 'my-app-id',
 *   privateKey: fs.readFileSync('./epic-key.pem', 'utf-8'),
 * }));
 *
 * const patient = await client.patient.read('e63wRTbPfr1p8UW81d8Seiw3');
 * ```
 */
export function createEpicConfig(config: EpicConfig): FHIRClientConfig {
  return {
    baseUrl: config.fhirBaseUrl,
    auth: {
      type: 'backend',
      clientId: config.clientId,
      privateKey: config.privateKey,
      tokenUrl: `${config.baseUrl}/oauth2/token`,
    },
    ehr: 'epic',
    rateLimit: 60, // Epic's default rate limit
    timeout: 30_000,
    retries: 3,
    retryDelay: 1000,
  };
}

/**
 * Create a FHIRClient pre-configured for Epic.
 * Convenience function that combines createEpicConfig + new FHIRClient.
 *
 * @param config - Epic-specific configuration
 * @returns A configured FHIRClient instance
 */
export function createEpicClient(config: EpicConfig): FHIRClient {
  return new FHIRClient(createEpicConfig(config));
}

/**
 * Epic-specific patient search parameters.
 * Epic supports a subset of FHIR search parameters with specific constraints.
 */
export interface EpicPatientSearchParams {
  /** Patient MRN (requires system prefix) */
  identifier?: string;
  /** Family name */
  family?: string;
  /** Given name */
  given?: string;
  /** Date of birth (YYYY-MM-DD) */
  birthdate?: string;
  /** Administrative gender */
  gender?: 'male' | 'female' | 'other' | 'unknown';
  /** Phone number */
  phone?: string;
  /** Email address */
  email?: string;
  /** Address city */
  'address-city'?: string;
  /** Address state */
  'address-state'?: string;
  /** Address postal code */
  'address-postalcode'?: string;
  /** Max results per page (default: 10, max: 100 for Epic) */
  _count?: number;
}
