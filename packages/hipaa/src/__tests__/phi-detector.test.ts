import { describe, it, expect } from 'vitest';
import { PHIDetector } from '../phi-detector.js';

// ---------------------------------------------------------------------------
// PHI Detection: individual identifiers
// ---------------------------------------------------------------------------

describe('PHIDetector', () => {
  const detector = new PHIDetector({
    sensitivity: 'standard',
    includeValues: true,
  });

  describe('SSN detection', () => {
    it('detects formatted SSN "123-45-6789"', () => {
      const result = detector.detect('Patient SSN: 123-45-6789');
      expect(result.containsPHI).toBe(true);
      const ssnSpan = result.spans.find((s) => s.type === 'ssn');
      expect(ssnSpan).toBeDefined();
      expect(ssnSpan!.value).toBe('123-45-6789');
      expect(ssnSpan!.confidence).toBeGreaterThanOrEqual(0.9);
    });
  });

  describe('MRN detection', () => {
    it('detects "MRN: 12345678"', () => {
      const result = detector.detect('MRN: 12345678');
      expect(result.containsPHI).toBe(true);
      const mrnSpan = result.spans.find((s) => s.type === 'mrn');
      expect(mrnSpan).toBeDefined();
    });

    it('detects "Patient ID: 87654321"', () => {
      const result = detector.detect('Patient ID: 87654321');
      expect(result.containsPHI).toBe(true);
      const mrnSpan = result.spans.find((s) => s.type === 'mrn');
      expect(mrnSpan).toBeDefined();
    });
  });

  describe('phone number detection', () => {
    it('detects "(303) 555-1234"', () => {
      const result = detector.detect('Call the patient at (303) 555-1234');
      expect(result.containsPHI).toBe(true);
      const phoneSpan = result.spans.find((s) => s.type === 'phone');
      expect(phoneSpan).toBeDefined();
    });
  });

  describe('email detection', () => {
    it('detects "patient@email.com"', () => {
      const result = detector.detect('Contact: patient@email.com');
      expect(result.containsPHI).toBe(true);
      const emailSpan = result.spans.find((s) => s.type === 'email');
      expect(emailSpan).toBeDefined();
      expect(emailSpan!.value).toBe('patient@email.com');
    });
  });

  describe('date of birth detection', () => {
    it('detects "DOB: 01/15/1958"', () => {
      const result = detector.detect('DOB: 01/15/1958');
      expect(result.containsPHI).toBe(true);
      const dobSpan = result.spans.find((s) => s.type === 'dob');
      expect(dobSpan).toBeDefined();
    });

    it('detects "Date of Birth: 1958-01-15"', () => {
      const result = detector.detect('Date of Birth: 1958-01-15');
      expect(result.containsPHI).toBe(true);
      const dobSpan = result.spans.find((s) => s.type === 'dob');
      expect(dobSpan).toBeDefined();
    });
  });

  describe('address detection', () => {
    it('detects "123 Main St, Boulder, CO 80302"', () => {
      const result = detector.detect(
        'Patient lives at 123 Main St, Boulder, CO 80302',
      );
      expect(result.containsPHI).toBe(true);
      const addrSpan = result.spans.find((s) => s.type === 'address');
      expect(addrSpan).toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // False positives: clinical terms should NOT be flagged
  // ---------------------------------------------------------------------------

  describe('clinical terms are NOT flagged', () => {
    it('"The patient presents with acute pain" has no PHI', () => {
      const result = detector.detect(
        'The patient presents with acute pain in the right knee.',
      );
      expect(result.containsPHI).toBe(false);
      expect(result.spans).toHaveLength(0);
    });

    it('clinical note without identifiers has no PHI', () => {
      const result = detector.detect(
        'Assessment: Bilateral osteoarthritis, Kellgren-Lawrence Grade III. ' +
          'Plan: Physical therapy referral, NSAIDs as needed.',
      );
      expect(result.containsPHI).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Dual-pass scanning
  // ---------------------------------------------------------------------------

  describe('dual-pass scanning', () => {
    it('pre-inference redaction: PHI is replaced with placeholders', () => {
      const result = detector.detect(
        'Patient SSN: 123-45-6789, DOB: 03/15/1985, email: john@example.com',
      );
      expect(result.redacted).toContain('[REDACTED:ssn]');
      expect(result.redacted).toContain('[REDACTED:dob]');
      expect(result.redacted).toContain('[REDACTED:email]');
      expect(result.redacted).not.toContain('123-45-6789');
      expect(result.redacted).not.toContain('john@example.com');
    });

    it('post-inference scan: clean AI output passes', () => {
      const aiOutput =
        'Based on the clinical presentation, the patient likely has osteoarthritis.';
      const hasPHI = detector.containsPHI(aiOutput);
      expect(hasPHI).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Structured data scanning
  // ---------------------------------------------------------------------------

  describe('structured data scanning', () => {
    it('detects PHI in nested objects', () => {
      const data = {
        patient: {
          notes: 'Follow up with patient, SSN: 123-45-6789',
          contact: {
            email: 'patient@email.com',
            phone: '(303) 555-1234',
          },
        },
        clinical: {
          assessment: 'Osteoarthritis',
        },
      };

      const results = detector.detectInObject(data);
      expect(results.length).toBeGreaterThanOrEqual(2);
      const paths = results.map((r) => r.path);
      expect(paths.some((p) => p.includes('patient.notes'))).toBe(true);
      expect(paths.some((p) => p.includes('patient.contact.email'))).toBe(true);
    });

    it('handles arrays in structured data', () => {
      const data = {
        contacts: [
          { info: 'SSN: 111-22-3333' },
          { info: 'No PHI here' },
          { info: 'DOB: 05/20/1990' },
        ],
      };
      const results = detector.detectInObject(data);
      expect(results.length).toBeGreaterThanOrEqual(2);
    });
  });

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------

  describe('summary', () => {
    it('provides correct PHI type counts', () => {
      const result = detector.detect(
        'SSN: 123-45-6789, email: a@b.com, another SSN: 987-65-4321',
      );
      expect(result.summary['ssn']).toBe(2);
      expect(result.summary['email']).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // Sensitivity levels
  // ---------------------------------------------------------------------------

  describe('sensitivity levels', () => {
    it('strict mode catches more patterns', () => {
      const strictDetector = new PHIDetector({
        sensitivity: 'strict',
        includeValues: true,
      });
      const lenientDetector = new PHIDetector({
        sensitivity: 'lenient',
        includeValues: true,
      });

      const text = 'Visit https://portal.hospital.com/patient?id=12345';
      const strictResult = strictDetector.detect(text);
      const lenientResult = lenientDetector.detect(text);

      // Strict should catch URLs; lenient might not
      expect(strictResult.spans.length).toBeGreaterThanOrEqual(
        lenientResult.spans.length,
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Object redaction
  // ---------------------------------------------------------------------------

  describe('redactObject', () => {
    it('redacts PHI in an object while preserving structure', () => {
      const data = {
        name: 'Clinical note',
        ssn: 'SSN: 123-45-6789',
        age: 67,
      };
      const redacted = detector.redactObject(data);
      expect(redacted.ssn).toContain('[REDACTED:ssn]');
      expect(redacted.name).toBe('Clinical note');
      expect(redacted.age).toBe(67);
    });
  });
});
