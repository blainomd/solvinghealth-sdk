/**
 * @solvinghealth/clinical -- Clinical AI Harness
 *
 * Proprietary clinical AI infrastructure:
 * - Model-agnostic agent harness (Claude, GPT, Gemini)
 * - Agentic Handshake Protocol (5-step physician validation)
 * - Compliance sanitizer (AKS, Stark, FMV, CMS billing)
 * - Encounter ID engine (cross-system deduplication)
 * - Agent Behavioral Contracts (formal verification)
 * - 3-layer agentic memory (global, project, context)
 *
 * @packageDocumentation
 * @module @solvinghealth/clinical
 * @license PROPRIETARY -- SEE LICENSE
 */

// Clinical Agent Harness
export {
  ClinicalAgent,
  ClinicalAgentConfigSchema,
  LLMConfigSchema,
  ProviderCredentialsSchema,
  type LLMProvider,
  type LLMConfig,
  type ProviderCredentials,
  type ClinicalAgentConfig,
  type ClinicalMessage,
  type ClinicalAgentResponse,
  type ValidationIssue,
} from './agent.js';

// Agentic Handshake Protocol
export {
  HandshakeProtocol,
  SubmissionSchema,
  ComplianceCheckSchema,
  RoutingDecisionSchema,
  PhysicianReviewSchema,
  ValidatedResultSchema,
  type Submission,
  type ComplianceCheck,
  type RoutingDecision,
  type PhysicianReview,
  type ValidatedResult,
  type HandshakeState,
  type HandshakeRecord,
} from './handshake.js';

// Compliance Sanitizer
export {
  validateAKS,
  validateStark,
  validateFMV,
  validateBillingCodes,
  runComplianceCheck,
  ArrangementSchema,
  EncounterPricingSchema,
  BillingCodeSchema,
  type Violation,
  type ViolationSeverity,
  type ViolationCategory,
  type ComplianceResult,
  type Arrangement,
  type EncounterPricing,
  type BillingCode,
} from './compliance.js';

// Encounter ID Engine
export {
  generateEncounterId,
  verifyEncounterId,
  EncounterIdRegistry,
  EncounterComponentsSchema,
  type EncounterComponents,
  type EncounterID,
  type CollisionCheckResult,
} from './encounter-id.js';

// Agent Behavioral Contracts
export {
  validatePreconditions,
  evaluateInvariants,
  computeSatisfaction,
  validateContract,
  AgentContractSchema,
  PreconditionsSchema,
  STANDARD_CLINICAL_CONTRACT,
  PRESCRIBING_CONTRACT,
  type AgentContract,
  type Preconditions,
  type HardInvariant,
  type SoftInvariant,
  type InvariantEvaluation,
  type PreconditionResult,
  type SatisfactionScore,
  type ContractValidationResult,
} from './contracts.js';

// Memory System
export { GlobalMemoryStore, type GlobalMemoryEntry } from './memory/global.js';
export { ProjectMemoryStore, type ProjectMemoryEntry } from './memory/project.js';
export { ContextMemoryStore, type ContextMemoryEntry } from './memory/context.js';
export {
  MemoryManager,
  type MemoryManagerConfig,
  type UnifiedMemoryResult,
  type SessionInfo,
} from './memory/manager.js';
