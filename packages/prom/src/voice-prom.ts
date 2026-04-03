/**
 * @solvinghealth/prom — Voice PROM Collection
 *
 * Conversational PROM collection via voice or text. Maps natural language
 * responses to structured instrument item scores. Supports bridging study
 * data model for voice-to-validated-instrument equivalence validation.
 *
 * Integration point for PGA (Pretty Good AI).
 *
 * MIT License
 */

import { z } from 'zod';
import {
  type InstrumentDefinition,
  type InstrumentItem,
  getInstrument,
} from './instruments.js';
import {
  type SurveySession,
  createSession,
  recordResponse,
  getNextItem,
} from './collector.js';

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

export const VoiceResponseMappingSchema = z.object({
  /** The raw voice/text input from the patient */
  rawInput: z.string(),
  /** The instrument item this maps to */
  itemId: z.string(),
  /** The interpreted numeric value */
  mappedValue: z.number(),
  /** Confidence of the mapping (0-1) */
  confidence: z.number().min(0).max(1),
  /** Whether this mapping needs human review */
  needsReview: z.boolean(),
  /** Alternative interpretations considered */
  alternatives: z.array(z.object({
    value: z.number(),
    confidence: z.number(),
    rationale: z.string(),
  })),
  /** Timestamp */
  timestamp: z.string().datetime(),
});
export type VoiceResponseMapping = z.infer<typeof VoiceResponseMappingSchema>;

export const ConversationalPromptSchema = z.object({
  /** The item being asked about */
  itemId: z.string(),
  /** Conversational version of the question */
  conversationalText: z.string(),
  /** Follow-up clarification if response is ambiguous */
  clarificationPrompt: z.string(),
  /** Example responses and their mappings */
  exampleMappings: z.array(z.object({
    input: z.string(),
    value: z.number(),
    label: z.string(),
  })),
});
export type ConversationalPrompt = z.infer<typeof ConversationalPromptSchema>;

export const BridgingStudyRecordSchema = z.object({
  /** Unique record ID */
  recordId: z.string(),
  /** Patient identifier */
  patientId: z.string(),
  /** Instrument used */
  instrumentId: z.string(),
  /** Item being compared */
  itemId: z.string(),
  /** Score from traditional (paper/digital form) administration */
  traditionalScore: z.number(),
  /** Score from voice administration */
  voiceScore: z.number(),
  /** Raw voice input */
  voiceRawInput: z.string(),
  /** Mapping confidence */
  mappingConfidence: z.number(),
  /** Time between administrations in hours */
  timeBetweenHours: z.number(),
  /** Administration order */
  order: z.enum(['voice_first', 'traditional_first']),
  /** Timestamp */
  recordedAt: z.string().datetime(),
});
export type BridgingStudyRecord = z.infer<typeof BridgingStudyRecordSchema>;

export const VoicePROMSessionSchema = z.object({
  /** Underlying survey session */
  session: SurveySession,
  /** Voice response mappings */
  voiceMappings: z.array(VoiceResponseMappingSchema),
  /** Bridging study records (if participating in validation study) */
  bridgingRecords: z.array(BridgingStudyRecordSchema),
  /** PGA integration configuration */
  pgaConfig: z.object({
    enabled: z.boolean(),
    modelId: z.string().optional(),
    voiceId: z.string().optional(),
  }).optional(),
});
export type VoicePROMSession = z.infer<typeof VoicePROMSessionSchema>;

// ---------------------------------------------------------------------------
// Natural Language Response Mapping
// ---------------------------------------------------------------------------

/**
 * Keyword-to-score mapping tables for common response patterns.
 * Used as a fast local mapping before falling back to AI.
 */
const SEVERITY_KEYWORDS: ReadonlyMap<string, number> = new Map([
  // 5-point scale: 0=none, 1=mild, 2=moderate, 3=severe, 4=extreme
  ['none', 0], ['no', 0], ['not at all', 0], ['never', 0], ['zero', 0], ['nope', 0],
  ['a little', 1], ['mild', 1], ['slight', 1], ['barely', 1], ['minor', 1], ['occasionally', 1],
  ['moderate', 2], ['some', 2], ['somewhat', 2], ['medium', 2], ['so-so', 2], ['fair', 2],
  ['severe', 3], ['bad', 3], ['a lot', 3], ['quite a bit', 3], ['considerable', 3], ['frequently', 3],
  ['extreme', 4], ['terrible', 4], ['worst', 4], ['unbearable', 4], ['always', 4], ['constant', 4], ['completely', 4],
]);

/**
 * Numeric scale keywords (for "rate 0-10" style questions).
 */
const NUMERIC_PATTERNS: ReadonlyArray<{ pattern: RegExp; value: number }> = [
  { pattern: /\b10\b/, value: 10 },
  { pattern: /\b[0-9]\b/, value: -1 }, // placeholder — extract actual number
  { pattern: /zero/i, value: 0 },
  { pattern: /one/i, value: 1 },
  { pattern: /two/i, value: 2 },
  { pattern: /three/i, value: 3 },
  { pattern: /four/i, value: 4 },
  { pattern: /five/i, value: 5 },
  { pattern: /six/i, value: 6 },
  { pattern: /seven/i, value: 7 },
  { pattern: /eight/i, value: 8 },
  { pattern: /nine/i, value: 9 },
  { pattern: /ten/i, value: 10 },
];

/**
 * Map a natural language response to a structured score.
 *
 * Strategy:
 * 1. Try keyword matching against severity scale
 * 2. Try numeric extraction
 * 3. If ambiguous, return low confidence for AI/human review
 *
 * @param rawInput - Patient's natural language response
 * @param item - The instrument item being answered
 * @returns Mapping result with confidence
 */
export function mapNaturalLanguageResponse(
  rawInput: string,
  item: InstrumentItem,
): VoiceResponseMapping {
  const input = rawInput.toLowerCase().trim();
  const validValues = item.options.map((o) => o.value);
  const maxValue = Math.max(...validValues);

  const alternatives: Array<{ value: number; confidence: number; rationale: string }> = [];
  let bestMatch: { value: number; confidence: number } | null = null;

  // Strategy 1: Exact option label match
  for (const option of item.options) {
    if (input === option.label.toLowerCase() || input.includes(option.label.toLowerCase())) {
      bestMatch = { value: option.value, confidence: 0.95 };
      break;
    }
  }

  // Strategy 2: Severity keyword matching
  if (!bestMatch) {
    for (const [keyword, score] of SEVERITY_KEYWORDS) {
      if (input.includes(keyword)) {
        // Scale the severity score to match the item's value range
        const scaledValue = Math.min(Math.round((score / 4) * maxValue), maxValue);
        if (validValues.includes(scaledValue)) {
          alternatives.push({
            value: scaledValue,
            confidence: 0.75,
            rationale: `Keyword "${keyword}" maps to severity ${score}/4, scaled to ${scaledValue}`,
          });
          if (!bestMatch || 0.75 > bestMatch.confidence) {
            bestMatch = { value: scaledValue, confidence: 0.75 };
          }
        }
      }
    }
  }

  // Strategy 3: Numeric extraction (for 0-10 scales)
  if (!bestMatch) {
    const numberMatch = input.match(/\b(\d{1,2})\b/);
    if (numberMatch) {
      const num = parseInt(numberMatch[1]!, 10);
      // Scale to item range
      const scaledValue = Math.min(Math.round((num / 10) * maxValue), maxValue);
      if (validValues.includes(scaledValue)) {
        bestMatch = { value: scaledValue, confidence: 0.7 };
        alternatives.push({
          value: scaledValue,
          confidence: 0.7,
          rationale: `Extracted number ${num}, scaled to ${scaledValue}`,
        });
      }
    }
  }

  // Fallback: low confidence, needs review
  if (!bestMatch) {
    bestMatch = {
      value: Math.round(maxValue / 2),
      confidence: 0.2,
    };
    alternatives.push({
      value: bestMatch.value,
      confidence: 0.2,
      rationale: 'No confident mapping found — defaulting to midpoint',
    });
  }

  return {
    rawInput,
    itemId: item.id,
    mappedValue: bestMatch.value,
    confidence: bestMatch.confidence,
    needsReview: bestMatch.confidence < 0.6,
    alternatives: alternatives.filter((a) => a.value !== bestMatch!.value),
    timestamp: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Conversational Prompts
// ---------------------------------------------------------------------------

/**
 * Generate a conversational prompt for an instrument item.
 * Transforms clinical questionnaire language into natural conversation.
 *
 * @param item - The instrument item
 * @param instrumentId - The instrument ID (for context)
 * @returns Conversational prompt with examples
 */
export function generateConversationalPrompt(
  item: InstrumentItem,
  instrumentId: string,
): ConversationalPrompt {
  const bodyRegion = getInstrument(instrumentId).bodyRegion.toLowerCase();

  // Map clinical language to conversational language
  let conversationalText = item.text;

  // Common transformations
  if (item.text.toLowerCase().includes('difficulty')) {
    conversationalText = `How much trouble do you have with ${item.text.toLowerCase().replace('difficulty ', '').replace('difficulty with ', '')}?`;
  } else if (item.text.toLowerCase().includes('pain')) {
    conversationalText = `Tell me about your ${bodyRegion} pain — ${item.text.toLowerCase()}`;
  } else if (item.text.toLowerCase().includes('how often')) {
    conversationalText = item.text;
  } else {
    conversationalText = `On a scale from "${item.options[0]?.label}" to "${item.options[item.options.length - 1]?.label}", ${item.text.toLowerCase()}?`;
  }

  const exampleMappings = item.options.map((option) => ({
    input: `${option.label.toLowerCase()}`,
    value: option.value,
    label: option.label,
  }));

  return {
    itemId: item.id,
    conversationalText,
    clarificationPrompt: `I want to make sure I understand — would you say "${item.options[1]?.label}" or "${item.options[2]?.label}" best describes your experience?`,
    exampleMappings,
  };
}

// ---------------------------------------------------------------------------
// Voice PROM Session Management
// ---------------------------------------------------------------------------

/**
 * Create a voice PROM collection session.
 *
 * @param params - Session parameters
 * @returns Voice PROM session wrapping a standard survey session
 */
export function createVoiceSession(params: {
  patientId: string;
  instrumentId: string;
  providerNPI?: string;
  encounterId?: string;
  pgaEnabled?: boolean;
  pgaModelId?: string;
  pgaVoiceId?: string;
}): VoicePROMSession {
  const session = createSession({
    patientId: params.patientId,
    instrumentId: params.instrumentId,
    providerNPI: params.providerNPI,
    encounterId: params.encounterId,
  });

  return {
    session,
    voiceMappings: [],
    bridgingRecords: [],
    pgaConfig: params.pgaEnabled ? {
      enabled: true,
      modelId: params.pgaModelId,
      voiceId: params.pgaVoiceId,
    } : undefined,
  };
}

/**
 * Process a voice/text response and update the session.
 *
 * @param voiceSession - Current voice session
 * @param rawInput - Patient's natural language input
 * @returns Updated session with mapping result
 */
export function processVoiceResponse(
  voiceSession: VoicePROMSession,
  rawInput: string,
): { session: VoicePROMSession; mapping: VoiceResponseMapping; nextPrompt: ConversationalPrompt | null } {
  const currentItem = getNextItem(voiceSession.session);
  if (!currentItem) {
    throw new Error('No more items to answer — session should be complete');
  }

  const mapping = mapNaturalLanguageResponse(rawInput, currentItem);

  // Record the response in the underlying session
  const updatedSession = recordResponse(
    voiceSession.session,
    currentItem.id,
    mapping.mappedValue,
  );

  const updatedVoiceSession: VoicePROMSession = {
    ...voiceSession,
    session: updatedSession,
    voiceMappings: [...voiceSession.voiceMappings, mapping],
  };

  // Get next prompt if session not complete
  const nextItem = getNextItem(updatedSession);
  const nextPrompt = nextItem
    ? generateConversationalPrompt(nextItem, updatedSession.instrumentId)
    : null;

  return {
    session: updatedVoiceSession,
    mapping,
    nextPrompt,
  };
}

// ---------------------------------------------------------------------------
// Bridging Study Support
// ---------------------------------------------------------------------------

/**
 * Record a bridging study data point comparing voice vs traditional administration.
 *
 * Used to validate that voice PROM collection produces equivalent scores
 * to traditional administration. Required for regulatory acceptance.
 *
 * @param params - Bridging study parameters
 * @returns Bridging study record
 */
export function recordBridgingDataPoint(params: {
  patientId: string;
  instrumentId: string;
  itemId: string;
  traditionalScore: number;
  voiceScore: number;
  voiceRawInput: string;
  mappingConfidence: number;
  timeBetweenHours: number;
  order: 'voice_first' | 'traditional_first';
}): BridgingStudyRecord {
  return {
    recordId: `bridge_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 8)}`,
    patientId: params.patientId,
    instrumentId: params.instrumentId,
    itemId: params.itemId,
    traditionalScore: params.traditionalScore,
    voiceScore: params.voiceScore,
    voiceRawInput: params.voiceRawInput,
    mappingConfidence: params.mappingConfidence,
    timeBetweenHours: params.timeBetweenHours,
    order: params.order,
    recordedAt: new Date().toISOString(),
  };
}

/**
 * Analyze bridging study results for an instrument.
 * Calculates ICC, agreement percentage, and bias.
 *
 * @param records - Collection of bridging study records
 * @returns Summary statistics
 */
export function analyzeBridgingResults(records: BridgingStudyRecord[]): {
  instrumentId: string;
  sampleSize: number;
  exactAgreementPct: number;
  withinOnePointPct: number;
  meanDifference: number;
  standardDeviation: number;
  /** Intraclass correlation coefficient (simplified Pearson as approximation) */
  icc: number;
  passesBridgingThreshold: boolean;
  recommendations: string[];
} {
  if (records.length === 0) {
    throw new Error('No bridging study records to analyze');
  }

  const instrumentId = records[0]!.instrumentId;
  const sampleSize = records.length;

  // Calculate agreement
  let exactMatches = 0;
  let withinOne = 0;
  let diffSum = 0;

  const diffs: number[] = [];
  const traditionalScores: number[] = [];
  const voiceScores: number[] = [];

  for (const record of records) {
    const diff = record.voiceScore - record.traditionalScore;
    diffs.push(diff);
    diffSum += diff;
    traditionalScores.push(record.traditionalScore);
    voiceScores.push(record.voiceScore);

    if (diff === 0) exactMatches++;
    if (Math.abs(diff) <= 1) withinOne++;
  }

  const meanDifference = diffSum / sampleSize;

  // Standard deviation of differences
  const squaredDiffs = diffs.map((d) => (d - meanDifference) ** 2);
  const variance = squaredDiffs.reduce((a, b) => a + b, 0) / (sampleSize - 1);
  const standardDeviation = Math.sqrt(variance);

  // Simplified ICC (Pearson correlation as approximation)
  const tradMean = traditionalScores.reduce((a, b) => a + b, 0) / sampleSize;
  const voiceMean = voiceScores.reduce((a, b) => a + b, 0) / sampleSize;

  let numerator = 0;
  let denomTrad = 0;
  let denomVoice = 0;

  for (let i = 0; i < sampleSize; i++) {
    const tradDev = traditionalScores[i]! - tradMean;
    const voiceDev = voiceScores[i]! - voiceMean;
    numerator += tradDev * voiceDev;
    denomTrad += tradDev ** 2;
    denomVoice += voiceDev ** 2;
  }

  const icc = denomTrad > 0 && denomVoice > 0
    ? numerator / Math.sqrt(denomTrad * denomVoice)
    : 0;

  // Threshold: ICC >= 0.75 and exact agreement >= 50%
  const exactAgreementPct = (exactMatches / sampleSize) * 100;
  const withinOnePointPct = (withinOne / sampleSize) * 100;
  const passesBridgingThreshold = icc >= 0.75 && exactAgreementPct >= 50;

  const recommendations: string[] = [];
  if (icc < 0.75) {
    recommendations.push(`ICC of ${icc.toFixed(3)} is below 0.75 threshold. Voice mappings need refinement.`);
  }
  if (exactAgreementPct < 50) {
    recommendations.push(`Exact agreement of ${exactAgreementPct.toFixed(1)}% is below 50%. Review mapping algorithm.`);
  }
  if (Math.abs(meanDifference) > 0.5) {
    recommendations.push(`Systematic bias detected (mean diff = ${meanDifference.toFixed(2)}). Calibrate voice scoring.`);
  }
  if (sampleSize < 50) {
    recommendations.push(`Sample size of ${sampleSize} is below minimum 50 for regulatory submission.`);
  }
  if (passesBridgingThreshold && sampleSize >= 50) {
    recommendations.push('Bridging study passes equivalence threshold. Ready for regulatory submission.');
  }

  return {
    instrumentId,
    sampleSize,
    exactAgreementPct: Math.round(exactAgreementPct * 10) / 10,
    withinOnePointPct: Math.round(withinOnePointPct * 10) / 10,
    meanDifference: Math.round(meanDifference * 1000) / 1000,
    standardDeviation: Math.round(standardDeviation * 1000) / 1000,
    icc: Math.round(icc * 1000) / 1000,
    passesBridgingThreshold,
    recommendations,
  };
}
