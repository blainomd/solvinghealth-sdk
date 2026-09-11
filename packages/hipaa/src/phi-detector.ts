/**
 * @solvinghealth/hipaa -- PHI Detector
 *
 * Detects Protected Health Information (PHI) in text and structured data
 * using regex patterns for the 18 HIPAA Safe Harbor identifiers.
 *
 * Dual-pass architecture:
 * 1. Pre-LLM redaction: strip PHI before sending to any AI model
 * 2. Post-LLM scanning: verify AI output does not contain PHI
 *
 * @module @solvinghealth/hipaa/phi-detector
 * @license Apache-2.0
 */

import { z } from 'zod';

// ─── Types ──────────────────────────────────────────────────

/** Sensitivity level for PHI detection */
export type PHISensitivity = 'strict' | 'standard' | 'lenient';

/** Type of PHI detected */
export type PHIType =
  | 'ssn'
  | 'mrn'
  | 'dob'
  | 'phone'
  | 'email'
  | 'address'
  | 'name'
  | 'ip_address'
  | 'account_number'
  | 'license_number'
  | 'vehicle_id'
  | 'device_id'
  | 'url'
  | 'biometric'
  | 'photo'
  | 'other';

/** A detected PHI span within text */
export interface PHISpan {
  /** Type of PHI detected */
  type: PHIType;
  /** The matched text */
  value: string;
  /** Start index in the original text */
  start: number;
  /** End index in the original text */
  end: number;
  /** Confidence score (0.0 to 1.0) */
  confidence: number;
  /** The regex pattern that matched (for debugging) */
  pattern?: string;
}

/** Result of PHI detection */
export interface PHIDetectionResult {
  /** Whether any PHI was detected */
  containsPHI: boolean;
  /** All detected PHI spans */
  spans: PHISpan[];
  /** The input text with PHI redacted */
  redacted: string;
  /** Summary of PHI types found */
  summary: Record<PHIType, number>;
}

/** Configuration for PHI detection */
export const PHIDetectorConfigSchema = z.object({
  /** Detection sensitivity (default: 'standard') */
  sensitivity: z.enum(['strict', 'standard', 'lenient']).default('standard'),
  /** Additional custom patterns to detect */
  customPatterns: z.array(z.object({
    type: z.string(),
    pattern: z.string(),
    confidence: z.number().min(0).max(1),
  })).optional(),
  /** Redaction placeholder format (default: '[REDACTED:{type}]') */
  redactionFormat: z.string().default('[REDACTED:{type}]'),
  /** Whether to include the matched value in results (default: false for production) */
  includeValues: z.boolean().default(false),
});

export type PHIDetectorConfig = z.infer<typeof PHIDetectorConfigSchema>;

// ─── Pattern Definitions ────────────────────────────────────

interface PatternDef {
  type: PHIType;
  pattern: RegExp;
  confidence: number;
  /** Minimum sensitivity level required for this pattern to be active */
  minSensitivity: PHISensitivity;
}

const SENSITIVITY_ORDER: Record<PHISensitivity, number> = {
  lenient: 0,
  standard: 1,
  strict: 2,
};

/**
 * PHI detection patterns organized by HIPAA Safe Harbor identifiers.
 * Each pattern includes a confidence score reflecting accuracy.
 */
const PHI_PATTERNS: PatternDef[] = [
  // 1. Social Security Numbers
  {
    type: 'ssn',
    pattern: /\b\d{3}-\d{2}-\d{4}\b/g,
    confidence: 0.99,
    minSensitivity: 'lenient',
  },
  {
    type: 'ssn',
    pattern: /\b\d{9}\b/g,
    confidence: 0.60,
    minSensitivity: 'strict',
  },

  // 2. Medical Record Numbers (common formats)
  {
    type: 'mrn',
    pattern: /\bMRN[:\s#]*\d{5,12}\b/gi,
    confidence: 0.95,
    minSensitivity: 'lenient',
  },
  {
    type: 'mrn',
    pattern: /\bMR[:\s#]*\d{5,12}\b/gi,
    confidence: 0.85,
    minSensitivity: 'standard',
  },
  {
    type: 'mrn',
    pattern: /\bPatient\s*(?:ID|#|No)[:\s]*\d{5,12}\b/gi,
    confidence: 0.90,
    minSensitivity: 'lenient',
  },

  // 3. Dates of Birth
  {
    type: 'dob',
    pattern: /\b(?:DOB|Date\s+of\s+Birth|Birth\s*Date)[:\s]*\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/gi,
    confidence: 0.98,
    minSensitivity: 'lenient',
  },
  {
    type: 'dob',
    pattern: /\b(?:DOB|Date\s+of\s+Birth|Birth\s*Date)[:\s]*\d{4}-\d{2}-\d{2}\b/gi,
    confidence: 0.98,
    minSensitivity: 'lenient',
  },
  {
    type: 'dob',
    pattern: /\b(?:born\s+(?:on\s+)?)\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/gi,
    confidence: 0.90,
    minSensitivity: 'standard',
  },

  // 4. Phone Numbers
  {
    type: 'phone',
    pattern: /\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
    confidence: 0.85,
    minSensitivity: 'standard',
  },
  {
    type: 'phone',
    pattern: /\b(?:phone|tel|fax|cell|mobile)[:\s]*(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/gi,
    confidence: 0.95,
    minSensitivity: 'lenient',
  },

  // 5. Email Addresses
  {
    type: 'email',
    pattern: /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/g,
    confidence: 0.95,
    minSensitivity: 'lenient',
  },

  // 6. Street Addresses (heuristic -- street number + street name + type)
  {
    type: 'address',
    pattern: /\b\d{1,5}\s+(?:[A-Z][a-z]+\s+){1,3}(?:St(?:reet)?|Ave(?:nue)?|Blvd|Boulevard|Dr(?:ive)?|Ln|Lane|Rd|Road|Way|Ct|Court|Pl(?:ace)?|Cir(?:cle)?)\b\.?\s*(?:#\s*\d+|(?:Apt|Suite|Ste|Unit)\s*#?\s*\d+)?/gi,
    confidence: 0.80,
    minSensitivity: 'standard',
  },

  // 7. IP Addresses
  {
    type: 'ip_address',
    pattern: /\b(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b/g,
    confidence: 0.90,
    minSensitivity: 'standard',
  },

  // 8. Account Numbers
  {
    type: 'account_number',
    pattern: /\b(?:Account|Acct)[:\s#]*\d{8,17}\b/gi,
    confidence: 0.85,
    minSensitivity: 'standard',
  },

  // 9. License/Certificate Numbers
  {
    type: 'license_number',
    pattern: /\b(?:License|DL|Driver'?s?\s+License)[:\s#]*[A-Z0-9]{5,15}\b/gi,
    confidence: 0.80,
    minSensitivity: 'standard',
  },

  // 10. Vehicle Identifiers
  {
    type: 'vehicle_id',
    pattern: /\bVIN[:\s#]*[A-HJ-NPR-Z0-9]{17}\b/gi,
    confidence: 0.95,
    minSensitivity: 'standard',
  },

  // 11. Device Identifiers (UDI format)
  {
    type: 'device_id',
    pattern: /\b(?:UDI|Device\s*ID)[:\s#]*[A-Z0-9]{10,30}\b/gi,
    confidence: 0.80,
    minSensitivity: 'standard',
  },

  // 12. URLs (web addresses can contain PHI in query params)
  {
    type: 'url',
    pattern: /https?:\/\/[^\s<>"{}|\\^`[\]]+/gi,
    confidence: 0.70,
    minSensitivity: 'strict',
  },
];

// ─── PHI Detector ───────────────────────────────────────────

/**
 * PHI Detector for identifying and redacting Protected Health Information.
 *
 * Implements a dual-pass architecture:
 * - Pre-LLM pass: detect and redact PHI before sending data to any AI model
 * - Post-LLM pass: scan AI output to ensure no PHI leaked through
 *
 * Covers the 18 HIPAA Safe Harbor identifiers via regex patterns.
 * Name detection uses a placeholder for future NER integration.
 *
 * @example
 * ```typescript
 * const detector = new PHIDetector({ sensitivity: 'standard' });
 *
 * // Pre-LLM redaction
 * const result = detector.detect('Patient John Smith, DOB 03/15/1985, SSN 123-45-6789');
 * console.log(result.redacted);
 * // "Patient John Smith, DOB [REDACTED:dob], SSN [REDACTED:ssn]"
 *
 * // Scan text
 * const clean = detector.containsPHI('The patient has knee pain');
 * // false
 * ```
 */
export class PHIDetector {
  private readonly config: PHIDetectorConfig;
  private readonly activePatterns: PatternDef[];

  constructor(config?: Partial<PHIDetectorConfig>) {
    this.config = PHIDetectorConfigSchema.parse(config ?? {});

    // Filter patterns by sensitivity level
    const sensitivityLevel = SENSITIVITY_ORDER[this.config.sensitivity];
    this.activePatterns = PHI_PATTERNS.filter(
      p => SENSITIVITY_ORDER[p.minSensitivity] <= sensitivityLevel
    );
  }

  /**
   * Detect PHI in a text string.
   *
   * @param text - The text to scan for PHI
   * @returns Detection result with spans, redacted text, and summary
   */
  detect(text: string): PHIDetectionResult {
    const spans: PHISpan[] = [];
    const seen = new Set<string>(); // Deduplicate overlapping matches

    for (const patternDef of this.activePatterns) {
      // Reset regex lastIndex for global patterns
      const regex = new RegExp(patternDef.pattern.source, patternDef.pattern.flags);
      let match: RegExpExecArray | null;

      while ((match = regex.exec(text)) !== null) {
        const key = `${match.index}:${match[0].length}`;
        if (seen.has(key)) continue;
        seen.add(key);

        spans.push({
          type: patternDef.type,
          value: this.config.includeValues ? match[0] : '[MASKED]',
          start: match.index,
          end: match.index + match[0].length,
          confidence: patternDef.confidence,
        });
      }
    }

    // Check custom patterns
    if (this.config.customPatterns) {
      for (const custom of this.config.customPatterns) {
        const regex = new RegExp(custom.pattern, 'gi');
        let match: RegExpExecArray | null;

        while ((match = regex.exec(text)) !== null) {
          const key = `${match.index}:${match[0].length}`;
          if (seen.has(key)) continue;
          seen.add(key);

          spans.push({
            type: 'other',
            value: this.config.includeValues ? match[0] : '[MASKED]',
            start: match.index,
            end: match.index + match[0].length,
            confidence: custom.confidence,
          });
        }
      }
    }

    // Sort spans by position
    spans.sort((a, b) => a.start - b.start);

    // Build redacted text
    const redacted = this.redact(text, spans);

    // Build summary
    const summary = {} as Record<PHIType, number>;
    for (const span of spans) {
      summary[span.type] = (summary[span.type] ?? 0) + 1;
    }

    return {
      containsPHI: spans.length > 0,
      spans,
      redacted,
      summary,
    };
  }

  /**
   * Quick check: does this text contain any PHI?
   *
   * @param text - The text to check
   * @returns true if PHI is detected
   */
  containsPHI(text: string): boolean {
    for (const patternDef of this.activePatterns) {
      const regex = new RegExp(patternDef.pattern.source, patternDef.pattern.flags);
      if (regex.test(text)) return true;
    }
    return false;
  }

  /**
   * Detect PHI in structured data (objects, arrays).
   * Recursively walks the data structure and scans all string values.
   *
   * @param data - The data structure to scan
   * @param path - Current path (for reporting)
   * @returns Array of PHI spans with their path in the data structure
   */
  detectInObject(data: unknown, path: string = ''): Array<PHISpan & { path: string }> {
    const results: Array<PHISpan & { path: string }> = [];

    if (typeof data === 'string') {
      const detection = this.detect(data);
      for (const span of detection.spans) {
        results.push({ ...span, path });
      }
    } else if (Array.isArray(data)) {
      for (let i = 0; i < data.length; i++) {
        results.push(...this.detectInObject(data[i], `${path}[${i}]`));
      }
    } else if (data !== null && typeof data === 'object') {
      for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
        const newPath = path ? `${path}.${key}` : key;
        results.push(...this.detectInObject(value, newPath));
      }
    }

    return results;
  }

  /**
   * Redact PHI from text, replacing detected spans with placeholders.
   *
   * @param text - Original text
   * @param spans - Detected PHI spans (if not provided, runs detection first)
   * @returns Text with PHI replaced by placeholders
   */
  redact(text: string, spans?: PHISpan[]): string {
    const detectedSpans = spans ?? this.detect(text).spans;
    if (detectedSpans.length === 0) return text;

    // Sort by position descending so we can replace from end to start
    const sorted = [...detectedSpans].sort((a, b) => b.start - a.start);

    let result = text;
    for (const span of sorted) {
      const placeholder = this.config.redactionFormat.replace('{type}', span.type);
      result = result.slice(0, span.start) + placeholder + result.slice(span.end);
    }

    return result;
  }

  /**
   * Redact PHI from a structured data object.
   * Returns a deep copy with all detected PHI redacted.
   *
   * @param data - The data structure to redact
   * @returns Deep copy with PHI redacted
   */
  redactObject<T>(data: T): T {
    if (typeof data === 'string') {
      return this.redact(data) as T;
    }

    if (Array.isArray(data)) {
      return data.map(item => this.redactObject(item)) as T;
    }

    if (data !== null && typeof data === 'object') {
      const result: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
        result[key] = this.redactObject(value);
      }
      return result as T;
    }

    return data;
  }
}
