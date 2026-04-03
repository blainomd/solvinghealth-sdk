/**
 * @solvinghealth/clinical -- Agent Behavioral Contracts (ABC)
 *
 * Formal contracts that define what an AI agent CAN and CANNOT do.
 * Every clinical agent operates under a contract that specifies:
 *
 * - Preconditions: what must be true before the agent can act
 * - Hard Invariants: rules that MUST NEVER be violated (system stops)
 * - Soft Invariants: rules that SHOULD be followed (logged, not blocked)
 * - (p, delta, k)-Satisfaction: scoring function for contract compliance
 *
 * This is the formal verification layer for clinical AI agents.
 *
 * @module @solvinghealth/clinical/contracts
 * @license PROPRIETARY -- SEE LICENSE
 */

import { z } from 'zod';

// ─── Types ──────────────────────────────────────────────────

/** Preconditions that must be met before an agent can act */
export const PreconditionsSchema = z.object({
  /** Provider has a valid, verified NPI */
  validNPI: z.boolean(),
  /** Provider has active state license(s) */
  activeStateLicenses: z.array(z.string().length(2)),
  /** Provider specialty matches the clinical context */
  matchingSpecialty: z.boolean(),
  /** Provider has required board certifications */
  requiredCertifications: z.array(z.string()).optional(),
  /** Provider has DEA number (required for controlled substances) */
  deaRequired: z.boolean().default(false),
  /** Provider has DEA number on file */
  deaOnFile: z.boolean().default(false),
  /** Patient consent obtained */
  patientConsent: z.boolean().default(true),
  /** BAA in place with the requesting entity */
  baaInPlace: z.boolean().default(true),
});

export type Preconditions = z.infer<typeof PreconditionsSchema>;

/** Hard invariants -- violations STOP the agent */
export type HardInvariant =
  | 'no_phi_exfiltration'
  | 'no_billing_without_attestation'
  | 'no_out_of_scope_recommendations'
  | 'no_controlled_substance_without_dea'
  | 'no_diagnosis_without_physician'
  | 'no_prescription_without_review'
  | 'no_patient_data_retention'
  | 'audit_trail_required';

/** Soft invariants -- violations are logged but do not stop the agent */
export type SoftInvariant =
  | 'professional_tone'
  | 'appropriate_follow_up_timing'
  | 'evidence_based_citations'
  | 'patient_centered_language'
  | 'cultural_sensitivity'
  | 'health_literacy_appropriate'
  | 'structured_output_format';

/** An Agent Behavioral Contract */
export const AgentContractSchema = z.object({
  /** Contract name/identifier */
  name: z.string(),
  /** Contract version */
  version: z.string(),
  /** Description of what this contract governs */
  description: z.string(),
  /** Preconditions that must be met */
  preconditions: PreconditionsSchema,
  /** Hard invariants (violations stop the agent) */
  hardInvariants: z.array(z.enum([
    'no_phi_exfiltration',
    'no_billing_without_attestation',
    'no_out_of_scope_recommendations',
    'no_controlled_substance_without_dea',
    'no_diagnosis_without_physician',
    'no_prescription_without_review',
    'no_patient_data_retention',
    'audit_trail_required',
  ])),
  /** Soft invariants (violations are logged) */
  softInvariants: z.array(z.enum([
    'professional_tone',
    'appropriate_follow_up_timing',
    'evidence_based_citations',
    'patient_centered_language',
    'cultural_sensitivity',
    'health_literacy_appropriate',
    'structured_output_format',
  ])),
  /** Maximum allowed response time in ms */
  maxResponseTimeMs: z.number().int().positive().default(30_000),
  /** Allowed output types */
  allowedOutputTypes: z.array(z.string()),
});

export type AgentContract = z.infer<typeof AgentContractSchema>;

/** Result of evaluating a single invariant */
export interface InvariantEvaluation {
  /** The invariant that was evaluated */
  invariant: string;
  /** Whether the invariant is satisfied */
  satisfied: boolean;
  /** Type of invariant */
  type: 'hard' | 'soft';
  /** Description of the violation (if not satisfied) */
  violation?: string;
  /** Confidence in the evaluation (0.0-1.0) */
  confidence: number;
}

/** Result of precondition evaluation */
export interface PreconditionResult {
  /** Whether all preconditions are met */
  allMet: boolean;
  /** Individual precondition results */
  results: Array<{
    precondition: string;
    met: boolean;
    reason?: string;
  }>;
}

/** (p, delta, k)-Satisfaction score */
export interface SatisfactionScore {
  /** p: proportion of satisfied invariants (0.0-1.0) */
  p: number;
  /** delta: maximum deviation from perfect satisfaction (0.0-1.0) */
  delta: number;
  /** k: number of hard invariant violations (must be 0 for approval) */
  k: number;
  /** Overall satisfaction: p >= threshold AND k === 0 */
  satisfied: boolean;
  /** Detailed breakdown */
  breakdown: {
    hardInvariantsTotal: number;
    hardInvariantsSatisfied: number;
    softInvariantsTotal: number;
    softInvariantsSatisfied: number;
  };
}

/** Complete contract validation result */
export interface ContractValidationResult {
  /** The contract that was validated against */
  contractName: string;
  /** Whether the agent's behavior passes the contract */
  passed: boolean;
  /** Precondition evaluation */
  preconditions: PreconditionResult;
  /** All invariant evaluations */
  invariantEvaluations: InvariantEvaluation[];
  /** Satisfaction score */
  satisfactionScore: SatisfactionScore;
  /** Timestamp of validation */
  validatedAt: string;
  /** Reasons for failure (if any) */
  failureReasons: string[];
}

// ─── Predefined Contracts ───────────────────────────────────

/**
 * The standard clinical agent contract.
 * Applies to any agent that processes clinical data.
 */
export const STANDARD_CLINICAL_CONTRACT: AgentContract = {
  name: 'standard-clinical',
  version: '1.0.0',
  description: 'Standard contract for clinical AI agents processing patient data',
  preconditions: {
    validNPI: true,
    activeStateLicenses: [], // At least one required
    matchingSpecialty: true,
    patientConsent: true,
    baaInPlace: true,
    deaRequired: false,
    deaOnFile: false,
  },
  hardInvariants: [
    'no_phi_exfiltration',
    'no_billing_without_attestation',
    'no_out_of_scope_recommendations',
    'no_diagnosis_without_physician',
    'audit_trail_required',
  ],
  softInvariants: [
    'professional_tone',
    'evidence_based_citations',
    'patient_centered_language',
    'structured_output_format',
  ],
  maxResponseTimeMs: 30_000,
  allowedOutputTypes: [
    'clinical_note', 'care_plan', 'treatment_plan', 'risk_assessment',
    'lab_interpretation', 'triage', 'referral', 'lmn',
  ],
};

/**
 * Contract for prescribing agents (higher restrictions).
 */
export const PRESCRIBING_CONTRACT: AgentContract = {
  name: 'prescribing-agent',
  version: '1.0.0',
  description: 'Contract for agents involved in medication prescribing workflows',
  preconditions: {
    validNPI: true,
    activeStateLicenses: [],
    matchingSpecialty: true,
    patientConsent: true,
    baaInPlace: true,
    deaRequired: true,
    deaOnFile: true,
  },
  hardInvariants: [
    'no_phi_exfiltration',
    'no_billing_without_attestation',
    'no_out_of_scope_recommendations',
    'no_controlled_substance_without_dea',
    'no_prescription_without_review',
    'no_diagnosis_without_physician',
    'audit_trail_required',
  ],
  softInvariants: [
    'professional_tone',
    'evidence_based_citations',
    'patient_centered_language',
    'structured_output_format',
    'appropriate_follow_up_timing',
  ],
  maxResponseTimeMs: 15_000,
  allowedOutputTypes: ['prescription', 'dose_adjustment', 'drug_interaction_check'],
};

// ─── Contract Validator ─────────────────────────────────────

/**
 * Validate preconditions for a contract.
 *
 * @param contract - The agent contract
 * @param actual - Actual precondition values
 * @returns Precondition evaluation result
 */
export function validatePreconditions(
  contract: AgentContract,
  actual: Preconditions,
): PreconditionResult {
  const results: PreconditionResult['results'] = [];

  if (contract.preconditions.validNPI && !actual.validNPI) {
    results.push({ precondition: 'validNPI', met: false, reason: 'Valid NPI required but not provided' });
  } else {
    results.push({ precondition: 'validNPI', met: true });
  }

  if (contract.preconditions.matchingSpecialty && !actual.matchingSpecialty) {
    results.push({ precondition: 'matchingSpecialty', met: false, reason: 'Provider specialty does not match clinical context' });
  } else {
    results.push({ precondition: 'matchingSpecialty', met: true });
  }

  if (contract.preconditions.deaRequired && !actual.deaOnFile) {
    results.push({ precondition: 'deaOnFile', met: false, reason: 'DEA number required for this contract but not on file' });
  } else {
    results.push({ precondition: 'deaOnFile', met: true });
  }

  if (actual.activeStateLicenses.length === 0) {
    results.push({ precondition: 'activeStateLicenses', met: false, reason: 'No active state licenses provided' });
  } else {
    results.push({ precondition: 'activeStateLicenses', met: true });
  }

  if (contract.preconditions.baaInPlace && !actual.baaInPlace) {
    results.push({ precondition: 'baaInPlace', met: false, reason: 'Business Associate Agreement required but not in place' });
  } else {
    results.push({ precondition: 'baaInPlace', met: true });
  }

  if (contract.preconditions.patientConsent && !actual.patientConsent) {
    results.push({ precondition: 'patientConsent', met: false, reason: 'Patient consent required but not obtained' });
  } else {
    results.push({ precondition: 'patientConsent', met: true });
  }

  return {
    allMet: results.every(r => r.met),
    results,
  };
}

/**
 * Evaluate invariants against agent output.
 *
 * @param contract - The agent contract
 * @param output - The agent's output text
 * @param metadata - Additional metadata for evaluation
 * @returns Array of invariant evaluations
 */
export function evaluateInvariants(
  contract: AgentContract,
  output: string,
  metadata: {
    phiDetected?: boolean;
    hasAttestation?: boolean;
    withinScope?: boolean;
    hasAuditTrail?: boolean;
    responseTimeMs?: number;
    hasDEA?: boolean;
  } = {},
): InvariantEvaluation[] {
  const evaluations: InvariantEvaluation[] = [];

  // Evaluate hard invariants
  for (const invariant of contract.hardInvariants) {
    const evaluation: InvariantEvaluation = {
      invariant,
      type: 'hard',
      satisfied: true,
      confidence: 1.0,
    };

    switch (invariant) {
      case 'no_phi_exfiltration':
        if (metadata.phiDetected) {
          evaluation.satisfied = false;
          evaluation.violation = 'PHI detected in agent output';
        }
        break;
      case 'no_billing_without_attestation':
        if (/\b\d{5}\b/.test(output) && !metadata.hasAttestation) {
          evaluation.satisfied = false;
          evaluation.violation = 'Billing code present without physician attestation';
        }
        break;
      case 'no_out_of_scope_recommendations':
        if (metadata.withinScope === false) {
          evaluation.satisfied = false;
          evaluation.violation = 'Recommendation outside provider scope of practice';
        }
        break;
      case 'no_controlled_substance_without_dea':
        if (/\b(?:schedule\s+[IViv]+|oxycodone|hydrocodone|fentanyl|morphine|alprazolam|diazepam)\b/i.test(output) && !metadata.hasDEA) {
          evaluation.satisfied = false;
          evaluation.violation = 'Controlled substance referenced without DEA authorization';
        }
        break;
      case 'no_diagnosis_without_physician':
        if (/\byou have\b|\byou are diagnosed\b|\bdiagnosis:\b/i.test(output) && !metadata.hasAttestation) {
          evaluation.satisfied = false;
          evaluation.violation = 'Definitive diagnosis without physician attestation';
        }
        break;
      case 'no_prescription_without_review':
        if (/\bprescri(?:be|ption|bing)\b/i.test(output) && !metadata.hasAttestation) {
          evaluation.satisfied = false;
          evaluation.violation = 'Prescription language without physician review';
        }
        break;
      case 'audit_trail_required':
        if (!metadata.hasAuditTrail) {
          evaluation.satisfied = false;
          evaluation.violation = 'No audit trail for this interaction';
        }
        break;
      case 'no_patient_data_retention':
        // This is checked at the system level, not output level
        evaluation.confidence = 0.8;
        break;
    }

    evaluations.push(evaluation);
  }

  // Evaluate soft invariants
  for (const invariant of contract.softInvariants) {
    const evaluation: InvariantEvaluation = {
      invariant,
      type: 'soft',
      satisfied: true,
      confidence: 0.7, // Lower confidence for soft checks (heuristic)
    };

    switch (invariant) {
      case 'professional_tone':
        if (/\b(?:lol|omg|wtf|gonna|wanna|gotta)\b/i.test(output)) {
          evaluation.satisfied = false;
          evaluation.violation = 'Informal language detected';
          evaluation.confidence = 0.9;
        }
        break;
      case 'evidence_based_citations':
        if (output.length > 500 && !/\b(?:guideline|evidence|study|trial|recommendation|per\s+\w+\s+guidelines)\b/i.test(output)) {
          evaluation.satisfied = false;
          evaluation.violation = 'Long clinical response without evidence citations';
          evaluation.confidence = 0.5;
        }
        break;
      case 'patient_centered_language':
        if (/\bnon-?compliant\b|\bnon-?adherent\b/i.test(output)) {
          evaluation.satisfied = false;
          evaluation.violation = 'Consider patient-centered alternatives to "non-compliant"';
          evaluation.confidence = 0.8;
        }
        break;
      case 'structured_output_format':
        // Heuristic: check for basic structure (headers, lists)
        if (output.length > 200 && !output.includes('\n') && !output.includes(':')) {
          evaluation.satisfied = false;
          evaluation.violation = 'Long response without structured formatting';
          evaluation.confidence = 0.4;
        }
        break;
      default:
        // Other soft invariants pass by default
        break;
    }

    evaluations.push(evaluation);
  }

  return evaluations;
}

/**
 * Compute the (p, delta, k)-Satisfaction score.
 *
 * - p: proportion of ALL invariants satisfied (0.0-1.0)
 * - delta: maximum deviation = 1 - p (worst case gap)
 * - k: count of HARD invariant violations (must be 0 for approval)
 *
 * The agent passes if: k === 0 AND p >= threshold (default 0.8)
 *
 * @param evaluations - Invariant evaluation results
 * @param threshold - Minimum p value for satisfaction (default: 0.8)
 * @returns Satisfaction score
 */
export function computeSatisfaction(
  evaluations: InvariantEvaluation[],
  threshold: number = 0.8,
): SatisfactionScore {
  const hardEvals = evaluations.filter(e => e.type === 'hard');
  const softEvals = evaluations.filter(e => e.type === 'soft');

  const hardSatisfied = hardEvals.filter(e => e.satisfied).length;
  const softSatisfied = softEvals.filter(e => e.satisfied).length;

  const totalInvariants = evaluations.length;
  const totalSatisfied = hardSatisfied + softSatisfied;

  const p = totalInvariants > 0 ? totalSatisfied / totalInvariants : 1.0;
  const delta = 1.0 - p;
  const k = hardEvals.length - hardSatisfied;

  return {
    p,
    delta,
    k,
    satisfied: k === 0 && p >= threshold,
    breakdown: {
      hardInvariantsTotal: hardEvals.length,
      hardInvariantsSatisfied: hardSatisfied,
      softInvariantsTotal: softEvals.length,
      softInvariantsSatisfied: softSatisfied,
    },
  };
}

/**
 * Run full contract validation: preconditions + invariants + satisfaction.
 *
 * @param contract - The agent contract to validate against
 * @param preconditions - Actual precondition values
 * @param output - The agent's output text
 * @param metadata - Additional context for evaluation
 * @returns Complete validation result
 */
export function validateContract(
  contract: AgentContract,
  preconditions: Preconditions,
  output: string,
  metadata?: Parameters<typeof evaluateInvariants>[2],
): ContractValidationResult {
  const preconditionResult = validatePreconditions(contract, preconditions);
  const invariantEvaluations = evaluateInvariants(contract, output, metadata);
  const satisfactionScore = computeSatisfaction(invariantEvaluations);

  const failureReasons: string[] = [];

  if (!preconditionResult.allMet) {
    const failed = preconditionResult.results.filter(r => !r.met);
    failureReasons.push(...failed.map(r => r.reason ?? `Precondition "${r.precondition}" not met`));
  }

  if (satisfactionScore.k > 0) {
    const hardViolations = invariantEvaluations.filter(e => e.type === 'hard' && !e.satisfied);
    failureReasons.push(...hardViolations.map(e => e.violation ?? `Hard invariant "${e.invariant}" violated`));
  }

  if (!satisfactionScore.satisfied && satisfactionScore.k === 0) {
    failureReasons.push(`Satisfaction score ${satisfactionScore.p.toFixed(2)} below threshold`);
  }

  return {
    contractName: contract.name,
    passed: preconditionResult.allMet && satisfactionScore.satisfied,
    preconditions: preconditionResult,
    invariantEvaluations,
    satisfactionScore,
    validatedAt: new Date().toISOString(),
    failureReasons,
  };
}
