/**
 * payee-qr: reads EMV merchant-presented payment QR codes, checks them against EMVCo's specification (v1.1) and
 * the conventions of Asian payment networks, and says who a payment made with the code would really go to.
 */
import { crc16 } from "./crc.js";
import { currency } from "./currencies.js";
import { DECODERS, primitiveNetwork, type Context, type Decoder } from "./networks.js";
import { describe, hiddenIn, isCommon, quote } from "./text.js";
import { readTlv, type Tlv } from "./tlv.js";
import type { Field, Issue, PayTo, Reading, Severity } from "./types.js";

export { crc16 } from "./crc.js";
export { currency, type Currency } from "./currencies.js";
export { thaiIdOk } from "./networks.js";
export type { Field, Issue, PayTo, Reading, Severity } from "./types.js";

/** Longest input read, in characters. The largest QR code holds 4,296 characters; EMVCo asks for at most 512. */
export const MAX_CHARACTERS = 4096;
/** At most this many issues are reported. */
export const MAX_ISSUES = 200;

export interface ParseOptions {
  /** The time to check expiry dates against. Defaults to now. */
  now?: Date;
}

type Format = "N" | "ans" | "S";
interface Spec { name: string; format: Format; max: number; fixed?: number }

const ROOT: Record<string, Spec> = Object.assign(Object.create(null) as Record<string, Spec>, {
  "00": { name: "Payload format indicator", format: "N", max: 2, fixed: 2 },
  "01": { name: "Point of initiation", format: "N", max: 2, fixed: 2 },
  "52": { name: "Merchant category code", format: "N", max: 4, fixed: 4 },
  "53": { name: "Transaction currency", format: "N", max: 3, fixed: 3 },
  "54": { name: "Transaction amount", format: "ans", max: 13 },
  "55": { name: "Tip or convenience fee indicator", format: "N", max: 2, fixed: 2 },
  "56": { name: "Convenience fee (fixed)", format: "ans", max: 13 },
  "57": { name: "Convenience fee (percentage)", format: "ans", max: 5 },
  "58": { name: "Country", format: "ans", max: 2, fixed: 2 },
  "59": { name: "Merchant name", format: "ans", max: 25 },
  "60": { name: "Merchant city", format: "ans", max: 15 },
  "61": { name: "Postal code", format: "ans", max: 10 },
  "62": { name: "Additional data", format: "S", max: 99 },
  "63": { name: "Checksum (CRC)", format: "ans", max: 4, fixed: 4 },
  "64": { name: "Merchant information in another language", format: "S", max: 99 },
});

const ADDITIONAL: Record<string, Spec> = Object.assign(Object.create(null) as Record<string, Spec>, {
  "01": { name: "Bill number", format: "ans", max: 25 },
  "02": { name: "Mobile number", format: "ans", max: 25 },
  "03": { name: "Store label", format: "ans", max: 25 },
  "04": { name: "Loyalty number", format: "ans", max: 25 },
  "05": { name: "Reference label", format: "ans", max: 25 },
  "06": { name: "Customer label", format: "ans", max: 25 },
  "07": { name: "Terminal label", format: "ans", max: 25 },
  "08": { name: "Purpose of transaction", format: "ans", max: 25 },
  "09": { name: "Additional consumer data request", format: "ans", max: 3 },
  "10": { name: "Merchant tax ID", format: "ans", max: 20 },
  "11": { name: "Merchant channel", format: "ans", max: 3, fixed: 3 },
});

const LANGUAGE: Record<string, Spec> = Object.assign(Object.create(null) as Record<string, Spec>, {
  "00": { name: "Language", format: "ans", max: 2, fixed: 2 },
  "01": { name: "Merchant name (other language)", format: "S", max: 25 },
  "02": { name: "Merchant city (other language)", format: "S", max: 15 },
});

const CHANNEL_MEDIA: Record<string, string> = {
  "0": "merchant sticker", "1": "bill or invoice", "2": "magazine or poster", "3": "other print",
  "4": "merchant's terminal screen", "5": "website", "6": "app", "7": "other screen",
};
const CHANNEL_PLACE: Record<string, string> = { "0": "at the merchant", "1": "away from the merchant", "2": "remote commerce", "3": "other" };

function rootName(id: string): string {
  const n = Number(id);
  if (ROOT[id]) return ROOT[id]!.name;
  if (n >= 2 && n <= 51) return "Merchant account information";
  if (n >= 65 && n <= 79) return "Reserved by EMVCo";
  return "Unreserved template";
}

/**
 * Reads a payment QR code's text. Never throws for any input: everything found is in the returned reading's
 * `issues`, and `valid` is false when any of them is an error.
 */
export function parse(payload: string, options: ParseOptions = {}): Reading {
  const now = options.now ?? new Date();
  const r: Reading = { valid: false, kind: "emv", payload: typeof payload === "string" ? payload : "", fields: [], payTo: [], merchant: {}, references: [], issues: [] };
  let capped = false;
  const issue = (code: string, severity: Severity, message: string, path?: string, offset?: number) => {
    if (r.issues.length >= MAX_ISSUES) {
      if (!capped) r.issues.push({ code: "TOO-MANY-ISSUES", severity: "warning", message: `Only the first ${MAX_ISSUES} problems are listed.` });
      capped = true;
      return;
    }
    const i: Issue = { code, severity, message };
    if (path !== undefined) i.path = path;
    if (offset !== undefined) i.offset = offset;
    r.issues.push(i);
  };
  const finish = () => ((r.valid = !r.issues.some(i => i.severity === "error")), r);

  if (typeof payload !== "string" || payload.length === 0) {
    r.kind = "empty";
    issue("EMPTY", "error", "There is nothing to read.");
    return finish();
  }
  // Checked on UTF-16 length first, so a huge input is refused before it is split into characters.
  if (payload.length > MAX_CHARACTERS * 2 || Array.from(payload).length > MAX_CHARACTERS) {
    r.kind = "text";
    issue("TOO-LONG", "error", `This is ${payload.length.toLocaleString("en")} characters long; a QR code holds at most 4,296, and a payment code should be under 512.`);
    return finish();
  }
  if (!/^\d{4}/.test(payload)) {
    const scheme = /^([a-z][a-z0-9+.-]{0,30}):/i.exec(payload);
    r.kind = scheme ? "link" : "text";
    issue(
      "NOT-EMV",
      "error",
      scheme
        ? `This code holds a link, not an EMV payment code: "${quote(payload, 80)}". Check where it leads before you open it or pay.`
        : `This isn't an EMV payment code: those start with "000201". It says "${quote(payload, 80)}".`,
    );
    return finish();
  }

  const chars = Array.from(payload);
  const root = readTlv(chars, 0);
  const broken = root.error !== undefined;
  if (root.error) issue("MALFORMED", "error", `The code stops making sense at character ${root.error.offset + 1}: ${root.error.message}.`, undefined, root.error.offset);
  if (chars.length > 512) issue("LONG-PAYLOAD", "warning", `The code is ${chars.length} characters long; EMVCo asks for at most 512, and long codes are harder to scan.`);

  checkDuplicates(root.items, "", issue);
  checkCrc(chars, root.items, broken, issue);

  // the payload format indicator
  const first = root.items[0];
  if (!root.items.some(t => t.id === "00")) issue("MISSING", "error", "The payload format indicator (ID 00) is missing.", "00");
  else if (first?.id !== "00") issue("ORDER", "error", "The payload format indicator (ID 00) must come first.", "00");
  const pfi = root.items.find(t => t.id === "00");
  if (pfi && pfi.value !== "01")
    issue("PFI-VERSION", "warning", `The payload format indicator is "${quote(pfi.value)}"; EMVCo defines only "01". (Malaysia's DuitNow uses "02".)`, "00");

  const ctx: Context = {
    issue: () => undefined,
    now,
    expires: d => { if (!r.expires || d < r.expires) r.expires = d; },
  };
  let khqr = false;

  for (const t of root.items) {
    const n = Number(t.id);
    const field: Field = { id: t.id, path: t.id, name: rootName(t.id), value: t.value, offset: t.offset };
    r.fields.push(field);
    // templates are checked object by object below, so a warning names the exact one
    if (!((n >= 26 && n <= 51) || t.id === "62" || t.id === "64" || (n >= 80 && tryTemplate(t)))) hidden(t, t.id, issue);
    const spec = own(ROOT, t.id);
    if (spec) checkValue(t, spec, t.id, issue);

    if (n >= 2 && n <= 25) {
      if (!isCommon(t.value)) issue("CHARSET", "warning", `${primitiveNetwork(t.id)}'s merchant ID has characters outside the EMV character set.`, t.id);
      r.payTo.push({ network: primitiveNetwork(t.id), path: t.id, kind: "Merchant ID", account: t.value, details: [] });
    } else if (n >= 26 && n <= 51) {
      const decoded = accountTemplate(t, field, ctx, issue);
      if (decoded?.network === "KHQR (Bakong)") khqr = true;
      if (decoded) r.payTo.push(decoded);
    } else if (t.id === "62") {
      additionalData(t, field, r, issue);
    } else if (t.id === "64") {
      language(t, field, r, issue);
    } else if (n >= 65 && n <= 79) {
      issue("RESERVED", "warning", `ID ${t.id} is reserved by EMVCo for future use and shouldn't appear in a code yet.`, t.id);
    } else if (n >= 80) {
      const sub = tryTemplate(t);
      if (sub) field.children = sub.map(s => {
        hidden(s, `${t.id}.${s.id}`, issue);
        return { id: s.id, path: `${t.id}.${s.id}`, name: s.id === "00" ? "Globally unique identifier" : "Network-specific", value: s.value, offset: s.offset };
      });
    }
  }

  // KHQR keeps its creation and expiry times (milliseconds since 1970) in ID 99
  const t99 = root.items.find(t => t.id === "99");
  const k99 = khqr && t99 ? tryTemplate(t99, false) : null;
  if (k99 && t99) {
    const f99 = r.fields.find(f => f.id === "99")!;
    f99.name = "KHQR timestamps";
    f99.children = k99.map(s => {
      const f: Field = { id: s.id, path: `99.${s.id}`, name: s.id === "00" ? "Created" : s.id === "01" ? "Expires" : "Unknown", value: s.value, offset: s.offset };
      if ((s.id === "00" || s.id === "01") && /^\d{13}$/.test(s.value)) {
        const d = new Date(Number(s.value));
        f.meaning = d.toISOString().replace("T", " ").slice(0, 19) + " UTC";
        if (s.id === "00") r.created = d;
        else {
          ctx.expires(d);
          if (d < now) issue("EXPIRED", "warning", `This KHQR code expired at ${f.meaning}.`, "99.01");
        }
      } else if (s.id === "00" || s.id === "01") issue("KHQR-TIMESTAMP", "warning", "A KHQR timestamp is 13 digits: milliseconds since 1 January 1970.", `99.${s.id}`);
      return f;
    });
  }

  // what the code says about the payment
  const value = (id: string) => root.items.find(t => t.id === id)?.value;
  const poi = value("01");
  if (poi === "11") r.reusable = true;
  else if (poi === "12") r.reusable = false;
  r.merchant = clean({ name: value("59"), city: value("60"), country: value("58"), postalCode: value("61"), category: value("52"), ...r.merchant });
  const cur = value("53");
  if (cur !== undefined && /^\d{3}$/.test(cur)) {
    r.currency = currency(cur);
    if (!r.currency.code) issue("CURRENCY-UNKNOWN", "warning", `Currency ${cur} isn't one this reader knows, so its decimals can't be checked.`, "53");
  }
  const amount = value("54");
  if (amount !== undefined) {
    r.amount = amount;
    if (!/^\d+(\.\d*)?$/.test(amount)) issue("AMOUNT", "error", `The amount "${quote(amount)}" isn't a number: only digits and one "." are allowed (no commas, spaces or signs).`, "54");
    else if (Number(amount) === 0) issue("AMOUNT", "error", "The amount is zero. A code where the payer types the amount leaves it out.", "54");
    else {
      const decimals = amount.includes(".") ? amount.length - amount.indexOf(".") - 1 : 0;
      if (khqr && cur === "116" && decimals > 0) issue("KHQR-RIEL-DECIMALS", "warning", "KHQR amounts in riel have no decimals.", "54");
      else if (r.currency?.decimals !== undefined && decimals > r.currency.decimals)
        issue("AMOUNT-DECIMALS", "warning", `${r.currency.code} has ${r.currency.decimals} decimal${r.currency.decimals === 1 ? "" : "s"}, but the amount has ${decimals}.`, "54");
    }
  }
  tip(value, r, issue);
  if (poi !== undefined && poi !== "11" && poi !== "12") issue("VALUE", "error", `The point of initiation is "${quote(poi)}"; it can only be 11 (static) or 12 (dynamic).`, "01");
  const country = value("58");
  if (country !== undefined && !/^[A-Z]{2}$/.test(country)) issue("COUNTRY", "warning", `The country "${quote(country)}" isn't a two-letter ISO 3166 code such as KH or TH.`, "58");

  if (!broken) {
    for (const [id, what] of [["52", "merchant category code"], ["53", "currency"], ["58", "country"], ["59", "merchant name"], ["60", "merchant city"]] as const)
      if (value(id) === undefined) issue("MISSING", "error", `The ${what} (ID ${id}) is missing.`, id);
    if (!root.items.some(t => Number(t.id) >= 2 && Number(t.id) <= 51))
      issue("NO-ACCOUNT", "error", "The code names no account to pay (IDs 02 to 51 are all missing).");
  }

  // meanings for the summary fields
  for (const f of r.fields) {
    if (f.id === "01") f.meaning = f.value === "11" ? "static: the same code for every payment" : f.value === "12" ? "dynamic: a code for one payment" : undefined;
    if (f.id === "53" && r.currency?.code) f.meaning = r.currency.code;
    if (f.id === "55") f.meaning = own({ "01": "the app asks the payer for a tip", "02": "a fixed convenience fee", "03": "a percentage convenience fee" }, f.value);
    if (f.meaning === undefined) delete f.meaning;
  }
  return finish();
}

/** obj[key] only if obj has it as its own property: values from a code never reach Object.prototype. */
function own<T>(obj: Readonly<Record<string, T>> | undefined, key: string): T | undefined {
  return obj !== undefined && Object.prototype.hasOwnProperty.call(obj, key) ? obj[key] : undefined;
}

type IssueFn = (code: string, severity: Severity, message: string, path?: string, offset?: number) => void;

function clean<T extends object>(o: T): T {
  for (const k of Object.keys(o) as (keyof T)[]) if (o[k] === undefined) delete o[k];
  return o;
}

function checkDuplicates(items: Tlv[], prefix: string, issue: IssueFn) {
  const seen = new Set<string>();
  for (const t of items) {
    if (seen.has(t.id))
      issue("DUPLICATE", "error", `ID ${prefix}${t.id} appears more than once. Apps may read either one, so the code can mean two different things.`, prefix + t.id, t.offset);
    seen.add(t.id);
  }
}

function checkCrc(chars: string[], items: Tlv[], broken: boolean, issue: IssueFn) {
  const index = items.findIndex(t => t.id === "63");
  let found: { value: string; valueOffset: number } | null = null;
  if (index >= 0) {
    found = items[index]!;
    if (index !== items.length - 1 || broken) issue("CRC-NOT-LAST", "error", "The checksum (ID 63) must be last; anything after it isn't protected by it.", "63");
  } else {
    // a damaged code: still check the checksum if it ends like one, to tell damage from editing
    const tail = chars.slice(-8).join("");
    if (/^6304[0-9A-Fa-f]{4}$/.test(tail)) found = { value: tail.slice(4), valueOffset: chars.length - 4 };
    else issue("CRC-MISSING", "error", "The checksum (ID 63) is missing, so damage to the code can't be detected.", "63");
  }
  if (!found) return;
  if (!/^[0-9A-Fa-f]{4}$/.test(found.value)) {
    issue("CRC-FORMAT", "error", `The checksum "${quote(found.value)}" isn't four hexadecimal digits.`, "63");
    return;
  }
  const expected = crc16(chars.slice(0, found.valueOffset).join(""));
  if (found.value.toUpperCase() !== expected)
    issue("CRC-MISMATCH", "error", `The checksum says ${found.value} but the content gives ${expected}: the code was damaged, misread, or changed after it was made. Payment apps refuse it.`, "63", found.valueOffset);
  else if (found.value !== expected) issue("CRC-LOWERCASE", "warning", "The checksum is in lowercase; EMVCo requires uppercase.", "63");
}

function hidden(t: { value: string; offset: number }, path: string, issue: IssueFn) {
  const found = hiddenIn(t.value);
  if (found.length)
    issue("HIDDEN-CHARACTERS", "warning", `ID ${path} contains ${found.slice(0, 3).map(describe).join(", ")}${found.length > 3 ? "…" : ""}, which can make it display differently from what it is: "${quote(t.value)}".`, path, t.offset);
}

function checkValue(t: { value: string }, spec: Spec, path: string, issue: IssueFn) {
  const length = Array.from(t.value).length;
  if (spec.fixed !== undefined && length !== spec.fixed)
    issue("LENGTH", "error", `${spec.name} (ID ${path}) should be ${spec.fixed} characters long, not ${length}.`, path);
  else if (length > spec.max) issue("TOO-LONG-VALUE", "warning", `${spec.name} (ID ${path}) is ${length} characters long; EMVCo allows ${spec.max}. Apps may cut it short.`, path);
  if (spec.format === "N" && !/^\d*$/.test(t.value)) issue("FORMAT", "error", `${spec.name} (ID ${path}) must be digits only, not "${quote(t.value)}".`, path);
  else if (spec.format === "ans" && !isCommon(t.value))
    issue("CHARSET", "warning", `${spec.name} (ID ${path}) has characters outside the EMV character set (A–Z, a–z, 0–9 and basic punctuation), so apps may show it differently. Names in other scripts belong in ID 64.`, path);
}

/** Reads a value as a template; null if it isn't one (some networks put plain values in IDs EMVCo reserves for templates). */
function tryTemplate(t: Tlv, needGuid = true): Tlv[] | null {
  const sub = readTlv(Array.from(t.value), t.valueOffset);
  if (sub.error || sub.items.length === 0) return null;
  if (needGuid && !sub.items.some(s => s.id === "00")) return null;
  if (new Set(sub.items.map(s => s.id)).size !== sub.items.length) return null;
  return sub.items;
}

function accountTemplate(t: Tlv, field: Field, ctx: Context, issue: IssueFn): PayTo | null {
  const sub = readTlv(Array.from(t.value), t.valueOffset);
  if (sub.error) {
    issue("MALFORMED", "error", `Merchant account template ${t.id} doesn't hold valid data objects: ${sub.error.message}.`, t.id, sub.error.offset);
    return null;
  }
  checkDuplicates(sub.items, t.id + ".", issue);
  const guid = sub.items.find(s => s.id === "00")?.value;
  if (guid === undefined) issue("MISSING", "error", `Merchant account template ${t.id} has no identifier (ID ${t.id}.00) saying which network it is for.`, `${t.id}.00`);
  else if (Array.from(guid).length > 32) issue("TOO-LONG-VALUE", "warning", `The network identifier in template ${t.id} is longer than 32 characters.`, `${t.id}.00`);
  for (const s of sub.items) hidden(s, `${t.id}.${s.id}`, issue);

  const decoder: Decoder | undefined = guid === undefined ? undefined : DECODERS.find(d => d.match(t.id, guid));
  const values = new Map<string, string>();
  field.children = sub.items.map(s => {
    values.set(s.id, s.value);
    const f: Field = { id: s.id, path: `${t.id}.${s.id}`, name: own(decoder?.names, s.id) ?? (s.id === "00" ? "Network identifier" : "Network-specific"), value: s.value, offset: s.offset };
    const meaning = own(own(decoder?.meanings, s.id), s.value);
    if (meaning) f.meaning = meaning;
    const nested = decoder?.nested?.[s.id];
    if (nested) {
      const inner = readTlv(Array.from(s.value), s.valueOffset);
      if (inner.error) issue("MALFORMED", "error", `${f.name} (ID ${f.path}) doesn't hold valid data objects: ${inner.error.message}.`, f.path, inner.error.offset);
      checkDuplicates(inner.items, f.path + ".", issue);
      f.children = inner.items.map(i => {
        values.set(`${s.id}.${i.id}`, i.value);
        hidden(i, `${f.path}.${i.id}`, issue);
        return { id: i.id, path: `${f.path}.${i.id}`, name: own(nested, i.id) ?? "Network-specific", value: i.value, offset: i.offset };
      });
    }
    return f;
  });
  if (decoder) field.name = `Merchant account: ${decoder.network}`;

  if (!decoder) {
    if (guid === undefined) return null;
    return {
      network: "Unrecognised network",
      path: t.id,
      kind: "Account",
      institution: guid,
      details: sub.items.filter(s => s.id !== "00").map(s => ({ label: `ID ${s.id}`, value: s.value })),
    };
  }
  const local: Context = { ...ctx, issue: (code, severity, message, path) => issue(code, severity, message, path === undefined ? t.id : `${t.id}.${path}`) };
  const described = decoder.describe(t.id, p => values.get(p), local);
  return described ? { network: decoder.network, path: t.id, ...clean(described) } : null;
}

function additionalData(t: Tlv, field: Field, r: Reading, issue: IssueFn) {
  const sub = readTlv(Array.from(t.value), t.valueOffset);
  if (sub.error) {
    issue("MALFORMED", "error", `The additional data template (ID 62) doesn't hold valid data objects: ${sub.error.message}.`, "62", sub.error.offset);
    return;
  }
  checkDuplicates(sub.items, "62.", issue);
  field.children = sub.items.map(s => {
    const n = Number(s.id);
    const spec = own(ADDITIONAL, s.id);
    const path = `62.${s.id}`;
    const f: Field = { id: s.id, path, name: spec?.name ?? (n >= 50 ? "Payment-system specific" : "Reserved by EMVCo"), value: s.value, offset: s.offset };
    hidden(s, path, issue);
    if (spec) {
      if (!(n <= 8 && s.value === "***")) checkValue(s, spec, path, issue);
      if (n <= 8) {
        if (s.value === "***") f.meaning = "the app asks the payer for it";
        r.references.push({ label: spec.name, value: s.value });
      }
      if (s.id === "09") {
        if (!/^[AME]{1,3}$/.test(s.value) || new Set(s.value).size !== s.value.length)
          issue("VALUE", "error", 'The additional consumer data request can only be the letters A, M and E, each at most once.', path);
        else f.meaning = "the app sends the payer's " + Array.from(s.value, c => ({ A: "address", M: "mobile number", E: "email" })[c as "A" | "M" | "E"]).join(", ");
      }
      if (s.id === "10") r.references.push({ label: spec.name, value: s.value });
      if (s.id === "11" && s.value.length === 3) {
        const media = own(CHANNEL_MEDIA, s.value[0]!), place = own(CHANNEL_PLACE, s.value[1]!);
        if (media && place) f.meaning = `${media}, ${place}`;
      }
    } else if (n >= 12 && n <= 49) issue("RESERVED", "warning", `ID ${path} is reserved by EMVCo for future use.`, path);
    else if (n >= 50) {
      const inner = tryTemplate(s);
      if (inner) f.children = inner.map(i => ({ id: i.id, path: `${path}.${i.id}`, name: i.id === "00" ? "Globally unique identifier" : "Payment-system specific", value: i.value, offset: i.offset }));
    }
    return f;
  });
  if (sub.items.length === 0) issue("EMPTY-TEMPLATE", "warning", "The additional data template (ID 62) is empty.", "62");
}

function language(t: Tlv, field: Field, r: Reading, issue: IssueFn) {
  const sub = readTlv(Array.from(t.value), t.valueOffset);
  if (sub.error) {
    issue("MALFORMED", "error", `The language template (ID 64) doesn't hold valid data objects: ${sub.error.message}.`, "64", sub.error.offset);
    return;
  }
  checkDuplicates(sub.items, "64.", issue);
  field.children = sub.items.map(s => {
    const spec = own(LANGUAGE, s.id);
    hidden(s, `64.${s.id}`, issue);
    if (spec) checkValue(s, spec, `64.${s.id}`, issue);
    if (s.id === "00") r.merchant.language = s.value;
    if (s.id === "01") r.merchant.nameInLanguage = s.value;
    if (s.id === "02") r.merchant.cityInLanguage = s.value;
    return { id: s.id, path: `64.${s.id}`, name: spec?.name ?? "Reserved by EMVCo", value: s.value, offset: s.offset };
  });
  for (const [id, what] of [["00", "language"], ["01", "merchant name"]] as const)
    if (!sub.items.some(s => s.id === id)) issue("MISSING", "error", `The language template (ID 64) must have the ${what} (ID 64.${id}).`, `64.${id}`);
}

function tip(value: (id: string) => string | undefined, r: Reading, issue: IssueFn) {
  const indicator = value("55"), fixed = value("56"), percent = value("57");
  const amountLike = /^\d+(\.\d*)?$/;
  if (indicator === "01") r.tip = { kind: "ask" };
  else if (indicator === "02") {
    if (fixed === undefined) issue("MISSING", "error", "The tip indicator says there's a fixed fee, but the fee (ID 56) is missing.", "56");
    else if (!amountLike.test(fixed) || Number(fixed) === 0) issue("VALUE", "error", `The fixed fee "${quote(fixed)}" must be a number above zero.`, "56");
    r.tip = { kind: "fixed", ...(fixed !== undefined ? { value: fixed } : {}) };
  } else if (indicator === "03") {
    if (percent === undefined) issue("MISSING", "error", "The tip indicator says there's a percentage fee, but the percentage (ID 57) is missing.", "57");
    else if (!amountLike.test(percent) || Number(percent) < 0.01 || Number(percent) > 99.99) issue("VALUE", "error", `The fee percentage "${quote(percent)}" must be between 00.01 and 99.99.`, "57");
    r.tip = { kind: "percent", ...(percent !== undefined ? { value: percent } : {}) };
  } else if (indicator !== undefined) issue("VALUE", "error", `The tip indicator is "${quote(indicator)}"; it can only be 01, 02 or 03.`, "55");
  if (fixed !== undefined && indicator !== "02") issue("UNEXPECTED", "error", "A fixed fee (ID 56) is only allowed when the tip indicator is 02.", "56");
  if (percent !== undefined && indicator !== "03") issue("UNEXPECTED", "error", "A fee percentage (ID 57) is only allowed when the tip indicator is 03.", "57");
}

/** A data object to build: an ID and either a value or the data objects of a template. */
export type DataObject = readonly [id: string, value: string | readonly DataObject[]];

/** Builds a payload from data objects, in the order given, and appends the checksum. For tests and examples. */
export function build(objects: readonly DataObject[]): string {
  const body = encode(objects) + "6304";
  return body + crc16(body);
}

function encode(objects: readonly DataObject[]): string {
  return objects
    .map(([id, value]) => {
      const v = typeof value === "string" ? value : encode(value);
      const n = Array.from(v).length;
      if (!/^\d\d$/.test(id)) throw new RangeError(`An ID is two digits, not "${quote(id)}".`);
      if (n < 1 || n > 99) throw new RangeError(`ID ${id}: a value is 1 to 99 characters long, not ${n}.`);
      return id + String(n).padStart(2, "0") + v;
    })
    .join("");
}
