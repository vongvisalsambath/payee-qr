import type { Currency } from "./currencies.js";

export type Severity = "error" | "warning";

/** A problem found in a code. Errors mean a payment app should refuse it; warnings are worth knowing. */
export interface Issue {
  code: string;
  severity: Severity;
  /** Plain-English explanation. Values quoted in it are escaped and shortened, so it is safe to print. */
  message: string;
  /** The data object, e.g. "62.01" for the bill number inside the additional data template. */
  path?: string;
  /** Where in the payload, in characters from the start. */
  offset?: number;
}

/** One data object as read from the code. */
export interface Field {
  id: string;
  /** "26", "26.01", "38.01.00"… */
  path: string;
  name: string;
  value: string;
  offset: number;
  /** What the value means, when it is coded ("11" → "static: the same code for every payment"). */
  meaning?: string;
  children?: Field[];
}

/** Where a payment made with the code goes, as one payment network reads it. */
export interface PayTo {
  /** The network, e.g. "KHQR (Bakong)", "PromptPay", "Visa". */
  network: string;
  /** The template or ID it came from, e.g. "29". */
  path: string;
  /** What the account is: "Bakong account", "Mobile number", "Bank account"… */
  kind: string;
  /** The account, number or ID that receives the money, as written in the code. */
  account?: string;
  /** The bank or institution, when the code says. */
  institution?: string;
  /** Everything else the template says, in order. */
  details: { label: string; value: string }[];
}

export interface Reading {
  /** True when the code has no errors (it may have warnings). */
  valid: boolean;
  /** "emv" for an EMV payment code; "link" for a URL; "text" for anything else; "empty". */
  kind: "emv" | "link" | "text" | "empty";
  payload: string;
  fields: Field[];
  /** Every account the code can pay, one per payment network it lists. */
  payTo: PayTo[];
  merchant: {
    name?: string;
    city?: string;
    country?: string;
    postalCode?: string;
    category?: string;
    language?: string;
    nameInLanguage?: string;
    cityInLanguage?: string;
  };
  currency?: Currency;
  /** The amount as written ("10.00"); absent when the payer types it. */
  amount?: string;
  /** "11": the same code for every payment (static); "12": a code for one payment (dynamic). */
  reusable?: boolean;
  tip?: { kind: "ask" | "fixed" | "percent"; value?: string };
  /** Bill number, reference, terminal… from the additional data template. "***" means the app asks the payer. */
  references: { label: string; value: string }[];
  created?: Date;
  expires?: Date;
  issues: Issue[];
}
