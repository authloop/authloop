/**
 * End-to-end encryption for the keystroke relay.
 *
 * Uses ECDH (P-256) key exchange + AES-256-GCM via the Web Crypto API.
 * Works in Node 18+, Chrome extensions, and any environment with crypto.subtle.
 *
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

import createDebug from "debug";

const debug = createDebug("authloop:crypto");

// ---------------------------------------------------------------------------
// Portable base64 helpers (no Buffer, works in browser + Node)
// ---------------------------------------------------------------------------

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToUint8(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// ---------------------------------------------------------------------------
// E2EESession
// ---------------------------------------------------------------------------

export class E2EESession {
  private keyPair: CryptoKeyPair;
  private aesKey: CryptoKey | null = null;
  private _publicKey: string;

  /** Use `E2EESession.create()` instead of `new`. */
  private constructor(keyPair: CryptoKeyPair, publicKeyBase64: string) {
    this.keyPair = keyPair;
    this._publicKey = publicKeyBase64;
  }

  /**
   * Create a new E2EE session (generates an ECDH P-256 keypair).
   */
  static async create(): Promise<E2EESession> {
    const keyPair = await crypto.subtle.generateKey(
      { name: "ECDH", namedCurve: "P-256" },
      false, // not extractable — we only need to derive
      ["deriveBits"],
    );

    // Export public key as uncompressed point (same wire format as node:crypto)
    const rawPub = new Uint8Array(await crypto.subtle.exportKey("raw", keyPair.publicKey));
    const publicKeyBase64 = uint8ToBase64(rawPub);
    debug("generated keypair, public key: %s...", publicKeyBase64.slice(0, 20));

    return new E2EESession(keyPair, publicKeyBase64);
  }

  /** Our public key to send to the peer (base64-encoded uncompressed point). */
  get publicKey(): string {
    return this._publicKey;
  }

  /** Derive shared secret from the peer's public key. */
  async deriveSecret(peerPublicKeyBase64: string): Promise<void> {
    const rawBytes = base64ToUint8(peerPublicKeyBase64);

    // Import the peer's raw public key
    const peerKey = await crypto.subtle.importKey(
      "raw",
      rawBytes.buffer as ArrayBuffer,
      { name: "ECDH", namedCurve: "P-256" },
      false,
      [],
    );

    // Derive 256 bits of shared secret
    const secretBits = await crypto.subtle.deriveBits(
      { name: "ECDH", public: peerKey },
      this.keyPair.privateKey,
      256, // 32 bytes
    );

    // Import as AES-256-GCM key
    this.aesKey = await crypto.subtle.importKey(
      "raw",
      secretBits,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );

    debug("shared secret derived");
  }

  /** Check if key exchange is complete. */
  get ready(): boolean {
    return this.aesKey !== null;
  }

  /** Decrypt a message from the peer. */
  async decrypt(encrypted: { iv: string; ciphertext: string; tag: string }): Promise<string> {
    if (!this.aesKey) throw new Error("E2EE not ready — key exchange incomplete");

    const iv = base64ToUint8(encrypted.iv);
    const ciphertext = base64ToUint8(encrypted.ciphertext);
    const tag = base64ToUint8(encrypted.tag);

    // Web Crypto expects ciphertext + tag concatenated
    const combined = new Uint8Array(ciphertext.length + tag.length);
    combined.set(ciphertext);
    combined.set(tag, ciphertext.length);

    const plainBuf = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: iv as BufferSource, tagLength: 128 },
      this.aesKey,
      combined as BufferSource,
    );

    return new TextDecoder().decode(plainBuf);
  }

  /** Encrypt a message to the peer. */
  async encrypt(plaintext: string): Promise<{ iv: string; ciphertext: string; tag: string }> {
    if (!this.aesKey) throw new Error("E2EE not ready — key exchange incomplete");

    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encoded = new TextEncoder().encode(plaintext);

    const combined = new Uint8Array(
      await crypto.subtle.encrypt(
        { name: "AES-GCM", iv: iv as BufferSource, tagLength: 128 },
        this.aesKey,
        encoded as BufferSource,
      ),
    );

    // Web Crypto returns ciphertext + tag concatenated; split them
    const ciphertext = combined.subarray(0, combined.length - 16);
    const tag = combined.subarray(combined.length - 16);

    return {
      iv: uint8ToBase64(iv),
      ciphertext: uint8ToBase64(ciphertext),
      tag: uint8ToBase64(tag),
    };
  }
}
