/**
 * @solvinghealth/identity — Remote Online Notarization (RON)
 *
 * Photo ID verification flow, face matching integration points,
 * state registry submission format, RON session management,
 * and advance directive document packaging.
 *
 * Integration point for Proof API (identity verification).
 * Target: 35-40 states with clear RON legislation.
 *
 * MIT License
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

export const RONSessionStatusSchema = z.enum([
  'created',
  'id_verification_pending',
  'id_verified',
  'face_matching_pending',
  'face_matched',
  'notary_assigned',
  'in_session',
  'documents_signed',
  'notarized',
  'submitted_to_registry',
  'completed',
  'failed',
  'expired',
]);
export type RONSessionStatus = z.infer<typeof RONSessionStatusSchema>;

export const IDDocumentTypeSchema = z.enum([
  'drivers_license',
  'passport',
  'state_id',
  'military_id',
  'permanent_resident_card',
]);
export type IDDocumentType = z.infer<typeof IDDocumentTypeSchema>;

export const IDVerificationResultSchema = z.object({
  /** Whether the ID document passed verification */
  verified: z.boolean(),
  /** Document type detected */
  documentType: IDDocumentTypeSchema,
  /** Issuing state/country */
  issuingAuthority: z.string(),
  /** Extracted name from document */
  extractedName: z.object({
    first: z.string(),
    middle: z.string().optional(),
    last: z.string(),
  }),
  /** Date of birth from document */
  dateOfBirth: z.string(),
  /** Document expiration */
  documentExpiration: z.string(),
  /** Whether document is expired */
  isExpired: z.boolean(),
  /** Confidence score (0-1) */
  confidence: z.number().min(0).max(1),
  /** Verification provider reference */
  providerRef: z.string().optional(),
  /** Timestamp */
  verifiedAt: z.string().datetime(),
  /** Failure reasons (if verification failed) */
  failureReasons: z.array(z.string()),
});
export type IDVerificationResult = z.infer<typeof IDVerificationResultSchema>;

export const FaceMatchResultSchema = z.object({
  /** Whether face matches ID photo */
  matched: z.boolean(),
  /** Similarity score (0-1) */
  similarityScore: z.number().min(0).max(1),
  /** Liveness detection passed */
  livenessDetected: z.boolean(),
  /** Provider reference */
  providerRef: z.string().optional(),
  /** Timestamp */
  matchedAt: z.string().datetime(),
  /** Failure reasons */
  failureReasons: z.array(z.string()),
});
export type FaceMatchResult = z.infer<typeof FaceMatchResultSchema>;

export const DocumentTypeSchema = z.enum([
  'advance_directive',
  'living_will',
  'healthcare_proxy',
  'durable_power_of_attorney',
  'polst',
  'dnr_order',
  'hipaa_authorization',
  'general_notarization',
]);
export type DocumentType = z.infer<typeof DocumentTypeSchema>;

export const RONDocumentSchema = z.object({
  /** Document identifier */
  documentId: z.string(),
  /** Document type */
  type: DocumentTypeSchema,
  /** Document title */
  title: z.string(),
  /** Signer information */
  signer: z.object({
    name: z.string(),
    email: z.string().email(),
    dateOfBirth: z.string(),
  }),
  /** Witness information (if required) */
  witnesses: z.array(z.object({
    name: z.string(),
    email: z.string().email(),
    role: z.string(),
  })),
  /** Document content hash (SHA-256) */
  contentHash: z.string(),
  /** Number of pages */
  pageCount: z.number().int().positive(),
  /** Created timestamp */
  createdAt: z.string().datetime(),
  /** Signed timestamp */
  signedAt: z.string().datetime().optional(),
  /** Notarized timestamp */
  notarizedAt: z.string().datetime().optional(),
});
export type RONDocument = z.infer<typeof RONDocumentSchema>;

export const RONSessionSchema = z.object({
  /** Unique session identifier */
  sessionId: z.string(),
  /** Current status */
  status: RONSessionStatusSchema,
  /** Principal (person being notarized) */
  principal: z.object({
    name: z.string(),
    email: z.string().email(),
    dateOfBirth: z.string(),
    state: z.string().length(2),
  }),
  /** Notary information (assigned after verification) */
  notary: z.object({
    name: z.string(),
    commissionNumber: z.string(),
    commissionState: z.string().length(2),
    commissionExpiration: z.string(),
  }).optional(),
  /** ID verification result */
  idVerification: IDVerificationResultSchema.optional(),
  /** Face matching result */
  faceMatch: FaceMatchResultSchema.optional(),
  /** Documents to be notarized */
  documents: z.array(RONDocumentSchema),
  /** Audio/video recording reference (required by most RON states) */
  recordingRef: z.string().optional(),
  /** Session creation timestamp */
  createdAt: z.string().datetime(),
  /** Session completion timestamp */
  completedAt: z.string().datetime().optional(),
  /** Session expiry (typically 30 minutes) */
  expiresAt: z.string().datetime(),
  /** State governing this RON session */
  governingState: z.string().length(2),
  /** Audit trail */
  auditLog: z.array(z.object({
    action: z.string(),
    timestamp: z.string().datetime(),
    actor: z.string(),
    details: z.string().optional(),
  })),
});
export type RONSession = z.infer<typeof RONSessionSchema>;

export const StateRegistrySubmissionSchema = z.object({
  /** Submission format version */
  version: z.literal(1),
  /** Target state */
  state: z.string().length(2),
  /** Notary commission information */
  notary: z.object({
    name: z.string(),
    commissionNumber: z.string(),
    commissionState: z.string().length(2),
    commissionExpiration: z.string(),
  }),
  /** Document details */
  document: z.object({
    type: DocumentTypeSchema,
    title: z.string(),
    dateNotarized: z.string(),
    signerName: z.string(),
    contentHash: z.string(),
  }),
  /** Verification details */
  verification: z.object({
    idDocumentType: IDDocumentTypeSchema,
    idVerificationPassed: z.boolean(),
    faceMatchPassed: z.boolean(),
    audioVideoRecorded: z.boolean(),
  }),
  /** Submission timestamp */
  submittedAt: z.string().datetime(),
});
export type StateRegistrySubmission = z.infer<typeof StateRegistrySubmissionSchema>;

// ---------------------------------------------------------------------------
// RON-Eligible States
// ---------------------------------------------------------------------------

/**
 * States with clear RON legislation (as of 2026).
 * 35-40 states have enacted RON laws; this tracks the ones with
 * operational RON registries.
 */
export const RON_ELIGIBLE_STATES: ReadonlyMap<string, {
  statute: string;
  effectiveDate: string;
  requiresRecording: boolean;
  witnessRequirement: 'none' | 'one' | 'two';
  notaryMustBeInState: boolean;
  notes: string;
}> = new Map([
  ['VA', { statute: 'Va. Code Ann. 47.1-2', effectiveDate: '2012-07-01', requiresRecording: true, witnessRequirement: 'none', notaryMustBeInState: false, notes: 'First state to enact RON. Technology agnostic.' }],
  ['TX', { statute: 'Tex. Civ. Prac. & Rem. Code 406', effectiveDate: '2018-01-01', requiresRecording: true, witnessRequirement: 'none', notaryMustBeInState: true, notes: 'Notary must be physically in Texas.' }],
  ['FL', { statute: 'Fla. Stat. 117.265', effectiveDate: '2020-01-01', requiresRecording: true, witnessRequirement: 'two', notaryMustBeInState: false, notes: 'Two witnesses required for wills and advance directives.' }],
  ['CO', { statute: 'C.R.S. 24-21-501', effectiveDate: '2020-09-14', requiresRecording: true, witnessRequirement: 'none', notaryMustBeInState: false, notes: 'Blaine + Josh home state. Priority market.' }],
  ['AZ', { statute: 'A.R.S. 41-373', effectiveDate: '2020-10-01', requiresRecording: true, witnessRequirement: 'none', notaryMustBeInState: false, notes: '' }],
  ['NV', { statute: 'NRS 240.199', effectiveDate: '2021-01-01', requiresRecording: true, witnessRequirement: 'none', notaryMustBeInState: false, notes: '' }],
  ['OH', { statute: 'ORC 147.63', effectiveDate: '2021-03-23', requiresRecording: true, witnessRequirement: 'none', notaryMustBeInState: false, notes: '' }],
  ['MI', { statute: 'MCL 55.286a', effectiveDate: '2021-03-31', requiresRecording: true, witnessRequirement: 'none', notaryMustBeInState: false, notes: '' }],
  ['WI', { statute: 'Wis. Stat. 140.145', effectiveDate: '2021-05-27', requiresRecording: true, witnessRequirement: 'none', notaryMustBeInState: false, notes: '' }],
  ['UT', { statute: 'UCA 46-1-2', effectiveDate: '2020-05-12', requiresRecording: true, witnessRequirement: 'none', notaryMustBeInState: false, notes: '' }],
  ['IN', { statute: 'IC 33-42-17', effectiveDate: '2019-07-01', requiresRecording: true, witnessRequirement: 'none', notaryMustBeInState: false, notes: '' }],
  ['MT', { statute: 'MCA 1-5-617', effectiveDate: '2019-10-01', requiresRecording: true, witnessRequirement: 'none', notaryMustBeInState: false, notes: '' }],
  ['NE', { statute: 'Neb. Rev. St. 64-402', effectiveDate: '2020-01-01', requiresRecording: true, witnessRequirement: 'none', notaryMustBeInState: false, notes: '' }],
  ['OK', { statute: '49 O.S. 208', effectiveDate: '2020-11-01', requiresRecording: true, witnessRequirement: 'none', notaryMustBeInState: false, notes: '' }],
  ['KY', { statute: 'KRS 423A', effectiveDate: '2020-01-01', requiresRecording: true, witnessRequirement: 'none', notaryMustBeInState: false, notes: '' }],
]);

/**
 * Check if a state supports RON.
 */
export function isRONEligible(state: string): boolean {
  return RON_ELIGIBLE_STATES.has(state.toUpperCase());
}

/**
 * Get RON requirements for a state.
 */
export function getRONRequirements(state: string): {
  eligible: boolean;
  requirements?: {
    statute: string;
    requiresRecording: boolean;
    witnessRequirement: string;
    notaryMustBeInState: boolean;
  };
} {
  const stateInfo = RON_ELIGIBLE_STATES.get(state.toUpperCase());
  if (!stateInfo) {
    return { eligible: false };
  }
  return {
    eligible: true,
    requirements: {
      statute: stateInfo.statute,
      requiresRecording: stateInfo.requiresRecording,
      witnessRequirement: stateInfo.witnessRequirement,
      notaryMustBeInState: stateInfo.notaryMustBeInState,
    },
  };
}

// ---------------------------------------------------------------------------
// Session Management
// ---------------------------------------------------------------------------

/**
 * Create a new RON session.
 *
 * @param params - Session creation parameters
 * @returns New RON session
 */
export function createRONSession(params: {
  principalName: string;
  principalEmail: string;
  principalDOB: string;
  principalState: string;
  documents: Array<{
    type: DocumentType;
    title: string;
    contentHash: string;
    pageCount: number;
    witnesses?: Array<{ name: string; email: string; role: string }>;
  }>;
  sessionDurationMinutes?: number;
}): RONSession {
  const now = new Date();
  const durationMinutes = params.sessionDurationMinutes ?? 30;
  const expiresAt = new Date(now.getTime() + durationMinutes * 60 * 1000);

  const sessionId = `ron_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 8)}`;

  // Check state eligibility
  if (!isRONEligible(params.principalState)) {
    throw new Error(
      `State "${params.principalState}" does not have clear RON legislation. ` +
      `RON is available in ${RON_ELIGIBLE_STATES.size} states.`,
    );
  }

  const documents: RONDocument[] = params.documents.map((doc, index) => ({
    documentId: `${sessionId}_doc_${index + 1}`,
    type: doc.type,
    title: doc.title,
    signer: {
      name: params.principalName,
      email: params.principalEmail,
      dateOfBirth: params.principalDOB,
    },
    witnesses: doc.witnesses ?? [],
    contentHash: doc.contentHash,
    pageCount: doc.pageCount,
    createdAt: now.toISOString(),
  }));

  return {
    sessionId,
    status: 'created',
    principal: {
      name: params.principalName,
      email: params.principalEmail,
      dateOfBirth: params.principalDOB,
      state: params.principalState.toUpperCase(),
    },
    documents,
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    governingState: params.principalState.toUpperCase(),
    auditLog: [{
      action: 'session_created',
      timestamp: now.toISOString(),
      actor: 'system',
      details: `RON session created for ${params.principalName} in ${params.principalState}`,
    }],
  };
}

/**
 * Record ID verification result in a RON session.
 *
 * Integration point for Proof API or similar identity verification service.
 *
 * @param session - RON session to update
 * @param result - ID verification result
 * @returns Updated session
 */
export function recordIDVerification(
  session: RONSession,
  result: IDVerificationResult,
): RONSession {
  if (session.status !== 'created' && session.status !== 'id_verification_pending') {
    throw new Error(`Cannot record ID verification in status "${session.status}"`);
  }

  const now = new Date().toISOString();

  return {
    ...session,
    status: result.verified ? 'id_verified' : 'failed',
    idVerification: result,
    auditLog: [
      ...session.auditLog,
      {
        action: result.verified ? 'id_verified' : 'id_verification_failed',
        timestamp: now,
        actor: 'identity_verification_service',
        details: result.verified
          ? `ID verified: ${result.documentType} from ${result.issuingAuthority}`
          : `ID verification failed: ${result.failureReasons.join(', ')}`,
      },
    ],
  };
}

/**
 * Record face match result in a RON session.
 *
 * @param session - RON session to update
 * @param result - Face match result
 * @returns Updated session
 */
export function recordFaceMatch(
  session: RONSession,
  result: FaceMatchResult,
): RONSession {
  if (session.status !== 'id_verified' && session.status !== 'face_matching_pending') {
    throw new Error(`Cannot record face match in status "${session.status}"`);
  }

  const now = new Date().toISOString();

  return {
    ...session,
    status: result.matched ? 'face_matched' : 'failed',
    faceMatch: result,
    auditLog: [
      ...session.auditLog,
      {
        action: result.matched ? 'face_matched' : 'face_match_failed',
        timestamp: now,
        actor: 'face_matching_service',
        details: result.matched
          ? `Face matched with ${(result.similarityScore * 100).toFixed(1)}% similarity`
          : `Face match failed: ${result.failureReasons.join(', ')}`,
      },
    ],
  };
}

/**
 * Generate state registry submission format from a completed RON session.
 *
 * @param session - Completed RON session
 * @returns Registry submission for each document
 */
export function generateRegistrySubmission(
  session: RONSession,
): StateRegistrySubmission[] {
  if (session.status !== 'notarized' && session.status !== 'completed') {
    throw new Error(`Session must be notarized to generate registry submission (current: "${session.status}")`);
  }

  if (!session.notary) {
    throw new Error('No notary assigned to session');
  }

  return session.documents.map((doc) => ({
    version: 1 as const,
    state: session.governingState,
    notary: session.notary!,
    document: {
      type: doc.type,
      title: doc.title,
      dateNotarized: doc.notarizedAt ?? session.completedAt ?? new Date().toISOString(),
      signerName: doc.signer.name,
      contentHash: doc.contentHash,
    },
    verification: {
      idDocumentType: session.idVerification?.documentType ?? 'drivers_license',
      idVerificationPassed: session.idVerification?.verified ?? false,
      faceMatchPassed: session.faceMatch?.matched ?? false,
      audioVideoRecorded: Boolean(session.recordingRef),
    },
    submittedAt: new Date().toISOString(),
  }));
}

// ---------------------------------------------------------------------------
// Advance Directive Packaging
// ---------------------------------------------------------------------------

/**
 * Package advance directive documents for a RON session.
 *
 * Advance directives are a key use case for co-op.care:
 * - CareGoals AI conversation captures patient wishes
 * - Documents are generated and packaged
 * - RON notarization makes them legally binding
 * - FHIR ADI resources created for interoperability
 *
 * @param params - Advance directive parameters
 * @returns Packaged documents ready for RON session
 */
export function packageAdvanceDirectives(params: {
  patientName: string;
  patientDOB: string;
  healthcareProxy?: {
    name: string;
    relationship: string;
    phone: string;
    email: string;
  };
  alternateProxy?: {
    name: string;
    relationship: string;
    phone: string;
    email: string;
  };
  documentTypes: DocumentType[];
  /** State for jurisdiction-specific forms */
  state: string;
}): Array<{
  type: DocumentType;
  title: string;
  requiredWitnesses: number;
  requiresNotarization: boolean;
  contentHash: string;
  estimatedPages: number;
}> {
  const stateReqs = getRONRequirements(params.state);
  const witnessReq = stateReqs.requirements?.witnessRequirement ?? 'none';
  const witnessCount = witnessReq === 'two' ? 2 : witnessReq === 'one' ? 1 : 0;

  return params.documentTypes.map((docType) => {
    const config = DOCUMENT_CONFIGS[docType];

    return {
      type: docType,
      title: `${config.title} — ${params.patientName}`,
      requiredWitnesses: Math.max(witnessCount, config.minWitnesses),
      requiresNotarization: config.requiresNotarization,
      // Placeholder hash — in production, hash actual document content
      contentHash: `sha256:${Date.now().toString(36)}${Math.random().toString(36).substring(2)}`,
      estimatedPages: config.estimatedPages,
    };
  });
}

/** Document type configurations */
const DOCUMENT_CONFIGS: Record<DocumentType, {
  title: string;
  minWitnesses: number;
  requiresNotarization: boolean;
  estimatedPages: number;
}> = {
  advance_directive: {
    title: 'Advance Health Care Directive',
    minWitnesses: 2,
    requiresNotarization: true,
    estimatedPages: 8,
  },
  living_will: {
    title: 'Living Will',
    minWitnesses: 2,
    requiresNotarization: true,
    estimatedPages: 4,
  },
  healthcare_proxy: {
    title: 'Healthcare Proxy Designation',
    minWitnesses: 2,
    requiresNotarization: true,
    estimatedPages: 3,
  },
  durable_power_of_attorney: {
    title: 'Durable Power of Attorney for Healthcare',
    minWitnesses: 2,
    requiresNotarization: true,
    estimatedPages: 6,
  },
  polst: {
    title: 'Physician Orders for Life-Sustaining Treatment (POLST)',
    minWitnesses: 0,
    requiresNotarization: false,
    estimatedPages: 2,
  },
  dnr_order: {
    title: 'Do Not Resuscitate Order',
    minWitnesses: 1,
    requiresNotarization: false,
    estimatedPages: 1,
  },
  hipaa_authorization: {
    title: 'HIPAA Authorization for Release of Health Information',
    minWitnesses: 0,
    requiresNotarization: false,
    estimatedPages: 2,
  },
  general_notarization: {
    title: 'Notarized Document',
    minWitnesses: 0,
    requiresNotarization: true,
    estimatedPages: 1,
  },
};
