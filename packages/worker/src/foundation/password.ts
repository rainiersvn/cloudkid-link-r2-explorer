/**
 * Password hashing for share links.
 *
 * Share metadata lives in the bucket as a plain JSON object, so the stored hash
 * has to survive being read by anyone who ever gains access to it. The original
 * scheme was a single unsalted SHA-256 round, which is a rainbow-table lookup
 * away from the plaintext; this derives a key with PBKDF2-HMAC-SHA256 instead.
 *
 * Hashes written before this change are still accepted, and re-hashed to the
 * current scheme the first time they verify, so existing links keep working.
 */

// OWASP's 2023 floor for PBKDF2-HMAC-SHA256. Workers bills CPU time, not wall
// clock, and one derivation stays well inside the per-request limit.
const ITERATIONS = 210_000;
const SALT_BYTES = 16;
const KEY_BITS = 256;

/** Legacy hashes are exactly one SHA-256 digest, hex encoded. */
const LEGACY_HASH = /^[0-9a-f]{64}$/;
const PREFIX = "pbkdf2";

const toHex = (buffer: ArrayBuffer | Uint8Array): string =>
	Array.from(buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer))
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");

const fromHex = (hex: string): Uint8Array =>
	new Uint8Array(
		(hex.match(/../g) ?? []).map((byte) => Number.parseInt(byte, 16)),
	);

async function deriveBits(
	password: string,
	salt: Uint8Array,
	iterations: number,
): Promise<string> {
	const key = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(password),
		"PBKDF2",
		false,
		["deriveBits"],
	);

	return toHex(
		await crypto.subtle.deriveBits(
			{ name: "PBKDF2", hash: "SHA-256", salt, iterations },
			key,
			KEY_BITS,
		),
	);
}

/**
 * Compare two hex digests without leaking where they first differ.
 *
 * Lengths are compared up front, which is fine here: both operands are digests
 * of a fixed width, so the length carries no information about the password.
 */
function timingSafeEqual(a: string, b: string): boolean {
	if (a.length !== b.length) return false;

	let difference = 0;
	for (let i = 0; i < a.length; i++) {
		difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
	}

	return difference === 0;
}

/** Hash a new password. Returns `pbkdf2$<iterations>$<salt>$<derived key>`. */
export async function hashPassword(password: string): Promise<string> {
	const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
	const derived = await deriveBits(password, salt, ITERATIONS);

	return [PREFIX, ITERATIONS, toHex(salt), derived].join("$");
}

export type VerifyResult = {
	valid: boolean;
	/** True when the stored hash used an older scheme and should be replaced. */
	needsRehash: boolean;
};

/** Check a password against a stored hash in either the current or legacy format. */
export async function verifyPassword(
	password: string,
	stored: string,
): Promise<VerifyResult> {
	if (stored.startsWith(`${PREFIX}$`)) {
		const [, iterations, salt, expected] = stored.split("$");
		const rounds = Number.parseInt(iterations, 10);

		if (!Number.isFinite(rounds) || rounds < 1 || !salt || !expected) {
			// A malformed hash can never be satisfied; treat it as a wrong password
			// rather than throwing, so a corrupted share fails closed.
			return { valid: false, needsRehash: false };
		}

		const derived = await deriveBits(password, fromHex(salt), rounds);

		return {
			valid: timingSafeEqual(derived, expected),
			needsRehash: rounds < ITERATIONS,
		};
	}

	if (LEGACY_HASH.test(stored)) {
		const digest = toHex(
			await crypto.subtle.digest("SHA-256", new TextEncoder().encode(password)),
		);

		return { valid: timingSafeEqual(digest, stored), needsRehash: true };
	}

	return { valid: false, needsRehash: false };
}
