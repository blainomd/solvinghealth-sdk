/**
 * @solvinghealth/identity — W3C Decentralized Identity (DID)
 *
 * DID document creation, Verifiable Credential issuance and verification
 * for physician, caregiver, and patient identities. Future: Base L2
 * blockchain anchoring.
 *
 * Follows W3C DID Core v1.0 and Verifiable Credentials Data Model v2.0.
 *
 * MIT License
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

export const DIDMethodSchema = z.enum([
  'did:web',
  'did:key',
  'did:ethr',  // Future: Ethereum/Base L2
]);
export type DIDMethod = z.infer<typeof DIDMethodSchema>;

export const VerificationMethodSchema = z.object({
  id: z.string(),
  type: z.enum([
    'Ed25519VerificationKey2020',
    'JsonWebKey2020',
    'EcdsaSecp256k1VerificationKey2019',
  ]),
  controller: z.string(),
  /** Public key in multibase or JWK format */
  publicKeyMultibase: z.string().optional(),
  publicKeyJwk: z.record(z.unknown()).optional(),
});
export type VerificationMethod = z.infer<typeof VerificationMethodSchema>;

export const ServiceEndpointSchema = z.object({
  id: z.string(),
  type: z.string(),
  serviceEndpoint: z.union([z.string(), z.record(z.string())]),
});
export type ServiceEndpoint = z.infer<typeof ServiceEndpointSchema>;

export const DIDDocumentSchema = z.object({
  '@context': z.array(z.string()),
  id: z.string(),
  controller: z.union([z.string(), z.array(z.string())]).optional(),
  verificationMethod: z.array(VerificationMethodSchema),
  authentication: z.array(z.string()),
  assertionMethod: z.array(z.string()).optional(),
  capabilityDelegation: z.array(z.string()).optional(),
  service: z.array(ServiceEndpointSchema).optional(),
  created: z.string().datetime().optional(),
  updated: z.string().datetime().optional(),
});
export type DIDDocument = z.infer<typeof DIDDocumentSchema>;

export const CredentialTypeSchema = z.enum([
  'PhysicianCredential',
  'CaregiverCredential',
  'PatientIdentity',
  'NPIVerification',
  'StateLicenseVerification',
  'BoardCertification',
  'ClinicalSwipeAttestation',
  'ComfortCardIdentity',
]);
export type CredentialType = z.infer<typeof CredentialTypeSchema>;

export const CredentialSubjectSchema = z.object({
  id: z.string(),
  /** Additional claims vary by credential type */
}).passthrough();
export type CredentialSubject = z.infer<typeof CredentialSubjectSchema>;

export const VerifiableCredentialSchema = z.object({
  '@context': z.array(z.string()),
  id: z.string(),
  type: z.array(z.string()),
  issuer: z.union([z.string(), z.object({
    id: z.string(),
    name: z.string().optional(),
  })]),
  issuanceDate: z.string().datetime(),
  expirationDate: z.string().datetime().optional(),
  credentialSubject: CredentialSubjectSchema,
  proof: z.object({
    type: z.string(),
    created: z.string().datetime(),
    verificationMethod: z.string(),
    proofPurpose: z.string(),
    /** In production, this would be a real cryptographic signature */
    proofValue: z.string(),
  }).optional(),
});
export type VerifiableCredential = z.infer<typeof VerifiableCredentialSchema>;

export const VerificationResultSchema = z.object({
  verified: z.boolean(),
  credentialId: z.string(),
  issuer: z.string(),
  issuanceDate: z.string(),
  expired: z.boolean(),
  revoked: z.boolean(),
  errors: z.array(z.string()),
});
export type VerificationResult = z.infer<typeof VerificationResultSchema>;

// ---------------------------------------------------------------------------
// DID Document Creation
// ---------------------------------------------------------------------------

/**
 * Create a DID document using the did:web method.
 *
 * did:web maps DIDs to web domains:
 * - did:web:solvinghealth.com -> https://solvinghealth.com/.well-known/did.json
 * - did:web:solvinghealth.com:physicians:1234567890 -> https://solvinghealth.com/physicians/1234567890/did.json
 *
 * @param params - DID document parameters
 * @returns W3C DID Document
 */
export function createDIDDocument(params: {
  /** Domain for did:web, or key for did:key */
  identifier: string;
  method?: DIDMethod;
  /** Public key in multibase format */
  publicKeyMultibase: string;
  /** Optional controller DID (if different from self) */
  controller?: string;
  /** Service endpoints */
  services?: ServiceEndpoint[];
}): DIDDocument {
  const method = params.method ?? 'did:web';
  const did = `${method}:${params.identifier}`;
  const verificationMethodId = `${did}#key-1`;

  const now = new Date().toISOString();

  return {
    '@context': [
      'https://www.w3.org/ns/did/v1',
      'https://w3id.org/security/suites/ed25519-2020/v1',
    ],
    id: did,
    controller: params.controller ?? did,
    verificationMethod: [{
      id: verificationMethodId,
      type: 'Ed25519VerificationKey2020',
      controller: did,
      publicKeyMultibase: params.publicKeyMultibase,
    }],
    authentication: [verificationMethodId],
    assertionMethod: [verificationMethodId],
    service: params.services ?? [
      {
        id: `${did}#solvinghealth`,
        type: 'SolvingHealthProfile',
        serviceEndpoint: `https://solvinghealth.com/api/v1/identity/${encodeURIComponent(params.identifier)}`,
      },
    ],
    created: now,
    updated: now,
  };
}

/**
 * Create a DID document for a physician.
 *
 * @param npi - Physician NPI
 * @param publicKeyMultibase - Public key
 * @returns DID Document for the physician
 */
export function createPhysicianDID(
  npi: string,
  publicKeyMultibase: string,
): DIDDocument {
  return createDIDDocument({
    identifier: `solvinghealth.com:physicians:${npi}`,
    publicKeyMultibase,
    services: [
      {
        id: `did:web:solvinghealth.com:physicians:${npi}#profile`,
        type: 'SolvingHealthPhysicianProfile',
        serviceEndpoint: `https://solvinghealth.com/api/v1/providers/${npi}`,
      },
      {
        id: `did:web:solvinghealth.com:physicians:${npi}#nppes`,
        type: 'NPPESRegistry',
        serviceEndpoint: `https://npiregistry.cms.hhs.gov/api/?number=${npi}&version=2.1`,
      },
    ],
  });
}

/**
 * Create a DID document for a caregiver (co-op.care worker-owner).
 *
 * @param memberId - co-op.care member ID
 * @param publicKeyMultibase - Public key
 * @returns DID Document for the caregiver
 */
export function createCaregiverDID(
  memberId: string,
  publicKeyMultibase: string,
): DIDDocument {
  return createDIDDocument({
    identifier: `co-op.care:caregivers:${memberId}`,
    publicKeyMultibase,
    services: [
      {
        id: `did:web:co-op.care:caregivers:${memberId}#profile`,
        type: 'CoopCareWorkerProfile',
        serviceEndpoint: `https://co-op.care/api/v1/caregivers/${memberId}`,
      },
    ],
  });
}

/**
 * Create a DID document for a patient (co-op.care family member).
 *
 * @param memberId - co-op.care member ID
 * @param publicKeyMultibase - Public key
 * @returns DID Document for the patient
 */
export function createPatientDID(
  memberId: string,
  publicKeyMultibase: string,
): DIDDocument {
  return createDIDDocument({
    identifier: `co-op.care:members:${memberId}`,
    publicKeyMultibase,
    services: [
      {
        id: `did:web:co-op.care:members:${memberId}#comfortcard`,
        type: 'ComfortCardIdentity',
        serviceEndpoint: `https://co-op.care/api/v1/comfortcard/${memberId}`,
      },
    ],
  });
}

// ---------------------------------------------------------------------------
// Verifiable Credential Issuance
// ---------------------------------------------------------------------------

/**
 * Generate a unique credential ID.
 */
function generateCredentialId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 10);
  return `urn:uuid:${timestamp}-${random}`;
}

/**
 * Issue a Verifiable Credential.
 *
 * @param params - Credential parameters
 * @returns Verifiable Credential
 */
export function issueCredential(params: {
  type: CredentialType;
  issuerDID: string;
  issuerName?: string;
  subjectDID: string;
  claims: Record<string, unknown>;
  expirationDate?: Date;
}): VerifiableCredential {
  const now = new Date();

  return {
    '@context': [
      'https://www.w3.org/2018/credentials/v1',
      'https://solvinghealth.com/credentials/v1',
    ],
    id: generateCredentialId(),
    type: ['VerifiableCredential', params.type],
    issuer: params.issuerName
      ? { id: params.issuerDID, name: params.issuerName }
      : params.issuerDID,
    issuanceDate: now.toISOString(),
    expirationDate: params.expirationDate?.toISOString(),
    credentialSubject: {
      id: params.subjectDID,
      ...params.claims,
    },
    proof: {
      type: 'Ed25519Signature2020',
      created: now.toISOString(),
      verificationMethod: `${params.issuerDID}#key-1`,
      proofPurpose: 'assertionMethod',
      // In production, this would be a real Ed25519 signature
      proofValue: `placeholder_proof_${Date.now().toString(36)}`,
    },
  };
}

/**
 * Issue a Physician Credential.
 *
 * @param params - Physician credential parameters
 * @returns Verifiable Credential for the physician
 */
export function issuePhysicianCredential(params: {
  issuerDID: string;
  physicianDID: string;
  npi: string;
  name: string;
  credential: string;
  specialty: string;
  stateLicenses: Array<{ state: string; number: string; expiration: string }>;
  boardCertifications: Array<{ board: string; specialty: string; expiration: string }>;
  credentialTier: string;
}): VerifiableCredential {
  const expirationDate = new Date();
  expirationDate.setFullYear(expirationDate.getFullYear() + 1);

  return issueCredential({
    type: 'PhysicianCredential',
    issuerDID: params.issuerDID,
    issuerName: 'SolvingHealth LLC',
    subjectDID: params.physicianDID,
    claims: {
      npi: params.npi,
      name: params.name,
      credential: params.credential,
      specialty: params.specialty,
      stateLicenses: params.stateLicenses,
      boardCertifications: params.boardCertifications,
      credentialTier: params.credentialTier,
      oigExclusionClearance: true,
    },
    expirationDate,
  });
}

/**
 * Issue a Caregiver Credential (co-op.care worker-owner).
 *
 * @param params - Caregiver credential parameters
 * @returns Verifiable Credential for the caregiver
 */
export function issueCaregiverCredential(params: {
  issuerDID: string;
  caregiverDID: string;
  memberId: string;
  name: string;
  certifications: string[];
  backgroundCheckDate: string;
  coopMemberSince: string;
}): VerifiableCredential {
  const expirationDate = new Date();
  expirationDate.setFullYear(expirationDate.getFullYear() + 1);

  return issueCredential({
    type: 'CaregiverCredential',
    issuerDID: params.issuerDID,
    issuerName: 'co-op.care',
    subjectDID: params.caregiverDID,
    claims: {
      memberId: params.memberId,
      name: params.name,
      certifications: params.certifications,
      backgroundCheckDate: params.backgroundCheckDate,
      coopMemberSince: params.coopMemberSince,
      workerOwner: true,
    },
    expirationDate,
  });
}

// ---------------------------------------------------------------------------
// Credential Verification
// ---------------------------------------------------------------------------

/**
 * Verify a Verifiable Credential.
 *
 * Checks:
 * 1. Credential structure is valid
 * 2. Credential is not expired
 * 3. Proof exists and has correct format
 * 4. (In production) Verify cryptographic signature
 *
 * @param credential - The credential to verify
 * @returns Verification result
 */
export function verifyCredential(credential: VerifiableCredential): VerificationResult {
  const errors: string[] = [];
  const now = new Date();

  // Check expiration
  const expired = credential.expirationDate
    ? new Date(credential.expirationDate) < now
    : false;

  if (expired) {
    errors.push(`Credential expired on ${credential.expirationDate}`);
  }

  // Check required fields
  if (!credential.id) errors.push('Missing credential ID');
  if (!credential.issuer) errors.push('Missing issuer');
  if (!credential.issuanceDate) errors.push('Missing issuance date');
  if (!credential.credentialSubject?.id) errors.push('Missing credential subject ID');

  // Check proof
  if (!credential.proof) {
    errors.push('Missing proof — credential is unsigned');
  } else {
    if (!credential.proof.verificationMethod) {
      errors.push('Proof missing verificationMethod');
    }
    if (!credential.proof.proofValue) {
      errors.push('Proof missing proofValue');
    }
    // In production: verify Ed25519 signature against issuer's public key
    if (credential.proof.proofValue?.startsWith('placeholder_')) {
      errors.push('Proof uses placeholder signature — not cryptographically verified');
    }
  }

  const issuerString = typeof credential.issuer === 'string'
    ? credential.issuer
    : credential.issuer.id;

  return {
    verified: errors.length === 0,
    credentialId: credential.id,
    issuer: issuerString,
    issuanceDate: credential.issuanceDate,
    expired,
    revoked: false, // In production: check revocation registry
    errors,
  };
}

// ---------------------------------------------------------------------------
// Future: Base L2 Blockchain Anchoring
// ---------------------------------------------------------------------------

/**
 * Placeholder for Base L2 DID anchoring.
 *
 * Future implementation will:
 * 1. Anchor DID documents to Base L2 smart contract
 * 2. Register credential hashes on-chain for tamper evidence
 * 3. Enable credential revocation via on-chain registry
 * 4. Support DID:ethr method for Ethereum-native identity
 *
 * @param didDocument - DID document to anchor
 * @returns Anchoring result (placeholder)
 */
export function anchorToBaseL2(didDocument: DIDDocument): {
  status: 'not_implemented';
  message: string;
  plannedPhase: string;
} {
  return {
    status: 'not_implemented',
    message: 'Base L2 anchoring is planned for Phase 3+. Currently using did:web method.',
    plannedPhase: 'Phase 3 — Web3 Integration',
  };
}
