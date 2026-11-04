// Inputs that try to crash the reader, slow it down, or make what it reports misleading.
import assert from "node:assert/strict";
import { test } from "node:test";
import { build, MAX_CHARACTERS, parse, type Reading } from "../src/index.js";
import { isHidden } from "../src/text.js";

const VALID = [
  build([["00", "01"], ["01", "12"], ["29", [["00", "demo_shop@demo"], ["01", "000123456"], ["02", "Demo Bank"]]], ["52", "5999"], ["53", "840"], ["54", "12.50"], ["58", "KH"], ["59", "DEMO SHOP"], ["60", "Phnom Penh"],
    ["62", [["01", "INV-445"], ["07", "T1"]]], ["64", [["00", "KM"], ["01", "ហាងសាកល្បង"]]], ["99", [["00", "1762257600000"], ["01", "1762261200000"]]]]),
  build([["00", "01"], ["01", "11"], ["38", [["00", "A000000727"], ["01", [["00", "970400"], ["01", "0000000001"]]], ["02", "QRIBFTTA"]]], ["52", "0000"], ["53", "704"], ["58", "VN"], ["59", "DEMO"], ["60", "HA NOI"]]),
  "00020201021126360014A00000061500010106898989020412345204111153034585802MY5903TNB6002KL610559200621790130124007552406823231d4db4506dc9852b1c21c74be148b8363045DFB",
];

/** Everything a reading says that a person or a terminal will see. */
function shown(r: Reading): string[] {
  return r.issues.map(i => i.message);
}

function messagesAreSafe(r: Reading) {
  for (const m of shown(r)) {
    for (const ch of m) assert.ok(!isHidden(ch.codePointAt(0)!), `hidden character in message: ${JSON.stringify(m)}`);
    assert.ok(m.length < 600, `message too long (${m.length})`);
  }
}

// a small deterministic random generator, so failures can be reproduced
function rng(seed: number) {
  return () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
}
const NASTY = ["\u202E", "\u200B", "\u0000", "\u001B[31m", "\uD800", "\uDFFF", "😀", "\uFEFF", "\u0085", "<script>", "__proto__", "constructor", "9", "0", "99", "00", "6304", "\r\n"];

test("20,000 mutated codes: the reader never throws, stays fast, and its messages stay clean", () => {
  const random = rng(20261104);
  const pick = <T>(a: readonly T[]) => a[Math.floor(random() * a.length)]!;
  let slowest = 0;
  for (let i = 0; i < 20000; i++) {
    let s = pick(VALID);
    const edits = 1 + Math.floor(random() * 4);
    for (let e = 0; e < edits; e++) {
      const at = Math.floor(random() * (s.length + 1));
      const what = random();
      if (what < 0.3) s = s.slice(0, at) + String.fromCharCode(32 + Math.floor(random() * 95)) + s.slice(at + 1);
      else if (what < 0.5) s = s.slice(0, at) + pick(NASTY) + s.slice(at);
      else if (what < 0.7) s = s.slice(0, at) + s.slice(at + 1 + Math.floor(random() * 5));
      else if (what < 0.85) s = s.slice(0, at);
      else s = s.slice(0, at) + String(Math.floor(random() * 100)).padStart(2, "0") + s.slice(at + 2);
    }
    const t0 = performance.now();
    const r = parse(s);
    slowest = Math.max(slowest, performance.now() - t0);
    messagesAreSafe(r);
    assert.equal(typeof r.valid, "boolean");
    JSON.stringify(r); // a reading can always be serialised
  }
  assert.ok(slowest < 100, `slowest parse took ${slowest.toFixed(1)} ms`);
});

test("a changed account is always caught by the checksum", () => {
  const random = rng(7);
  for (let i = 0; i < 2000; i++) {
    const original = VALID[0]!;
    const at = original.indexOf("demo_shop") + Math.floor(random() * 9);
    const replacement = String.fromCharCode(97 + Math.floor(random() * 26));
    if (original[at] === replacement) continue;
    const edited = original.slice(0, at) + replacement + original.slice(at + 1);
    const r = parse(edited);
    assert.ok(r.issues.some(x => x.code === "CRC-MISMATCH"), edited);
    assert.equal(r.valid, false);
  }
});

test("the worst inputs at the size limit finish quickly", () => {
  const cases = {
    "1,024 copies of one ID": "0002" + "0101".repeat(1023),
    "nested templates everywhere": "000201" + ("26" + "16" + "0012" + "000800040000").repeat(200),
    "the largest number of objects": "0001" + "0".repeat(MAX_CHARACTERS - 4),
    "one huge additional data template": "000201" + "6299" + "0195" + "x".repeat(95),
    "4,096 emoji": "😀".repeat(MAX_CHARACTERS),
    "just over the limit": "0".repeat(MAX_CHARACTERS + 1),
    "a 10 MB input": "0".repeat(10_000_000),
  };
  for (const [name, input] of Object.entries(cases)) {
    const t0 = performance.now();
    const r = parse(input);
    const ms = performance.now() - t0;
    assert.ok(ms < 200, `${name}: ${ms.toFixed(1)} ms`);
    assert.ok(r.issues.length <= 201, `${name}: ${r.issues.length} issues`);
    messagesAreSafe(r);
  }
});

test("the issue list stops at its limit", () => {
  const r = parse("0002" + "0101".repeat(1023));
  assert.equal(r.issues.at(-1)?.code, "TOO-MANY-ISSUES");
});

test("names of JavaScript's built-in properties are ordinary values", () => {
  const before = Object.getOwnPropertyNames(Object.prototype).join();
  for (const key of ["__proto__", "constructor", "toString", "hasOwnProperty", "valueOf"]) {
    const payloads = [
      build([["00", "01"], ["26", [["00", "SG.PAYNOW"], ["01", key], ["02", key], ["03", key]]], ["52", "0000"], ["53", "702"], ["58", "SG"], ["59", key], ["60", "C"]]),
      build([["00", "01"], ["51", [["00", "ID.CO.QRIS.WWW"], ["02", key], ["03", key]]], ["52", "0000"], ["53", "360"], ["58", "ID"], ["59", "D"], ["60", "C"], ["62", [["11", key.slice(0, 3)]]]]),
      build([["00", "01"], ["38", [["00", "A000000727"], ["01", [["00", key]]], ["02", key]]], ["52", "0000"], ["53", "704"], ["55", key], ["58", "VN"], ["59", "D"], ["60", "C"]]),
    ];
    for (const p of payloads) {
      const r = parse(p);
      const walk = (fs: Reading["fields"]): void => fs.forEach(f => { assert.ok(f.meaning === undefined || typeof f.meaning === "string", `${f.path}: ${typeof f.meaning}`); walk(f.children ?? []); });
      walk(r.fields);
      for (const p of r.payTo) assert.ok(typeof p.kind === "string" && (p.account === undefined || typeof p.account === "string"));
    }
  }
  assert.equal(Object.getOwnPropertyNames(Object.prototype).join(), before);
  assert.equal(({} as Record<string, unknown>)["polluted"], undefined);
});

test("a right-to-left override in the merchant name is reported, and escaped in the message", () => {
  const r = parse(build([["00", "01"], ["29", [["00", "demo_shop@demo"]]], ["52", "5999"], ["53", "840"], ["58", "KH"], ["64", [["00", "KM"], ["01", "Acme\u202E0001"]]], ["59", "D"], ["60", "C"]]));
  const hidden = r.issues.find(i => i.code === "HIDDEN-CHARACTERS");
  assert.ok(hidden);
  assert.equal(hidden.path, "64.01");
  assert.match(hidden.message, /right-to-left override \(U\+202E\)/);
  assert.match(hidden.message, /Acme\\u202E0001/);
  messagesAreSafe(r);
});

test("hidden characters in an account ID are reported too", () => {
  const r = parse(build([["00", "01"], ["29", [["00", "demo\u200Bshop@demo"]]], ["52", "5999"], ["53", "840"], ["58", "KH"], ["59", "D"], ["60", "C"]]));
  assert.ok(r.issues.some(i => i.code === "HIDDEN-CHARACTERS" && i.path === "29.00"));
});

test("terminal escape sequences never reach a message", () => {
  const r = parse("\u001B]0;owned\u0007\u001B[2J");
  messagesAreSafe(r);
  const r2 = parse(build([["00", "01"], ["01", "\u001B["], ["29", [["00", "a@b"]]], ["52", "5999"], ["53", "840"], ["58", "KH"], ["59", "D"], ["60", "C"]]));
  messagesAreSafe(r2);
});

test("lone surrogates don't break the checksum or the reader", () => {
  const r = parse(VALID[0]!.replace("DEMO SHOP", "DEMO\uD800SHOP"));
  assert.ok(r.issues.some(i => i.code === "CRC-MISMATCH"));
  messagesAreSafe(r);
});

test("the checksum's UTF-8 encoding matches TextEncoder, including emoji and lone surrogates", async () => {
  const { crc16 } = await import("../src/crc.js");
  const reference = (s: string) => {
    let crc = 0xffff;
    for (const byte of new TextEncoder().encode(s)) {
      crc ^= byte << 8;
      for (let bit = 0; bit < 8; bit++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
    return crc.toString(16).toUpperCase().padStart(4, "0");
  };
  const random = rng(99);
  for (let i = 0; i < 2000; i++) {
    let s = "";
    for (let j = 0; j < 20; j++) {
      const r = random();
      s += r < 0.4 ? String.fromCharCode(32 + Math.floor(random() * 95)) : r < 0.6 ? String.fromCharCode(0x80 + Math.floor(random() * 0x780)) : r < 0.8 ? String.fromCharCode(0x800 + Math.floor(random() * 0xd000)) : r < 0.9 ? "😀" : String.fromCharCode(0xd800 + Math.floor(random() * 0x800));
    }
    assert.equal(crc16(s), reference(s), JSON.stringify(s));
  }
});
