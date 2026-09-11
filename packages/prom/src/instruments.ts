/**
 * @solvinghealth/prom — PROM Instrument Definitions
 *
 * Structure and scoring for validated patient-reported outcome measures used
 * in orthopedic and general health assessment: item ids, response values,
 * domains, scoring, normative ranges and MCID thresholds.
 *
 * The instruments belong to their copyright holders. This package does NOT
 * ship their wording (item text or response-option text); load a copy you
 * are licensed to use with registerInstrumentWording(). See NOTICE.
 *
 * KOOS JR / HOOS JR and PROMIS-10 scores here approximate the official
 * conversions. Do not report them as official instrument scores.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

export const ResponseOptionSchema = z.object({
  /** Response-option wording: not shipped (see NOTICE); set by registerInstrumentWording() */
  label: z.string().optional(),
  value: z.number(),
});
export type ResponseOption = z.infer<typeof ResponseOptionSchema>;

export const InstrumentItemSchema = z.object({
  /** Unique item identifier within the instrument */
  id: z.string(),
  /** Item number (display order) */
  number: z.number().int().positive(),
  /** Question wording: not shipped (see NOTICE); set by registerInstrumentWording() */
  text: z.string().optional(),
  /** Response options (ordered from best to worst unless reverseScored) */
  options: z.array(ResponseOptionSchema).min(2),
  /** Whether this item is reverse-scored */
  reverseScored: z.boolean().optional(),
  /** Domain/subscale this item belongs to */
  domain: z.string().optional(),
  /** Skip logic: only show if referenced item has this response */
  skipIf: z.object({
    itemId: z.string(),
    condition: z.enum(['equals', 'greaterThan', 'lessThan']),
    value: z.number(),
  }).optional(),
});
export type InstrumentItem = z.infer<typeof InstrumentItemSchema>;

export const ScoringRangeSchema = z.object({
  min: z.number(),
  max: z.number(),
  label: z.string(),
  interpretation: z.string(),
});
export type ScoringRange = z.infer<typeof ScoringRangeSchema>;

export const InstrumentDefinitionSchema = z.object({
  /** Instrument identifier (e.g., 'KOOS_JR') */
  id: z.string(),
  /** Full name */
  name: z.string(),
  /** Short abbreviation */
  abbreviation: z.string(),
  /** Description */
  description: z.string(),
  /** Version */
  version: z.string(),
  /** Body region / clinical domain */
  bodyRegion: z.string(),
  /** Items/questions */
  items: z.array(InstrumentItemSchema),
  /** Scoring range */
  scoreRange: z.object({ min: z.number(), max: z.number() }),
  /** Higher score is better? */
  higherIsBetter: z.boolean(),
  /** Normative ranges for interpretation */
  normativeRanges: z.array(ScoringRangeSchema),
  /** Minimal Clinically Important Difference */
  mcid: z.number(),
  /** Substantial Clinical Benefit threshold */
  scb: z.number().optional(),
  /** Estimated completion time in minutes */
  completionTimeMins: z.number(),
  /** LOINC code if available */
  loincCode: z.string().optional(),
  /** Citation */
  citation: z.string(),
});
export type InstrumentDefinition = z.infer<typeof InstrumentDefinitionSchema>;

// ---------------------------------------------------------------------------
// Scoring Functions
// ---------------------------------------------------------------------------

/**
 * Score a KOOS JR / HOOS JR instrument using the interval scoring method.
 * Raw sum is converted to an interval score (0-100, higher = better).
 */
function scoreJointReplacementShort(responses: Record<string, number>, itemCount: number): number {
  const values = Object.values(responses);
  if (values.length !== itemCount) {
    throw new Error(`Expected ${itemCount} responses, got ${values.length}`);
  }
  const rawSum = values.reduce((a, b) => a + b, 0);
  const maxRaw = itemCount * 4;
  // Linear transformation to 0-100 scale (interval scoring approximation)
  const score = 100 - ((rawSum / maxRaw) * 100);
  return Math.round(score * 10) / 10;
}

/**
 * Score a disability index (ODI/NDI) — percentage scale.
 * Raw sum / (max possible) * 100.
 */
function scoreDisabilityIndex(responses: Record<string, number>, _itemCount: number): number {
  const values = Object.values(responses);
  const answered = values.length;
  if (answered === 0) throw new Error('No responses provided');
  const rawSum = values.reduce((a, b) => a + b, 0);
  const maxPossible = answered * 5;
  const percentage = (rawSum / maxPossible) * 100;
  return Math.round(percentage * 10) / 10;
}

/**
 * Score QuickDASH — scaled 0-100 (higher = more disability).
 */
function scoreQuickDASH(responses: Record<string, number>): number {
  const values = Object.values(responses);
  if (values.length < 10) {
    throw new Error(`QuickDASH requires at least 10 responses, got ${values.length}`);
  }
  const answered = values.length;
  const rawSum = values.reduce((a, b) => a + b, 0);
  const score = ((rawSum / answered) - 1) * 25;
  return Math.round(score * 10) / 10;
}

/**
 * Score PROMIS-10 Global Health — T-score conversion.
 * Raw sum maps to T-score (mean 50, SD 10 in reference population).
 */
function scorePROMIS10(responses: Record<string, number>, domain: 'physical' | 'mental'): number {
  const values = Object.values(responses);
  const rawSum = values.reduce((a, b) => a + b, 0);
  // Simplified T-score lookup (real PROMIS uses IRT-derived tables)
  // Physical: items 3,6,7,10; Mental: items 2,4,5,8
  const tScoreBase = 50;
  const rawMidpoint = domain === 'physical' ? 13 : 13;
  const rawSD = domain === 'physical' ? 3.5 : 3.5;
  const tScore = tScoreBase + ((rawSum - rawMidpoint) / rawSD) * 10;
  return Math.round(Math.max(20, Math.min(80, tScore)) * 10) / 10;
}

// ---------------------------------------------------------------------------
// Instrument Definitions
// ---------------------------------------------------------------------------

/** KOOS JR — Knee injury and Osteoarthritis Outcome Score for Joint Replacement */
export const KOOS_JR: InstrumentDefinition = {
  id: 'KOOS_JR',
  name: 'Knee injury and Osteoarthritis Outcome Score for Joint Replacement',
  abbreviation: 'KOOS, JR',
  description: '7-item short form measuring knee pain, stiffness, and function in daily living for patients undergoing joint replacement.',
  version: '1.0',
  bodyRegion: 'Knee',
  items: [
    { id: 'kj1', number: 1, options: [{ value: 0 }, { value: 1 }, { value: 2 }, { value: 3 }, { value: 4 }], domain: 'Awareness' },
    { id: 'kj2', number: 2, options: [{ value: 0 }, { value: 1 }, { value: 2 }, { value: 3 }, { value: 4 }], domain: 'Lifestyle' },
    { id: 'kj3', number: 3, options: [{ value: 0 }, { value: 1 }, { value: 2 }, { value: 3 }, { value: 4 }], domain: 'Confidence' },
    { id: 'kj4', number: 4, options: [{ value: 0 }, { value: 1 }, { value: 2 }, { value: 3 }, { value: 4 }], domain: 'Difficulty' },
    { id: 'kj5', number: 5, options: [{ value: 0 }, { value: 1 }, { value: 2 }, { value: 3 }, { value: 4 }], domain: 'Function' },
    { id: 'kj6', number: 6, options: [{ value: 0 }, { value: 1 }, { value: 2 }, { value: 3 }, { value: 4 }], domain: 'Function' },
    { id: 'kj7', number: 7, options: [{ value: 0 }, { value: 1 }, { value: 2 }, { value: 3 }, { value: 4 }], domain: 'Function' },
  ],
  scoreRange: { min: 0, max: 100 },
  higherIsBetter: true,
  normativeRanges: [
    { min: 85, max: 100, label: 'Excellent', interpretation: 'Minimal knee problems; near-normal function' },
    { min: 70, max: 84.9, label: 'Good', interpretation: 'Mild knee problems; good function with minor limitations' },
    { min: 50, max: 69.9, label: 'Fair', interpretation: 'Moderate knee problems; noticeable functional limitations' },
    { min: 0, max: 49.9, label: 'Poor', interpretation: 'Severe knee problems; significant functional disability' },
  ],
  mcid: 14,
  scb: 20,
  completionTimeMins: 2,
  loincCode: '82323-0',
  citation: 'Lyman S, et al. J Bone Joint Surg Am. 2016;98(16):1373-1382.',
};

/** HOOS JR — Hip disability and Osteoarthritis Outcome Score for Joint Replacement */
export const HOOS_JR: InstrumentDefinition = {
  id: 'HOOS_JR',
  name: 'Hip disability and Osteoarthritis Outcome Score for Joint Replacement',
  abbreviation: 'HOOS, JR',
  description: '6-item short form measuring hip pain and function for patients undergoing hip replacement.',
  version: '1.0',
  bodyRegion: 'Hip',
  items: [
    { id: 'hj1', number: 1, options: [{ value: 0 }, { value: 1 }, { value: 2 }, { value: 3 }, { value: 4 }], domain: 'Pain' },
    { id: 'hj2', number: 2, options: [{ value: 0 }, { value: 1 }, { value: 2 }, { value: 3 }, { value: 4 }], domain: 'Pain' },
    { id: 'hj3', number: 3, options: [{ value: 0 }, { value: 1 }, { value: 2 }, { value: 3 }, { value: 4 }], domain: 'Function' },
    { id: 'hj4', number: 4, options: [{ value: 0 }, { value: 1 }, { value: 2 }, { value: 3 }, { value: 4 }], domain: 'Function' },
    { id: 'hj5', number: 5, options: [{ value: 0 }, { value: 1 }, { value: 2 }, { value: 3 }, { value: 4 }], domain: 'Function' },
    { id: 'hj6', number: 6, options: [{ value: 0 }, { value: 1 }, { value: 2 }, { value: 3 }, { value: 4 }], domain: 'Awareness' },
  ],
  scoreRange: { min: 0, max: 100 },
  higherIsBetter: true,
  normativeRanges: [
    { min: 85, max: 100, label: 'Excellent', interpretation: 'Minimal hip problems; near-normal function' },
    { min: 70, max: 84.9, label: 'Good', interpretation: 'Mild hip problems; good function' },
    { min: 50, max: 69.9, label: 'Fair', interpretation: 'Moderate hip problems; noticeable limitations' },
    { min: 0, max: 49.9, label: 'Poor', interpretation: 'Severe hip problems; significant disability' },
  ],
  mcid: 18,
  scb: 24,
  completionTimeMins: 2,
  loincCode: '82319-8',
  citation: 'Lyman S, et al. Clin Orthop Relat Res. 2016;474(6):1472-1482.',
};

/** ODI — Oswestry Disability Index */
export const ODI: InstrumentDefinition = {
  id: 'ODI',
  name: 'Oswestry Disability Index',
  abbreviation: 'ODI',
  description: '10-item questionnaire measuring disability due to low back pain. Scores range from 0% (no disability) to 100% (maximum disability).',
  version: '2.1a',
  bodyRegion: 'Lumbar Spine',
  items: [
    { id: 'odi1', number: 1, options: [{ value: 0 }, { value: 1 }, { value: 2 }, { value: 3 }, { value: 4 }, { value: 5 }], domain: 'Pain' },
    { id: 'odi2', number: 2, options: [{ value: 0 }, { value: 1 }, { value: 2 }, { value: 3 }, { value: 4 }, { value: 5 }], domain: 'ADL' },
    { id: 'odi3', number: 3, options: [{ value: 0 }, { value: 1 }, { value: 2 }, { value: 3 }, { value: 4 }, { value: 5 }], domain: 'Function' },
    { id: 'odi4', number: 4, options: [{ value: 0 }, { value: 1 }, { value: 2 }, { value: 3 }, { value: 4 }, { value: 5 }], domain: 'Function' },
    { id: 'odi5', number: 5, options: [{ value: 0 }, { value: 1 }, { value: 2 }, { value: 3 }, { value: 4 }, { value: 5 }], domain: 'Function' },
    { id: 'odi6', number: 6, options: [{ value: 0 }, { value: 1 }, { value: 2 }, { value: 3 }, { value: 4 }, { value: 5 }], domain: 'Function' },
    { id: 'odi7', number: 7, options: [{ value: 0 }, { value: 1 }, { value: 2 }, { value: 3 }, { value: 4 }, { value: 5 }], domain: 'Sleep' },
    { id: 'odi8', number: 8, options: [{ value: 0 }, { value: 1 }, { value: 2 }, { value: 3 }, { value: 4 }, { value: 5 }], domain: 'Social' },
    { id: 'odi9', number: 9, options: [{ value: 0 }, { value: 1 }, { value: 2 }, { value: 3 }, { value: 4 }, { value: 5 }], domain: 'Travel' },
    { id: 'odi10', number: 10, options: [{ value: 0 }, { value: 1 }, { value: 2 }, { value: 3 }, { value: 4 }, { value: 5 }], domain: 'Work' },
  ],
  scoreRange: { min: 0, max: 100 },
  higherIsBetter: false,
  normativeRanges: [
    { min: 0, max: 20, label: 'Minimal Disability', interpretation: 'Can cope with most living activities' },
    { min: 21, max: 40, label: 'Moderate Disability', interpretation: 'Difficulty with sitting, lifting, standing; impaired social/sex life' },
    { min: 41, max: 60, label: 'Severe Disability', interpretation: 'Pain is a major problem; significant impact on daily activities' },
    { min: 61, max: 80, label: 'Crippled', interpretation: 'Back pain impinges all aspects of life; positive intervention needed' },
    { min: 81, max: 100, label: 'Bed-bound', interpretation: 'Bed-bound or exaggerating symptoms; careful evaluation needed' },
  ],
  mcid: 12.8,
  scb: 18.8,
  completionTimeMins: 5,
  loincCode: '71934-8',
  citation: 'Fairbank JC, Pynsent PB. Spine. 2000;25(22):2940-2952.',
};

/** NDI — Neck Disability Index */
export const NDI: InstrumentDefinition = {
  id: 'NDI',
  name: 'Neck Disability Index',
  abbreviation: 'NDI',
  description: '10-item questionnaire measuring disability due to neck pain. Adapted from the ODI.',
  version: '1.0',
  bodyRegion: 'Cervical Spine',
  items: [
    { id: 'ndi1', number: 1, options: [{ value: 0 }, { value: 1 }, { value: 2 }, { value: 3 }, { value: 4 }, { value: 5 }], domain: 'Pain' },
    { id: 'ndi2', number: 2, options: [{ value: 0 }, { value: 1 }, { value: 2 }, { value: 3 }, { value: 4 }, { value: 5 }], domain: 'ADL' },
    { id: 'ndi3', number: 3, options: [{ value: 0 }, { value: 1 }, { value: 2 }, { value: 3 }, { value: 4 }, { value: 5 }], domain: 'Function' },
    { id: 'ndi4', number: 4, options: [{ value: 0 }, { value: 1 }, { value: 2 }, { value: 3 }, { value: 4 }, { value: 5 }], domain: 'Function' },
    { id: 'ndi5', number: 5, options: [{ value: 0 }, { value: 1 }, { value: 2 }, { value: 3 }, { value: 4 }, { value: 5 }], domain: 'Pain' },
    { id: 'ndi6', number: 6, options: [{ value: 0 }, { value: 1 }, { value: 2 }, { value: 3 }, { value: 4 }, { value: 5 }], domain: 'Cognitive' },
    { id: 'ndi7', number: 7, options: [{ value: 0 }, { value: 1 }, { value: 2 }, { value: 3 }, { value: 4 }, { value: 5 }], domain: 'Work' },
    { id: 'ndi8', number: 8, options: [{ value: 0 }, { value: 1 }, { value: 2 }, { value: 3 }, { value: 4 }, { value: 5 }], domain: 'Function' },
    { id: 'ndi9', number: 9, options: [{ value: 0 }, { value: 1 }, { value: 2 }, { value: 3 }, { value: 4 }, { value: 5 }], domain: 'Sleep' },
    { id: 'ndi10', number: 10, options: [{ value: 0 }, { value: 1 }, { value: 2 }, { value: 3 }, { value: 4 }, { value: 5 }], domain: 'Recreation' },
  ],
  scoreRange: { min: 0, max: 100 },
  higherIsBetter: false,
  normativeRanges: [
    { min: 0, max: 8, label: 'No Disability', interpretation: 'No functional limitations' },
    { min: 9, max: 28, label: 'Mild Disability', interpretation: 'Can cope with most daily activities' },
    { min: 29, max: 48, label: 'Moderate Disability', interpretation: 'Significant neck-related limitations' },
    { min: 49, max: 68, label: 'Severe Disability', interpretation: 'All aspects of life affected' },
    { min: 69, max: 100, label: 'Complete Disability', interpretation: 'Bed-bound or extreme exaggeration' },
  ],
  mcid: 7.5,
  scb: 9.5,
  completionTimeMins: 5,
  loincCode: '72100-5',
  citation: 'Vernon H, Mior S. J Manipulative Physiol Ther. 1991;14(7):409-415.',
};

/** QuickDASH — Disabilities of the Arm, Shoulder and Hand */
export const QUICK_DASH: InstrumentDefinition = {
  id: 'QUICK_DASH',
  name: 'Disabilities of the Arm, Shoulder and Hand (Quick Version)',
  abbreviation: 'QuickDASH',
  description: '11-item shortened version of the DASH outcome measure for upper extremity disability.',
  version: '1.0',
  bodyRegion: 'Upper Extremity',
  items: Array.from({ length: 11 }, (_, i) => ({
    id: `qd${i + 1}`,
    number: i + 1,
    options: [
      { value: 1 },
      { value: 2 },
      { value: 3 },
      { value: 4 },
      { value: 5 },
    ],
    domain: i < 6 ? 'Function' : i < 8 ? 'Social/Work' : 'Symptoms',
  })),
  scoreRange: { min: 0, max: 100 },
  higherIsBetter: false,
  normativeRanges: [
    { min: 0, max: 15, label: 'Minimal Disability', interpretation: 'Near-normal upper extremity function' },
    { min: 16, max: 40, label: 'Mild Disability', interpretation: 'Some difficulty with demanding tasks' },
    { min: 41, max: 60, label: 'Moderate Disability', interpretation: 'Notable limitations in daily activities' },
    { min: 61, max: 100, label: 'Severe Disability', interpretation: 'Significant upper extremity disability' },
  ],
  mcid: 8,
  scb: 12,
  completionTimeMins: 3,
  loincCode: '71940-5',
  citation: 'Beaton DE, et al. J Bone Joint Surg Am. 2005;87(5):1038-1046.',
};

/** PROMIS-10 Global Health */
export const PROMIS_10: InstrumentDefinition = {
  id: 'PROMIS_10',
  name: 'PROMIS Global Health-10',
  abbreviation: 'PROMIS-10',
  description: '10-item questionnaire measuring global physical and mental health. Uses T-score metric (mean=50, SD=10).',
  version: '1.2',
  bodyRegion: 'General',
  items: [
    { id: 'p1', number: 1, options: [{ value: 5 }, { value: 4 }, { value: 3 }, { value: 2 }, { value: 1 }], domain: 'Global' },
    { id: 'p2', number: 2, options: [{ value: 5 }, { value: 4 }, { value: 3 }, { value: 2 }, { value: 1 }], domain: 'Mental' },
    { id: 'p3', number: 3, options: [{ value: 5 }, { value: 4 }, { value: 3 }, { value: 2 }, { value: 1 }], domain: 'Physical' },
    { id: 'p4', number: 4, options: [{ value: 5 }, { value: 4 }, { value: 3 }, { value: 2 }, { value: 1 }], domain: 'Mental' },
    { id: 'p5', number: 5, options: [{ value: 5 }, { value: 4 }, { value: 3 }, { value: 2 }, { value: 1 }], domain: 'Mental' },
    { id: 'p6', number: 6, options: [{ value: 5 }, { value: 4 }, { value: 3 }, { value: 2 }, { value: 1 }], domain: 'Physical' },
    { id: 'p7', number: 7, options: [{ value: 5 }, { value: 4 }, { value: 3 }, { value: 2 }, { value: 1 }], domain: 'Physical', reverseScored: true },
    { id: 'p8', number: 8, options: [{ value: 5 }, { value: 4 }, { value: 3 }, { value: 2 }, { value: 1 }], domain: 'Mental' },
    { id: 'p9', number: 9, options: [{ value: 5 }, { value: 4 }, { value: 3 }, { value: 2 }, { value: 1 }], domain: 'Physical' },
    { id: 'p10', number: 10, options: [{ value: 5 }, { value: 4 }, { value: 3 }, { value: 2 }, { value: 1 }], domain: 'Mental' },
  ],
  scoreRange: { min: 20, max: 80 },
  higherIsBetter: true,
  normativeRanges: [
    { min: 60, max: 80, label: 'Above Average', interpretation: 'Better health than reference population' },
    { min: 40, max: 59.9, label: 'Average', interpretation: 'Within one SD of reference population mean' },
    { min: 20, max: 39.9, label: 'Below Average', interpretation: 'Worse health than reference population' },
  ],
  mcid: 3,
  completionTimeMins: 3,
  loincCode: '71969-0',
  citation: 'Hays RD, et al. Qual Life Res. 2009;18(7):873-880.',
};

// ---------------------------------------------------------------------------
// Instrument Registry
// ---------------------------------------------------------------------------

/** All available instruments indexed by ID */
export const INSTRUMENTS: ReadonlyMap<string, InstrumentDefinition> = new Map([
  ['KOOS_JR', KOOS_JR],
  ['HOOS_JR', HOOS_JR],
  ['ODI', ODI],
  ['NDI', NDI],
  ['QUICK_DASH', QUICK_DASH],
  ['PROMIS_10', PROMIS_10],
]);

// ---------------------------------------------------------------------------
// Instrument Wording (loaded by the implementer)
// ---------------------------------------------------------------------------

/**
 * The wording of an instrument's items and response options.
 *
 * The instruments belong to their copyright holders. This package ships
 * structure and scoring only; the wording has to come from a copy you are
 * licensed to use (see NOTICE).
 */
export interface InstrumentWording {
  /** Item id → wording. Every item in the instrument needs an entry. */
  items: Record<string, {
    /** The item's question wording */
    text: string;
    /** Response-option wording, in the same order as the item's options */
    options: string[];
  }>;
}

/** Instruments whose licensed wording has been loaded, by instrument ID */
const WORDED = new Map<string, InstrumentDefinition>();

/**
 * Return a copy of an instrument with the supplied wording applied.
 * The shipped definition is not modified.
 * @throws Error if any item or response option is left without wording
 */
export function withInstrumentText(
  instrument: InstrumentDefinition,
  wording: InstrumentWording,
): InstrumentDefinition {
  const items = instrument.items.map((item) => {
    const w = wording.items[item.id];
    if (!w || !w.text.trim()) {
      throw new Error(`No wording supplied for ${instrument.id} item ${item.id}`);
    }
    if (w.options.length !== item.options.length || w.options.some((o) => !o.trim())) {
      throw new Error(
        `${instrument.id} item ${item.id} needs ${item.options.length} response-option wordings; got ${w.options.length}`,
      );
    }
    return {
      ...item,
      text: w.text,
      options: item.options.map((o, i) => ({ ...o, label: w.options[i]! })),
    };
  });
  return { ...instrument, items };
}

/**
 * Load licensed wording for an instrument. From then on getInstrument() and
 * everything built on it (sessions, FHIR export, voice prompts) uses it.
 * @returns The instrument definition with wording applied
 */
export function registerInstrumentWording(
  instrumentId: string,
  wording: InstrumentWording,
): InstrumentDefinition {
  const base = INSTRUMENTS.get(instrumentId);
  if (!base) throw new Error(`Unknown instrument: ${instrumentId}`);
  const worded = withInstrumentText(base, wording);
  WORDED.set(instrumentId, worded);
  return worded;
}

/** Forget loaded wording for one instrument, or for all of them. */
export function clearInstrumentWording(instrumentId?: string): void {
  if (instrumentId) WORDED.delete(instrumentId);
  else WORDED.clear();
}

/** True when every item and response option carries wording. */
export function hasWording(instrument: InstrumentDefinition): boolean {
  return instrument.items.every((item) => !!item.text && item.options.every((o) => !!o.label));
}

/**
 * The wording for one item, or an error that says how to load it.
 * @throws Error when the item's wording has not been loaded
 */
export function requireWording(
  item: InstrumentItem,
  instrumentId: string,
): { text: string; labels: string[] } {
  const labels = item.options.map((o) => o.label);
  if (!item.text || labels.some((l) => !l)) {
    throw new Error(
      `${instrumentId} item ${item.id} has no wording loaded. This package does not ship ` +
        'third-party instrument wording; load a licensed copy with registerInstrumentWording() (see NOTICE).',
    );
  }
  return { text: item.text, labels: labels as string[] };
}

/**
 * Get an instrument definition by ID.
 * @throws Error if instrument not found
 */
export function getInstrument(id: string): InstrumentDefinition {
  const instrument = WORDED.get(id) ?? INSTRUMENTS.get(id);
  if (!instrument) {
    throw new Error(`Instrument "${id}" not found. Available: ${Array.from(INSTRUMENTS.keys()).join(', ')}`);
  }
  return instrument;
}

/**
 * Score an instrument given responses.
 *
 * @param instrumentId - The instrument ID
 * @param responses - Map of item ID to response value
 * @returns Computed score
 */
export function scoreInstrument(instrumentId: string, responses: Record<string, number>): number {
  // Validate instrument exists
  getInstrument(instrumentId);

  switch (instrumentId) {
    case 'KOOS_JR':
      return scoreJointReplacementShort(responses, 7);
    case 'HOOS_JR':
      return scoreJointReplacementShort(responses, 6);
    case 'ODI':
      return scoreDisabilityIndex(responses, 10);
    case 'NDI':
      return scoreDisabilityIndex(responses, 10);
    case 'QUICK_DASH':
      return scoreQuickDASH(responses);
    case 'PROMIS_10': {
      // Score both physical and mental domains; return physical T-score
      // Use scorePROMIS10Domain for specific domain
      return scorePROMIS10(responses, 'physical');
    }
    default:
      throw new Error(`No scoring function for instrument "${instrumentId}"`);
  }
}

/**
 * Score PROMIS-10 for a specific domain.
 */
export function scorePROMIS10Domain(
  responses: Record<string, number>,
  domain: 'physical' | 'mental',
): number {
  const physicalItems = ['p3', 'p6', 'p7', 'p9'];
  const mentalItems = ['p2', 'p4', 'p5', 'p8'];
  const relevantItems = domain === 'physical' ? physicalItems : mentalItems;

  const domainResponses: Record<string, number> = {};
  for (const item of relevantItems) {
    if (responses[item] !== undefined) {
      domainResponses[item] = responses[item]!;
    }
  }

  return scorePROMIS10(domainResponses, domain);
}

/**
 * Interpret a score against the instrument's normative ranges.
 */
export function interpretScore(instrumentId: string, score: number): ScoringRange {
  const instrument = getInstrument(instrumentId);
  for (const range of instrument.normativeRanges) {
    if (score >= range.min && score <= range.max) {
      return range;
    }
  }
  // Fallback
  return instrument.normativeRanges[instrument.normativeRanges.length - 1]!;
}

/**
 * Check if a score change meets the MCID threshold.
 */
export function isClinicallySignificant(instrumentId: string, baselineScore: number, followupScore: number): boolean {
  const instrument = getInstrument(instrumentId);
  const change = Math.abs(followupScore - baselineScore);
  return change >= instrument.mcid;
}
