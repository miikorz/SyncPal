import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-ctr";
const IV_LENGTH = 16;
const FORMAT_VERSION = "v1";

function getEncryptionKey(): Buffer {
  const encodedKey = process.env.PAYPAL_TOKEN_ENCRYPTION_KEY;

  if (!encodedKey || !/^[a-fA-F0-9]{64}$/.test(encodedKey)) {
    throw new Error(
      "PAYPAL_TOKEN_ENCRYPTION_KEY must contain exactly 64 hexadecimal characters",
    );
  }

  return Buffer.from(encodedKey, "hex");
}

export function encrypt(value: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, getEncryptionKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);

  return [FORMAT_VERSION, iv.toString("hex"), ciphertext.toString("hex")].join(
    ":",
  );
}

export function decrypt(value: string): string {
  const [version, encodedIv, encodedCiphertext, ...extraParts] = value.split(":");

  if (
    version !== FORMAT_VERSION ||
    !/^[a-fA-F0-9]{32}$/.test(encodedIv ?? "") ||
    !/^[a-fA-F0-9]*$/.test(encodedCiphertext ?? "") ||
    extraParts.length > 0
  ) {
    throw new Error("Encrypted value has an invalid format");
  }

  const decipher = createDecipheriv(
    ALGORITHM,
    getEncryptionKey(),
    Buffer.from(encodedIv, "hex"),
  );
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(encodedCiphertext, "hex")),
    decipher.final(),
  ]);

  return plaintext.toString("utf8");
}