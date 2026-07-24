/**
 * @param {string} alphabet
 * @param {number} length
 */
export function generateSecureCode(alphabet, length) {
  if (alphabet.length < 2 || alphabet.length > 256) {
    throw new Error("Secure code alphabet must contain between 2 and 256 characters");
  }
  if (!Number.isSafeInteger(length) || length < 1) {
    throw new Error("Secure code length must be a positive integer");
  }

  const unbiasedLimit = Math.floor(256 / alphabet.length) * alphabet.length;
  let code = "";

  while (code.length < length) {
    const bytes = new Uint8Array(length - code.length);
    crypto.getRandomValues(bytes);
    for (const byte of bytes) {
      if (byte < unbiasedLimit) {
        code += alphabet[byte % alphabet.length];
      }
    }
  }

  return code;
}
