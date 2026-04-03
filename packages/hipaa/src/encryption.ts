/**
 * @solvinghealth/hipaa -- AES-256-GCM Encryption for PHI
 *
 * Provides envelope encryption for PHI at rest:
 * - Data Encryption Key (DEK): random per-record AES-256-GCM key
 * - Key Encryption Key (KEK): master key that encrypts DEKs
 *
 * This pattern enables key rotation without re-encrypting all data:
 * only the DEK envelopes need re-encryption when rotating the KEK.
 *
 * @module @solvinghealth/hipaa/encryption
 * @license MIT
 */

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  createHash,
  scryptSync,
} from 'node:crypto';
import { z } from 'zod';

// ─── Types ──────────────────────────────────────────────────

/** Encrypted payload with metadata needed for decryption */
export interface EncryptedPayload {
  /** Base64-encoded ciphertext */
  ciphertext: string;
  /** Base64-encoded initialization vector (12 bytes for GCM) */
  iv: string;
  /** Base64-encoded authentication tag (16 bytes for GCM) */
  authTag: string;
  /** Key version used for encryption (for key rotation) */
  keyVersion: number;
  /** Algorithm identifier */
  algorithm: 'aes-256-gcm';
}

/** Envelope-encrypted payload -- DEK is encrypted by KEK */
export interface EnvelopeEncryptedPayload {
  /** The encrypted data (encrypted by DEK) */
  data: EncryptedPayload;
  /** The DEK encrypted by KEK */
  encryptedDEK: EncryptedPayload;
}

/** Configuration for the encryption service */
export const EncryptionConfigSchema = z.object({
  /** Master key (KEK) as hex string -- must be 64 hex chars (32 bytes) */
  masterKey: z.string().min(32, 'Master key must be at least 32 characters'),
  /** Current key version (increment on rotation) */
  keyVersion: z.number().int().positive().default(1),
  /** Previous keys for decryption during rotation (hex strings) */
  previousKeys: z.array(z.object({
    version: z.number().int().positive(),
    key: z.string().min(32),
  })).optional(),
});

export type EncryptionConfig = z.infer<typeof EncryptionConfigSchema>;

// ─── Key Derivation ─────────────────────────────────────────

/**
 * Derive a 256-bit key from a master key string using scrypt.
 * This allows using human-readable passwords/passphrases as master keys.
 */
function deriveKey(masterKey: string): Buffer {
  // If the key is already 64 hex chars, use it directly
  if (/^[0-9a-f]{64}$/i.test(masterKey)) {
    return Buffer.from(masterKey, 'hex');
  }

  // Otherwise, derive using scrypt with a fixed salt
  // (The salt is fixed because we need deterministic derivation for the same key)
  const salt = createHash('sha256').update('solvinghealth-kek-salt').digest();
  return scryptSync(masterKey, salt, 32, { N: 16384, r: 8, p: 1 });
}

// ─── Core Encryption Functions ──────────────────────────────

/**
 * Encrypt plaintext using AES-256-GCM.
 *
 * @param plaintext - The data to encrypt
 * @param key - 32-byte encryption key
 * @param keyVersion - Key version number for tracking
 * @returns Encrypted payload with IV and auth tag
 */
function encryptWithKey(plaintext: Buffer, key: Buffer, keyVersion: number): EncryptedPayload {
  const iv = randomBytes(12); // 96-bit IV for GCM
  const cipher = createCipheriv('aes-256-gcm', key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext),
    cipher.final(),
  ]);

  const authTag = cipher.getAuthTag();

  return {
    ciphertext: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
    keyVersion,
    algorithm: 'aes-256-gcm',
  };
}

/**
 * Decrypt an AES-256-GCM encrypted payload.
 *
 * @param payload - The encrypted payload
 * @param key - 32-byte decryption key
 * @returns Decrypted plaintext buffer
 * @throws Error if authentication fails (tampered data)
 */
function decryptWithKey(payload: EncryptedPayload, key: Buffer): Buffer {
  const iv = Buffer.from(payload.iv, 'base64');
  const ciphertext = Buffer.from(payload.ciphertext, 'base64');
  const authTag = Buffer.from(payload.authTag, 'base64');

  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);

  return Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);
}

// ─── Encryption Service ─────────────────────────────────────

/**
 * AES-256-GCM encryption service with envelope encryption and key rotation.
 *
 * Uses a two-layer key hierarchy:
 * - KEK (Key Encryption Key): your master key, used to encrypt DEKs
 * - DEK (Data Encryption Key): random per-record key, used to encrypt data
 *
 * This pattern means key rotation only requires re-encrypting DEKs,
 * not re-encrypting all your data.
 *
 * @example
 * ```typescript
 * const enc = new EncryptionService({
 *   masterKey: process.env.ENCRYPTION_KEY!,
 *   keyVersion: 1,
 * });
 *
 * // Simple encryption
 * const encrypted = enc.encrypt('Patient SSN: 123-45-6789');
 * const decrypted = enc.decrypt(encrypted);
 *
 * // Envelope encryption (recommended for PHI)
 * const envelope = enc.envelopeEncrypt('Sensitive patient data');
 * const original = enc.envelopeDecrypt(envelope);
 *
 * // Encrypt structured data
 * const encObj = enc.encryptObject({ name: 'John', ssn: '123-45-6789' });
 * const decObj = enc.decryptObject(encObj);
 * ```
 */
export class EncryptionService {
  private readonly kek: Buffer;
  private readonly keyVersion: number;
  private readonly previousKeys: Map<number, Buffer>;

  constructor(config: EncryptionConfig) {
    const validated = EncryptionConfigSchema.parse(config);

    this.kek = deriveKey(validated.masterKey);
    this.keyVersion = validated.keyVersion;

    this.previousKeys = new Map();
    if (validated.previousKeys) {
      for (const prev of validated.previousKeys) {
        this.previousKeys.set(prev.version, deriveKey(prev.key));
      }
    }
    // Current key is also available for decryption
    this.previousKeys.set(this.keyVersion, this.kek);
  }

  /**
   * Encrypt a string using the current KEK directly.
   * For higher security, use envelopeEncrypt() instead.
   *
   * @param plaintext - The string to encrypt
   * @returns Encrypted payload
   */
  encrypt(plaintext: string): EncryptedPayload {
    return encryptWithKey(
      Buffer.from(plaintext, 'utf-8'),
      this.kek,
      this.keyVersion,
    );
  }

  /**
   * Decrypt an encrypted payload.
   * Automatically selects the correct key version.
   *
   * @param payload - The encrypted payload
   * @returns Decrypted string
   * @throws Error if the key version is not available or auth fails
   */
  decrypt(payload: EncryptedPayload): string {
    const key = this.previousKeys.get(payload.keyVersion);
    if (!key) {
      throw new Error(
        `Key version ${payload.keyVersion} not available. ` +
        `Available versions: ${[...this.previousKeys.keys()].join(', ')}`
      );
    }

    return decryptWithKey(payload, key).toString('utf-8');
  }

  /**
   * Encrypt using envelope encryption pattern.
   *
   * 1. Generate a random DEK
   * 2. Encrypt the data with the DEK
   * 3. Encrypt the DEK with the KEK
   * 4. Return both encrypted blobs
   *
   * This is the recommended pattern for PHI at rest.
   *
   * @param plaintext - The string to encrypt
   * @returns Envelope with encrypted data and encrypted DEK
   */
  envelopeEncrypt(plaintext: string): EnvelopeEncryptedPayload {
    // Generate random DEK
    const dek = randomBytes(32);

    // Encrypt data with DEK
    const data = encryptWithKey(
      Buffer.from(plaintext, 'utf-8'),
      dek,
      this.keyVersion,
    );

    // Encrypt DEK with KEK
    const encryptedDEK = encryptWithKey(
      dek,
      this.kek,
      this.keyVersion,
    );

    return { data, encryptedDEK };
  }

  /**
   * Decrypt an envelope-encrypted payload.
   *
   * 1. Decrypt the DEK using the KEK
   * 2. Decrypt the data using the DEK
   *
   * @param envelope - The envelope-encrypted payload
   * @returns Decrypted string
   */
  envelopeDecrypt(envelope: EnvelopeEncryptedPayload): string {
    // Get the correct KEK for this key version
    const kek = this.previousKeys.get(envelope.encryptedDEK.keyVersion);
    if (!kek) {
      throw new Error(
        `Key version ${envelope.encryptedDEK.keyVersion} not available for DEK decryption`
      );
    }

    // Decrypt DEK
    const dek = decryptWithKey(envelope.encryptedDEK, kek);

    // Decrypt data with DEK
    return decryptWithKey(envelope.data, dek).toString('utf-8');
  }

  /**
   * Encrypt each value in an object. Keys are preserved in plaintext.
   * Only encrypts string values; non-string values are passed through.
   *
   * @param obj - Object with string values to encrypt
   * @returns Object with encrypted values
   */
  encryptObject<T extends Record<string, unknown>>(obj: T): Record<string, EncryptedPayload | unknown> {
    const result: Record<string, EncryptedPayload | unknown> = {};

    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === 'string') {
        result[key] = this.encrypt(value);
      } else {
        result[key] = value;
      }
    }

    return result;
  }

  /**
   * Decrypt each encrypted value in an object.
   *
   * @param obj - Object with EncryptedPayload values
   * @returns Object with decrypted string values
   */
  decryptObject(obj: Record<string, EncryptedPayload | unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(obj)) {
      if (isEncryptedPayload(value)) {
        result[key] = this.decrypt(value);
      } else {
        result[key] = value;
      }
    }

    return result;
  }

  /**
   * Re-encrypt a payload with the current key version.
   * Use this during key rotation to update old payloads.
   *
   * @param payload - Payload encrypted with an old key
   * @returns Payload re-encrypted with the current key
   */
  rotatePayload(payload: EncryptedPayload): EncryptedPayload {
    const plaintext = this.decrypt(payload);
    return this.encrypt(plaintext);
  }

  /**
   * Re-encrypt an envelope payload with the current KEK.
   * Only re-encrypts the DEK wrapper, not the data itself.
   *
   * @param envelope - Envelope encrypted with an old KEK
   * @returns Envelope with DEK re-encrypted under current KEK
   */
  rotateEnvelope(envelope: EnvelopeEncryptedPayload): EnvelopeEncryptedPayload {
    // Decrypt the DEK
    const oldKek = this.previousKeys.get(envelope.encryptedDEK.keyVersion);
    if (!oldKek) {
      throw new Error(`Key version ${envelope.encryptedDEK.keyVersion} not available`);
    }
    const dek = decryptWithKey(envelope.encryptedDEK, oldKek);

    // Re-encrypt DEK with current KEK
    const newEncryptedDEK = encryptWithKey(dek, this.kek, this.keyVersion);

    return {
      data: envelope.data, // Data stays the same (encrypted by same DEK)
      encryptedDEK: newEncryptedDEK,
    };
  }

  /**
   * Generate a new random encryption key (hex string).
   * Use this when you need to create a new master key.
   *
   * @returns 64-character hex string (256 bits)
   */
  static generateKey(): string {
    return randomBytes(32).toString('hex');
  }
}

// ─── Type Guard ─────────────────────────────────────────────

function isEncryptedPayload(value: unknown): value is EncryptedPayload {
  return (
    typeof value === 'object' &&
    value !== null &&
    'ciphertext' in value &&
    'iv' in value &&
    'authTag' in value &&
    'algorithm' in value &&
    (value as EncryptedPayload).algorithm === 'aes-256-gcm'
  );
}
