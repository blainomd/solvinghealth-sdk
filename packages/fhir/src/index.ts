/**
 * @solvinghealth/fhir -- FHIR R4 Client & EHR Connectors
 *
 * Open source FHIR R4 client with type-safe operations, Zod runtime
 * validation, and pre-configured connectors for Epic and athenahealth.
 *
 * @packageDocumentation
 * @module @solvinghealth/fhir
 * @license Apache-2.0
 */

// Core types and Zod schemas
export {
  // Primitive schemas
  FHIRInstantSchema,
  FHIRDateSchema,
  FHIRDateTimeSchema,
  FHIRCanonicalSchema,
  FHIRUriSchema,

  // Complex type schemas
  CodingSchema,
  CodeableConceptSchema,
  IdentifierSchema,
  ReferenceSchema,
  PeriodSchema,
  HumanNameSchema,
  AddressSchema,
  ContactPointSchema,
  QuantitySchema,
  AnnotationSchema,
  DosageSchema,
  AttachmentSchema,
  MetaSchema,

  // Resource schemas
  PatientSchema,
  ObservationSchema,
  MedicationRequestSchema,
  EncounterSchema,
  ConditionSchema,
  ProcedureSchema,
  DocumentReferenceSchema,
  ServiceRequestSchema,
  BundleSchema,
  BundleEntrySchema,
  OperationOutcomeSchema,

  // Resource type enum
  FHIRResourceTypeEnum,

  // TypeScript types (inferred from schemas)
  type FHIRResourceType,
  type Patient,
  type Observation,
  type MedicationRequest,
  type Encounter,
  type Condition,
  type Procedure,
  type DocumentReference,
  type ServiceRequest,
  type Bundle,
  type BundleEntry,
  type OperationOutcome,

  // Config and search types
  type FHIRSearchParams,
  type FHIRAuthConfig,
  type FHIRClientConfig,
  type PaginatedResult,
  type BatchOperation,
  type PatchOperation,
} from './types.js';

// Client
export { FHIRClient, ResourceClient, FHIRError, FHIRAuthError } from './client.js';

// EHR Connectors
export { createEpicConfig, createEpicClient, EPIC_SCOPES, type EpicConfig } from './connectors/epic.js';
export { createAthenaConfig, createAthenaClient, ATHENA_SEARCH_NOTES, type AthenaConfig, type AthenaEnvironment } from './connectors/athena.js';

// Omaha System to FHIR mapper
export {
  mapOmahaProblemToCondition,
  mapOmahaKBSToObservations,
  mapOmahaAssessmentToFHIR,
  getSnomedMapping,
  listAllMappings,
  type OmahaDomain,
  type OmahaProblem,
  type SubjectReference,
} from './omaha-to-fhir.js';
