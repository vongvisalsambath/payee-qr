/** One data object: a two-digit ID, a two-digit length (in characters) and the value. Offsets are in characters. */
export interface Tlv {
  id: string;
  value: string;
  /** Where the ID starts, counted in characters from the start of the payload. */
  offset: number;
  /** Where the value starts. */
  valueOffset: number;
}

export interface TlvResult {
  items: Tlv[];
  /** Set when the data stops making sense; `items` holds what was read before. */
  error?: { message: string; offset: number };
}

/**
 * Reads ID-length-value objects from `chars` (one string per character, so lengths count characters as EMVCo
 * requires, not UTF-16 units). `base` is the offset of chars[0] in the whole payload.
 */
export function readTlv(chars: readonly string[], base: number): TlvResult {
  const items: Tlv[] = [];
  let pos = 0;
  while (pos < chars.length) {
    if (chars.length - pos < 4)
      return { items, error: { message: `${chars.length - pos} character(s) left over where an ID and a length (4 digits) should start`, offset: base + pos } };
    const id = chars[pos]! + chars[pos + 1]!;
    const len = chars[pos + 2]! + chars[pos + 3]!;
    if (!/^\d\d$/.test(id)) return { items, error: { message: `expected a two-digit ID, found "${printable(id)}"`, offset: base + pos } };
    if (!/^\d\d$/.test(len)) return { items, error: { message: `ID ${id}: expected a two-digit length, found "${printable(len)}"`, offset: base + pos + 2 } };
    const n = Number(len);
    if (n === 0) return { items, error: { message: `ID ${id} has length 00; lengths run from 01 to 99`, offset: base + pos + 2 } };
    if (pos + 4 + n > chars.length)
      return { items, error: { message: `ID ${id} says its value is ${n} characters long, but only ${chars.length - pos - 4} are left`, offset: base + pos + 2 } };
    items.push({ id, value: chars.slice(pos + 4, pos + 4 + n).join(""), offset: base + pos, valueOffset: base + pos + 4 });
    pos += 4 + n;
  }
  return { items };
}

function printable(s: string): string {
  return Array.from(s, ch => (/^[\x21-\x7e]$/.test(ch) ? ch : "\\u" + ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0"))).join("");
}
