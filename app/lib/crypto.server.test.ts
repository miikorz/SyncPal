import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { decrypt, encrypt } from "./crypto.server";

const originalKey = process.env.PAYPAL_TOKEN_ENCRYPTION_KEY;

afterEach(() => {
  process.env.PAYPAL_TOKEN_ENCRYPTION_KEY = originalKey;
});

test("encrypts and decrypts a token with a unique IV", () => {
  process.env.PAYPAL_TOKEN_ENCRYPTION_KEY = "ab".repeat(32);

  const first = encrypt("paypal-access-token");
  const second = encrypt("paypal-access-token");

  assert.notEqual(first, second);
  assert.equal(decrypt(first), "paypal-access-token");
  assert.equal(decrypt(second), "paypal-access-token");
});

test("rejects an invalid encryption key", () => {
  process.env.PAYPAL_TOKEN_ENCRYPTION_KEY = "too-short";

  assert.throws(() => encrypt("token"), /64 hexadecimal characters/);
});

test("rejects malformed encrypted values", () => {
  process.env.PAYPAL_TOKEN_ENCRYPTION_KEY = "cd".repeat(32);

  assert.throws(() => decrypt("invalid"), /invalid format/);
});