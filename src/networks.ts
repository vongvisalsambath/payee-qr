/**
 * What the merchant account templates (IDs 26 to 51, and KHQR's 29 and 30) of each payment network mean.
 *
 * Sources: EMVCo's Merchant-Presented Mode specification v1.1 (the allocation of IDs 02 to 51); PayNet's
 * published DuitNow QR specification; ABA PayWay's KHQR guideline. The PromptPay, VietQR, QRIS and PayNow/SGQR
 * layouts come from widely used open-source readers of those codes, because their national specifications aren't
 * published openly; README.md says which.
 */
import type { PayTo, Severity } from "./types.js";

export interface Context {
  issue(code: string, severity: Severity, message: string, path?: string): void;
  now: Date;
  expires(d: Date): void;
}

type Get = (subPath: string) => string | undefined;
export type Described = Omit<PayTo, "network" | "path">;

export interface Decoder {
  network: string;
  match(id: string, guid: string): boolean;
  /** Names of the sub-IDs. */
  names: Record<string, string>;
  /** Sub-IDs that are templates themselves, with the names of their sub-IDs. */
  nested?: Record<string, Record<string, string>>;
  /** Meanings of coded values, by sub-path. */
  meanings?: Record<string, Record<string, string>>;
  describe(id: string, get: Get, ctx: Context): Described | null;
}

const details = (get: Get, names: Record<string, string>, skip: string[] = []) =>
  Object.keys(names)
    .filter(k => !skip.includes(k) && get(k) !== undefined)
    .map(k => ({ label: names[k]!, value: get(k)! }));

const digits = (s: string | undefined, n?: number) => s !== undefined && (n === undefined ? /^\d+$/ : new RegExp(`^\\d{${n}}$`)).test(s);

/** Thai national ID and tax ID check digit (mod 11). */
export function thaiIdOk(id: string): boolean {
  if (!/^\d{13}$/.test(id)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(id[i]) * (13 - i);
  return (11 - (sum % 11)) % 10 === Number(id[12]);
}

function yyyymmdd(s: string): Date | null {
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(s);
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, 23, 59, 59));
  return d.getUTCMonth() === +m[2]! - 1 && d.getUTCDate() === +m[3]! ? d : null;
}

const KHQR: Decoder = {
  network: "KHQR (Bakong)",
  // KHQR puts the Bakong account ID ("name@bank") where other templates have a GUID.
  match: (id, guid) => (id === "29" || id === "30") && /^[^@\s]{1,32}@[^@\s]{1,32}$/.test(guid),
  names: { "00": "Bakong account ID", "01": "Account information / merchant ID", "02": "Acquiring bank" },
  describe(id, get) {
    const individual = id === "29";
    const names = individual
      ? { "01": "Account information", "02": "Acquiring bank" }
      : { "01": "Merchant ID", "02": "Acquiring bank" };
    return {
      kind: individual ? "Bakong account (individual)" : "Bakong account (merchant)",
      account: get("00"),
      institution: get("02"),
      details: details(get, names, ["02"]),
    };
  },
};

const PROMPTPAY: Decoder = {
  network: "PromptPay",
  match: (id, guid) => id === "29" && (guid === "A000000677010111" || guid === "A000000677010114"),
  names: { "01": "Mobile number", "02": "National ID or tax ID", "03": "E-wallet ID", "04": "Bank account", "05": "One-time authorisation code" },
  describe(_id, get, ctx) {
    const mobile = get("01"), nid = get("02"), wallet = get("03"), bank = get("04");
    if (mobile !== undefined && !/^0066\d{9}$/.test(mobile)) ctx.issue("PROMPTPAY-MOBILE", "warning", "A PromptPay mobile number is 13 digits: 0066 and the number without its leading 0.", "01");
    if (nid !== undefined && !thaiIdOk(nid)) ctx.issue("PROMPTPAY-ID", "warning", "This national ID or tax ID's check digit doesn't match: a typing mistake, or not a Thai ID.", "02");
    if (wallet !== undefined && !digits(wallet, 15)) ctx.issue("PROMPTPAY-WALLET", "warning", "A PromptPay e-wallet ID is 15 digits.", "03");
    const [kind, account] =
      mobile !== undefined ? ["Mobile number", /^0066\d{9}$/.test(mobile) ? "+66 " + mobile.slice(4) : mobile]
      : nid !== undefined ? ["National ID or tax ID", nid]
      : wallet !== undefined ? ["E-wallet ID", wallet]
      : bank !== undefined ? ["Bank account", bank]
      : ["PromptPay ID (missing)", undefined];
    if (account === undefined) ctx.issue("PROMPTPAY-NO-ID", "error", "The PromptPay template names no mobile number, ID, e-wallet or account to pay.");
    return { kind, account, institution: bank !== undefined && bank.length > 3 ? "Bank code " + bank.slice(0, 3) : undefined, details: details(get, PROMPTPAY.names) };
  },
};

const THAI_BILL: Decoder = {
  network: "Thai QR bill payment",
  match: (id, guid) => id === "30" && (guid === "A000000677010112" || guid === "A000000677012006"),
  names: { "01": "Biller ID", "02": "Reference 1", "03": "Reference 2" },
  describe: (_id, get) => ({ kind: "Biller", account: get("01"), details: details(get, THAI_BILL.names, ["01"]) }),
};

const DUITNOW: Decoder = {
  network: "DuitNow QR",
  match: (_id, guid) => guid === "A0000006150001",
  names: { "01": "Acquirer ID", "02": "DuitNow QR ID (merchant, recipient or biller)" },
  describe: (_id, get) => ({ kind: "DuitNow QR ID", account: get("02"), institution: get("01") !== undefined ? "Acquirer " + get("01") : undefined, details: [] }),
};

const VIETQR: Decoder = {
  network: "VietQR (NAPAS 247)",
  match: (_id, guid) => guid === "A000000727",
  names: { "01": "Beneficiary", "02": "Service code" },
  nested: { "01": { "00": "Bank BIN", "01": "Account or card number" } },
  meanings: { "02": { QRIBFTTA: "transfer to a bank account", QRIBFTTC: "transfer to a card" } },
  describe(_id, get, ctx) {
    const service = get("02");
    if (service !== undefined && service !== "QRIBFTTA" && service !== "QRIBFTTC")
      ctx.issue("VIETQR-SERVICE", "warning", "The service code is usually QRIBFTTA (to an account) or QRIBFTTC (to a card).", "02");
    const bin = get("01.00");
    if (bin !== undefined && !digits(bin, 6)) ctx.issue("VIETQR-BIN", "warning", "A bank BIN is 6 digits.", "01.00");
    return {
      kind: service === "QRIBFTTC" ? "Card" : "Bank account",
      account: get("01.01"),
      institution: bin !== undefined ? "Bank BIN " + bin : undefined,
      details: service !== undefined ? [{ label: "Service code", value: service }] : [],
    };
  },
};

const PAYNOW: Decoder = {
  network: "PayNow",
  match: (_id, guid) => guid.toUpperCase() === "SG.PAYNOW",
  names: { "01": "Proxy type", "02": "Proxy value", "03": "Amount can be changed", "04": "Expiry date" },
  meanings: { "01": { "0": "mobile number", "2": "UEN (business registration number)" }, "03": { "0": "no", "1": "yes" } },
  describe(_id, get, ctx) {
    const type = get("01"), expiry = get("04");
    if (expiry !== undefined) {
      const d = yyyymmdd(expiry.slice(0, 8));
      if (!d) ctx.issue("PAYNOW-EXPIRY", "warning", "The expiry date isn't a date in the form YYYYMMDD.", "04");
      else {
        ctx.expires(d);
        if (d < ctx.now) ctx.issue("EXPIRED", "warning", `This PayNow code expired on ${d.toISOString().slice(0, 10)}.`, "04");
      }
    }
    return {
      kind: type === "0" ? "Mobile number" : type === "2" ? "UEN (business)" : "PayNow proxy",
      account: get("02"),
      details: get("03") !== undefined ? [{ label: "Amount can be changed", value: get("03") === "1" ? "yes" : get("03") === "0" ? "no" : get("03")! }] : [],
    };
  },
};

const SGQR: Decoder = {
  network: "SGQR",
  match: (_id, guid) => guid.toUpperCase() === "SG.SGQR",
  names: { "01": "SGQR ID", "02": "Version", "03": "Postal code", "04": "Level", "05": "Unit number", "06": "Miscellaneous", "07": "Revision date" },
  describe: () => null, // SGQR's own template describes the label, not an account
};

const QRIS_CRITERIA: Record<string, string> = { UMI: "micro business", UKE: "small business", UME: "medium business", UBE: "large business", URE: "regular" };

const QRIS_NATIONAL: Decoder = {
  network: "QRIS",
  match: (_id, guid) => guid.toUpperCase() === "ID.CO.QRIS.WWW",
  names: { "02": "National merchant ID (NMID)", "03": "Merchant criteria" },
  meanings: { "03": QRIS_CRITERIA },
  describe: (_id, get) => ({ kind: "National merchant ID (NMID)", account: get("02"), details: details(get, { "03": "Merchant criteria" }) }),
};

const QRIS_PROVIDER: Decoder = {
  network: "QRIS",
  match: (_id, guid) => /^ID\.[A-Z0-9.]+$/i.test(guid) && guid.toUpperCase() !== "ID.CO.QRIS.WWW",
  names: { "01": "Merchant PAN", "02": "Merchant ID", "03": "Merchant criteria" },
  meanings: { "03": QRIS_CRITERIA },
  describe: (_id, get) => ({ kind: "Merchant PAN", account: get("01"), details: details(get, { "02": "Merchant ID", "03": "Merchant criteria" }) }),
};

export const DECODERS: readonly Decoder[] = [KHQR, PROMPTPAY, THAI_BILL, DUITNOW, VIETQR, PAYNOW, SGQR, QRIS_NATIONAL, QRIS_PROVIDER];

/** The card networks' primitive IDs 02 to 25 (EMVCo table 4.1). */
export function primitiveNetwork(id: string): string {
  const n = Number(id);
  if (n <= 3) return "Visa";
  if (n <= 5) return "Mastercard";
  if (n <= 8) return "EMVCo (reserved)";
  if (n <= 10) return "Discover";
  if (n <= 12) return "American Express";
  if (n <= 14) return "JCB";
  if (n <= 16) return "UnionPay";
  return "EMVCo (reserved)";
}
