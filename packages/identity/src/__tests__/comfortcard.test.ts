import { describe, it, expect } from 'vitest';
import {
  createComfortCard,
  generateQRPayload,
  verifyQRPayload,
  getAccessibleData,
  generateAppleWalletPass,
  type EmergencyInfo,
  type ComfortCard,
} from '../comfortcard.js';

// ---------------------------------------------------------------------------
// Test Fixtures
// ---------------------------------------------------------------------------

function makeEmergencyInfo(): EmergencyInfo {
  return {
    fullName: 'Margaret Johnson',
    dateOfBirth: '1958-03-15',
    bloodType: 'O+',
    allergies: ['Penicillin', 'Shellfish'],
    currentMedications: ['Lisinopril 10mg', 'Metformin 500mg'],
    emergencyContacts: [
      {
        name: 'Robert Johnson',
        relationship: 'Spouse',
        phone: '(303) 555-1234',
      },
    ],
    advanceDirectiveOnFile: true,
    dnrStatus: false,
    primaryPhysician: {
      name: 'Josh Emdur DO',
      phone: '(303) 555-0000',
      npi: '1649218389',
    },
    activeConditions: ['Hypertension', 'Type 2 Diabetes'],
  };
}

function makeCard(): ComfortCard {
  return createComfortCard({
    cardholderName: 'Margaret Johnson',
    memberId: 'member-001',
    membershipTier: 'founding_member',
    emergencyInfo: makeEmergencyInfo(),
  });
}

// ---------------------------------------------------------------------------
// Card Number Generation
// ---------------------------------------------------------------------------

describe('Card number format', () => {
  it('generates card number in XXXX-XXXX-XXXX format', () => {
    const card = makeCard();
    expect(card.cardNumber).toMatch(/^\d{4}-\d{4}-\d{4}$/);
  });

  it('generates unique card IDs', () => {
    const card1 = makeCard();
    const card2 = makeCard();
    expect(card1.cardId).not.toBe(card2.cardId);
  });

  it('card ID starts with "cc_" prefix', () => {
    const card = makeCard();
    expect(card.cardId).toMatch(/^cc_/);
  });
});

// ---------------------------------------------------------------------------
// Card Creation
// ---------------------------------------------------------------------------

describe('createComfortCard', () => {
  it('creates a card with all required fields', () => {
    const card = makeCard();
    expect(card.cardholderName).toBe('Margaret Johnson');
    expect(card.memberId).toBe('member-001');
    expect(card.membershipTier).toBe('founding_member');
    expect(card.isActive).toBe(true);
    expect(card.issuedAt).toBeTruthy();
    expect(card.expiresAt).toBeTruthy();
    expect(card.qrPayload).toBeTruthy();
  });

  it('assigns founding design variant for founding members', () => {
    const card = makeCard();
    expect(card.designVariant).toBe('founding');
  });

  it('assigns standard design variant for regular members', () => {
    const card = createComfortCard({
      cardholderName: 'Regular User',
      memberId: 'member-002',
      membershipTier: 'member',
      emergencyInfo: makeEmergencyInfo(),
    });
    expect(card.designVariant).toBe('standard');
  });

  it('adds founding badge for founding members', () => {
    const card = makeCard();
    const foundingBadge = card.badges.find((b) => b.id === 'founding');
    expect(foundingBadge).toBeDefined();
    expect(foundingBadge!.label).toBe('Founding Member');
    expect(foundingBadge!.category).toBe('membership');
  });

  it('adds advance directive badge when on file', () => {
    const card = makeCard();
    const adBadge = card.badges.find((b) => b.id === 'advance_directive');
    expect(adBadge).toBeDefined();
    expect(adBadge!.label).toBe('Advance Directive on File');
  });

  it('default validity is 2 years', () => {
    const card = makeCard();
    const issued = new Date(card.issuedAt);
    const expires = new Date(card.expiresAt);
    const yearDiff = expires.getFullYear() - issued.getFullYear();
    expect(yearDiff).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// QR Code Payload
// ---------------------------------------------------------------------------

describe('QR Payload', () => {
  it('generates valid QR payload structure', () => {
    const payload = generateQRPayload({
      cardId: 'cc_test123',
      memberId: 'member-001',
      accessTier: 'emergency',
      profileRef: 'profile:member-001',
    });

    expect(payload.version).toBe(1);
    expect(payload.cardId).toBe('cc_test123');
    expect(payload.memberId).toBe('member-001');
    expect(payload.accessTier).toBe('emergency');
    expect(payload.generatedAt).toBeTruthy();
    expect(payload.expiresAt).toBeTruthy();
    expect(payload.signature).toBeTruthy();
  });

  it('emergency QR has long TTL (1 year)', () => {
    const payload = generateQRPayload({
      cardId: 'cc_test',
      memberId: 'member-001',
      accessTier: 'emergency',
      profileRef: 'profile:member-001',
    });
    const generated = new Date(payload.generatedAt);
    const expires = new Date(payload.expiresAt);
    const diffMinutes = (expires.getTime() - generated.getTime()) / (60 * 1000);
    // 1 year = 525600 minutes
    expect(diffMinutes).toBeCloseTo(525600, -1);
  });

  it('full access QR has short TTL (5 minutes)', () => {
    const payload = generateQRPayload({
      cardId: 'cc_test',
      memberId: 'member-001',
      accessTier: 'full',
      profileRef: 'profile:member-001',
    });
    const generated = new Date(payload.generatedAt);
    const expires = new Date(payload.expiresAt);
    const diffMinutes = (expires.getTime() - generated.getTime()) / (60 * 1000);
    expect(diffMinutes).toBeCloseTo(5, 0);
  });

  it('emergency tier profileRef points to emergency data', () => {
    const payload = generateQRPayload({
      cardId: 'cc_test',
      memberId: 'member-001',
      accessTier: 'emergency',
      profileRef: 'profile:member-001',
    });
    expect(payload.profileRef).toBe('emergency:member-001');
  });

  it('full tier profileRef uses provided ref', () => {
    const payload = generateQRPayload({
      cardId: 'cc_test',
      memberId: 'member-001',
      accessTier: 'full',
      profileRef: 'profile:member-001',
    });
    expect(payload.profileRef).toBe('profile:member-001');
  });
});

// ---------------------------------------------------------------------------
// QR Verification
// ---------------------------------------------------------------------------

describe('verifyQRPayload', () => {
  it('valid non-expired QR passes verification', () => {
    const payload = generateQRPayload({
      cardId: 'cc_test',
      memberId: 'member-001',
      accessTier: 'emergency',
      profileRef: 'profile:member-001',
    });
    const result = verifyQRPayload(payload);
    expect(result.valid).toBe(true);
    expect(result.expired).toBe(false);
  });

  it('expired QR fails verification', () => {
    const payload = generateQRPayload({
      cardId: 'cc_test',
      memberId: 'member-001',
      accessTier: 'full',
      profileRef: 'profile:member-001',
      ttlMinutes: 0, // Immediately expired
    });
    // Manually backdate
    payload.expiresAt = new Date(Date.now() - 60000).toISOString();
    const result = verifyQRPayload(payload);
    expect(result.valid).toBe(false);
    expect(result.expired).toBe(true);
  });

  it('missing signature fails verification', () => {
    const payload = generateQRPayload({
      cardId: 'cc_test',
      memberId: 'member-001',
      accessTier: 'emergency',
      profileRef: 'profile:member-001',
    });
    payload.signature = '';
    const result = verifyQRPayload(payload);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('signature');
  });
});

// ---------------------------------------------------------------------------
// Access Tiers
// ---------------------------------------------------------------------------

describe('getAccessibleData', () => {
  const card = makeCard();

  it('emergency tier returns limited data without biometric', () => {
    const access = getAccessibleData(card, 'emergency');
    expect(access.tier).toBe('emergency');
    expect(access.requiresBiometric).toBe(false);
    expect(access.data.fullName).toBe('Margaret Johnson');
    expect(access.data.allergies).toEqual(['Penicillin', 'Shellfish']);
    expect(access.data.emergencyContacts).toHaveLength(1);
    expect(access.data.activeConditions).toEqual([
      'Hypertension',
      'Type 2 Diabetes',
    ]);
  });

  it('full access tier requires biometric authentication', () => {
    const access = getAccessibleData(card, 'full');
    expect(access.tier).toBe('full');
    expect(access.requiresBiometric).toBe(true);
    expect(access.data).toEqual(card.emergencyInfo);
  });
});

// ---------------------------------------------------------------------------
// Apple Wallet Pass
// ---------------------------------------------------------------------------

describe('generateAppleWalletPass', () => {
  it('generates correct Apple Wallet pass structure', () => {
    const card = makeCard();
    const pass = generateAppleWalletPass(card, 'TEAM123');

    expect(pass.formatVersion).toBe(1);
    expect(pass.passTypeIdentifier).toBe('pass.care.coop.comfortcard');
    expect(pass.serialNumber).toBe(card.cardId);
    expect(pass.teamIdentifier).toBe('TEAM123');
    expect(pass.organizationName).toBe('co-op.care');
    expect(pass.barcode.format).toBe('PKBarcodeFormatQR');
    expect(pass.barcode.message).toBe(card.qrPayload);
    expect(pass.backgroundColor).toContain('13, 115, 119'); // Teal
  });

  it('includes member name in primary fields', () => {
    const card = makeCard();
    const pass = generateAppleWalletPass(card, 'TEAM123');
    const nameField = pass.generic.primaryFields.find(
      (f) => f.key === 'member-name',
    );
    expect(nameField).toBeDefined();
    expect(nameField!.value).toBe('Margaret Johnson');
  });

  it('includes allergies in back fields', () => {
    const card = makeCard();
    const pass = generateAppleWalletPass(card, 'TEAM123');
    const allergiesField = pass.generic.backFields.find(
      (f) => f.key === 'allergies',
    );
    expect(allergiesField).toBeDefined();
    expect(allergiesField!.value).toContain('Penicillin');
    expect(allergiesField!.value).toContain('Shellfish');
  });
});
