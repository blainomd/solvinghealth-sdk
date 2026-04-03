/**
 * @solvinghealth/prom — PROM Instrument Definitions
 *
 * Validated Patient-Reported Outcome Measure instruments used in
 * orthopedic and general health assessment. Each instrument includes
 * questions, scoring algorithms, normative ranges, and MCID thresholds.
 *
 * MIT License
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

export const ResponseOptionSchema = z.object({
  label: z.string(),
  value: z.number(),
});
export type ResponseOption = z.infer<typeof ResponseOptionSchema>;

export const InstrumentItemSchema = z.object({
  /** Unique item identifier within the instrument */
  id: z.string(),
  /** Item number (display order) */
  number: z.number().int().positive(),
  /** Question text */
  text: z.string(),
  /** Response options (ordered from best to worst unless reverseScored) */
  options: z.array(ResponseOptionSchema).min(2),
  /** Whether this item is reverse-scored */
  reverseScored: z.boolean().default(false),
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
function scoreDisabilityIndex(responses: Record<string, number>, itemCount: number): number {
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
    { id: 'kj1', number: 1, text: 'How often are you aware of your knee problem?', options: [{ label: 'Never', value: 0 }, { label: 'Monthly', value: 1 }, { label: 'Weekly', value: 2 }, { label: 'Daily', value: 3 }, { label: 'Always', value: 4 }], domain: 'Awareness' },
    { id: 'kj2', number: 2, text: 'Have you modified your lifestyle to avoid activities potentially damaging to your knee?', options: [{ label: 'Not at all', value: 0 }, { label: 'Mildly', value: 1 }, { label: 'Moderately', value: 2 }, { label: 'Severely', value: 3 }, { label: 'Totally', value: 4 }], domain: 'Lifestyle' },
    { id: 'kj3', number: 3, text: 'How much are you troubled with lack of confidence in your knee?', options: [{ label: 'Not at all', value: 0 }, { label: 'Mildly', value: 1 }, { label: 'Moderately', value: 2 }, { label: 'Severely', value: 3 }, { label: 'Extremely', value: 4 }], domain: 'Confidence' },
    { id: 'kj4', number: 4, text: 'In general, how much difficulty do you have with your knee?', options: [{ label: 'None', value: 0 }, { label: 'Mild', value: 1 }, { label: 'Moderate', value: 2 }, { label: 'Severe', value: 3 }, { label: 'Extreme', value: 4 }], domain: 'Difficulty' },
    { id: 'kj5', number: 5, text: 'Difficulty rising from sitting', options: [{ label: 'None', value: 0 }, { label: 'Mild', value: 1 }, { label: 'Moderate', value: 2 }, { label: 'Severe', value: 3 }, { label: 'Extreme', value: 4 }], domain: 'Function' },
    { id: 'kj6', number: 6, text: 'Difficulty bending to floor/picking up an object', options: [{ label: 'None', value: 0 }, { label: 'Mild', value: 1 }, { label: 'Moderate', value: 2 }, { label: 'Severe', value: 3 }, { label: 'Extreme', value: 4 }], domain: 'Function' },
    { id: 'kj7', number: 7, text: 'Difficulty twisting/pivoting on your knee', options: [{ label: 'None', value: 0 }, { label: 'Mild', value: 1 }, { label: 'Moderate', value: 2 }, { label: 'Severe', value: 3 }, { label: 'Extreme', value: 4 }], domain: 'Function' },
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
    { id: 'hj1', number: 1, text: 'Groin or hip pain during the last week', options: [{ label: 'None', value: 0 }, { label: 'Mild', value: 1 }, { label: 'Moderate', value: 2 }, { label: 'Severe', value: 3 }, { label: 'Extreme', value: 4 }], domain: 'Pain' },
    { id: 'hj2', number: 2, text: 'Pain going up or down stairs', options: [{ label: 'None', value: 0 }, { label: 'Mild', value: 1 }, { label: 'Moderate', value: 2 }, { label: 'Severe', value: 3 }, { label: 'Extreme', value: 4 }], domain: 'Pain' },
    { id: 'hj3', number: 3, text: 'Difficulty with sitting', options: [{ label: 'None', value: 0 }, { label: 'Mild', value: 1 }, { label: 'Moderate', value: 2 }, { label: 'Severe', value: 3 }, { label: 'Extreme', value: 4 }], domain: 'Function' },
    { id: 'hj4', number: 4, text: 'Difficulty running', options: [{ label: 'None', value: 0 }, { label: 'Mild', value: 1 }, { label: 'Moderate', value: 2 }, { label: 'Severe', value: 3 }, { label: 'Extreme', value: 4 }], domain: 'Function' },
    { id: 'hj5', number: 5, text: 'Difficulty twisting/pivoting on loaded leg', options: [{ label: 'None', value: 0 }, { label: 'Mild', value: 1 }, { label: 'Moderate', value: 2 }, { label: 'Severe', value: 3 }, { label: 'Extreme', value: 4 }], domain: 'Function' },
    { id: 'hj6', number: 6, text: 'Awareness of hip problem', options: [{ label: 'Never', value: 0 }, { label: 'Monthly', value: 1 }, { label: 'Weekly', value: 2 }, { label: 'Daily', value: 3 }, { label: 'Always', value: 4 }], domain: 'Awareness' },
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
    { id: 'odi1', number: 1, text: 'Pain Intensity', options: [{ label: 'I have no pain at the moment', value: 0 }, { label: 'The pain is very mild', value: 1 }, { label: 'The pain is moderate', value: 2 }, { label: 'The pain is fairly severe', value: 3 }, { label: 'The pain is very severe', value: 4 }, { label: 'The pain is the worst imaginable', value: 5 }], domain: 'Pain' },
    { id: 'odi2', number: 2, text: 'Personal Care (Washing, Dressing)', options: [{ label: 'I can look after myself without causing extra pain', value: 0 }, { label: 'I can look after myself but it causes extra pain', value: 1 }, { label: 'It is painful and I am slow and careful', value: 2 }, { label: 'I need some help but manage most of my care', value: 3 }, { label: 'I need help every day in most aspects', value: 4 }, { label: 'I do not get dressed and wash with difficulty', value: 5 }], domain: 'ADL' },
    { id: 'odi3', number: 3, text: 'Lifting', options: [{ label: 'I can lift heavy weights without extra pain', value: 0 }, { label: 'I can lift heavy weights but it gives extra pain', value: 1 }, { label: 'Pain prevents me from lifting heavy weights', value: 2 }, { label: 'Pain prevents me from lifting heavy weights but I can manage light/medium', value: 3 }, { label: 'I can lift only very light weights', value: 4 }, { label: 'I cannot lift or carry anything at all', value: 5 }], domain: 'Function' },
    { id: 'odi4', number: 4, text: 'Walking', options: [{ label: 'Pain does not prevent me walking any distance', value: 0 }, { label: 'Pain prevents me from walking more than 1 mile', value: 1 }, { label: 'Pain prevents me from walking more than 1/2 mile', value: 2 }, { label: 'Pain prevents me from walking more than 100 yards', value: 3 }, { label: 'I can only walk using a stick or crutches', value: 4 }, { label: 'I am in bed most of the time', value: 5 }], domain: 'Function' },
    { id: 'odi5', number: 5, text: 'Sitting', options: [{ label: 'I can sit in any chair as long as I like', value: 0 }, { label: 'I can only sit in my favorite chair as long as I like', value: 1 }, { label: 'Pain prevents me sitting more than 1 hour', value: 2 }, { label: 'Pain prevents me from sitting more than 30 minutes', value: 3 }, { label: 'Pain prevents me from sitting more than 10 minutes', value: 4 }, { label: 'Pain prevents me from sitting at all', value: 5 }], domain: 'Function' },
    { id: 'odi6', number: 6, text: 'Standing', options: [{ label: 'I can stand as long as I want without extra pain', value: 0 }, { label: 'I can stand as long as I want but it gives extra pain', value: 1 }, { label: 'Pain prevents me from standing more than 1 hour', value: 2 }, { label: 'Pain prevents me from standing more than 30 minutes', value: 3 }, { label: 'Pain prevents me from standing more than 10 minutes', value: 4 }, { label: 'Pain prevents me from standing at all', value: 5 }], domain: 'Function' },
    { id: 'odi7', number: 7, text: 'Sleeping', options: [{ label: 'My sleep is never disturbed by pain', value: 0 }, { label: 'My sleep is occasionally disturbed', value: 1 }, { label: 'I get less than 6 hours sleep because of pain', value: 2 }, { label: 'I get less than 4 hours sleep because of pain', value: 3 }, { label: 'I get less than 2 hours sleep because of pain', value: 4 }, { label: 'Pain prevents me from sleeping at all', value: 5 }], domain: 'Sleep' },
    { id: 'odi8', number: 8, text: 'Social Life', options: [{ label: 'My social life is normal and gives no extra pain', value: 0 }, { label: 'My social life is normal but increases pain', value: 1 }, { label: 'Pain reduces my more energetic interests', value: 2 }, { label: 'Pain has restricted my social life to home', value: 3 }, { label: 'Pain has restricted social life to home', value: 4 }, { label: 'I have no social life because of pain', value: 5 }], domain: 'Social' },
    { id: 'odi9', number: 9, text: 'Traveling', options: [{ label: 'I can travel anywhere without pain', value: 0 }, { label: 'I can travel anywhere but it gives extra pain', value: 1 }, { label: 'Pain is bad but I manage journeys over 2 hours', value: 2 }, { label: 'Pain restricts me to journeys of less than 1 hour', value: 3 }, { label: 'Pain restricts me to short necessary journeys under 30 min', value: 4 }, { label: 'Pain prevents me from traveling except for treatment', value: 5 }], domain: 'Travel' },
    { id: 'odi10', number: 10, text: 'Employment/Homemaking', options: [{ label: 'My normal homemaking/job activities do not cause extra pain', value: 0 }, { label: 'My work causes extra pain but I can still do all that is required', value: 1 }, { label: 'I can do most of my work but pain prevents more demanding', value: 2 }, { label: 'Pain prevents me from doing anything but light duties', value: 3 }, { label: 'Pain prevents me from doing even light duties', value: 4 }, { label: 'Pain prevents me from doing any job at all', value: 5 }], domain: 'Work' },
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
    { id: 'ndi1', number: 1, text: 'Pain Intensity', options: [{ label: 'I have no pain at the moment', value: 0 }, { label: 'The pain is very mild', value: 1 }, { label: 'The pain is moderate', value: 2 }, { label: 'The pain is fairly severe', value: 3 }, { label: 'The pain is very severe', value: 4 }, { label: 'The pain is the worst imaginable', value: 5 }], domain: 'Pain' },
    { id: 'ndi2', number: 2, text: 'Personal Care', options: [{ label: 'I can look after myself without causing extra pain', value: 0 }, { label: 'I can look after myself but it causes extra pain', value: 1 }, { label: 'It is painful and I am slow and careful', value: 2 }, { label: 'I need some help but manage most', value: 3 }, { label: 'I need help every day in most aspects', value: 4 }, { label: 'I do not get dressed, wash with difficulty', value: 5 }], domain: 'ADL' },
    { id: 'ndi3', number: 3, text: 'Lifting', options: [{ label: 'I can lift heavy weights without extra pain', value: 0 }, { label: 'I can lift heavy weights but it causes pain', value: 1 }, { label: 'Pain prevents heavy weights off the floor', value: 2 }, { label: 'Pain prevents heavy weights but I can manage light/medium from convenient position', value: 3 }, { label: 'I can lift only very light weights', value: 4 }, { label: 'I cannot lift or carry anything', value: 5 }], domain: 'Function' },
    { id: 'ndi4', number: 4, text: 'Reading', options: [{ label: 'I can read as much as I want with no neck pain', value: 0 }, { label: 'I can read as much as I want with slight pain', value: 1 }, { label: 'I can read as much as I want with moderate pain', value: 2 }, { label: 'I cannot read as much as I want because of moderate pain', value: 3 }, { label: 'I can hardly read at all because of severe pain', value: 4 }, { label: 'I cannot read at all', value: 5 }], domain: 'Function' },
    { id: 'ndi5', number: 5, text: 'Headaches', options: [{ label: 'I have no headaches at all', value: 0 }, { label: 'Slight headaches which come infrequently', value: 1 }, { label: 'Moderate headaches infrequently', value: 2 }, { label: 'Moderate headaches frequently', value: 3 }, { label: 'Severe headaches frequently', value: 4 }, { label: 'I have headaches almost all the time', value: 5 }], domain: 'Pain' },
    { id: 'ndi6', number: 6, text: 'Concentration', options: [{ label: 'I can concentrate fully when I want without difficulty', value: 0 }, { label: 'I can concentrate fully with slight difficulty', value: 1 }, { label: 'I have a fair degree of difficulty concentrating', value: 2 }, { label: 'I have a lot of difficulty concentrating', value: 3 }, { label: 'I have a great deal of difficulty concentrating', value: 4 }, { label: 'I cannot concentrate at all', value: 5 }], domain: 'Cognitive' },
    { id: 'ndi7', number: 7, text: 'Work', options: [{ label: 'I can do as much work as I want to', value: 0 }, { label: 'I can only do my usual work, but no more', value: 1 }, { label: 'I can do most of my usual work, but no more', value: 2 }, { label: 'I cannot do my usual work', value: 3 }, { label: 'I can hardly do any work at all', value: 4 }, { label: 'I cannot do any work at all', value: 5 }], domain: 'Work' },
    { id: 'ndi8', number: 8, text: 'Driving', options: [{ label: 'I can drive without any neck pain', value: 0 }, { label: 'I can drive as long as I want with slight pain', value: 1 }, { label: 'I can drive as long as I want with moderate pain', value: 2 }, { label: 'I cannot drive as long as I want because of moderate pain', value: 3 }, { label: 'I can hardly drive at all because of severe pain', value: 4 }, { label: 'I cannot drive at all', value: 5 }], domain: 'Function' },
    { id: 'ndi9', number: 9, text: 'Sleeping', options: [{ label: 'I have no trouble sleeping', value: 0 }, { label: 'My sleep is slightly disturbed (less than 1 hour)', value: 1 }, { label: 'My sleep is mildly disturbed (1-2 hours)', value: 2 }, { label: 'My sleep is moderately disturbed (2-3 hours)', value: 3 }, { label: 'My sleep is greatly disturbed (3-5 hours)', value: 4 }, { label: 'My sleep is completely disturbed (5-7 hours)', value: 5 }], domain: 'Sleep' },
    { id: 'ndi10', number: 10, text: 'Recreation', options: [{ label: 'I am able to engage in all recreation activities without neck pain', value: 0 }, { label: 'I am able to engage in all recreation with some neck pain', value: 1 }, { label: 'I am able to engage in most but not all recreation', value: 2 }, { label: 'I am able to engage in a few recreation activities', value: 3 }, { label: 'I can hardly do any recreation activities', value: 4 }, { label: 'I cannot do any recreation activities', value: 5 }], domain: 'Recreation' },
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
    text: [
      'Open a tight or new jar',
      'Do heavy household chores (e.g., wash walls)',
      'Carry a shopping bag or briefcase',
      'Wash your back',
      'Use a knife to cut food',
      'Recreational activities with some force (e.g., golf, tennis)',
      'Arm, shoulder, or hand interfering with normal social activities',
      'Arm, shoulder, or hand limiting work or regular daily activities',
      'Severity of arm, shoulder, or hand pain',
      'Tingling (pins and needles) in your arm, shoulder, or hand',
      'Difficulty sleeping due to arm, shoulder, or hand pain',
    ][i]!,
    options: [
      { label: 'No difficulty / None', value: 1 },
      { label: 'Mild', value: 2 },
      { label: 'Moderate', value: 3 },
      { label: 'Severe', value: 4 },
      { label: 'Unable / Extreme', value: 5 },
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
    { id: 'p1', number: 1, text: 'In general, would you say your health is:', options: [{ label: 'Excellent', value: 5 }, { label: 'Very good', value: 4 }, { label: 'Good', value: 3 }, { label: 'Fair', value: 2 }, { label: 'Poor', value: 1 }], domain: 'Global' },
    { id: 'p2', number: 2, text: 'In general, would you say your quality of life is:', options: [{ label: 'Excellent', value: 5 }, { label: 'Very good', value: 4 }, { label: 'Good', value: 3 }, { label: 'Fair', value: 2 }, { label: 'Poor', value: 1 }], domain: 'Mental' },
    { id: 'p3', number: 3, text: 'In general, how would you rate your physical health?', options: [{ label: 'Excellent', value: 5 }, { label: 'Very good', value: 4 }, { label: 'Good', value: 3 }, { label: 'Fair', value: 2 }, { label: 'Poor', value: 1 }], domain: 'Physical' },
    { id: 'p4', number: 4, text: 'In general, how would you rate your mental health?', options: [{ label: 'Excellent', value: 5 }, { label: 'Very good', value: 4 }, { label: 'Good', value: 3 }, { label: 'Fair', value: 2 }, { label: 'Poor', value: 1 }], domain: 'Mental' },
    { id: 'p5', number: 5, text: 'In general, how would you rate your satisfaction with social activities?', options: [{ label: 'Excellent', value: 5 }, { label: 'Very good', value: 4 }, { label: 'Good', value: 3 }, { label: 'Fair', value: 2 }, { label: 'Poor', value: 1 }], domain: 'Mental' },
    { id: 'p6', number: 6, text: 'To what extent are you able to carry out everyday physical activities?', options: [{ label: 'Completely', value: 5 }, { label: 'Mostly', value: 4 }, { label: 'Moderately', value: 3 }, { label: 'A little', value: 2 }, { label: 'Not at all', value: 1 }], domain: 'Physical' },
    { id: 'p7', number: 7, text: 'How would you rate your pain on average? (0 = no pain, 10 = worst)', options: [{ label: '0 (No pain)', value: 5 }, { label: '1-3', value: 4 }, { label: '4-6', value: 3 }, { label: '7-9', value: 2 }, { label: '10 (Worst)', value: 1 }], domain: 'Physical', reverseScored: true },
    { id: 'p8', number: 8, text: 'How often have you been bothered by emotional problems (anxiety, depression)?', options: [{ label: 'Never', value: 5 }, { label: 'Rarely', value: 4 }, { label: 'Sometimes', value: 3 }, { label: 'Often', value: 2 }, { label: 'Always', value: 1 }], domain: 'Mental' },
    { id: 'p9', number: 9, text: 'How would you rate your fatigue on average?', options: [{ label: 'None', value: 5 }, { label: 'Mild', value: 4 }, { label: 'Moderate', value: 3 }, { label: 'Severe', value: 2 }, { label: 'Very severe', value: 1 }], domain: 'Physical' },
    { id: 'p10', number: 10, text: 'In general, please rate how well you carry out your usual social activities at home and work', options: [{ label: 'Excellent', value: 5 }, { label: 'Very good', value: 4 }, { label: 'Good', value: 3 }, { label: 'Fair', value: 2 }, { label: 'Poor', value: 1 }], domain: 'Mental' },
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

/**
 * Get an instrument definition by ID.
 * @throws Error if instrument not found
 */
export function getInstrument(id: string): InstrumentDefinition {
  const instrument = INSTRUMENTS.get(id);
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
  const instrument = getInstrument(instrumentId);

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
