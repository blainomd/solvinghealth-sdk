/**
 * @solvinghealth/hipaa -- HIPAA Compliance Toolkit
 *
 * Open source HIPAA compliance primitives: PHI detection,
 * immutable audit logging with hash chain, AES-256-GCM encryption,
 * and HIPAA-compliant HTTP transport.
 *
 * @packageDocumentation
 * @module @solvinghealth/hipaa
 * @license Apache-2.0
 */

// PHI Detection
export {
  PHIDetector,
  PHIDetectorConfigSchema,
  type PHISensitivity,
  type PHIType,
  type PHISpan,
  type PHIDetectionResult,
  type PHIDetectorConfig,
} from './phi-detector.js';

// Audit Logging
export {
  AuditLogger,
  InMemoryAuditStore,
  AuditEntryInputSchema,
  type AuditAction,
  type AuditOutcome,
  type AuditEntryInput,
  type AuditEntry,
  type AuditQueryFilters,
  type AuditStore,
  type ChainVerificationResult,
} from './audit-log.js';

// Encryption
export {
  EncryptionService,
  EncryptionConfigSchema,
  type EncryptedPayload,
  type EnvelopeEncryptedPayload,
  type EncryptionConfig,
} from './encryption.js';

// Transport
export {
  HIPAATransport,
  HIPAATransportConfigSchema,
  HIPAATransportError,
  type HIPAATransportConfig,
  type HIPAARequest,
  type HIPAAResponse,
} from './transport.js';
