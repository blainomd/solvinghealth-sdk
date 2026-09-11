/**
 * @solvinghealth/fhir -- FHIR R4 Type Definitions
 *
 * Zod schemas for runtime validation of FHIR R4 resources.
 * These schemas validate the most commonly used resource types
 * in healthcare AI applications: Patient, Observation, MedicationRequest,
 * Encounter, Condition, Procedure, DocumentReference, and ServiceRequest.
 *
 * @module @solvinghealth/fhir/types
 * @license Apache-2.0
 */

import { z } from 'zod';

// ─── FHIR Primitive Schemas ─────────────────────────────────

/** FHIR instant (xs:dateTime with timezone) */
export const FHIRInstantSchema = z.string().regex(
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/,
  'Must be a valid FHIR instant (YYYY-MM-DDThh:mm:ss.sss+zz:zz)'
);

/** FHIR date (YYYY, YYYY-MM, or YYYY-MM-DD) */
export const FHIRDateSchema = z.string().regex(
  /^\d{4}(-\d{2}(-\d{2})?)?$/,
  'Must be a valid FHIR date (YYYY, YYYY-MM, or YYYY-MM-DD)'
);

/** FHIR dateTime (date with optional time) */
export const FHIRDateTimeSchema = z.string().regex(
  /^\d{4}(-\d{2}(-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2}))?)?)?$/,
  'Must be a valid FHIR dateTime'
);

/** FHIR canonical URL */
export const FHIRCanonicalSchema = z.string().url();

/** FHIR URI */
export const FHIRUriSchema = z.string().min(1);

// ─── FHIR Complex Type Schemas ──────────────────────────────

/** FHIR Coding -- a single code in a code system */
export const CodingSchema = z.object({
  system: FHIRUriSchema.optional(),
  version: z.string().optional(),
  code: z.string().optional(),
  display: z.string().optional(),
  userSelected: z.boolean().optional(),
});

/** FHIR CodeableConcept -- a set of codes from different systems */
export const CodeableConceptSchema = z.object({
  coding: z.array(CodingSchema).optional(),
  text: z.string().optional(),
});

/** FHIR Identifier -- business identifier for a resource */
export const IdentifierSchema = z.object({
  use: z.enum(['usual', 'official', 'temp', 'secondary', 'old']).optional(),
  type: CodeableConceptSchema.optional(),
  system: FHIRUriSchema.optional(),
  value: z.string().optional(),
  period: z.object({
    start: FHIRDateTimeSchema.optional(),
    end: FHIRDateTimeSchema.optional(),
  }).optional(),
});

/** FHIR Reference -- typed reference to another resource */
export const ReferenceSchema = z.object({
  reference: z.string().optional(),
  type: FHIRUriSchema.optional(),
  identifier: IdentifierSchema.optional(),
  display: z.string().optional(),
});

/** FHIR Period */
export const PeriodSchema = z.object({
  start: FHIRDateTimeSchema.optional(),
  end: FHIRDateTimeSchema.optional(),
});

/** FHIR HumanName */
export const HumanNameSchema = z.object({
  use: z.enum(['usual', 'official', 'temp', 'nickname', 'anonymous', 'old', 'maiden']).optional(),
  text: z.string().optional(),
  family: z.string().optional(),
  given: z.array(z.string()).optional(),
  prefix: z.array(z.string()).optional(),
  suffix: z.array(z.string()).optional(),
  period: PeriodSchema.optional(),
});

/** FHIR Address */
export const AddressSchema = z.object({
  use: z.enum(['home', 'work', 'temp', 'old', 'billing']).optional(),
  type: z.enum(['postal', 'physical', 'both']).optional(),
  text: z.string().optional(),
  line: z.array(z.string()).optional(),
  city: z.string().optional(),
  district: z.string().optional(),
  state: z.string().optional(),
  postalCode: z.string().optional(),
  country: z.string().optional(),
  period: PeriodSchema.optional(),
});

/** FHIR ContactPoint (phone, email, etc.) */
export const ContactPointSchema = z.object({
  system: z.enum(['phone', 'fax', 'email', 'pager', 'url', 'sms', 'other']).optional(),
  value: z.string().optional(),
  use: z.enum(['home', 'work', 'temp', 'old', 'mobile']).optional(),
  rank: z.number().int().positive().optional(),
  period: PeriodSchema.optional(),
});

/** FHIR Quantity */
export const QuantitySchema = z.object({
  value: z.number().optional(),
  comparator: z.enum(['<', '<=', '>=', '>']).optional(),
  unit: z.string().optional(),
  system: FHIRUriSchema.optional(),
  code: z.string().optional(),
});

/** FHIR Annotation */
export const AnnotationSchema = z.object({
  authorReference: ReferenceSchema.optional(),
  authorString: z.string().optional(),
  time: FHIRDateTimeSchema.optional(),
  text: z.string(),
});

/** FHIR Dosage */
export const DosageSchema = z.object({
  sequence: z.number().int().optional(),
  text: z.string().optional(),
  timing: z.object({
    repeat: z.object({
      frequency: z.number().int().optional(),
      period: z.number().optional(),
      periodUnit: z.enum(['s', 'min', 'h', 'd', 'wk', 'mo', 'a']).optional(),
    }).optional(),
    code: CodeableConceptSchema.optional(),
  }).optional(),
  route: CodeableConceptSchema.optional(),
  doseAndRate: z.array(z.object({
    type: CodeableConceptSchema.optional(),
    doseQuantity: QuantitySchema.optional(),
    rateQuantity: QuantitySchema.optional(),
  })).optional(),
});

/** FHIR Attachment */
export const AttachmentSchema = z.object({
  contentType: z.string().optional(),
  language: z.string().optional(),
  data: z.string().optional(),
  url: z.string().optional(),
  size: z.number().int().optional(),
  hash: z.string().optional(),
  title: z.string().optional(),
  creation: FHIRDateTimeSchema.optional(),
});

// ─── FHIR Meta Schema ──────────────────────────────────────

export const MetaSchema = z.object({
  versionId: z.string().optional(),
  lastUpdated: FHIRInstantSchema.optional(),
  source: FHIRUriSchema.optional(),
  profile: z.array(FHIRCanonicalSchema).optional(),
  security: z.array(CodingSchema).optional(),
  tag: z.array(CodingSchema).optional(),
});

// ─── FHIR Resource Types ───────────────────────────────────

export const FHIRResourceTypeEnum = z.enum([
  'Patient', 'Practitioner', 'Encounter', 'Observation',
  'Condition', 'Procedure', 'MedicationRequest', 'AllergyIntolerance',
  'DiagnosticReport', 'CarePlan', 'Goal', 'QuestionnaireResponse',
  'DocumentReference', 'Claim', 'Organization', 'Location',
  'ServiceRequest', 'Bundle',
]);

export type FHIRResourceType = z.infer<typeof FHIRResourceTypeEnum>;

// ─── Patient Resource ──────────────────────────────────────

export const PatientSchema = z.object({
  resourceType: z.literal('Patient'),
  id: z.string().optional(),
  meta: MetaSchema.optional(),
  identifier: z.array(IdentifierSchema).optional(),
  active: z.boolean().optional(),
  name: z.array(HumanNameSchema).optional(),
  telecom: z.array(ContactPointSchema).optional(),
  gender: z.enum(['male', 'female', 'other', 'unknown']).optional(),
  birthDate: FHIRDateSchema.optional(),
  deceasedBoolean: z.boolean().optional(),
  deceasedDateTime: FHIRDateTimeSchema.optional(),
  address: z.array(AddressSchema).optional(),
  maritalStatus: CodeableConceptSchema.optional(),
  multipleBirthBoolean: z.boolean().optional(),
  multipleBirthInteger: z.number().int().optional(),
  contact: z.array(z.object({
    relationship: z.array(CodeableConceptSchema).optional(),
    name: HumanNameSchema.optional(),
    telecom: z.array(ContactPointSchema).optional(),
    address: AddressSchema.optional(),
    gender: z.enum(['male', 'female', 'other', 'unknown']).optional(),
    organization: ReferenceSchema.optional(),
    period: PeriodSchema.optional(),
  })).optional(),
  communication: z.array(z.object({
    language: CodeableConceptSchema,
    preferred: z.boolean().optional(),
  })).optional(),
  generalPractitioner: z.array(ReferenceSchema).optional(),
  managingOrganization: ReferenceSchema.optional(),
});

export type Patient = z.infer<typeof PatientSchema>;

// ─── Observation Resource ──────────────────────────────────

export const ObservationSchema = z.object({
  resourceType: z.literal('Observation'),
  id: z.string().optional(),
  meta: MetaSchema.optional(),
  identifier: z.array(IdentifierSchema).optional(),
  status: z.enum(['registered', 'preliminary', 'final', 'amended', 'corrected', 'cancelled', 'entered-in-error', 'unknown']),
  category: z.array(CodeableConceptSchema).optional(),
  code: CodeableConceptSchema,
  subject: ReferenceSchema.optional(),
  encounter: ReferenceSchema.optional(),
  effectiveDateTime: FHIRDateTimeSchema.optional(),
  effectivePeriod: PeriodSchema.optional(),
  issued: FHIRInstantSchema.optional(),
  performer: z.array(ReferenceSchema).optional(),
  valueQuantity: QuantitySchema.optional(),
  valueCodeableConcept: CodeableConceptSchema.optional(),
  valueString: z.string().optional(),
  valueBoolean: z.boolean().optional(),
  valueInteger: z.number().int().optional(),
  dataAbsentReason: CodeableConceptSchema.optional(),
  interpretation: z.array(CodeableConceptSchema).optional(),
  note: z.array(AnnotationSchema).optional(),
  bodySite: CodeableConceptSchema.optional(),
  method: CodeableConceptSchema.optional(),
  referenceRange: z.array(z.object({
    low: QuantitySchema.optional(),
    high: QuantitySchema.optional(),
    type: CodeableConceptSchema.optional(),
    appliesTo: z.array(CodeableConceptSchema).optional(),
    age: z.object({
      low: QuantitySchema.optional(),
      high: QuantitySchema.optional(),
    }).optional(),
    text: z.string().optional(),
  })).optional(),
  component: z.array(z.object({
    code: CodeableConceptSchema,
    valueQuantity: QuantitySchema.optional(),
    valueCodeableConcept: CodeableConceptSchema.optional(),
    valueString: z.string().optional(),
    dataAbsentReason: CodeableConceptSchema.optional(),
    interpretation: z.array(CodeableConceptSchema).optional(),
  })).optional(),
});

export type Observation = z.infer<typeof ObservationSchema>;

// ─── MedicationRequest Resource ────────────────────────────

export const MedicationRequestSchema = z.object({
  resourceType: z.literal('MedicationRequest'),
  id: z.string().optional(),
  meta: MetaSchema.optional(),
  identifier: z.array(IdentifierSchema).optional(),
  status: z.enum(['active', 'on-hold', 'cancelled', 'completed', 'entered-in-error', 'stopped', 'draft', 'unknown']),
  statusReason: CodeableConceptSchema.optional(),
  intent: z.enum(['proposal', 'plan', 'order', 'original-order', 'reflex-order', 'filler-order', 'instance-order', 'option']),
  category: z.array(CodeableConceptSchema).optional(),
  priority: z.enum(['routine', 'urgent', 'asap', 'stat']).optional(),
  medicationCodeableConcept: CodeableConceptSchema.optional(),
  medicationReference: ReferenceSchema.optional(),
  subject: ReferenceSchema,
  encounter: ReferenceSchema.optional(),
  authoredOn: FHIRDateTimeSchema.optional(),
  requester: ReferenceSchema.optional(),
  performer: ReferenceSchema.optional(),
  reasonCode: z.array(CodeableConceptSchema).optional(),
  reasonReference: z.array(ReferenceSchema).optional(),
  note: z.array(AnnotationSchema).optional(),
  dosageInstruction: z.array(DosageSchema).optional(),
  dispenseRequest: z.object({
    numberOfRepeatsAllowed: z.number().int().optional(),
    quantity: QuantitySchema.optional(),
    expectedSupplyDuration: z.object({
      value: z.number().optional(),
      unit: z.string().optional(),
      system: FHIRUriSchema.optional(),
      code: z.string().optional(),
    }).optional(),
    performer: ReferenceSchema.optional(),
  }).optional(),
  substitution: z.object({
    allowedBoolean: z.boolean().optional(),
    allowedCodeableConcept: CodeableConceptSchema.optional(),
    reason: CodeableConceptSchema.optional(),
  }).optional(),
});

export type MedicationRequest = z.infer<typeof MedicationRequestSchema>;

// ─── Encounter Resource ────────────────────────────────────

export const EncounterSchema = z.object({
  resourceType: z.literal('Encounter'),
  id: z.string().optional(),
  meta: MetaSchema.optional(),
  identifier: z.array(IdentifierSchema).optional(),
  status: z.enum(['planned', 'arrived', 'triaged', 'in-progress', 'onleave', 'finished', 'cancelled', 'entered-in-error', 'unknown']),
  statusHistory: z.array(z.object({
    status: z.enum(['planned', 'arrived', 'triaged', 'in-progress', 'onleave', 'finished', 'cancelled', 'entered-in-error', 'unknown']),
    period: PeriodSchema,
  })).optional(),
  class: CodingSchema,
  classHistory: z.array(z.object({
    class: CodingSchema,
    period: PeriodSchema,
  })).optional(),
  type: z.array(CodeableConceptSchema).optional(),
  serviceType: CodeableConceptSchema.optional(),
  priority: CodeableConceptSchema.optional(),
  subject: ReferenceSchema.optional(),
  participant: z.array(z.object({
    type: z.array(CodeableConceptSchema).optional(),
    period: PeriodSchema.optional(),
    individual: ReferenceSchema.optional(),
  })).optional(),
  period: PeriodSchema.optional(),
  length: QuantitySchema.optional(),
  reasonCode: z.array(CodeableConceptSchema).optional(),
  reasonReference: z.array(ReferenceSchema).optional(),
  diagnosis: z.array(z.object({
    condition: ReferenceSchema,
    use: CodeableConceptSchema.optional(),
    rank: z.number().int().positive().optional(),
  })).optional(),
  hospitalization: z.object({
    preAdmissionIdentifier: IdentifierSchema.optional(),
    origin: ReferenceSchema.optional(),
    admitSource: CodeableConceptSchema.optional(),
    reAdmission: CodeableConceptSchema.optional(),
    dietPreference: z.array(CodeableConceptSchema).optional(),
    destination: ReferenceSchema.optional(),
    dischargeDisposition: CodeableConceptSchema.optional(),
  }).optional(),
  location: z.array(z.object({
    location: ReferenceSchema,
    status: z.enum(['planned', 'active', 'reserved', 'completed']).optional(),
    physicalType: CodeableConceptSchema.optional(),
    period: PeriodSchema.optional(),
  })).optional(),
  serviceProvider: ReferenceSchema.optional(),
});

export type Encounter = z.infer<typeof EncounterSchema>;

// ─── Condition Resource ────────────────────────────────────

export const ConditionSchema = z.object({
  resourceType: z.literal('Condition'),
  id: z.string().optional(),
  meta: MetaSchema.optional(),
  identifier: z.array(IdentifierSchema).optional(),
  clinicalStatus: CodeableConceptSchema.optional(),
  verificationStatus: CodeableConceptSchema.optional(),
  category: z.array(CodeableConceptSchema).optional(),
  severity: CodeableConceptSchema.optional(),
  code: CodeableConceptSchema.optional(),
  bodySite: z.array(CodeableConceptSchema).optional(),
  subject: ReferenceSchema,
  encounter: ReferenceSchema.optional(),
  onsetDateTime: FHIRDateTimeSchema.optional(),
  onsetAge: QuantitySchema.optional(),
  onsetPeriod: PeriodSchema.optional(),
  onsetString: z.string().optional(),
  abatementDateTime: FHIRDateTimeSchema.optional(),
  abatementAge: QuantitySchema.optional(),
  abatementPeriod: PeriodSchema.optional(),
  abatementString: z.string().optional(),
  recordedDate: FHIRDateTimeSchema.optional(),
  recorder: ReferenceSchema.optional(),
  asserter: ReferenceSchema.optional(),
  stage: z.array(z.object({
    summary: CodeableConceptSchema.optional(),
    assessment: z.array(ReferenceSchema).optional(),
    type: CodeableConceptSchema.optional(),
  })).optional(),
  evidence: z.array(z.object({
    code: z.array(CodeableConceptSchema).optional(),
    detail: z.array(ReferenceSchema).optional(),
  })).optional(),
  note: z.array(AnnotationSchema).optional(),
});

export type Condition = z.infer<typeof ConditionSchema>;

// ─── Procedure Resource ────────────────────────────────────

export const ProcedureSchema = z.object({
  resourceType: z.literal('Procedure'),
  id: z.string().optional(),
  meta: MetaSchema.optional(),
  identifier: z.array(IdentifierSchema).optional(),
  status: z.enum(['preparation', 'in-progress', 'not-done', 'on-hold', 'stopped', 'completed', 'entered-in-error', 'unknown']),
  statusReason: CodeableConceptSchema.optional(),
  category: CodeableConceptSchema.optional(),
  code: CodeableConceptSchema.optional(),
  subject: ReferenceSchema,
  encounter: ReferenceSchema.optional(),
  performedDateTime: FHIRDateTimeSchema.optional(),
  performedPeriod: PeriodSchema.optional(),
  performedString: z.string().optional(),
  recorder: ReferenceSchema.optional(),
  asserter: ReferenceSchema.optional(),
  performer: z.array(z.object({
    function: CodeableConceptSchema.optional(),
    actor: ReferenceSchema,
    onBehalfOf: ReferenceSchema.optional(),
  })).optional(),
  location: ReferenceSchema.optional(),
  reasonCode: z.array(CodeableConceptSchema).optional(),
  reasonReference: z.array(ReferenceSchema).optional(),
  bodySite: z.array(CodeableConceptSchema).optional(),
  outcome: CodeableConceptSchema.optional(),
  report: z.array(ReferenceSchema).optional(),
  complication: z.array(CodeableConceptSchema).optional(),
  followUp: z.array(CodeableConceptSchema).optional(),
  note: z.array(AnnotationSchema).optional(),
  usedCode: z.array(CodeableConceptSchema).optional(),
});

export type Procedure = z.infer<typeof ProcedureSchema>;

// ─── DocumentReference Resource ────────────────────────────

export const DocumentReferenceSchema = z.object({
  resourceType: z.literal('DocumentReference'),
  id: z.string().optional(),
  meta: MetaSchema.optional(),
  masterIdentifier: IdentifierSchema.optional(),
  identifier: z.array(IdentifierSchema).optional(),
  status: z.enum(['current', 'superseded', 'entered-in-error']),
  docStatus: z.enum(['preliminary', 'final', 'amended', 'entered-in-error']).optional(),
  type: CodeableConceptSchema.optional(),
  category: z.array(CodeableConceptSchema).optional(),
  subject: ReferenceSchema.optional(),
  date: FHIRInstantSchema.optional(),
  author: z.array(ReferenceSchema).optional(),
  authenticator: ReferenceSchema.optional(),
  custodian: ReferenceSchema.optional(),
  description: z.string().optional(),
  securityLabel: z.array(CodeableConceptSchema).optional(),
  content: z.array(z.object({
    attachment: AttachmentSchema,
    format: CodingSchema.optional(),
  })),
  context: z.object({
    encounter: z.array(ReferenceSchema).optional(),
    event: z.array(CodeableConceptSchema).optional(),
    period: PeriodSchema.optional(),
    facilityType: CodeableConceptSchema.optional(),
    practiceSetting: CodeableConceptSchema.optional(),
    sourcePatientInfo: ReferenceSchema.optional(),
    related: z.array(ReferenceSchema).optional(),
  }).optional(),
});

export type DocumentReference = z.infer<typeof DocumentReferenceSchema>;

// ─── ServiceRequest Resource ───────────────────────────────

export const ServiceRequestSchema = z.object({
  resourceType: z.literal('ServiceRequest'),
  id: z.string().optional(),
  meta: MetaSchema.optional(),
  identifier: z.array(IdentifierSchema).optional(),
  status: z.enum(['draft', 'active', 'on-hold', 'revoked', 'completed', 'entered-in-error', 'unknown']),
  intent: z.enum(['proposal', 'plan', 'directive', 'order', 'original-order', 'reflex-order', 'filler-order', 'instance-order', 'option']),
  category: z.array(CodeableConceptSchema).optional(),
  priority: z.enum(['routine', 'urgent', 'asap', 'stat']).optional(),
  doNotPerform: z.boolean().optional(),
  code: CodeableConceptSchema.optional(),
  orderDetail: z.array(CodeableConceptSchema).optional(),
  quantityQuantity: QuantitySchema.optional(),
  subject: ReferenceSchema,
  encounter: ReferenceSchema.optional(),
  occurrenceDateTime: FHIRDateTimeSchema.optional(),
  occurrencePeriod: PeriodSchema.optional(),
  authoredOn: FHIRDateTimeSchema.optional(),
  requester: ReferenceSchema.optional(),
  performerType: CodeableConceptSchema.optional(),
  performer: z.array(ReferenceSchema).optional(),
  locationCode: z.array(CodeableConceptSchema).optional(),
  reasonCode: z.array(CodeableConceptSchema).optional(),
  reasonReference: z.array(ReferenceSchema).optional(),
  insurance: z.array(ReferenceSchema).optional(),
  supportingInfo: z.array(ReferenceSchema).optional(),
  note: z.array(AnnotationSchema).optional(),
  patientInstruction: z.string().optional(),
});

export type ServiceRequest = z.infer<typeof ServiceRequestSchema>;

// ─── Bundle Resource ───────────────────────────────────────

export const BundleEntrySchema = z.object({
  fullUrl: z.string().optional(),
  resource: z.record(z.unknown()).optional(),
  search: z.object({
    mode: z.enum(['match', 'include', 'outcome']).optional(),
    score: z.number().optional(),
  }).optional(),
  request: z.object({
    method: z.enum(['GET', 'HEAD', 'POST', 'PUT', 'DELETE', 'PATCH']),
    url: z.string(),
    ifNoneMatch: z.string().optional(),
    ifModifiedSince: FHIRInstantSchema.optional(),
    ifMatch: z.string().optional(),
    ifNoneExist: z.string().optional(),
  }).optional(),
  response: z.object({
    status: z.string(),
    location: z.string().optional(),
    etag: z.string().optional(),
    lastModified: FHIRInstantSchema.optional(),
    outcome: z.record(z.unknown()).optional(),
  }).optional(),
});

export const BundleSchema = z.object({
  resourceType: z.literal('Bundle'),
  id: z.string().optional(),
  meta: MetaSchema.optional(),
  type: z.enum(['document', 'message', 'transaction', 'transaction-response', 'batch', 'batch-response', 'history', 'searchset', 'collection']),
  total: z.number().int().nonnegative().optional(),
  link: z.array(z.object({
    relation: z.string(),
    url: z.string(),
  })).optional(),
  entry: z.array(BundleEntrySchema).optional(),
});

export type Bundle = z.infer<typeof BundleSchema>;
export type BundleEntry = z.infer<typeof BundleEntrySchema>;

// ─── Search and Config Types ───────────────────────────────

/** FHIR search parameters */
export interface FHIRSearchParams {
  [param: string]: string | number | boolean | string[] | undefined;
  _count?: number;
  _offset?: number;
  _sort?: string;
  _include?: string | string[];
  _revinclude?: string | string[];
  _summary?: 'true' | 'text' | 'data' | 'count';
  _elements?: string;
}

/** Authentication configuration for FHIR servers */
export type FHIRAuthConfig =
  | { type: 'bearer'; token: string }
  | { type: 'smart'; clientId: string; clientSecret: string; tokenUrl: string; scopes?: string[] }
  | { type: 'basic'; username: string; password: string }
  | { type: 'backend'; clientId: string; privateKey: string; tokenUrl: string };

/** FHIR client configuration */
export interface FHIRClientConfig {
  /** Base URL of the FHIR server (e.g., https://fhir.epic.com/interconnect-fhir-oauth/api/FHIR/R4) */
  baseUrl: string;
  /** Authentication configuration */
  auth: FHIRAuthConfig;
  /** EHR vendor hint for vendor-specific behavior */
  ehr?: 'epic' | 'cerner' | 'athena' | 'generic';
  /** Number of retry attempts on transient failures (default: 3) */
  retries?: number;
  /** Delay between retries in ms (default: 1000) */
  retryDelay?: number;
  /** Max requests per minute (default: 100) */
  rateLimit?: number;
  /** Request timeout in ms (default: 30000) */
  timeout?: number;
  /** Custom headers to include in every request */
  headers?: Record<string, string>;
}

/** Paginated search result */
export interface PaginatedResult<T> {
  /** Resources returned in this page */
  resources: T[];
  /** Total count of matching resources (if server provides it) */
  total: number | undefined;
  /** Whether there are more pages */
  hasNext: boolean;
  /** Whether there is a previous page */
  hasPrevious: boolean;
  /** Fetch the next page */
  next: () => Promise<PaginatedResult<T>>;
  /** Fetch the previous page */
  previous: () => Promise<PaginatedResult<T>>;
}

/** Batch/transaction operation */
export interface BatchOperation {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  url: string;
  resource?: Record<string, unknown>;
  ifMatch?: string;
}

/** JSON Patch operation */
export interface PatchOperation {
  op: 'add' | 'remove' | 'replace' | 'move' | 'copy' | 'test';
  path: string;
  value?: unknown;
  from?: string;
}

/** FHIR OperationOutcome for error handling */
export const OperationOutcomeSchema = z.object({
  resourceType: z.literal('OperationOutcome'),
  issue: z.array(z.object({
    severity: z.enum(['fatal', 'error', 'warning', 'information']),
    code: z.string(),
    details: CodeableConceptSchema.optional(),
    diagnostics: z.string().optional(),
    location: z.array(z.string()).optional(),
    expression: z.array(z.string()).optional(),
  })),
});

export type OperationOutcome = z.infer<typeof OperationOutcomeSchema>;
