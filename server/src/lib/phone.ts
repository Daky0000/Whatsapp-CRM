/**
 * Phone numbers as WhatsApp sees them: digits only, country code first, no "+".
 * The number is the identity of a contact, so two spellings of one handset
 * must come out the same, and anything we can't be sure of is refused rather
 * than guessed (a wrong guess sends a message to a stranger).
 */
export const DEFAULT_COUNTRY = "233"; // Ghana

export function normalizePhone(input: string, defaultCountry = DEFAULT_COUNTRY): string | null {
  const trimmed = input.trim();
  let digits = trimmed.replace(/[^\d]/g, "");
  if (!digits) return null;
  if (trimmed.startsWith("+")) {
    // Already international.
  } else if (digits.startsWith("00")) {
    digits = digits.slice(2);
  } else if (digits.startsWith("0")) {
    // Local format: 024 123 4567 → 233 24 123 4567
    digits = defaultCountry + digits.slice(1);
  } else if (digits.length === 9 && defaultCountry === "233") {
    // Ghana number written without the leading zero: 241234567
    digits = defaultCountry + digits;
  }
  if (digits.length < 10 || digits.length > 15) return null;
  if (digits.startsWith("233") && digits.length !== 12) return null;
  return digits;
}

export function displayPhone(e164: string): string {
  if (e164.startsWith("233") && e164.length === 12) {
    return `+233 ${e164.slice(3, 5)} ${e164.slice(5, 8)} ${e164.slice(8)}`;
  }
  return `+${e164}`;
}

/** Click-to-chat link with the message typed in. The fallback when there is no API connection. */
export function waLink(phone: string, text: string): string {
  return `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
}
