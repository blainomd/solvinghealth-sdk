/**
 * @solvinghealth/fhir -- Omaha System to FHIR R4 Mapper
 *
 * Maps Omaha System classification (domains, problems, signs/symptoms)
 * to FHIR R4 Condition and Observation resources with proper SNOMED CT coding.
 *
 * The Omaha System is used by home care, public health, and community-based
 * organizations. Mapping it to FHIR enables interoperability with hospital
 * systems, creating the "hospital-grade data from home care" that is
 * genuine IP for co-op.care.
 *
 * @see https://www.omahasystem.org/
 * @module @solvinghealth/fhir/omaha-to-fhir
 * @license Apache-2.0
 */

import type { Condition, Observation } from './types.js';

// ─── Omaha System Types ─────────────────────────────────────

/** The four Omaha System problem classification domains */
export type OmahaDomain =
  | 'Environmental'
  | 'Psychosocial'
  | 'Physiological'
  | 'Health-Related Behaviors';

/** Omaha System problem with domain, problem name, and signs/symptoms */
export interface OmahaProblem {
  /** The domain this problem falls under */
  domain: OmahaDomain;
  /** Problem name from the Omaha System Problem Classification Scheme */
  problem: string;
  /** Signs and symptoms observed */
  signsSymptoms?: string[];
  /** Knowledge, Behavior, Status ratings (1-5 scale) */
  kbsRating?: {
    knowledge: 1 | 2 | 3 | 4 | 5;
    behavior: 1 | 2 | 3 | 4 | 5;
    status: 1 | 2 | 3 | 4 | 5;
  };
  /** Modifier: individual or family */
  modifier?: 'individual' | 'family';
  /** Date the problem was identified */
  identifiedDate?: string;
}

/** Subject reference for generated FHIR resources */
export interface SubjectReference {
  /** FHIR reference string (e.g., "Patient/123") */
  reference: string;
  /** Display name */
  display?: string;
}

// ─── SNOMED CT Mappings ─────────────────────────────────────

/**
 * Mapping from Omaha System problems to SNOMED CT codes.
 * This is a curated subset -- the full mapping covers all 42 Omaha problems.
 *
 * The Omaha System OID is 2.16.840.1.113883.6.98
 * SNOMED CT system: http://snomed.info/sct
 */
const OMAHA_TO_SNOMED: Record<string, { code: string; display: string }> = {
  // Environmental Domain (4 problems)
  'Income': { code: '224163003', display: 'Household income finding' },
  'Sanitation': { code: '105530003', display: 'Housing condition finding' },
  'Residence': { code: '365508006', display: 'Residence and accommodation circumstances' },
  'Neighborhood/workplace safety': { code: '105529008', display: 'Occupational hazard' },

  // Psychosocial Domain (12 problems)
  'Communication with community resources': { code: '105499002', display: 'Community integration' },
  'Social contact': { code: '105494007', display: 'Social support finding' },
  'Role change': { code: '276082008', display: 'Role change' },
  'Interpersonal relationship': { code: '365462002', display: 'Interpersonal relationship finding' },
  'Spirituality': { code: '365480000', display: 'Spiritual wellbeing finding' },
  'Grief': { code: '248152002', display: 'Grief reaction' },
  'Mental health': { code: '74732009', display: 'Mental disorder' },
  'Sexuality': { code: '365466004', display: 'Sexual function finding' },
  'Caretaking/parenting': { code: '365453002', display: 'Parenting finding' },
  'Neglected child/adult': { code: '95930005', display: 'Neglect' },
  'Abused child/adult': { code: '386702006', display: 'Victim of abuse' },
  'Growth and development': { code: '248290002', display: 'Growth and development finding' },

  // Physiological Domain (18 problems)
  'Hearing': { code: '47078008', display: 'Hearing disorder' },
  'Vision': { code: '397540003', display: 'Visual impairment' },
  'Speech and language': { code: '229721001', display: 'Speech and language finding' },
  'Oral health': { code: '232004', display: 'Disorder of oral cavity' },
  'Cognition': { code: '386806002', display: 'Impaired cognition' },
  'Pain': { code: '22253000', display: 'Pain' },
  'Consciousness': { code: '3006004', display: 'Disturbance of consciousness' },
  'Skin': { code: '95320005', display: 'Disorder of skin' },
  'Neuro-musculo-skeletal function': { code: '928000', display: 'Disorder of musculoskeletal system' },
  'Respiration': { code: '106048009', display: 'Respiratory finding' },
  'Circulation': { code: '400047006', display: 'Cardiovascular finding' },
  'Digestion-hydration': { code: '386617003', display: 'Digestive system finding' },
  'Bowel function': { code: '300391003', display: 'Bowel function finding' },
  'Urinary function': { code: '106098005', display: 'Urinary system finding' },
  'Reproductive function': { code: '248160001', display: 'Reproductive function finding' },
  'Pregnancy': { code: '77386006', display: 'Pregnant' },
  'Postpartum': { code: '255410009', display: 'Postpartum period' },
  'Communicable/infectious condition': { code: '40733004', display: 'Infectious disease' },

  // Health-Related Behaviors Domain (8 problems)
  'Nutrition': { code: '300391003', display: 'Nutritional finding' },
  'Sleep and rest patterns': { code: '106168000', display: 'Sleep finding' },
  'Physical activity': { code: '68130003', display: 'Physical activity finding' },
  'Personal care': { code: '284773001', display: 'Ability to perform personal care activity' },
  'Substance use': { code: '66214007', display: 'Substance abuse' },
  'Family planning': { code: '13197004', display: 'Contraception' },
  'Health care supervision': { code: '243788004', display: 'Adherence to care plan' },
  'Medication regimen': { code: '373529000', display: 'Medication administration' },
};

/**
 * Mapping from Omaha domains to FHIR Condition category codes.
 */
const DOMAIN_TO_CATEGORY: Record<OmahaDomain, { code: string; display: string }> = {
  'Environmental': { code: '75326-9', display: 'Environmental problem' },
  'Psychosocial': { code: '75325-1', display: 'Psychosocial problem' },
  'Physiological': { code: '75323-6', display: 'Physiological problem' },
  'Health-Related Behaviors': { code: '75324-4', display: 'Health-related behavior' },
};

// ─── Mapper Functions ───────────────────────────────────────

/**
 * Map an Omaha System problem to a FHIR R4 Condition resource.
 *
 * Creates a Condition with:
 * - Omaha System problem as the primary code (OID: 2.16.840.1.113883.6.98)
 * - SNOMED CT mapping as secondary coding
 * - Domain-based category
 * - Clinical and verification status
 * - Signs/symptoms as evidence
 *
 * @param problem - The Omaha System problem to map
 * @param subject - Patient/subject reference
 * @returns A FHIR R4 Condition resource
 *
 * @example
 * ```typescript
 * const condition = mapOmahaProblemToCondition(
 *   {
 *     domain: 'Physiological',
 *     problem: 'Pain',
 *     signsSymptoms: ['Expresses discomfort/pain', 'Decreased activity'],
 *     kbsRating: { knowledge: 3, behavior: 2, status: 2 },
 *   },
 *   { reference: 'Patient/123', display: 'Jane Doe' }
 * );
 * ```
 */
export function mapOmahaProblemToCondition(
  problem: OmahaProblem,
  subject: SubjectReference,
): Condition {
  const snomedMapping = OMAHA_TO_SNOMED[problem.problem];
  const domainCategory = DOMAIN_TO_CATEGORY[problem.domain];

  const coding = [
    {
      system: 'urn:oid:2.16.840.1.113883.6.98',
      code: problem.problem,
      display: `Omaha: ${problem.problem}`,
    },
  ];

  if (snomedMapping) {
    coding.push({
      system: 'http://snomed.info/sct',
      code: snomedMapping.code,
      display: snomedMapping.display,
    });
  }

  const condition: Condition = {
    resourceType: 'Condition',
    clinicalStatus: {
      coding: [{
        system: 'http://terminology.hl7.org/CodeSystem/condition-clinical',
        code: 'active',
        display: 'Active',
      }],
    },
    verificationStatus: {
      coding: [{
        system: 'http://terminology.hl7.org/CodeSystem/condition-ver-status',
        code: 'confirmed',
        display: 'Confirmed',
      }],
    },
    category: [{
      coding: [{
        system: 'http://loinc.org',
        code: domainCategory.code,
        display: domainCategory.display,
      }],
      text: `Omaha Domain: ${problem.domain}`,
    }],
    code: {
      coding,
      text: problem.problem,
    },
    subject: {
      reference: subject.reference,
      display: subject.display,
    },
    onsetDateTime: problem.identifiedDate,
  };

  // Add signs/symptoms as evidence
  if (problem.signsSymptoms && problem.signsSymptoms.length > 0) {
    condition.evidence = problem.signsSymptoms.map(ss => ({
      code: [{
        coding: [{
          system: 'urn:oid:2.16.840.1.113883.6.98',
          code: ss,
          display: ss,
        }],
        text: ss,
      }],
    }));
  }

  // Add modifier as a note
  if (problem.modifier) {
    condition.note = [{
      text: `Omaha modifier: ${problem.modifier}`,
    }];
  }

  return condition;
}

/**
 * Map Omaha System KBS (Knowledge, Behavior, Status) ratings
 * to FHIR R4 Observation resources.
 *
 * Creates three Observation resources (one per KBS dimension)
 * using a 1-5 scale with LOINC coding. These observations enable
 * outcome tracking over time -- the core value proposition of
 * the Omaha System's outcome framework.
 *
 * @param problem - The Omaha System problem with KBS ratings
 * @param subject - Patient/subject reference
 * @returns Array of three FHIR Observation resources (knowledge, behavior, status)
 */
export function mapOmahaKBSToObservations(
  problem: OmahaProblem,
  subject: SubjectReference,
): Observation[] {
  if (!problem.kbsRating) return [];

  const now = new Date().toISOString();

  const dimensions: Array<{
    dimension: string;
    value: number;
    loincCode: string;
    loincDisplay: string;
  }> = [
    {
      dimension: 'Knowledge',
      value: problem.kbsRating.knowledge,
      loincCode: '75281-6',
      loincDisplay: 'Problem knowledge rating',
    },
    {
      dimension: 'Behavior',
      value: problem.kbsRating.behavior,
      loincCode: '75282-4',
      loincDisplay: 'Problem behavior rating',
    },
    {
      dimension: 'Status',
      value: problem.kbsRating.status,
      loincCode: '75283-2',
      loincDisplay: 'Problem status rating',
    },
  ];

  return dimensions.map(dim => ({
    resourceType: 'Observation' as const,
    status: 'final' as const,
    category: [{
      coding: [{
        system: 'http://terminology.hl7.org/CodeSystem/observation-category',
        code: 'survey',
        display: 'Survey',
      }],
    }],
    code: {
      coding: [
        {
          system: 'http://loinc.org',
          code: dim.loincCode,
          display: dim.loincDisplay,
        },
        {
          system: 'urn:oid:2.16.840.1.113883.6.98',
          code: `KBS-${dim.dimension}`,
          display: `Omaha KBS ${dim.dimension} for ${problem.problem}`,
        },
      ],
      text: `${dim.dimension} rating for ${problem.problem}`,
    },
    subject: {
      reference: subject.reference,
      display: subject.display,
    },
    effectiveDateTime: now,
    valueInteger: dim.value,
    note: [{
      text: `Omaha System ${dim.dimension} rating (1=lowest, 5=highest) for problem: ${problem.problem} in domain: ${problem.domain}`,
    }],
  }));
}

/**
 * Map a complete Omaha assessment (multiple problems) to FHIR resources.
 *
 * @param problems - Array of Omaha System problems
 * @param subject - Patient/subject reference
 * @returns Object containing arrays of Condition and Observation resources
 */
export function mapOmahaAssessmentToFHIR(
  problems: OmahaProblem[],
  subject: SubjectReference,
): { conditions: Condition[]; observations: Observation[] } {
  const conditions: Condition[] = [];
  const observations: Observation[] = [];

  for (const problem of problems) {
    conditions.push(mapOmahaProblemToCondition(problem, subject));
    observations.push(...mapOmahaKBSToObservations(problem, subject));
  }

  return { conditions, observations };
}

/**
 * Get the SNOMED CT code for an Omaha System problem.
 *
 * @param problemName - The Omaha System problem name
 * @returns SNOMED CT code and display, or undefined if no mapping exists
 */
export function getSnomedMapping(problemName: string): { code: string; display: string } | undefined {
  return OMAHA_TO_SNOMED[problemName];
}

/**
 * List all Omaha System problems with their SNOMED CT mappings.
 * Useful for building UIs and validation.
 */
export function listAllMappings(): Array<{
  problem: string;
  snomed: { code: string; display: string } | undefined;
}> {
  return Object.entries(OMAHA_TO_SNOMED).map(([problem, snomed]) => ({
    problem,
    snomed,
  }));
}
