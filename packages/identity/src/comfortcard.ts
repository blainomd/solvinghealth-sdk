/**
 * @solvinghealth/identity — ComfortCard Identity
 *
 * Digital identity card for co-op.care members. Generates card data,
 * QR code payloads, emergency/full access tiers, and Apple Wallet /
 * Google Pay pass formats.
 *
 * ComfortCard is a wallet tab inside the co-op.care app — not a separate site.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

export const AccessTierSchema = z.enum(['emergency', 'full']);
export type AccessTier = z.infer<typeof AccessTierSchema>;

export const CardBadgeSchema = z.object({
  /** Badge identifier */
  id: z.string(),
  /** Display label */
  label: z.string(),
  /** Badge category */
  category: z.enum([
    'membership',
    'health_status',
    'caregiver',
    'advance_directive',
    'insurance',
  ]),
  /** ISO date when badge was earned */
  earnedAt: z.string().datetime(),
  /** Optional expiration */
  expiresAt: z.string().datetime().optional(),
});
export type CardBadge = z.infer<typeof CardBadgeSchema>;

export const EmergencyInfoSchema = z.object({
  /** Full legal name */
  fullName: z.string(),
  /** Date of birth */
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** Blood type (if known) */
  bloodType: z.string().optional(),
  /** Known allergies */
  allergies: z.array(z.string()),
  /** Current medications */
  currentMedications: z.array(z.string()),
  /** Emergency contacts */
  emergencyContacts: z.array(z.object({
    name: z.string(),
    relationship: z.string(),
    phone: z.string(),
  })),
  /** Advance directive on file */
  advanceDirectiveOnFile: z.boolean(),
  /** DNR status */
  dnrStatus: z.boolean().optional(),
  /** Primary care physician */
  primaryPhysician: z.object({
    name: z.string(),
    phone: z.string(),
    npi: z.string().optional(),
  }).optional(),
  /** Active conditions (brief, for emergency use) */
  activeConditions: z.array(z.string()),
});
export type EmergencyInfo = z.infer<typeof EmergencyInfoSchema>;

export const ComfortCardSchema = z.object({
  /** Unique card identifier */
  cardId: z.string(),
  /** Card number (formatted: XXXX-XXXX-XXXX) */
  cardNumber: z.string(),
  /** Cardholder name */
  cardholderName: z.string(),
  /** Member ID (co-op.care membership) */
  memberId: z.string(),
  /** Membership tier */
  membershipTier: z.enum(['curious', 'member', 'founding_member', 'founding_investor']),
  /** Issued date */
  issuedAt: z.string().datetime(),
  /** Expiration date */
  expiresAt: z.string().datetime(),
  /** Active status */
  isActive: z.boolean(),
  /** Badges earned */
  badges: z.array(CardBadgeSchema),
  /** Emergency access info (available without biometric auth) */
  emergencyInfo: EmergencyInfoSchema,
  /** QR code data payload (encrypted reference to Living Profile) */
  qrPayload: z.string(),
  /** Card design variant */
  designVariant: z.enum(['standard', 'founding', 'caregiver']),
});
export type ComfortCard = z.infer<typeof ComfortCardSchema>;

export const QRPayloadSchema = z.object({
  /** Version of payload format */
  version: z.literal(1),
  /** Card ID */
  cardId: z.string(),
  /** Member ID */
  memberId: z.string(),
  /** Access tier this QR grants */
  accessTier: AccessTierSchema,
  /** Encrypted reference to Living Profile data */
  profileRef: z.string(),
  /** Timestamp of QR generation */
  generatedAt: z.string().datetime(),
  /** QR expiry (short-lived for security) */
  expiresAt: z.string().datetime(),
  /** HMAC signature for verification */
  signature: z.string(),
});
export type QRPayload = z.infer<typeof QRPayloadSchema>;

export const AppleWalletPassSchema = z.object({
  formatVersion: z.literal(1),
  passTypeIdentifier: z.string(),
  serialNumber: z.string(),
  teamIdentifier: z.string(),
  organizationName: z.literal('co-op.care'),
  description: z.string(),
  /** Generic pass style */
  generic: z.object({
    primaryFields: z.array(z.object({
      key: z.string(),
      label: z.string(),
      value: z.string(),
    })),
    secondaryFields: z.array(z.object({
      key: z.string(),
      label: z.string(),
      value: z.string(),
    })),
    auxiliaryFields: z.array(z.object({
      key: z.string(),
      label: z.string(),
      value: z.string(),
    })),
    backFields: z.array(z.object({
      key: z.string(),
      label: z.string(),
      value: z.string(),
    })),
  }),
  barcode: z.object({
    message: z.string(),
    format: z.literal('PKBarcodeFormatQR'),
    messageEncoding: z.literal('iso-8859-1'),
  }),
  backgroundColor: z.string(),
  foregroundColor: z.string(),
  labelColor: z.string(),
});
export type AppleWalletPass = z.infer<typeof AppleWalletPassSchema>;

// ---------------------------------------------------------------------------
// Card Generation
// ---------------------------------------------------------------------------

/**
 * Generate a unique card number in XXXX-XXXX-XXXX format.
 */
function generateCardNumber(): string {
  const segments: string[] = [];
  for (let i = 0; i < 3; i++) {
    const segment = Math.floor(1000 + Math.random() * 9000).toString();
    segments.push(segment);
  }
  return segments.join('-');
}

/**
 * Generate a unique card ID.
 */
function generateCardId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 10);
  return `cc_${timestamp}_${random}`;
}

/**
 * Create a new ComfortCard for a co-op.care member.
 *
 * @param params - Card creation parameters
 * @returns New ComfortCard
 */
export function createComfortCard(params: {
  cardholderName: string;
  memberId: string;
  membershipTier: ComfortCard['membershipTier'];
  emergencyInfo: EmergencyInfo;
  designVariant?: ComfortCard['designVariant'];
  validityYears?: number;
}): ComfortCard {
  const now = new Date();
  const validityYears = params.validityYears ?? 2;
  const expiresAt = new Date(now);
  expiresAt.setFullYear(expiresAt.getFullYear() + validityYears);

  const cardId = generateCardId();
  const cardNumber = generateCardNumber();

  // Generate QR payload (encrypted reference — in production, this would use
  // real encryption with the member's encryption key)
  const qrPayload = generateQRPayload({
    cardId,
    memberId: params.memberId,
    accessTier: 'emergency',
    profileRef: `profile:${params.memberId}`,
  });

  // Default badges based on tier
  const badges: CardBadge[] = [];
  if (params.membershipTier === 'founding_member' || params.membershipTier === 'founding_investor') {
    badges.push({
      id: 'founding',
      label: params.membershipTier === 'founding_investor' ? 'Founding Investor' : 'Founding Member',
      category: 'membership',
      earnedAt: now.toISOString(),
    });
  }

  if (params.emergencyInfo.advanceDirectiveOnFile) {
    badges.push({
      id: 'advance_directive',
      label: 'Advance Directive on File',
      category: 'advance_directive',
      earnedAt: now.toISOString(),
    });
  }

  return {
    cardId,
    cardNumber,
    cardholderName: params.cardholderName,
    memberId: params.memberId,
    membershipTier: params.membershipTier,
    issuedAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    isActive: true,
    badges,
    emergencyInfo: params.emergencyInfo,
    qrPayload: JSON.stringify(qrPayload),
    designVariant: params.designVariant ?? (
      params.membershipTier === 'founding_member' || params.membershipTier === 'founding_investor'
        ? 'founding'
        : 'standard'
    ),
  };
}

// ---------------------------------------------------------------------------
// QR Code Payload
// ---------------------------------------------------------------------------

/**
 * Generate a QR code data payload.
 *
 * The QR encodes an encrypted reference to the member's Living Profile.
 * Two access tiers:
 * - Emergency: Basic medical info (allergies, meds, contacts, DNR) — no auth needed
 * - Full: Complete Living Profile — requires biometric authentication
 *
 * @param params - Payload parameters
 * @returns QR payload object
 */
export function generateQRPayload(params: {
  cardId: string;
  memberId: string;
  accessTier: AccessTier;
  profileRef: string;
  ttlMinutes?: number;
}): QRPayload {
  const now = new Date();
  const ttlMinutes = params.ttlMinutes ?? (params.accessTier === 'emergency' ? 525600 : 5); // 1 year for emergency, 5 min for full
  const expiresAt = new Date(now.getTime() + ttlMinutes * 60 * 1000);

  // In production, this would be a real HMAC-SHA256 signature
  const signatureInput = `${params.cardId}:${params.memberId}:${params.accessTier}:${now.toISOString()}`;
  const signature = simpleHash(signatureInput);

  return {
    version: 1,
    cardId: params.cardId,
    memberId: params.memberId,
    accessTier: params.accessTier,
    profileRef: params.accessTier === 'emergency'
      ? `emergency:${params.memberId}`
      : params.profileRef,
    generatedAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    signature,
  };
}

/**
 * Verify a QR payload (check expiry and signature format).
 *
 * @param payload - The QR payload to verify
 * @returns Verification result
 */
export function verifyQRPayload(payload: QRPayload): {
  valid: boolean;
  expired: boolean;
  error?: string;
} {
  const now = new Date();
  const expiresAt = new Date(payload.expiresAt);

  if (now > expiresAt) {
    return { valid: false, expired: true, error: 'QR code has expired' };
  }

  if (!payload.signature || payload.signature.length === 0) {
    return { valid: false, expired: false, error: 'Missing signature' };
  }

  // In production, verify HMAC-SHA256 with server key
  return { valid: true, expired: false };
}

/**
 * Get the data accessible for a given access tier.
 *
 * @param card - The ComfortCard
 * @param tier - Access tier
 * @returns Data available at this tier
 */
export function getAccessibleData(
  card: ComfortCard,
  tier: AccessTier,
): {
  name: string;
  tier: AccessTier;
  data: Partial<EmergencyInfo>;
  requiresBiometric: boolean;
} {
  if (tier === 'emergency') {
    return {
      name: card.cardholderName,
      tier: 'emergency',
      requiresBiometric: false,
      data: {
        fullName: card.emergencyInfo.fullName,
        dateOfBirth: card.emergencyInfo.dateOfBirth,
        bloodType: card.emergencyInfo.bloodType,
        allergies: card.emergencyInfo.allergies,
        currentMedications: card.emergencyInfo.currentMedications,
        emergencyContacts: card.emergencyInfo.emergencyContacts,
        advanceDirectiveOnFile: card.emergencyInfo.advanceDirectiveOnFile,
        dnrStatus: card.emergencyInfo.dnrStatus,
        activeConditions: card.emergencyInfo.activeConditions,
      },
    };
  }

  // Full access — requires biometric auth
  return {
    name: card.cardholderName,
    tier: 'full',
    requiresBiometric: true,
    data: card.emergencyInfo,
  };
}

// ---------------------------------------------------------------------------
// Apple Wallet / Google Pay
// ---------------------------------------------------------------------------

/**
 * Generate an Apple Wallet pass structure for a ComfortCard.
 *
 * NOTE: Actual .pkpass file generation requires signing with Apple
 * developer certificates. This generates the pass.json structure.
 *
 * @param card - The ComfortCard
 * @param teamIdentifier - Apple Developer Team ID
 * @returns Apple Wallet pass.json structure
 */
export function generateAppleWalletPass(
  card: ComfortCard,
  teamIdentifier: string,
): AppleWalletPass {
  return {
    formatVersion: 1,
    passTypeIdentifier: 'pass.care.coop.comfortcard',
    serialNumber: card.cardId,
    teamIdentifier,
    organizationName: 'co-op.care',
    description: 'ComfortCard Health Identity',
    generic: {
      primaryFields: [{
        key: 'member-name',
        label: 'MEMBER',
        value: card.cardholderName,
      }],
      secondaryFields: [
        {
          key: 'card-number',
          label: 'CARD NUMBER',
          value: card.cardNumber,
        },
        {
          key: 'member-since',
          label: 'MEMBER SINCE',
          value: new Date(card.issuedAt).toLocaleDateString('en-US', {
            month: 'short',
            year: 'numeric',
          }),
        },
      ],
      auxiliaryFields: [
        {
          key: 'tier',
          label: 'TIER',
          value: card.membershipTier.replace('_', ' ').toUpperCase(),
        },
        {
          key: 'advance-directive',
          label: 'ADVANCE DIRECTIVE',
          value: card.emergencyInfo.advanceDirectiveOnFile ? 'ON FILE' : 'NOT ON FILE',
        },
      ],
      backFields: [
        {
          key: 'allergies',
          label: 'ALLERGIES',
          value: card.emergencyInfo.allergies.length > 0
            ? card.emergencyInfo.allergies.join(', ')
            : 'None known',
        },
        {
          key: 'medications',
          label: 'CURRENT MEDICATIONS',
          value: card.emergencyInfo.currentMedications.length > 0
            ? card.emergencyInfo.currentMedications.join(', ')
            : 'None',
        },
        {
          key: 'emergency-contacts',
          label: 'EMERGENCY CONTACTS',
          value: card.emergencyInfo.emergencyContacts
            .map((c) => `${c.name} (${c.relationship}): ${c.phone}`)
            .join('\n'),
        },
        {
          key: 'conditions',
          label: 'ACTIVE CONDITIONS',
          value: card.emergencyInfo.activeConditions.length > 0
            ? card.emergencyInfo.activeConditions.join(', ')
            : 'None documented',
        },
      ],
    },
    barcode: {
      message: card.qrPayload,
      format: 'PKBarcodeFormatQR',
      messageEncoding: 'iso-8859-1',
    },
    // co-op.care brand colors
    backgroundColor: 'rgb(13, 115, 119)',  // Teal #0D7377
    foregroundColor: 'rgb(255, 255, 255)',
    labelColor: 'rgb(200, 230, 231)',
  };
}

/**
 * Generate a Google Pay pass structure (SaveToAndroidPay JWT payload).
 *
 * @param card - The ComfortCard
 * @param issuerId - Google Pay API issuer ID
 * @returns Google Pay generic pass object
 */
export function generateGooglePayPass(
  card: ComfortCard,
  issuerId: string,
): Record<string, unknown> {
  return {
    iss: issuerId,
    aud: 'google',
    typ: 'savetowallet',
    iat: Math.floor(Date.now() / 1000),
    payload: {
      genericObjects: [{
        id: `${issuerId}.${card.cardId}`,
        classId: `${issuerId}.comfortcard`,
        genericType: 'GENERIC_TYPE_UNSPECIFIED',
        hexBackgroundColor: '#0D7377',
        logo: {
          sourceUri: { uri: 'https://co-op.care/logo.png' },
        },
        cardTitle: { defaultValue: { language: 'en', value: 'ComfortCard' } },
        subheader: { defaultValue: { language: 'en', value: 'co-op.care' } },
        header: { defaultValue: { language: 'en', value: card.cardholderName } },
        barcode: {
          type: 'QR_CODE',
          value: card.qrPayload,
        },
        textModulesData: [
          { id: 'card-number', header: 'Card Number', body: card.cardNumber },
          { id: 'tier', header: 'Membership', body: card.membershipTier.replace('_', ' ') },
          { id: 'allergies', header: 'Allergies', body: card.emergencyInfo.allergies.join(', ') || 'None known' },
        ],
      }],
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Simple hash function for development use.
 * In production, replace with HMAC-SHA256.
 */
function simpleHash(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(36).padStart(8, '0');
}
