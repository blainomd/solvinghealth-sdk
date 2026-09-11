/**
 * @solvinghealth/prom — Patient-Reported Outcome Measures
 *
 * Open source PROM collection, scoring, voice administration,
 * and analytics for orthopedic and general health outcomes. Ships no
 * third-party questionnaire wording; see NOTICE.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// Instrument Definitions
export {
  type InstrumentDefinition,
  InstrumentDefinitionSchema,
  type InstrumentItem,
  InstrumentItemSchema,
  type ResponseOption,
  ResponseOptionSchema,
  type ScoringRange,
  ScoringRangeSchema,
  INSTRUMENTS,
  KOOS_JR,
  HOOS_JR,
  ODI,
  NDI,
  QUICK_DASH,
  PROMIS_10,
  getInstrument,
  scoreInstrument,
  scorePROMIS10Domain,
  interpretScore,
  isClinicallySignificant,
  type InstrumentWording,
  withInstrumentText,
  registerInstrumentWording,
  clearInstrumentWording,
  hasWording,
  requireWording,
} from './instruments.js';

// Collection Engine
export {
  type FHIRQuestionnaireResponse,
  FHIRQuestionnaireResponseSchema,
  type ItemResponse,
  ItemResponseSchema,
  type SessionStatus,
  SessionStatusSchema,
  type SurveySession,
  SurveySessionSchema,
  completeSession,
  createSession,
  getCompletionStats,
  getNextItem,
  recordResponse,
  toFHIRQuestionnaireResponse,
} from './collector.js';

// Voice PROM
export {
  type BridgingStudyRecord,
  BridgingStudyRecordSchema,
  type ConversationalPrompt,
  ConversationalPromptSchema,
  type VoicePROMSession,
  VoicePROMSessionSchema,
  type VoiceResponseMapping,
  VoiceResponseMappingSchema,
  analyzeBridgingResults,
  createVoiceSession,
  generateConversationalPrompt,
  mapNaturalLanguageResponse,
  processVoiceResponse,
  recordBridgingDataPoint,
} from './voice-prom.js';

// Analytics
export {
  type PopulationBenchmark,
  PopulationBenchmarkSchema,
  type RiskLevel,
  RiskLevelSchema,
  type RiskStratification,
  RiskStratificationSchema,
  type ScoreDataPoint,
  ScoreDataPointSchema,
  type TrendAnalysis,
  TrendAnalysisSchema,
  REFERENCE_BENCHMARKS,
  analyzeTrend,
  calculateMCIDAchievement,
  compareToPopulation,
  stratifyRisk,
} from './analytics.js';
