import { describe, it, expect } from 'vitest';
import { EncryptionService } from '../encryption.js';

// ---------------------------------------------------------------------------
// Test Fixtures
// ---------------------------------------------------------------------------

const MASTER_KEY = EncryptionService.generateKey();
const MASTER_KEY_2 = EncryptionService.generateKey();

// ---------------------------------------------------------------------------
// Basic Encrypt / Decrypt
// ---------------------------------------------------------------------------

describe('EncryptionService', () => {
  it('encrypts and decrypts a string roundtrip', () => {
    const service = new EncryptionService({ masterKey: MASTER_KEY, keyVersion: 1 });
    const plaintext = 'Patient SSN: 123-45-6789';

    const encrypted = service.encrypt(plaintext);
    expect(encrypted.ciphertext).toBeTruthy();
    expect(encrypted.iv).toBeTruthy();
    expect(encrypted.authTag).toBeTruthy();
    expect(encrypted.algorithm).toBe('aes-256-gcm');
    expect(encrypted.keyVersion).toBe(1);

    const decrypted = service.decrypt(encrypted);
    expect(decrypted).toBe(plaintext);
  });

  it('different data produces different ciphertext', () => {
    const service = new EncryptionService({ masterKey: MASTER_KEY, keyVersion: 1 });

    const enc1 = service.encrypt('Patient A');
    const enc2 = service.encrypt('Patient B');
    expect(enc1.ciphertext).not.toBe(enc2.ciphertext);
  });

  it('same data produces different ciphertext (random IV)', () => {
    const service = new EncryptionService({ masterKey: MASTER_KEY, keyVersion: 1 });
    const enc1 = service.encrypt('Same text');
    const enc2 = service.encrypt('Same text');
    // Random IV should ensure different ciphertext each time
    expect(enc1.iv).not.toBe(enc2.iv);
    expect(enc1.ciphertext).not.toBe(enc2.ciphertext);
  });

  it('wrong key fails to decrypt', () => {
    const service1 = new EncryptionService({ masterKey: MASTER_KEY, keyVersion: 1 });
    const service2 = new EncryptionService({ masterKey: MASTER_KEY_2, keyVersion: 1 });

    const encrypted = service1.encrypt('Secret data');
    expect(() => service2.decrypt(encrypted)).toThrow();
  });

  // ---------------------------------------------------------------------------
  // Envelope Encryption
  // ---------------------------------------------------------------------------

  it('envelope encrypt/decrypt roundtrip', () => {
    const service = new EncryptionService({ masterKey: MASTER_KEY, keyVersion: 1 });
    const plaintext = 'Highly sensitive PHI data';

    const envelope = service.envelopeEncrypt(plaintext);
    expect(envelope.data.ciphertext).toBeTruthy();
    expect(envelope.encryptedDEK.ciphertext).toBeTruthy();

    const decrypted = service.envelopeDecrypt(envelope);
    expect(decrypted).toBe(plaintext);
  });

  // ---------------------------------------------------------------------------
  // Key Rotation
  // ---------------------------------------------------------------------------

  it('old data still decryptable with rotated keys', () => {
    // Encrypt with key version 1
    const service1 = new EncryptionService({ masterKey: MASTER_KEY, keyVersion: 1 });
    const encrypted = service1.encrypt('Data from version 1');

    // Create service with key version 2, but with version 1 as a previous key
    const service2 = new EncryptionService({
      masterKey: MASTER_KEY_2,
      keyVersion: 2,
      previousKeys: [{ version: 1, key: MASTER_KEY }],
    });

    // Should be able to decrypt old data
    const decrypted = service2.decrypt(encrypted);
    expect(decrypted).toBe('Data from version 1');

    // New data uses version 2
    const newEncrypted = service2.encrypt('Data from version 2');
    expect(newEncrypted.keyVersion).toBe(2);
    const newDecrypted = service2.decrypt(newEncrypted);
    expect(newDecrypted).toBe('Data from version 2');
  });

  it('rotatePayload re-encrypts with current key version', () => {
    const service1 = new EncryptionService({ masterKey: MASTER_KEY, keyVersion: 1 });
    const oldEncrypted = service1.encrypt('Rotate me');

    const service2 = new EncryptionService({
      masterKey: MASTER_KEY_2,
      keyVersion: 2,
      previousKeys: [{ version: 1, key: MASTER_KEY }],
    });

    const rotated = service2.rotatePayload(oldEncrypted);
    expect(rotated.keyVersion).toBe(2);

    const decrypted = service2.decrypt(rotated);
    expect(decrypted).toBe('Rotate me');
  });

  it('envelope rotation re-encrypts DEK without touching data', () => {
    const service1 = new EncryptionService({ masterKey: MASTER_KEY, keyVersion: 1 });
    const envelope = service1.envelopeEncrypt('Envelope data');

    const service2 = new EncryptionService({
      masterKey: MASTER_KEY_2,
      keyVersion: 2,
      previousKeys: [{ version: 1, key: MASTER_KEY }],
    });

    const rotated = service2.rotateEnvelope(envelope);
    // Data blob should be identical (same DEK, same ciphertext)
    expect(rotated.data.ciphertext).toBe(envelope.data.ciphertext);
    // DEK should be re-encrypted with new KEK
    expect(rotated.encryptedDEK.keyVersion).toBe(2);

    const decrypted = service2.envelopeDecrypt(rotated);
    expect(decrypted).toBe('Envelope data');
  });

  // ---------------------------------------------------------------------------
  // Object Encryption
  // ---------------------------------------------------------------------------

  it('encrypts and decrypts object string values', () => {
    const service = new EncryptionService({ masterKey: MASTER_KEY, keyVersion: 1 });
    const obj = { name: 'John Doe', ssn: '123-45-6789', age: 67 };

    const encrypted = service.encryptObject(obj);
    // String fields encrypted, number preserved
    expect(encrypted['age']).toBe(67);
    expect(typeof encrypted['name']).toBe('object');

    const decrypted = service.decryptObject(encrypted);
    expect(decrypted['name']).toBe('John Doe');
    expect(decrypted['ssn']).toBe('123-45-6789');
    expect(decrypted['age']).toBe(67);
  });

  // ---------------------------------------------------------------------------
  // Key Generation
  // ---------------------------------------------------------------------------

  it('generateKey returns a 64-character hex string', () => {
    const key = EncryptionService.generateKey();
    expect(key).toMatch(/^[0-9a-f]{64}$/);
  });

  it('generated keys are unique', () => {
    const key1 = EncryptionService.generateKey();
    const key2 = EncryptionService.generateKey();
    expect(key1).not.toBe(key2);
  });

  // ---------------------------------------------------------------------------
  // Error handling
  // ---------------------------------------------------------------------------

  it('throws when key version not available', () => {
    const service = new EncryptionService({ masterKey: MASTER_KEY, keyVersion: 1 });
    const encrypted = service.encrypt('test');
    // Manually change key version to something unavailable
    encrypted.keyVersion = 99;

    expect(() => service.decrypt(encrypted)).toThrow(/Key version 99 not available/);
  });
});
