import { describe, it, expect } from "vitest";
import { E2EESession } from "./crypto.js";

describe("E2EESession", () => {
  it("generates a non-empty base64 public key", async () => {
    const session = await E2EESession.create();
    expect(session.publicKey).toBeTruthy();
    expect(typeof session.publicKey).toBe("string");
    // P-256 uncompressed point is 65 bytes → 88 chars in base64
    expect(session.publicKey.length).toBeGreaterThan(0);
  });

  it("is not ready before key exchange", async () => {
    const session = await E2EESession.create();
    expect(session.ready).toBe(false);
  });

  it("derives the same shared secret on both sides", async () => {
    const alice = await E2EESession.create();
    const bob = await E2EESession.create();

    await alice.deriveSecret(bob.publicKey);
    await bob.deriveSecret(alice.publicKey);

    expect(alice.ready).toBe(true);
    expect(bob.ready).toBe(true);

    // Verify by encrypting on one side and decrypting on the other
    const plaintext = "shared-secret-test";
    const encrypted = await alice.encrypt(plaintext);
    const decrypted = await bob.decrypt(encrypted);
    expect(decrypted).toBe(plaintext);
  });

  it("encrypt then decrypt roundtrip", async () => {
    const alice = await E2EESession.create();
    const bob = await E2EESession.create();

    await alice.deriveSecret(bob.publicKey);
    await bob.deriveSecret(alice.publicKey);

    const messages = [
      "hello",
      "OTP: 482917",
      "p@ssw0rd!#$%",
      "", // empty string
      "unicode: 你好世界 🔐",
    ];

    for (const msg of messages) {
      const encrypted = await alice.encrypt(msg);

      // Wire format has iv, ciphertext, tag as base64 strings
      expect(typeof encrypted.iv).toBe("string");
      expect(typeof encrypted.ciphertext).toBe("string");
      expect(typeof encrypted.tag).toBe("string");

      const decrypted = await bob.decrypt(encrypted);
      expect(decrypted).toBe(msg);
    }

    // Also test bob → alice direction
    const encrypted = await bob.encrypt("reverse direction");
    const decrypted = await alice.decrypt(encrypted);
    expect(decrypted).toBe("reverse direction");
  });

  it("decrypt fails with wrong key", async () => {
    const alice = await E2EESession.create();
    const bob = await E2EESession.create();
    const eve = await E2EESession.create();

    // alice ↔ bob key exchange
    await alice.deriveSecret(bob.publicKey);
    await bob.deriveSecret(alice.publicKey);

    // eve does key exchange with a different session
    const evePartner = await E2EESession.create();
    await eve.deriveSecret(evePartner.publicKey);

    const encrypted = await alice.encrypt("secret message");

    // eve should fail to decrypt
    await expect(eve.decrypt(encrypted)).rejects.toThrow();
  });

  it("decrypt throws before key exchange (ready === false)", async () => {
    const session = await E2EESession.create();
    expect(session.ready).toBe(false);

    await expect(
      session.decrypt({ iv: "AAAA", ciphertext: "BBBB", tag: "CCCC" }),
    ).rejects.toThrow("E2EE not ready");
  });

  it("encrypt throws before key exchange (ready === false)", async () => {
    const session = await E2EESession.create();
    expect(session.ready).toBe(false);

    await expect(session.encrypt("test")).rejects.toThrow("E2EE not ready");
  });
});
