import { describe, it, expect } from 'vitest';
import {
  validateClaim,
  generateClaim,
  calculateNetRevenue,
  validateNPIChecksum,
  MEMBER_TRANSACTION_FEE_DOLLARS,
  NON_MEMBER_TRANSACTION_FEE_DOLLARS,
  type CMS1500Claim,
} from '../claims.js';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function makeValidClaim(overrides: Partial<CMS1500Claim> = {}): CMS1500Claim {
  return {
    claimId: 'CLM-TEST-001',
    patient: {
      lastName: 'Smith',
      firstName: 'Jane',
      dateOfBirth: '1958-03-15',
      sex: 'F',
      address: {
        street: '123 Main St',
        city: 'Boulder',
        state: 'CO',
        zip: '80302',
      },
      insuranceId: '1EG4-TE5-MK72',
    },
    insuranceType: 'Medicare',
    renderingProvider: {
      npi: '1234567893',
      lastName: 'Emdur',
      firstName: 'Josh',
      credential: 'DO',
      taxId: '12-3456789',
      taxIdType: 'EIN',
    },
    billingProvider: {
      npi: '1234567893',
      name: 'SolvingHealth Orthopedic Clinic',
      address: {
        street: '456 Pearl St',
        city: 'Boulder',
        state: 'CO',
        zip: '80302',
      },
      taxId: '12-3456789',
      phone: '303-555-0100',
    },
    diagnosisCodes: ['M17.11'],
    lines: [
      {
        lineNumber: 1,
        procedureCode: '99490',
        modifiers: [],
        diagnosisPointers: [1],
        dateOfService: '2026-04-01',
        placeOfService: '11',
        units: 1,
        chargeDollars: 64.15,
      },
    ],
    dateOfService: '2026-04-01',
    acceptAssignment: true,
    totalChargeDollars: 64.15,
    ...overrides,
  };
}

describe('NPI Validation (Luhn Algorithm)', () => {
  it('validates a known valid NPI (1234567893)', () => {
    expect(validateNPIChecksum('1234567893')).toBe(true);
  });

  it('rejects NPI with wrong check digit', () => {
    expect(validateNPIChecksum('1234567890')).toBe(false);
  });

  it('rejects NPI that is too short', () => {
    expect(validateNPIChecksum('123456')).toBe(false);
  });

  it('rejects NPI that is too long', () => {
    expect(validateNPIChecksum('12345678901')).toBe(false);
  });

  it('rejects NPI with non-numeric characters', () => {
    expect(validateNPIChecksum('123456789A')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(validateNPIChecksum('')).toBe(false);
  });

  it('validates another known valid NPI (1497758544)', () => {
    // This is a commonly referenced test NPI
    expect(validateNPIChecksum('1497758544')).toBe(true);
  });
});

describe('CMS-1500 Claim Generation', () => {
  it('generates a claim with correct structure', () => {
    const claim = generateClaim({
      claimId: 'CLM-GEN-001',
      patient: {
        lastName: 'Smith',
        firstName: 'Jane',
        dateOfBirth: '1958-03-15',
        sex: 'F',
        address: { street: '123 Main St', city: 'Boulder', state: 'CO', zip: '80302' },
        insuranceId: '1EG4-TE5-MK72',
      },
      renderingProvider: {
        npi: '1234567893',
        lastName: 'Emdur',
        firstName: 'Josh',
        credential: 'DO',
        taxId: '12-3456789',
        taxIdType: 'EIN',
      },
      billingProvider: {
        npi: '1234567893',
        name: 'SolvingHealth Orthopedic Clinic',
        address: { street: '456 Pearl St', city: 'Boulder', state: 'CO', zip: '80302' },
        taxId: '12-3456789',
        phone: '303-555-0100',
      },
      diagnosisCodes: ['M17.11'],
      procedureCodes: ['99490', '98977'],
      dateOfService: '2026-04-01',
    });

    expect(claim.claimId).toBe('CLM-GEN-001');
    expect(claim.lines.length).toBe(2);
    expect(claim.lines[0]!.procedureCode).toBe('99490');
    expect(claim.lines[1]!.procedureCode).toBe('98977');
    expect(claim.acceptAssignment).toBe(true);
    expect(claim.insuranceType).toBe('Medicare');
  });

  it('auto-calculates total charge from line items', () => {
    const claim = generateClaim({
      claimId: 'CLM-GEN-002',
      patient: {
        lastName: 'Smith',
        firstName: 'Jane',
        dateOfBirth: '1958-03-15',
        sex: 'F',
        address: { street: '123 Main', city: 'Boulder', state: 'CO', zip: '80302' },
        insuranceId: '1EG4',
      },
      renderingProvider: {
        npi: '1234567893',
        lastName: 'Emdur',
        firstName: 'Josh',
        taxId: '12-3456789',
        taxIdType: 'EIN',
      },
      billingProvider: {
        npi: '1234567893',
        name: 'Clinic',
        address: { street: '456 Pearl', city: 'Boulder', state: 'CO', zip: '80302' },
        taxId: '12-3456789',
        phone: '303-555-0100',
      },
      diagnosisCodes: ['M17.11'],
      procedureCodes: ['99490'],
      dateOfService: '2026-04-01',
    });

    const lineTotal = claim.lines.reduce((s, l) => s + l.chargeDollars * l.units, 0);
    expect(claim.totalChargeDollars).toBe(lineTotal);
  });

  it('defaults place of service to office (11)', () => {
    const claim = generateClaim({
      claimId: 'CLM-GEN-003',
      patient: {
        lastName: 'Doe',
        firstName: 'John',
        dateOfBirth: '1965-01-01',
        sex: 'M',
        address: { street: '1 St', city: 'Denver', state: 'CO', zip: '80201' },
        insuranceId: 'MED123',
      },
      renderingProvider: {
        npi: '1234567893',
        lastName: 'Emdur',
        firstName: 'Josh',
        taxId: '12-3456789',
        taxIdType: 'EIN',
      },
      billingProvider: {
        npi: '1234567893',
        name: 'Clinic',
        address: { street: '2 St', city: 'Denver', state: 'CO', zip: '80201' },
        taxId: '12-3456789',
        phone: '303-555-0100',
      },
      diagnosisCodes: ['M17.11'],
      procedureCodes: ['99490'],
      dateOfService: '2026-04-01',
    });
    expect(claim.lines[0]!.placeOfService).toBe('11');
  });
});

describe('Claim Validation', () => {
  it('valid claim passes validation', () => {
    const claim = makeValidClaim();
    const result = validateClaim(claim, true);
    expect(result.valid).toBe(true);
    expect(result.errors.filter((e) => e.severity === 'error').length).toBe(0);
  });

  it('catches invalid NPI on rendering provider', () => {
    const claim = makeValidClaim({
      renderingProvider: {
        npi: '1234567890', // invalid check digit
        lastName: 'Bad',
        firstName: 'NPI',
        taxId: '12-3456789',
        taxIdType: 'EIN',
      },
    });
    const result = validateClaim(claim);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === 'renderingProvider.npi')).toBe(true);
  });

  it('catches mismatched total charge', () => {
    const claim = makeValidClaim({ totalChargeDollars: 999.99 });
    const result = validateClaim(claim);
    expect(result.errors.some((e) => e.field === 'totalChargeDollars')).toBe(true);
  });

  it('warns on zero charge amount', () => {
    const claim = makeValidClaim({
      lines: [
        {
          lineNumber: 1,
          procedureCode: '99490',
          modifiers: [],
          diagnosisPointers: [1],
          dateOfService: '2026-04-01',
          placeOfService: '11',
          units: 1,
          chargeDollars: 0,
        },
      ],
      totalChargeDollars: 0,
    });
    const result = validateClaim(claim);
    expect(result.errors.some((e) => e.severity === 'warning' && e.message.includes('$0.00'))).toBe(
      true,
    );
  });

  it('Medicare claims must accept assignment', () => {
    const claim = makeValidClaim({ acceptAssignment: false });
    const result = validateClaim(claim);
    expect(result.errors.some((e) => e.message.includes('accept assignment'))).toBe(true);
  });

  it('catches invalid diagnosis pointer', () => {
    const claim = makeValidClaim({
      lines: [
        {
          lineNumber: 1,
          procedureCode: '99490',
          modifiers: [],
          diagnosisPointers: [5], // only 1 diagnosis, pointer to index 5 is invalid
          dateOfService: '2026-04-01',
          placeOfService: '11',
          units: 1,
          chargeDollars: 64.15,
        },
      ],
    });
    const result = validateClaim(claim);
    expect(
      result.errors.some((e) => e.message.includes('Diagnosis pointer')),
    ).toBe(true);
  });
});

describe('Flat Fee Calculation (AKS Compliance)', () => {
  it('member fee is $15', () => {
    expect(MEMBER_TRANSACTION_FEE_DOLLARS).toBe(15);
  });

  it('non-member fee is $25', () => {
    expect(NON_MEMBER_TRANSACTION_FEE_DOLLARS).toBe(25);
  });

  it('validateClaim returns member fee type when isMember=true', () => {
    const claim = makeValidClaim();
    const result = validateClaim(claim, true);
    expect(result.platformFee.type).toBe('member');
    expect(result.platformFee.feeDollars).toBe(15);
  });

  it('validateClaim returns non-member fee type when isMember=false', () => {
    const claim = makeValidClaim();
    const result = validateClaim(claim, false);
    expect(result.platformFee.type).toBe('non-member');
    expect(result.platformFee.feeDollars).toBe(25);
  });

  it('fee is flat, not percentage-based', () => {
    // Verify the fee does not change based on claim amount
    const smallClaim = makeValidClaim({
      lines: [
        {
          lineNumber: 1,
          procedureCode: '99490',
          modifiers: [],
          diagnosisPointers: [1],
          dateOfService: '2026-04-01',
          placeOfService: '11',
          units: 1,
          chargeDollars: 64.15,
        },
      ],
      totalChargeDollars: 64.15,
    });
    const largeClaim = makeValidClaim({
      lines: [
        {
          lineNumber: 1,
          procedureCode: '99496',
          modifiers: [],
          diagnosisPointers: [1],
          dateOfService: '2026-04-01',
          placeOfService: '11',
          units: 1,
          chargeDollars: 234.50,
        },
      ],
      totalChargeDollars: 234.50,
    });

    const smallResult = validateClaim(smallClaim, true);
    const largeResult = validateClaim(largeClaim, true);

    // Fee must be identical regardless of claim amount (AKS compliance)
    expect(smallResult.platformFee.feeDollars).toBe(largeResult.platformFee.feeDollars);
    expect(smallResult.platformFee.feeDollars).toBe(15);
  });
});

describe('Net Revenue Calculation', () => {
  it('calculates net for member', () => {
    const result = calculateNetRevenue(234.50, true);
    expect(result.grossReimbursement).toBe(234.50);
    expect(result.platformFee).toBe(15);
    expect(result.netToSurgeon).toBe(219.50);
    expect(result.feeType).toContain('Flat');
    expect(result.feeType).toContain('NOT percentage');
  });

  it('calculates net for non-member', () => {
    const result = calculateNetRevenue(234.50, false);
    expect(result.platformFee).toBe(25);
    expect(result.netToSurgeon).toBe(209.50);
  });

  it('net revenue is always gross minus flat fee', () => {
    const amounts = [50, 100, 500, 1000];
    for (const amount of amounts) {
      const member = calculateNetRevenue(amount, true);
      expect(member.netToSurgeon).toBe(amount - 15);
      const nonMember = calculateNetRevenue(amount, false);
      expect(nonMember.netToSurgeon).toBe(amount - 25);
    }
  });
});
