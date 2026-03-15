/**
 * End-to-end encryption for the keystroke relay.
 *
 * Uses ECDH (P-256) key exchange + AES-256-GCM.
 * The relay only sees ciphertext — it cannot read passwords or OTPs.
 *
 * Flow:
 *   1. MCP generates ECDH P-256 keypair, sends public key to viewer via relay
 *   2. Viewer generates ECDH P-256 keypair, sends public key to MCP via relay
 *   3. Both sides derive the same shared secret using ECDH
 *   4. Viewer encrypts input events with AES-256-GCM before sending
 *   5. MCP decrypts input events after receiving
 *   6. Frames (screenshots) are NOT encrypted — they show visible page content only
 */

import { createECDH, createDecipheriv, createCipheriv, randomBytes } from "node:crypto";
import createDebug from "debug";

const debug = createDebug("authloop:crypto");

export class E2EESession {
  private ecdh = createECDH("prime256v1");
  private sharedSecret: Buffer | null = null;
  private _publicKey: string;

  constructor() {
    this.ecdh.generateKeys();
    this._publicKey = this.ecdh.getPublicKey("base64");
    debug("generated keypair, public key: %s...", this._publicKey.slice(0, 20));
  }

  /** Our public key to send to the viewer */
  get publicKey(): string {
    return this._publicKey;
  }

  /** Derive shared secret from the viewer's public key */
  deriveSecret(viewerPublicKey: string): void {
    const secret = this.ecdh.computeSecret(Buffer.from(viewerPublicKey, "base64"));
    // Use first 32 bytes as AES-256 key
    this.sharedSecret = secret.subarray(0, 32);
    debug("shared secret derived");
  }

  /** Check if key exchange is complete */
  get ready(): boolean {
    return this.sharedSecret !== null;
  }

  /** Decrypt a message from the viewer */
  decrypt(encrypted: { iv: string; ciphertext: string; tag: string }): string {
    if (!this.sharedSecret) throw new Error("E2EE not ready — key exchange incomplete");

    const iv = Buffer.from(encrypted.iv, "base64");
    const ciphertext = Buffer.from(encrypted.ciphertext, "base64");
    const tag = Buffer.from(encrypted.tag, "base64");

    const decipher = createDecipheriv("aes-256-gcm", this.sharedSecret, iv);
    decipher.setAuthTag(tag);

    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return decrypted.toString("utf8");
  }

  /** Encrypt a message to the viewer (for testing / future use) */
  encrypt(plaintext: string): { iv: string; ciphertext: string; tag: string } {
    if (!this.sharedSecret) throw new Error("E2EE not ready — key exchange incomplete");

    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.sharedSecret, iv);

    const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();

    return {
      iv: iv.toString("base64"),
      ciphertext: ciphertext.toString("base64"),
      tag: tag.toString("base64"),
    };
  }
}
