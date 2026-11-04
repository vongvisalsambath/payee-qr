/**
 * The EMV QR checksum: CRC-16 with polynomial 0x1021 and initial value 0xFFFF (ISO/IEC 13239, also known as
 * CRC-16/CCITT-FALSE), over the UTF-8 bytes of the payload up to and including "6304".
 * Returns four uppercase hexadecimal characters.
 */
export function crc16(data: string): string {
  let crc = 0xffff;
  const add = (byte: number) => {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  };
  for (const ch of data) {
    let cp = ch.codePointAt(0)!;
    if (cp >= 0xd800 && cp <= 0xdfff) cp = 0xfffd; // a lone surrogate, encoded as TextEncoder does
    if (cp < 0x80) add(cp);
    else if (cp < 0x800) { add(0xc0 | (cp >> 6)); add(0x80 | (cp & 0x3f)); }
    else if (cp < 0x10000) { add(0xe0 | (cp >> 12)); add(0x80 | ((cp >> 6) & 0x3f)); add(0x80 | (cp & 0x3f)); }
    else { add(0xf0 | (cp >> 18)); add(0x80 | ((cp >> 12) & 0x3f)); add(0x80 | ((cp >> 6) & 0x3f)); add(0x80 | (cp & 0x3f)); }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}
