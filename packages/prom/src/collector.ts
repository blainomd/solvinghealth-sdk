/**
 * @solvinghealth/prom — PROM Collection Engine
 *
 * Manages survey sessions, tracks completion, scores responses in real-time,
 * generates FHIR QuestionnaireResponse resources, and supports adaptive
 * testing with skip logic.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import { z } from 'zod';
import {
  type InstrumentItem,
  getInstrument,
  scoreInstrument,
  interpretScore,
} from './instruments.js';

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

export const SessionStatusSchema = z.enum([
  'created',
  'in_progress',
  'completed',
  'abandoned',
  'expired',
]);
export type SessionStatus = z.infer<typeof SessionStatusSchema>;

export const ItemResponseSchema = z.object({
  itemId: z.string(),
  value: z.number(),
  timestamp: z.string().datetime(),
  /** Time spent on this item in milliseconds */
  durationMs: z.number().int().nonnegative().optional(),
  /** Whether this item was skipped due to skip logic */
  skipped: z.boolean().default(false),
});
export type ItemResponse = z.infer<typeof ItemResponseSchema>;

export const SurveySessionSchema = z.object({
  /** Unique session identifier */
  sessionId: z.string(),
  /** Patient identifier */
  patientId: z.string(),
  /** Provider NPI (optional — for attribution) */
  providerNPI: z.string().optional(),
  /** Encounter identifier (optional — links PROM to clinical encounter) */
  encounterId: z.string().optional(),
  /** Instrument being administered */
  instrumentId: z.string(),
  /** Session status */
  status: SessionStatusSchema,
  /** Responses collected so far */
  responses: z.array(ItemResponseSchema),
  /** Session start time */
  startedAt: z.string().datetime().optional(),
  /** Session completion time */
  completedAt: z.string().datetime().optional(),
  /** Computed score (available after completion) */
  score: z.number().optional(),
  /** Score interpretation */
  interpretation: z.string().optional(),
  /** Session expiry (default 72 hours from creation) */
  expiresAt: z.string().datetime(),
  /** Session creation time */
  createdAt: z.string().datetime(),
});
export type SurveySession = z.infer<typeof SurveySessionSchema>;

export const FHIRQuestionnaireResponseSchema = z.object({
  resourceType: z.literal('QuestionnaireResponse'),
  id: z.string(),
  status: z.enum(['in-progress', 'completed', 'amended', 'stopped']),
  questionnaire: z.string(),
  subject: z.object({
    reference: z.string(),
    type: z.literal('Patient'),
  }),
  encounter: z.object({
    reference: z.string(),
    type: z.literal('Encounter'),
  }).optional(),
  authored: z.string().datetime(),
  author: z.object({
    reference: z.string(),
    type: z.string(),
  }).optional(),
  item: z.array(z.object({
    linkId: z.string(),
    text: z.string(),
    answer: z.array(z.object({
      valueInteger: z.number().optional(),
      valueCoding: z.object({
        system: z.string(),
        code: z.string(),
        display: z.string().optional(),
      }).optional(),
    })),
  })),
});
export type FHIRQuestionnaireResponse = z.infer<typeof FHIRQuestionnaireResponseSchema>;

// ---------------------------------------------------------------------------
// Session Management
// ---------------------------------------------------------------------------

/**
 * Generate a unique session ID.
 */
function generateSessionId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 10);
  return `prom_${timestamp}_${random}`;
}

/**
 * Create a new PROM collection session.
 *
 * @param params - Session creation parameters
 * @returns New survey session
 */
export function createSession(params: {
  patientId: string;
  instrumentId: string;
  providerNPI?: string;
  encounterId?: string;
  expiryHours?: number;
}): SurveySession {
  // Validate instrument exists
  getInstrument(params.instrumentId);

  const now = new Date();
  const expiryHours = params.expiryHours ?? 72;
  const expiresAt = new Date(now.getTime() + expiryHours * 60 * 60 * 1000);

  return {
    sessionId: generateSessionId(),
    patientId: params.patientId,
    providerNPI: params.providerNPI,
    encounterId: params.encounterId,
    instrumentId: params.instrumentId,
    status: 'created',
    responses: [],
    expiresAt: expiresAt.toISOString(),
    createdAt: now.toISOString(),
  };
}

/**
 * Get the next item to present to the patient, respecting skip logic.
 *
 * @param session - Current session state
 * @returns Next item to present, or null if all items answered
 */
export function getNextItem(session: SurveySession): InstrumentItem | null {
  const instrument = getInstrument(session.instrumentId);
  const answeredIds = new Set(session.responses.map((r) => r.itemId));
  const responseMap = new Map(session.responses.map((r) => [r.itemId, r.value]));

  for (const item of instrument.items) {
    // Skip already answered items
    if (answeredIds.has(item.id)) continue;

    // Evaluate skip logic
    if (item.skipIf) {
      const refValue = responseMap.get(item.skipIf.itemId);
      if (refValue !== undefined) {
        let shouldSkip = false;
        switch (item.skipIf.condition) {
          case 'equals':
            shouldSkip = refValue === item.skipIf.value;
            break;
          case 'greaterThan':
            shouldSkip = refValue > item.skipIf.value;
            break;
          case 'lessThan':
            shouldSkip = refValue < item.skipIf.value;
            break;
        }
        if (shouldSkip) continue;
      }
    }

    return item;
  }

  return null;
}

/**
 * Record a response for a specific item.
 *
 * @param session - Current session (mutated in place)
 * @param itemId - The item being answered
 * @param value - The response value
 * @param durationMs - Optional time spent on item in ms
 * @returns Updated session with real-time partial score
 */
export function recordResponse(
  session: SurveySession,
  itemId: string,
  value: number,
  durationMs?: number,
): SurveySession {
  const instrument = getInstrument(session.instrumentId);

  // Validate item exists
  const item = instrument.items.find((i) => i.id === itemId);
  if (!item) {
    throw new Error(`Item "${itemId}" not found in instrument "${session.instrumentId}"`);
  }

  // Validate response value is within options
  const validValues = item.options.map((o) => o.value);
  if (!validValues.includes(value)) {
    throw new Error(
      `Invalid response value ${value} for item "${itemId}". Valid: ${validValues.join(', ')}`,
    );
  }

  // Update session
  const now = new Date().toISOString();
  const updatedResponses = [
    ...session.responses.filter((r) => r.itemId !== itemId), // replace if exists
    {
      itemId,
      value,
      timestamp: now,
      durationMs,
      skipped: false,
    },
  ];

  const updated: SurveySession = {
    ...session,
    responses: updatedResponses,
    status: 'in_progress',
    startedAt: session.startedAt ?? now,
  };

  // Check if all items are answered
  const answeredIds = new Set(updatedResponses.map((r) => r.itemId));
  const allItemsAnswered = instrument.items.every((i) => {
    if (answeredIds.has(i.id)) return true;
    // Check if skip logic skips this item
    if (i.skipIf) {
      const refResp = updatedResponses.find((r) => r.itemId === i.skipIf!.itemId);
      if (refResp) {
        switch (i.skipIf.condition) {
          case 'equals': return refResp.value === i.skipIf.value;
          case 'greaterThan': return refResp.value > i.skipIf.value;
          case 'lessThan': return refResp.value < i.skipIf.value;
        }
      }
    }
    return false;
  });

  if (allItemsAnswered) {
    return completeSession(updated);
  }

  return updated;
}

/**
 * Mark a session as completed and compute final score.
 */
export function completeSession(session: SurveySession): SurveySession {
  const responseMap: Record<string, number> = {};
  for (const r of session.responses) {
    if (!r.skipped) {
      responseMap[r.itemId] = r.value;
    }
  }

  const score = scoreInstrument(session.instrumentId, responseMap);
  const interpretation = interpretScore(session.instrumentId, score);

  return {
    ...session,
    status: 'completed',
    completedAt: new Date().toISOString(),
    score,
    interpretation: `${interpretation.label}: ${interpretation.interpretation}`,
  };
}

/**
 * Get completion statistics for a session.
 */
export function getCompletionStats(session: SurveySession): {
  totalItems: number;
  answeredItems: number;
  skippedItems: number;
  completionRate: number;
  estimatedTimeRemainingMins: number;
} {
  const instrument = getInstrument(session.instrumentId);
  const totalItems = instrument.items.length;
  const answeredItems = session.responses.filter((r) => !r.skipped).length;
  const skippedItems = session.responses.filter((r) => r.skipped).length;
  const completionRate = totalItems > 0 ? answeredItems / totalItems : 0;

  // Estimate remaining time based on average response time
  const answeredWithTime = session.responses.filter((r) => r.durationMs !== undefined && !r.skipped);
  const avgTimeMs = answeredWithTime.length > 0
    ? answeredWithTime.reduce((sum, r) => sum + (r.durationMs ?? 0), 0) / answeredWithTime.length
    : 30000; // default 30 seconds per item
  const remainingItems = totalItems - answeredItems - skippedItems;
  const estimatedTimeRemainingMins = (remainingItems * avgTimeMs) / 60000;

  return {
    totalItems,
    answeredItems,
    skippedItems,
    completionRate: Math.round(completionRate * 1000) / 10,
    estimatedTimeRemainingMins: Math.round(estimatedTimeRemainingMins * 10) / 10,
  };
}

// ---------------------------------------------------------------------------
// FHIR Export
// ---------------------------------------------------------------------------

/**
 * Generate a FHIR R4 QuestionnaireResponse from a completed session.
 *
 * @param session - Completed survey session
 * @returns FHIR QuestionnaireResponse resource
 */
export function toFHIRQuestionnaireResponse(session: SurveySession): FHIRQuestionnaireResponse {
  if (session.status !== 'completed') {
    throw new Error('Cannot generate FHIR resource from incomplete session');
  }

  const instrument = getInstrument(session.instrumentId);

  const fhirItems = session.responses
    .filter((r) => !r.skipped)
    .map((response) => {
      const item = instrument.items.find((i) => i.id === response.itemId);
      const option = item?.options.find((o) => o.value === response.value);

      return {
        linkId: response.itemId,
        text: item?.text ?? response.itemId,
        answer: [{
          valueInteger: response.value,
          valueCoding: option ? {
            system: `https://solvinghealth.com/fhir/CodeSystem/${instrument.id}`,
            code: String(response.value),
            display: option.label,
          } : undefined,
        }],
      };
    });

  const fhirStatus = session.status === 'completed' ? 'completed' as const : 'in-progress' as const;

  return {
    resourceType: 'QuestionnaireResponse',
    id: session.sessionId,
    status: fhirStatus,
    questionnaire: `https://solvinghealth.com/fhir/Questionnaire/${instrument.id}`,
    subject: {
      reference: `Patient/${session.patientId}`,
      type: 'Patient',
    },
    encounter: session.encounterId ? {
      reference: `Encounter/${session.encounterId}`,
      type: 'Encounter',
    } : undefined,
    authored: session.completedAt ?? session.createdAt,
    author: session.providerNPI ? {
      reference: `Practitioner/${session.providerNPI}`,
      type: 'Practitioner',
    } : undefined,
    item: fhirItems,
  };
}
