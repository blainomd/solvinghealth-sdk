/**
 * @solvinghealth/clinical -- Clinical Agent Harness
 *
 * The core clinical AI harness that wraps ANY LLM (Claude, GPT, Gemini)
 * with healthcare-specific guardrails:
 *
 * 1. System prompt injection with clinical safety rules
 * 2. PHI boundary enforcement (pre/post LLM scanning)
 * 3. Scope-of-practice enforcement based on provider credentials
 * 4. Response validation against clinical assertions
 * 5. Hallucination detection via FHIR data anchoring
 * 6. Configurable model provider
 *
 * This is the "agentic orchestration layer" -- the harness is model-agnostic.
 * Every module in SolvingHealth is a harness around an LLM with domain
 * prompts and guardrails.
 *
 * @module @solvinghealth/clinical/agent
 * @license PROPRIETARY -- SEE LICENSE
 */

import { z } from 'zod';
import { PHIDetector } from '@solvinghealth/hipaa';
import type { AuditLogger } from '@solvinghealth/hipaa';

// ─── Types ──────────────────────────────────────────────────

/** Supported LLM providers */
export type LLMProvider = 'claude' | 'openai' | 'gemini';

/** LLM provider configuration */
export const LLMConfigSchema = z.object({
  /** LLM provider */
  provider: z.enum(['claude', 'openai', 'gemini']),
  /** Model identifier (e.g., 'claude-sonnet-4-20250514', 'gpt-4o', 'gemini-pro') */
  model: z.string(),
  /** API key for the provider */
  apiKey: z.string().min(1),
  /** API base URL override (for proxies or custom endpoints) */
  baseUrl: z.string().url().optional(),
  /** Max tokens for response */
  maxTokens: z.number().int().positive().default(4096),
  /** Temperature (0.0-1.0) */
  temperature: z.number().min(0).max(1).default(0.3),
});

export type LLMConfig = z.infer<typeof LLMConfigSchema>;

/** Provider credentials for scope-of-practice enforcement */
export const ProviderCredentialsSchema = z.object({
  /** National Provider Identifier */
  npi: z.string().regex(/^\d{10}$/, 'NPI must be 10 digits'),
  /** Provider name */
  name: z.string(),
  /** Credential type */
  credentialType: z.enum(['MD', 'DO', 'NP', 'PA', 'RN', 'LCSW', 'PhD', 'PharmD']),
  /** Board certifications */
  boardCertifications: z.array(z.string()),
  /** State licenses (two-letter state codes) */
  stateLicenses: z.array(z.string().length(2)),
  /** DEA number (for controlled substance prescribing) */
  deaNumber: z.string().optional(),
  /** Medical specialties */
  specialties: z.array(z.string()),
});

export type ProviderCredentials = z.infer<typeof ProviderCredentialsSchema>;

/** Clinical agent configuration */
export const ClinicalAgentConfigSchema = z.object({
  /** LLM provider configuration */
  llm: LLMConfigSchema,
  /** Provider credentials for scope-of-practice enforcement */
  credentials: ProviderCredentialsSchema.optional(),
  /** Whether to enforce PHI boundaries (default: true) */
  enforcePhiBoundary: z.boolean().default(true),
  /** Whether to enforce scope of practice (default: true) */
  enforceScopeOfPractice: z.boolean().default(true),
  /** Custom system prompt to prepend to clinical guardrails */
  customSystemPrompt: z.string().optional(),
  /** Clinical specialty context for the agent */
  specialtyContext: z.string().optional(),
  /** Audit logger instance */
  auditLogger: z.any().optional(),
  /** PHI detector sensitivity */
  phiSensitivity: z.enum(['strict', 'standard', 'lenient']).default('standard'),
});

export type ClinicalAgentConfig = z.infer<typeof ClinicalAgentConfigSchema>;

/** A message in the clinical conversation */
export interface ClinicalMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** Clinical agent response with validation metadata */
export interface ClinicalAgentResponse {
  /** The agent's response text */
  content: string;
  /** Whether PHI was detected and redacted in the input */
  inputPHIRedacted: boolean;
  /** Whether PHI was detected in the output (should be false) */
  outputPHIDetected: boolean;
  /** Whether the response passed scope-of-practice checks */
  scopeValid: boolean;
  /** Validation issues found in the response */
  validationIssues: ValidationIssue[];
  /** Token usage */
  usage: { inputTokens: number; outputTokens: number };
  /** The model that generated the response */
  model: string;
  /** Response generation time in ms */
  latencyMs: number;
}

/** A validation issue found in the agent's response */
export interface ValidationIssue {
  /** Severity of the issue */
  severity: 'error' | 'warning' | 'info';
  /** Category of the issue */
  category: 'phi_leak' | 'scope_violation' | 'clinical_assertion' | 'hallucination' | 'safety';
  /** Human-readable description */
  message: string;
  /** The text span that triggered the issue (if applicable) */
  span?: string;
}

// ─── Clinical Guardrails System Prompt ──────────────────────

const CLINICAL_GUARDRAILS_PROMPT = `You are a clinical AI assistant operating within a physician-supervised harness.

ABSOLUTE RULES (violations are logged and flagged):
1. NEVER provide a definitive diagnosis. Always frame as "considerations" or "differential includes."
2. NEVER recommend starting, stopping, or changing medication without physician review.
3. NEVER provide dosing calculations for controlled substances.
4. NEVER dismiss patient-reported symptoms.
5. ALWAYS include "This requires physician review and confirmation" for any clinical recommendation.
6. NEVER store, repeat, or reference specific patient identifiers (name, DOB, SSN, MRN, address).
7. If asked to perform an action outside clinical scope, decline and explain why.
8. ALWAYS cite evidence-based guidelines when making clinical suggestions.
9. Flag any critical findings (life-threatening conditions, drug interactions) with [CRITICAL].
10. When uncertain, say so explicitly rather than guessing.

SCOPE ENFORCEMENT:
- You operate within the scope of the supervising physician's credentials.
- Do not make recommendations outside the physician's board certifications.
- If a question falls outside scope, recommend referral to appropriate specialty.

OUTPUT FORMAT:
- Use structured format when generating clinical content.
- Include confidence level (high/medium/low) for clinical assertions.
- Separate factual statements from clinical judgment.`;

// ─── Scope of Practice Rules ────────────────────────────────

/**
 * Categories of clinical activities and which credential types can perform them.
 */
const SCOPE_OF_PRACTICE: Record<string, string[]> = {
  'prescribe_controlled': ['MD', 'DO', 'NP', 'PA'], // Need DEA
  'prescribe_non_controlled': ['MD', 'DO', 'NP', 'PA', 'PharmD'],
  'diagnose': ['MD', 'DO', 'NP', 'PA'],
  'order_imaging': ['MD', 'DO', 'NP', 'PA'],
  'order_labs': ['MD', 'DO', 'NP', 'PA'],
  'perform_procedure': ['MD', 'DO'],
  'counsel': ['MD', 'DO', 'NP', 'PA', 'RN', 'LCSW', 'PhD'],
  'prescribe_therapy': ['MD', 'DO', 'NP', 'PA', 'LCSW', 'PhD'],
  'care_plan': ['MD', 'DO', 'NP', 'PA', 'RN'],
  'triage': ['MD', 'DO', 'NP', 'PA', 'RN'],
};

// ─── Response Validators ────────────────────────────────────

/**
 * Patterns that indicate potentially dangerous clinical assertions.
 */
const DANGEROUS_PATTERNS = [
  { pattern: /\byou (?:have|are diagnosed with|suffer from)\b/i, message: 'Definitive diagnosis detected -- must use "may" or "considerations include"' },
  { pattern: /\b(?:start|begin|take|increase|decrease|stop|discontinue)\s+(?:taking\s+)?\w+\s*\d+\s*mg/i, message: 'Specific medication dosing recommendation detected -- requires physician attestation' },
  { pattern: /\b(?:inject|administer)\s+\d+\s*(?:mg|ml|mcg|units)/i, message: 'Injection dosing detected -- requires physician order' },
  { pattern: /\bno need (?:to|for) (?:see|visit|consult)\b/i, message: 'Discouraging medical consultation detected' },
  { pattern: /\b(?:don't worry|nothing to worry about|it's nothing)\b/i, message: 'Dismissive language about symptoms detected' },
];

// ─── Clinical Agent ─────────────────────────────────────────

/**
 * Clinical Agent Harness -- wraps any LLM with healthcare guardrails.
 *
 * This is the "model-agnostic agentic orchestration layer" at the heart
 * of SolvingHealth's technology. Every clinical AI feature is a configured
 * instance of this harness with domain-specific prompts and rules.
 *
 * @example
 * ```typescript
 * const agent = new ClinicalAgent({
 *   llm: {
 *     provider: 'claude',
 *     model: 'claude-sonnet-4-20250514',
 *     apiKey: process.env.ANTHROPIC_API_KEY!,
 *   },
 *   credentials: {
 *     npi: '1649218389',
 *     name: 'Josh Emdur DO',
 *     credentialType: 'DO',
 *     boardCertifications: ['Internal Medicine'],
 *     stateLicenses: ['CO', 'NY', 'CA', ...],
 *     specialties: ['Internal Medicine', 'Hospitalist'],
 *   },
 *   specialtyContext: 'Primary care evaluation',
 * });
 *
 * const response = await agent.chat([
 *   { role: 'user', content: 'Patient reports chest pain with exertion, relieved by rest.' }
 * ]);
 * ```
 */
export class ClinicalAgent {
  private readonly config: ClinicalAgentConfig;
  private readonly phiDetector: PHIDetector;

  constructor(config: ClinicalAgentConfig) {
    this.config = ClinicalAgentConfigSchema.parse(config);
    this.phiDetector = new PHIDetector({
      sensitivity: this.config.phiSensitivity,
    });
  }

  /**
   * Send a conversation to the LLM with clinical guardrails applied.
   *
   * Flow:
   * 1. Inject clinical guardrails system prompt
   * 2. Scan and redact PHI from input messages
   * 3. Enforce scope-of-practice on the request
   * 4. Send to the configured LLM provider
   * 5. Validate the response for dangerous patterns
   * 6. Scan output for PHI leakage
   * 7. Return response with validation metadata
   *
   * @param messages - Conversation messages
   * @returns Clinical response with validation metadata
   */
  async chat(messages: ClinicalMessage[]): Promise<ClinicalAgentResponse> {
    const startTime = Date.now();
    const issues: ValidationIssue[] = [];

    // 1. Build system prompt with guardrails
    const systemPrompt = this.buildSystemPrompt();

    // 2. Pre-LLM PHI scan and redaction
    let inputPHIRedacted = false;
    const sanitizedMessages = messages.map(msg => {
      if (msg.role === 'system') return msg;

      if (this.config.enforcePhiBoundary) {
        const detection = this.phiDetector.detect(msg.content);
        if (detection.containsPHI) {
          inputPHIRedacted = true;
          issues.push({
            severity: 'warning',
            category: 'phi_leak',
            message: `PHI detected and redacted in ${msg.role} message: ${Object.keys(detection.summary).join(', ')}`,
          });
          return { ...msg, content: detection.redacted };
        }
      }

      return msg;
    });

    // 3. Prepare full message list with system prompt
    const fullMessages: ClinicalMessage[] = [
      { role: 'system', content: systemPrompt },
      ...sanitizedMessages.filter(m => m.role !== 'system'),
    ];

    // 4. Call the LLM provider
    const llmResponse = await this.callLLM(fullMessages);

    // 5. Validate response for dangerous patterns
    for (const check of DANGEROUS_PATTERNS) {
      const match = check.pattern.exec(llmResponse.content);
      if (match) {
        issues.push({
          severity: 'warning',
          category: 'clinical_assertion',
          message: check.message,
          span: match[0],
        });
      }
    }

    // 6. Post-LLM PHI scan
    let outputPHIDetected = false;
    if (this.config.enforcePhiBoundary) {
      const outputDetection = this.phiDetector.detect(llmResponse.content);
      if (outputDetection.containsPHI) {
        outputPHIDetected = true;
        issues.push({
          severity: 'error',
          category: 'phi_leak',
          message: 'PHI detected in LLM output. This should not happen -- review system prompt.',
        });
      }
    }

    // 7. Scope-of-practice validation
    let scopeValid = true;
    if (this.config.enforceScopeOfPractice && this.config.credentials) {
      const scopeIssues = this.validateScope(llmResponse.content);
      if (scopeIssues.length > 0) {
        scopeValid = false;
        issues.push(...scopeIssues);
      }
    }

    // 8. Audit log
    await this.auditInteraction(
      messages,
      llmResponse.content,
      issues,
      inputPHIRedacted,
      outputPHIDetected,
    );

    return {
      content: llmResponse.content,
      inputPHIRedacted,
      outputPHIDetected,
      scopeValid,
      validationIssues: issues,
      usage: llmResponse.usage,
      model: this.config.llm.model,
      latencyMs: Date.now() - startTime,
    };
  }

  // ─── Private Methods ────────────────────────────────────

  /**
   * Build the complete system prompt with clinical guardrails.
   */
  private buildSystemPrompt(): string {
    const parts = [CLINICAL_GUARDRAILS_PROMPT];

    if (this.config.customSystemPrompt) {
      parts.push(`\nADDITIONAL CONTEXT:\n${this.config.customSystemPrompt}`);
    }

    if (this.config.specialtyContext) {
      parts.push(`\nSPECIALTY CONTEXT: ${this.config.specialtyContext}`);
    }

    if (this.config.credentials) {
      parts.push(
        `\nSUPERVISING PHYSICIAN: ${this.config.credentials.name}`,
        `Credentials: ${this.config.credentials.credentialType}`,
        `Specialties: ${this.config.credentials.specialties.join(', ')}`,
        `Board Certifications: ${this.config.credentials.boardCertifications.join(', ')}`,
        `Licensed States: ${this.config.credentials.stateLicenses.join(', ')}`,
      );
    }

    return parts.join('\n');
  }

  /**
   * Call the LLM provider API.
   * This is the model-agnostic abstraction layer.
   */
  private async callLLM(
    messages: ClinicalMessage[],
  ): Promise<{ content: string; usage: { inputTokens: number; outputTokens: number } }> {
    const { provider, model, apiKey, baseUrl, maxTokens, temperature } = this.config.llm;

    switch (provider) {
      case 'claude': {
        const url = baseUrl ?? 'https://api.anthropic.com/v1/messages';
        const systemMsg = messages.find(m => m.role === 'system');
        const nonSystemMsgs = messages.filter(m => m.role !== 'system');

        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model,
            max_tokens: maxTokens,
            temperature,
            system: systemMsg?.content,
            messages: nonSystemMsgs.map(m => ({
              role: m.role,
              content: m.content,
            })),
          }),
        });

        if (!response.ok) {
          throw new Error(`Claude API error: ${response.status} ${response.statusText}`);
        }

        const data = await response.json() as {
          content: Array<{ text: string }>;
          usage: { input_tokens: number; output_tokens: number };
        };

        return {
          content: data.content.map(c => c.text).join(''),
          usage: {
            inputTokens: data.usage.input_tokens,
            outputTokens: data.usage.output_tokens,
          },
        };
      }

      case 'openai': {
        const url = baseUrl ?? 'https://api.openai.com/v1/chat/completions';

        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model,
            max_tokens: maxTokens,
            temperature,
            messages: messages.map(m => ({
              role: m.role,
              content: m.content,
            })),
          }),
        });

        if (!response.ok) {
          throw new Error(`OpenAI API error: ${response.status} ${response.statusText}`);
        }

        const data = await response.json() as {
          choices: Array<{ message: { content: string } }>;
          usage: { prompt_tokens: number; completion_tokens: number };
        };

        return {
          content: data.choices[0]?.message.content ?? '',
          usage: {
            inputTokens: data.usage.prompt_tokens,
            outputTokens: data.usage.completion_tokens,
          },
        };
      }

      case 'gemini': {
        const url = baseUrl ??
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

        const systemMsg = messages.find(m => m.role === 'system');
        const nonSystemMsgs = messages.filter(m => m.role !== 'system');

        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            system_instruction: systemMsg ? { parts: [{ text: systemMsg.content }] } : undefined,
            contents: nonSystemMsgs.map(m => ({
              role: m.role === 'assistant' ? 'model' : 'user',
              parts: [{ text: m.content }],
            })),
            generationConfig: {
              maxOutputTokens: maxTokens,
              temperature,
            },
          }),
        });

        if (!response.ok) {
          throw new Error(`Gemini API error: ${response.status} ${response.statusText}`);
        }

        const data = await response.json() as {
          candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
          usageMetadata: { promptTokenCount: number; candidatesTokenCount: number };
        };

        return {
          content: data.candidates[0]?.content.parts.map(p => p.text).join('') ?? '',
          usage: {
            inputTokens: data.usageMetadata.promptTokenCount,
            outputTokens: data.usageMetadata.candidatesTokenCount,
          },
        };
      }

      default:
        throw new Error(`Unsupported LLM provider: ${provider as string}`);
    }
  }

  /**
   * Validate the response against scope-of-practice rules.
   */
  private validateScope(content: string): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    const creds = this.config.credentials;
    if (!creds) return issues;

    // Check for prescribing language
    if (/\b(?:prescribe|prescribing|prescription)\b/i.test(content)) {
      const allowed = SCOPE_OF_PRACTICE['prescribe_non_controlled'] ?? [];
      if (!allowed.includes(creds.credentialType)) {
        issues.push({
          severity: 'error',
          category: 'scope_violation',
          message: `${creds.credentialType} credential type cannot prescribe medications`,
        });
      }
    }

    // Check for controlled substance prescribing
    if (/\b(?:schedule\s+[IViv]+|controlled|opioid|benzodiazepine|stimulant)\b/i.test(content)) {
      if (!creds.deaNumber) {
        issues.push({
          severity: 'error',
          category: 'scope_violation',
          message: 'Controlled substance discussion detected but provider has no DEA number on file',
        });
      }
    }

    // Check for procedure language
    if (/\b(?:perform|performing|surgical|operate|incision)\b/i.test(content)) {
      const allowed = SCOPE_OF_PRACTICE['perform_procedure'] ?? [];
      if (!allowed.includes(creds.credentialType)) {
        issues.push({
          severity: 'warning',
          category: 'scope_violation',
          message: `${creds.credentialType} credential type typically does not perform procedures`,
        });
      }
    }

    return issues;
  }

  /**
   * Log the interaction to the audit trail.
   */
  private async auditInteraction(
    _inputMessages: ClinicalMessage[],
    _output: string,
    issues: ValidationIssue[],
    phiRedacted: boolean,
    phiInOutput: boolean,
  ): Promise<void> {
    const logger = this.config.auditLogger as AuditLogger | undefined;
    if (!logger) return;

    try {
      await logger.log({
        actor: this.config.credentials?.npi ?? 'system',
        actorRole: this.config.credentials?.credentialType ?? 'ai-agent',
        action: 'write',
        resourceType: 'ClinicalAgentInteraction',
        resourceId: `agent-${Date.now()}`,
        phiAccessed: phiRedacted,
        outcome: phiInOutput || issues.some(i => i.severity === 'error') ? 'error' : 'success',
        reason: issues.length > 0 ? issues.map(i => i.message).join('; ') : undefined,
        metadata: {
          model: this.config.llm.model,
          provider: this.config.llm.provider,
          issueCount: issues.length,
          errorCount: issues.filter(i => i.severity === 'error').length,
        },
      });
    } catch {
      // Audit failures should not break the clinical workflow
    }
  }
}
