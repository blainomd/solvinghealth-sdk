/**
 * @solvinghealth/identity — Identity Management
 *
 * Open source identity primitives for healthcare: NPI validation,
 * ComfortCard digital identity, W3C DID, and Remote Online Notarization.
 *
 * MIT License
 */

// NPI Identity
export {
  type CredentialStatus,
  CredentialStatusSchema,
  type CredentialTier,
  CredentialTierSchema,
  CREDENTIAL_TIERS,
  type NPIProfile,
  NPIProfileSchema,
  type NPIType,
  NPITypeSchema,
  type ProviderTaxonomy,
  ProviderTaxonomySchema,
  type StateLicense,
  StateLicenseSchema,
  buildNPPESLookupUrl,
  buildNPPESSearchUrl,
  determineCredentialTier,
  getNPIType,
  parseNPPESResponse,
  validateNPI,
} from './npi.js';

// ComfortCard
export {
  type AccessTier,
  AccessTierSchema,
  type AppleWalletPass,
  AppleWalletPassSchema,
  type CardBadge,
  CardBadgeSchema,
  type ComfortCard,
  ComfortCardSchema,
  type EmergencyInfo,
  EmergencyInfoSchema,
  type QRPayload,
  QRPayloadSchema,
  createComfortCard,
  generateAppleWalletPass,
  generateGooglePayPass,
  generateQRPayload,
  getAccessibleData,
  verifyQRPayload,
} from './comfortcard.js';

// Decentralized Identity (DID)
export {
  type CredentialSubject,
  CredentialSubjectSchema,
  type CredentialType,
  CredentialTypeSchema,
  type DIDDocument,
  DIDDocumentSchema,
  type DIDMethod,
  DIDMethodSchema,
  type ServiceEndpoint,
  ServiceEndpointSchema,
  type VerifiableCredential,
  VerifiableCredentialSchema,
  type VerificationMethod,
  VerificationMethodSchema,
  type VerificationResult,
  VerificationResultSchema,
  anchorToBaseL2,
  createCaregiverDID,
  createDIDDocument,
  createPatientDID,
  createPhysicianDID,
  issueCaregiverCredential,
  issueCredential,
  issuePhysicianCredential,
  verifyCredential,
} from './did.js';

// Remote Online Notarization
export {
  type DocumentType,
  DocumentTypeSchema,
  type FaceMatchResult,
  FaceMatchResultSchema,
  type IDDocumentType,
  IDDocumentTypeSchema,
  type IDVerificationResult,
  IDVerificationResultSchema,
  type RONDocument,
  RONDocumentSchema,
  type RONSession,
  RONSessionSchema,
  type RONSessionStatus,
  RONSessionStatusSchema,
  type StateRegistrySubmission,
  StateRegistrySubmissionSchema,
  RON_ELIGIBLE_STATES,
  createRONSession,
  generateRegistrySubmission,
  getRONRequirements,
  isRONEligible,
  packageAdvanceDirectives,
  recordFaceMatch,
  recordIDVerification,
} from './ron.js';
