/**
 * @solvinghealth/billing — Medicare Billing Automation
 *
 * Proprietary billing intelligence engine for the SolvingHealth SDK.
 * Code registry, NPI mapping, stacking analysis, claims generation,
 * and per-surgeon revenue calculation.
 *
 * PROPRIETARY — SolvingHealth LLC. All rights reserved.
 */

// Code Registry
export {
  type BillingCode,
  BillingCodeSchema,
  BILLING_CODES,
  type CodeCategory,
  CodeCategorySchema,
  type CodeSystem,
  CodeSystemSchema,
  type CompatibilityRule,
  CompatibilityRuleSchema,
  COMPATIBILITY_RULES,
  type ICD10Code,
  ICD10CodeSchema,
  ICD10_CODES,
  areCodesCompatible,
  getBillingCode,
  getCodesByCategory,
  getCodesBySystem,
  getICD10Code,
  getPaymentDollars,
  searchICD10,
} from './codes.js';

// NPI Mapper
export {
  type NPIEligibilityResult,
  NPIEligibilityResultSchema,
  type NPPESResult,
  NPPESResultSchema,
  type Taxonomy,
  TaxonomySchema,
  buildNPPESSearchUrl,
  buildNPPESUrl,
  mapNPIToEligibleCodes,
} from './npi-mapper.js';

// Code Stacking
export {
  type EncounterInput,
  EncounterInputSchema,
  type PatientCondition,
  PatientConditionSchema,
  type StackingAnalysis,
  StackingAnalysisSchema,
  type StackingOpportunity,
  StackingOpportunitySchema,
  analyzeCodeStacking,
  estimateMaxAnnualRevenue,
} from './stacking.js';

// Claims
export {
  type CMS1500Claim,
  CMS1500ClaimSchema,
  type ClaimLine,
  ClaimLineSchema,
  type ClaimValidationResult,
  ClaimValidationResultSchema,
  MEMBER_TRANSACTION_FEE_DOLLARS,
  NON_MEMBER_TRANSACTION_FEE_DOLLARS,
  calculateNetRevenue,
  generateClaim,
  validateClaim,
  validateNPIChecksum,
} from './claims.js';

// Revenue Calculator
export {
  type RevenueAnalysis,
  RevenueAnalysisSchema,
  type RevenueBreakdown,
  RevenueBreakdownSchema,
  type RevenueInput,
  RevenueInputSchema,
  type SpecialtyType,
  SpecialtyTypeSchema,
  calculateSurgeonRevenue,
  quickEstimate,
} from './revenue-calculator.js';
