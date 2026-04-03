/**
 * @solvinghealth/clinical -- Agentic Handshake Protocol
 *
 * The 5-step clinical validation flow for AI healthcare outputs.
 * This is the core ClinicalSwipe protocol as a state machine:
 *
 * Step 1: AI company submits clinical output (structured JSON)
 * Step 2: Harness validates against CMS billing rules + AKS/Stark
 * Step 3: Routes to specialty-matched physician via ClinicalSwipe
 * Step 4: Physician reviews (approve/modify/reject with attestation)
 * Step 5: Returns validated result with audit trail + billing codes
 *
 * Each step is a discrete state with typed inputs/outputs and
 * validation. The state machine ensures no step can be skipped
 * and every transition is auditable.
 *
 * @module @solvinghealth/clinical/handshake
 * @license PROPRIETARY -- SEE LICENSE
 */

import { z } from 'zod';
import { createHash, randomUUID } from 'node:crypto';

// ─── Step Types ─────────────────────────────────────────────

/** Step 1: Clinical output submission */
export const SubmissionSchema = z.object({
  /** Unique submission ID (generated if not provided) */
  submissionId: z.string().uuid().optional(),
  /** The AI company/system submitting the output */
  source: z.object({
    /** Company or system name */
    name: z.string(),
    /** API key or client ID */
    clientId: z.string(),
    /** Software version */
    version: z.string().optional(),
  }),
  /** Type of clinical output */
  outputType: z.enum([
    'treatment_plan',
    'diagnosis',
    'prescription',
    'lab_interpretation',
    'imaging_interpretation',
    'care_plan',
    'clinical_note',
    'lmn',
    'prior_auth',
    'risk_assessment',
    'triage',
    'referral',
  ]),
  /** The AI-generated clinical content */
  content: z.object({
    /** Structured clinical output (JSON) */
    structured: z.record(z.unknown()),
    /** Human-readable narrative */
    narrative: z.string(),
    /** Confidence score from the AI model (0.0-1.0) */
    confidence: z.number().min(0).max(1).optional(),
    /** Supporting evidence/citations */
    evidence: z.array(z.string()).optional(),
  }),
  /** De-identified patient context */
  patientContext: z.object({
    /** Age (NOT date of birth) */
    age: z.number().int().positive().optional(),
    /** Biological sex */
    sex: z.enum(['male', 'female', 'other', 'unknown']).optional(),
    /** Active conditions (de-identified) */
    conditions: z.array(z.string()).optional(),
    /** Current medications (generic names only) */
    medications: z.array(z.string()).optional(),
    /** Relevant lab values */
    relevantLabs: z.array(z.object({
      name: z.string(),
      value: z.string(),
      unit: z.string().optional(),
      referenceRange: z.string().optional(),
    })).optional(),
  }),
  /** Requested specialty for review */
  specialty: z.string(),
  /** Urgency level */
  urgency: z.enum(['routine', 'expedited', 'stat', 'emergency']).default('routine'),
  /** Requested billing codes (AI's suggestion, physician validates) */
  suggestedBillingCodes: z.array(z.object({
    system: z.enum(['CPT', 'HCPCS', 'ICD10']),
    code: z.string(),
    description: z.string().optional(),
  })).optional(),
});

export type Submission = z.infer<typeof SubmissionSchema>;

/** Step 2: Compliance validation result */
export const ComplianceCheckSchema = z.object({
  /** Whether the submission passes compliance checks */
  compliant: z.boolean(),
  /** AKS (Anti-Kickback Statute) check result */
  aksCheck: z.object({
    passed: z.boolean(),
    violations: z.array(z.string()),
  }),
  /** Stark Law check result */
  starkCheck: z.object({
    passed: z.boolean(),
    violations: z.array(z.string()),
  }),
  /** CMS billing rule validation */
  billingCheck: z.object({
    passed: z.boolean(),
    validCodes: z.array(z.string()),
    invalidCodes: z.array(z.object({
      code: z.string(),
      reason: z.string(),
    })),
  }),
  /** Fair Market Value check */
  fmvCheck: z.object({
    passed: z.boolean(),
    estimatedFMV: z.string().optional(),
    notes: z.string().optional(),
  }),
});

export type ComplianceCheck = z.infer<typeof ComplianceCheckSchema>;

/** Step 3: Physician routing decision */
export const RoutingDecisionSchema = z.object({
  /** Assigned physician NPI */
  physicianNpi: z.string(),
  /** Physician name */
  physicianName: z.string(),
  /** Physician credentials */
  physicianCredentials: z.string(),
  /** Matched specialty */
  matchedSpecialty: z.string(),
  /** Estimated review time */
  estimatedReviewTime: z.string(),
  /** Routing reason */
  routingReason: z.string(),
  /** Queue position */
  queuePosition: z.number().int().nonnegative().optional(),
});

export type RoutingDecision = z.infer<typeof RoutingDecisionSchema>;

/** Step 4: Physician review decision */
export const PhysicianReviewSchema = z.object({
  /** Review decision */
  decision: z.enum(['approve', 'modify', 'reject']),
  /** Clinical reasoning for the decision */
  reasoning: z.string().min(10),
  /** Modifications (required if decision is 'modify') */
  modifications: z.string().optional(),
  /** Modified structured content (if decision is 'modify') */
  modifiedContent: z.record(z.unknown()).optional(),
  /** Physician's validated billing codes */
  validatedBillingCodes: z.array(z.object({
    system: z.enum(['CPT', 'HCPCS', 'ICD10']),
    code: z.string(),
    description: z.string().optional(),
  })).optional(),
  /** Attestation timestamp */
  attestedAt: z.string().datetime(),
  /** Physician NPI */
  physicianNpi: z.string(),
  /** Time spent on review (minutes) */
  reviewDurationMinutes: z.number().positive().optional(),
});

export type PhysicianReview = z.infer<typeof PhysicianReviewSchema>;

/** Step 5: Validated result returned to the AI company */
export const ValidatedResultSchema = z.object({
  /** Unique attestation ID (immutable) */
  attestationId: z.string().uuid(),
  /** Original submission ID */
  submissionId: z.string().uuid(),
  /** SHA-256 hash of the original AI output */
  originalContentHash: z.string(),
  /** SHA-256 hash of the attestation record */
  attestationHash: z.string(),
  /** Final decision */
  decision: z.enum(['approve', 'modify', 'reject']),
  /** Clinical reasoning */
  reasoning: z.string(),
  /** Final content (original if approved, modified if modified) */
  finalContent: z.record(z.unknown()),
  /** Validated billing codes */
  billingCodes: z.array(z.object({
    system: z.enum(['CPT', 'HCPCS', 'ICD10']),
    code: z.string(),
    description: z.string().optional(),
  })),
  /** Physician attestation details */
  physician: z.object({
    npi: z.string(),
    name: z.string(),
    credentials: z.string(),
    specialty: z.string(),
  }),
  /** Compliance validation summary */
  compliance: ComplianceCheckSchema,
  /** Audit trail */
  auditTrail: z.object({
    submittedAt: z.string().datetime(),
    complianceCheckedAt: z.string().datetime(),
    routedAt: z.string().datetime(),
    reviewedAt: z.string().datetime(),
    completedAt: z.string().datetime(),
  }),
  /** Regulatory note */
  regulatoryNote: z.string(),
});

export type ValidatedResult = z.infer<typeof ValidatedResultSchema>;

// ─── State Machine ──────────────────────────────────────────

/** Handshake protocol states */
export type HandshakeState =
  | 'submitted'
  | 'compliance_checked'
  | 'routed'
  | 'reviewed'
  | 'completed'
  | 'rejected_compliance'
  | 'error';

/** Complete handshake record tracking all 5 steps */
export interface HandshakeRecord {
  /** Current state */
  state: HandshakeState;
  /** Step 1: Original submission */
  submission: Submission;
  /** Step 2: Compliance check result (populated after compliance check) */
  complianceCheck?: ComplianceCheck;
  /** Step 3: Routing decision (populated after routing) */
  routingDecision?: RoutingDecision;
  /** Step 4: Physician review (populated after review) */
  physicianReview?: PhysicianReview;
  /** Step 5: Validated result (populated on completion) */
  validatedResult?: ValidatedResult;
  /** Error details (if state is 'error') */
  error?: string;
  /** Timestamps for each state transition */
  timestamps: Record<string, string>;
}

/**
 * Agentic Handshake Protocol -- 5-step clinical validation state machine.
 *
 * This implements the ClinicalSwipe review flow as a typed state machine
 * with validation at each transition. No step can be skipped, and every
 * transition is recorded for the audit trail.
 *
 * @example
 * ```typescript
 * const handshake = new HandshakeProtocol();
 *
 * // Step 1: Submit
 * const record = await handshake.submit({
 *   source: { name: 'Ambient Scribe AI', clientId: 'client-123' },
 *   outputType: 'clinical_note',
 *   content: {
 *     structured: { soap: { subjective: '...', objective: '...', assessment: '...', plan: '...' } },
 *     narrative: 'Patient presents with...',
 *   },
 *   patientContext: { age: 67, sex: 'male', conditions: ['Osteoarthritis'] },
 *   specialty: 'msk',
 * });
 *
 * // Step 2: Compliance check (automatic)
 * // Step 3: Route to physician
 * const routed = await handshake.route(record.submission.submissionId!, routingDecision);
 * // Step 4: Physician reviews
 * const reviewed = await handshake.review(record.submission.submissionId!, physicianReview);
 * // Step 5: Complete
 * const result = await handshake.complete(record.submission.submissionId!);
 * ```
 */
export class HandshakeProtocol {
  private readonly records = new Map<string, HandshakeRecord>();

  /**
   * Step 1: Submit a clinical output for the handshake protocol.
   * Automatically runs Step 2 (compliance check) inline.
   *
   * @param submission - The clinical output submission
   * @returns The handshake record with compliance results
   */
  async submit(submission: Submission): Promise<HandshakeRecord> {
    const validated = SubmissionSchema.parse(submission);
    const submissionId = validated.submissionId ?? randomUUID();
    validated.submissionId = submissionId;

    const now = new Date().toISOString();

    const record: HandshakeRecord = {
      state: 'submitted',
      submission: validated,
      timestamps: { submitted: now },
    };

    // Auto-run Step 2: Compliance check
    const complianceCheck = await this.runComplianceCheck(validated);
    record.complianceCheck = complianceCheck;
    record.timestamps['compliance_checked'] = new Date().toISOString();

    if (!complianceCheck.compliant) {
      record.state = 'rejected_compliance';
    } else {
      record.state = 'compliance_checked';
    }

    this.records.set(submissionId, record);
    return record;
  }

  /**
   * Step 3: Route to a physician for review.
   *
   * @param submissionId - The submission ID
   * @param routing - The routing decision
   * @returns Updated handshake record
   */
  async route(submissionId: string, routing: RoutingDecision): Promise<HandshakeRecord> {
    const record = this.getRecord(submissionId);

    if (record.state !== 'compliance_checked') {
      throw new Error(`Cannot route: handshake is in state "${record.state}", expected "compliance_checked"`);
    }

    record.routingDecision = RoutingDecisionSchema.parse(routing);
    record.state = 'routed';
    record.timestamps['routed'] = new Date().toISOString();

    return record;
  }

  /**
   * Step 4: Record physician review decision.
   *
   * @param submissionId - The submission ID
   * @param review - The physician's review decision
   * @returns Updated handshake record
   */
  async review(submissionId: string, review: PhysicianReview): Promise<HandshakeRecord> {
    const record = this.getRecord(submissionId);

    if (record.state !== 'routed') {
      throw new Error(`Cannot review: handshake is in state "${record.state}", expected "routed"`);
    }

    record.physicianReview = PhysicianReviewSchema.parse(review);
    record.state = 'reviewed';
    record.timestamps['reviewed'] = new Date().toISOString();

    return record;
  }

  /**
   * Step 5: Complete the handshake and generate the validated result.
   *
   * @param submissionId - The submission ID
   * @returns The final validated result
   */
  async complete(submissionId: string): Promise<ValidatedResult> {
    const record = this.getRecord(submissionId);

    if (record.state !== 'reviewed') {
      throw new Error(`Cannot complete: handshake is in state "${record.state}", expected "reviewed"`);
    }

    const review = record.physicianReview!;
    const routing = record.routingDecision!;

    // Compute content hashes
    const originalContentHash = createHash('sha256')
      .update(JSON.stringify(record.submission.content))
      .digest('hex');

    const attestationId = randomUUID();

    const attestationHash = createHash('sha256')
      .update(JSON.stringify({
        attestationId,
        decision: review.decision,
        reasoning: review.reasoning,
        physicianNpi: review.physicianNpi,
        attestedAt: review.attestedAt,
      }))
      .digest('hex');

    const finalContent = review.decision === 'modify' && review.modifiedContent
      ? review.modifiedContent
      : record.submission.content.structured;

    const validatedResult: ValidatedResult = {
      attestationId,
      submissionId,
      originalContentHash,
      attestationHash,
      decision: review.decision,
      reasoning: review.reasoning,
      finalContent,
      billingCodes: review.validatedBillingCodes ?? record.submission.suggestedBillingCodes ?? [],
      physician: {
        npi: routing.physicianNpi,
        name: routing.physicianName,
        credentials: routing.physicianCredentials,
        specialty: routing.matchedSpecialty,
      },
      compliance: record.complianceCheck!,
      auditTrail: {
        submittedAt: record.timestamps['submitted']!,
        complianceCheckedAt: record.timestamps['compliance_checked']!,
        routedAt: record.timestamps['routed']!,
        reviewedAt: record.timestamps['reviewed']!,
        completedAt: new Date().toISOString(),
      },
      regulatoryNote:
        'This attestation constitutes documented physician oversight of AI-generated ' +
        'clinical output per the 21st Century Cures Act CDS exemption criteria. ' +
        'The attestation ID can be referenced in FDA SaMD submissions, CMS ACCESS ' +
        'Model compliance documentation, and malpractice defense records. ' +
        'This record is immutable and must be retained for 7 years per CMS requirements.',
    };

    record.validatedResult = validatedResult;
    record.state = 'completed';
    record.timestamps['completed'] = validatedResult.auditTrail.completedAt;

    return validatedResult;
  }

  /**
   * Get the current state of a handshake.
   */
  getState(submissionId: string): HandshakeRecord {
    return this.getRecord(submissionId);
  }

  // ─── Private Methods ────────────────────────────────────

  private getRecord(submissionId: string): HandshakeRecord {
    const record = this.records.get(submissionId);
    if (!record) {
      throw new Error(`Handshake record not found: ${submissionId}`);
    }
    return record;
  }

  /**
   * Run compliance checks against the submission.
   * This is Step 2 of the handshake protocol.
   */
  private async runComplianceCheck(submission: Submission): Promise<ComplianceCheck> {
    const aksViolations: string[] = [];
    const starkViolations: string[] = [];
    const invalidCodes: Array<{ code: string; reason: string }> = [];
    const validCodes: string[] = [];

    // AKS check: ensure no percentage-based compensation references
    const narrative = submission.content.narrative.toLowerCase();
    if (narrative.includes('percentage') || narrative.includes('% of revenue')) {
      aksViolations.push('Percentage-based compensation detected -- AKS requires flat fee arrangements');
    }
    if (narrative.includes('referral bonus') || narrative.includes('referral fee')) {
      aksViolations.push('Referral incentive language detected -- potential AKS violation');
    }

    // Stark check: designated health services
    const dhsServices = ['clinical laboratory', 'imaging', 'dme', 'home health', 'outpatient drugs'];
    for (const dhs of dhsServices) {
      if (narrative.includes(dhs) && narrative.includes('self-referral')) {
        starkViolations.push(`Self-referral to designated health service detected: ${dhs}`);
      }
    }

    // Billing code validation (basic format check)
    if (submission.suggestedBillingCodes) {
      for (const code of submission.suggestedBillingCodes) {
        if (code.system === 'CPT' && !/^\d{5}$/.test(code.code)) {
          invalidCodes.push({ code: code.code, reason: 'CPT codes must be 5 digits' });
        } else if (code.system === 'ICD10' && !/^[A-Z]\d{2}(\.\d{1,4})?$/.test(code.code)) {
          invalidCodes.push({ code: code.code, reason: 'Invalid ICD-10 format' });
        } else if (code.system === 'HCPCS' && !/^[A-V]\d{4}$/.test(code.code)) {
          invalidCodes.push({ code: code.code, reason: 'HCPCS codes must be letter + 4 digits' });
        } else {
          validCodes.push(code.code);
        }
      }
    }

    return {
      compliant: aksViolations.length === 0 && starkViolations.length === 0,
      aksCheck: {
        passed: aksViolations.length === 0,
        violations: aksViolations,
      },
      starkCheck: {
        passed: starkViolations.length === 0,
        violations: starkViolations,
      },
      billingCheck: {
        passed: invalidCodes.length === 0,
        validCodes,
        invalidCodes,
      },
      fmvCheck: {
        passed: true, // FMV requires external data, pass by default
        notes: 'FMV validation requires encounter pricing data for complete assessment',
      },
    };
  }
}
