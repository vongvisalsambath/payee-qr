/** Characters that are invisible or change the direction of text, so a value can display as something it isn't. */
export function isHidden(cp: number): boolean {
  return (
    cp < 0x20 || (cp >= 0x7f && cp <= 0x9f) || // C0 and C1 controls, DEL
    cp === 0xad || cp === 0x34f || cp === 0x61c || cp === 0x115f || cp === 0x1160 || cp === 0x17b4 || cp === 0x17b5 || cp === 0x180e ||
    (cp >= 0x200b && cp <= 0x200f) || // zero-width space/joiners, LRM, RLM
    (cp >= 0x202a && cp <= 0x202e) || // bidi embeddings and overrides
    (cp >= 0x2060 && cp <= 0x206f) || // word joiner, invisible operators, bidi isolates
    cp === 0x3164 || cp === 0xfeff || cp === 0xffa0 ||
    (cp >= 0xfff0 && cp <= 0xfffb) ||
    (cp >= 0xe0000 && cp <= 0xe007f) // tag characters
  );
}

export function hiddenIn(s: string): number[] {
  const found: number[] = [];
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (isHidden(cp) && !found.includes(cp)) found.push(cp);
  }
  return found;
}

export const hex = (cp: number) => "U+" + cp.toString(16).toUpperCase().padStart(4, "0");

const NAMES: Record<number, string> = {
  0x202e: "right-to-left override", 0x202d: "left-to-right override", 0x202b: "right-to-left embedding", 0x202a: "left-to-right embedding",
  0x2067: "right-to-left isolate", 0x2066: "left-to-right isolate", 0x2068: "first-strong isolate", 0x2069: "pop directional isolate", 0x202c: "pop directional formatting",
  0x200b: "zero-width space", 0x200c: "zero-width non-joiner", 0x200d: "zero-width joiner", 0x200e: "left-to-right mark", 0x200f: "right-to-left mark",
  0x2060: "word joiner", 0xfeff: "zero-width no-break space", 0xad: "soft hyphen", 0x61c: "Arabic letter mark", 0x3164: "Hangul filler", 0x17b4: "Khmer vowel inherent AQ", 0x17b5: "Khmer vowel inherent AA",
};

export function describe(cp: number): string {
  if (NAMES[cp]) return `${NAMES[cp]} (${hex(cp)})`;
  if (cp < 0x20 || (cp >= 0x7f && cp <= 0x9f)) return `control character (${hex(cp)})`;
  return `invisible character (${hex(cp)})`;
}

/** A value made safe to quote in a message: hidden characters as \uXXXX, at most `max` characters, cut in the middle. */
export function quote(s: string, max = 60): string {
  const out: string[] = [];
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    out.push(isHidden(cp) ? "\\u" + cp.toString(16).toUpperCase().padStart(4, "0") : ch);
  }
  if (out.length <= max) return out.join("");
  const half = Math.floor((max - 1) / 2);
  return out.slice(0, half).join("") + "…" + out.slice(out.length - half).join("");
}

/** The EMV "common character set" for ans values: printable ASCII. */
export const isCommon = (s: string) => /^[\x20-\x7e]*$/.test(s);
