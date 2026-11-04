import assert from "node:assert/strict";
import { test } from "node:test";
import { build, crc16, parse, thaiIdOk, type DataObject, type Reading } from "../src/index.js";

const codes = (r: Reading) => r.issues.map(i => i.code);
const errors = (r: Reading) => r.issues.filter(i => i.severity === "error").map(i => i.code);
const NOW = new Date("2026-11-04T12:00:00Z");

/** The required objects around a merchant account template, in a typical order. */
function code(account: DataObject[], extra: DataObject[] = [], head: DataObject[] = [["00", "01"], ["01", "12"]]): string {
  return build([...head, ...account, ["52", "5999"], ["53", "116"], ["58", "KH"], ["59", "DEMO SHOP"], ["60", "Phnom Penh"], ...extra]);
}

// ---- official examples ----

test("CRC-16/CCITT-FALSE check value", () => assert.equal(crc16("123456789"), "29B1"));

test("PayNet's published DuitNow examples are valid, with the checksums they publish", () => {
  const examples: [string, string, string | undefined][] = [
    ["00020201021126410014A000000615000101065016640209123456789520499995303458540510.005802MY5909QRCSDNBHD6005BANGI6304343F", "123456789", "10.00"],
    ["00020201021126410014A000000615000101065016640209123456789520400005303458540510.005802MY5909AUSERNAME6005BANGI63043A23", "123456789", "10.00"],
    ["00020201021126410014A000000615000101065016640209123456789520499995303458540510.005802MY5909QRCSDNBHD6005BANGI8264f879ac6266d8d6da081fc1c17160021119747b190615c21076b3fc0fce56c6eb6304B623", "123456789", "10.00"],
    ["00020201021126360014A00000061500010106898989020412345204111153034585802MY5903TNB6002KL610559200621790130124007552406823231d4db4506dc9852b1c21c74be148b8363045DFB", "1234", undefined],
  ];
  for (const [payload, account, amount] of examples) {
    const r = parse(payload);
    assert.equal(r.valid, true, JSON.stringify(r.issues));
    assert.deepEqual(codes(r), ["PFI-VERSION"]); // DuitNow uses payload format "02"
    assert.equal(r.payTo[0]?.network, "DuitNow QR");
    assert.equal(r.payTo[0]?.account, account);
    assert.equal(r.amount, amount);
    assert.equal(r.currency?.code, "MYR");
    assert.equal(r.reusable, true);
  }
});

test("EMVCo's own example (v1.1 appendix B.7), with Chinese text in the language template, is valid", () => {
  const payload =
    "00020101021229300012D156000000000510A93FO3230Q31280012D15600000001030812345678520441115802CN5914BEST TRANSPORT6007BEIJING" +
    "64200002ZH0104最佳运输0202北京540523.7253031565502016233030412340603***0708A60086670902ME91320016A0112233449988770708123456786304A13A";
  const r = parse(payload);
  assert.equal(r.valid, true, JSON.stringify(r.issues));
  assert.deepEqual(r.issues, []);
  assert.equal(r.merchant.nameInLanguage, "最佳运输");
  assert.equal(r.merchant.cityInLanguage, "北京");
  assert.equal(r.amount, "23.72");
  assert.equal(r.currency?.code, "CNY");
  assert.equal(r.reusable, false);
  assert.deepEqual(r.tip, { kind: "ask" });
  assert.deepEqual(r.references, [{ label: "Store label", value: "1234" }, { label: "Customer label", value: "***" }, { label: "Terminal label", value: "A6008667" }]);
  assert.equal(r.fields.find(f => f.id === "62")?.children?.find(f => f.id === "09")?.meaning, "the app sends the payer's mobile number, email");
  assert.equal(r.payTo.length, 2);
});

// ---- networks ----

test("KHQR: an individual Bakong account, its bank, and its timestamps", () => {
  const created = Date.UTC(2026, 10, 4, 11, 0), expires = Date.UTC(2026, 10, 4, 13, 0);
  const r = parse(
    code([["29", [["00", "demo_shop@demo"], ["01", "000123456"], ["02", "Demo Bank"]]]], [["54", "25000"], ["99", [["00", String(created)], ["01", String(expires)]]]]),
    { now: NOW },
  );
  assert.equal(r.valid, true, JSON.stringify(r.issues));
  assert.deepEqual(r.payTo, [{ network: "KHQR (Bakong)", path: "29", kind: "Bakong account (individual)", account: "demo_shop@demo", institution: "Demo Bank", details: [{ label: "Account information", value: "000123456" }] }]);
  assert.equal(r.created?.getTime(), created);
  assert.equal(r.expires?.getTime(), expires);
  assert.equal(r.fields.find(f => f.id === "29")?.name, "Merchant account: KHQR (Bakong)");
});

test("KHQR: a merchant account; an expired code; riel with decimals", () => {
  const r = parse(code([["30", [["00", "demo_shop@demo"], ["01", "123456789012345"], ["02", "Demo Bank"]]]], [["54", "1000.50"], ["99", [["00", "1700000000000"], ["01", "1700000600000"]]]]), { now: NOW });
  assert.equal(r.payTo[0]?.kind, "Bakong account (merchant)");
  assert.deepEqual(r.payTo[0]?.details, [{ label: "Merchant ID", value: "123456789012345" }]);
  assert.deepEqual(codes(r), ["EXPIRED", "KHQR-RIEL-DECIMALS"]);
  assert.equal(r.valid, true); // warnings only
});

test("PromptPay: mobile number, national ID with its check digit, e-wallet; Thai bill payment", () => {
  const thai = (account: DataObject[]) => build([["00", "01"], ["01", "11"], ...account, ["52", "0000"], ["53", "764"], ["58", "TH"], ["59", "DEMO"], ["60", "BANGKOK"]]);
  const mobile = parse(thai([["29", [["00", "A000000677010111"], ["01", "0066000000001"]]]]));
  assert.equal(mobile.valid, true, JSON.stringify(mobile.issues));
  assert.deepEqual([mobile.payTo[0]?.network, mobile.payTo[0]?.kind, mobile.payTo[0]?.account], ["PromptPay", "Mobile number", "+66 000000001"]);

  assert.equal(thaiIdOk("1101700230708"), true);
  assert.equal(thaiIdOk("1101700230709"), false);
  const good = parse(thai([["29", [["00", "A000000677010111"], ["02", "1101700230708"]]]]));
  assert.deepEqual(codes(good), []);
  const typo = parse(thai([["29", [["00", "A000000677010111"], ["02", "1101700230709"]]]]));
  assert.deepEqual(codes(typo), ["PROMPTPAY-ID"]);
  assert.equal(typo.issues[0]?.path, "29.02");

  const none = parse(thai([["29", [["00", "A000000677010111"]]]]));
  assert.deepEqual(errors(none), ["PROMPTPAY-NO-ID"]);

  const bill = parse(thai([["30", [["00", "A000000677010112"], ["01", "010000000000001"], ["02", "INV445"]]]]));
  assert.deepEqual([bill.payTo[0]?.network, bill.payTo[0]?.account], ["Thai QR bill payment", "010000000000001"]);
  assert.deepEqual(bill.payTo[0]?.details, [{ label: "Reference 1", value: "INV445" }]);
});

test("VietQR: the beneficiary template inside the template", () => {
  const r = parse(build([["00", "01"], ["01", "12"], ["38", [["00", "A000000727"], ["01", [["00", "970400"], ["01", "0000000001"]]], ["02", "QRIBFTTA"]]],
    ["53", "704"], ["54", "150000"], ["58", "VN"], ["62", [["08", "Invoice 445"]]], ["52", "0000"], ["59", "DEMO"], ["60", "HA NOI"]]));
  assert.equal(r.valid, true, JSON.stringify(r.issues));
  assert.deepEqual(r.payTo[0], { network: "VietQR (NAPAS 247)", path: "38", kind: "Bank account", account: "0000000001", institution: "Bank BIN 970400", details: [{ label: "Service code", value: "QRIBFTTA" }] });
  assert.equal(r.fields.find(f => f.id === "38")?.children?.[2]?.meaning, "transfer to a bank account");
  assert.deepEqual(r.fields.find(f => f.id === "38")?.children?.[1]?.children?.map(f => f.name), ["Bank BIN", "Account or card number"]);
  const decimals = parse(build([["00", "01"], ["38", [["00", "A000000727"], ["01", [["00", "970400"], ["01", "1"]]]]], ["52", "0000"], ["53", "704"], ["54", "1000.5"], ["58", "VN"], ["59", "D"], ["60", "C"]]));
  assert.deepEqual(codes(decimals), ["AMOUNT-DECIMALS"]);
});

test("PayNow and SGQR: proxy, editable amount, expiry", () => {
  const r = parse(build([["00", "01"], ["01", "12"], ["26", [["00", "SG.PAYNOW"], ["01", "2"], ["02", "000000000X"], ["03", "0"], ["04", "20261031"]]],
    ["51", [["00", "SG.SGQR"], ["01", "000000000000"], ["02", "01.0001"]]], ["52", "0000"], ["53", "702"], ["54", "12.50"], ["58", "SG"], ["59", "DEMO"], ["60", "Singapore"]]), { now: NOW });
  assert.deepEqual(r.payTo.map(p => [p.network, p.kind, p.account]), [["PayNow", "UEN (business)", "000000000X"]]);
  assert.deepEqual(codes(r), ["EXPIRED"]);
  assert.equal(r.expires?.toISOString(), "2026-10-31T23:59:59.000Z");
  assert.equal(r.fields.find(f => f.id === "26")?.children?.[1]?.meaning, "UEN (business registration number)");
  assert.equal(r.fields.find(f => f.id === "51")?.name, "Merchant account: SGQR");
});

test("QRIS: the national merchant ID and a provider's template", () => {
  const r = parse(build([["00", "01"], ["01", "11"], ["26", [["00", "ID.CO.DEMOBANK.WWW"], ["01", "936000000000000001"], ["02", "000000000000001"], ["03", "UMI"]]],
    ["51", [["00", "ID.CO.QRIS.WWW"], ["02", "ID0000000000001"], ["03", "UMI"]]], ["52", "5812"], ["53", "360"], ["58", "ID"], ["59", "DEMO"], ["60", "JAKARTA"]]));
  assert.equal(r.valid, true, JSON.stringify(r.issues));
  assert.deepEqual(r.payTo.map(p => [p.network, p.kind, p.account]), [["QRIS", "Merchant PAN", "936000000000000001"], ["QRIS", "National merchant ID (NMID)", "ID0000000000001"]]);
  assert.equal(r.fields.find(f => f.id === "51")?.children?.[2]?.meaning, "micro business");
});

test("card networks' primitive IDs and unknown networks", () => {
  const r = parse(code([["02", "4000123412341234"], ["04", "5100123412341234"], ["27", [["00", "COM.EXAMPLE.PAY"], ["01", "ABC"]]]]));
  assert.deepEqual(r.payTo.map(p => [p.network, p.account ?? p.institution]), [["Visa", "4000123412341234"], ["Mastercard", "5100123412341234"], ["Unrecognised network", "COM.EXAMPLE.PAY"]]);
});

// ---- what makes a code invalid ----

const GOOD = code([["29", [["00", "demo_shop@demo"], ["02", "Demo Bank"]]]], [["54", "100"]]);

test("the good code used below is valid", () => assert.deepEqual(parse(GOOD).issues, []));

test("one changed character breaks the checksum", () => {
  const edited = GOOD.replace("demo_shop@demo", "evil_shop@demo");
  const r = parse(edited);
  assert.deepEqual(errors(r), ["CRC-MISMATCH"]);
  assert.match(r.issues[0]!.message, /changed after it was made/);
  // the account is still shown, so the person can see what the edited code would pay
  assert.equal(r.payTo[0]?.account, "evil_shop@demo");
});

test("checksum: lowercase, missing, not last, not hexadecimal", () => {
  const body = GOOD.slice(0, -4);
  const crc = GOOD.slice(-4);
  if (/[A-F]/.test(crc)) assert.deepEqual(codes(parse(body + crc.toLowerCase())), ["CRC-LOWERCASE"]);
  assert.deepEqual(errors(parse(GOOD.slice(0, -8))), ["CRC-MISSING"]);
  const after = GOOD + "0102AB";
  assert.ok(errors(parse(after)).includes("CRC-NOT-LAST"));
  assert.deepEqual(errors(parse(body + "ZZZZ")), ["CRC-FORMAT"]);
});

test("structure: length past the end, a non-digit ID, length 00, leftovers", () => {
  const cases: [string, RegExp][] = [
    ["000201010212299900", /says its value is 99 characters long/],
    ["0002010A01X", /expected a two-digit ID/],
    ["0002010100", /length 00/],
    ["00020101", /left over/],
  ];
  for (const [payload, message] of cases) {
    const r = parse(payload);
    assert.equal(r.valid, false);
    const m = r.issues.find(i => i.code === "MALFORMED");
    assert.ok(m, payload);
    assert.match(m.message, message);
    assert.equal(typeof m.offset, "number");
  }
});

test("duplicate IDs, at the root and inside templates", () => {
  const r = parse(code([["29", [["00", "a@b"], ["02", "Bank"], ["02", "Other bank"]]]], [["59", "SECOND NAME"]]));
  assert.deepEqual(errors(r).sort(), ["DUPLICATE", "DUPLICATE"]);
  assert.deepEqual(r.issues.filter(i => i.code === "DUPLICATE").map(i => i.path).sort(), ["29.02", "59"]);
});

test("payload format indicator: missing, not first, another version", () => {
  assert.ok(errors(parse(build([["01", "11"], ["29", [["00", "a@b"]]], ["52", "0000"], ["53", "116"], ["58", "KH"], ["59", "D"], ["60", "C"]]))).includes("MISSING"));
  assert.ok(errors(parse(build([["01", "11"], ["00", "01"], ["29", [["00", "a@b"]]], ["52", "0000"], ["53", "116"], ["58", "KH"], ["59", "D"], ["60", "C"]]))).includes("ORDER"));
});

test("required objects missing, and no account at all", () => {
  const r = parse(build([["00", "01"], ["53", "116"]]));
  assert.deepEqual(r.issues.filter(i => i.code === "MISSING").map(i => i.path), ["52", "58", "59", "60"]);
  assert.ok(errors(r).includes("NO-ACCOUNT"));
});

test("amounts: commas, spaces, signs, zero; '98.' is allowed", () => {
  for (const bad of ["98,73", "3 705", "-5", "1e3", ".5", "0", "0.00"]) assert.deepEqual(errors(parse(code([["29", [["00", "a@b"]]]], [["54", bad]]))), ["AMOUNT"], bad);
  assert.deepEqual(parse(code([["29", [["00", "a@b"]]]], [["54", "98."]])).issues, []);
});

test("tip and convenience fees follow their indicator", () => {
  const acct: DataObject[] = [["29", [["00", "a@b"]]]];
  assert.deepEqual(parse(code(acct, [["55", "02"], ["56", "1.00"]])).tip, { kind: "fixed", value: "1.00" });
  assert.deepEqual(errors(parse(code(acct, [["55", "02"]]))), ["MISSING"]);
  assert.deepEqual(errors(parse(code(acct, [["55", "03"], ["57", "150"]]))), ["VALUE"]);
  assert.deepEqual(errors(parse(code(acct, [["56", "1.00"]]))), ["UNEXPECTED"]);
  assert.deepEqual(errors(parse(code(acct, [["55", "04"]]))), ["VALUE"]);
});

test("formats and lengths", () => {
  const acct: DataObject[] = [["29", [["00", "a@b"]]]];
  assert.deepEqual(errors(parse(build([["00", "01"], ...acct, ["52", "59A9"], ["53", "116"], ["58", "KH"], ["59", "D"], ["60", "C"]]))), ["FORMAT"]);
  assert.deepEqual(errors(parse(build([["00", "01"], ...acct, ["52", "599"], ["53", "116"], ["58", "KH"], ["59", "D"], ["60", "C"]]))), ["LENGTH"]);
  assert.deepEqual(codes(parse(build([["00", "01"], ...acct, ["52", "5999"], ["53", "116"], ["58", "KH"], ["59", "A NAME THAT IS FAR TOO LONG FOR EMV"], ["60", "C"]]))), ["TOO-LONG-VALUE"]);
  assert.deepEqual(codes(parse(build([["00", "01"], ...acct, ["52", "5999"], ["53", "116"], ["58", "KH"], ["59", "ហាងកាហ្វេ"], ["60", "C"]]))), ["CHARSET"]);
  assert.deepEqual(codes(parse(build([["00", "01"], ...acct, ["52", "5999"], ["53", "999"], ["58", "KH"], ["59", "D"], ["60", "C"]]))), ["CURRENCY-UNKNOWN"]);
  assert.deepEqual(errors(parse(code(acct, [["01", "13"]], [["00", "01"]]))), ["VALUE"]);
});

test("additional data and language templates", () => {
  const acct: DataObject[] = [["29", [["00", "a@b"]]]];
  assert.deepEqual(errors(parse(code(acct, [["62", [["09", "AA"]]]]))), ["VALUE"]);
  assert.deepEqual(codes(parse(code(acct, [["62", [["20", "x"]]]]))), ["RESERVED"]);
  assert.deepEqual(errors(parse(code(acct, [["64", [["00", "KM"]]]]))), ["MISSING"]);
  const km = parse(code(acct, [["64", [["00", "KM"], ["01", "ហាងកាហ្វេ"], ["02", "ភ្នំពេញ"]]]]));
  assert.deepEqual(km.issues, []);
  assert.equal(km.merchant.nameInLanguage, "ហាងកាហ្វេ");
  assert.equal(parse(code(acct, [["62", [["11", "210"]]]])).fields.find(f => f.id === "62")?.children?.[0]?.meaning, "magazine or poster, away from the merchant");
  assert.deepEqual(codes(parse(code(acct, [["70", "x"]]))), ["RESERVED"]);
  assert.deepEqual(errors(parse(code(acct, [["62", "not a template"]]))), ["MALFORMED"]);
});

// ---- not payment codes ----

test("links, text, empty input, huge input, non-strings", () => {
  const link = parse("https://pay.example.com/abc");
  assert.deepEqual([link.kind, errors(link)], ["link", ["NOT-EMV"]]);
  assert.equal(parse("hello").kind, "text");
  assert.equal(parse("").kind, "empty");
  const huge = parse("0".repeat(5000));
  assert.deepEqual(errors(huge), ["TOO-LONG"]);
  assert.equal(parse(null as unknown as string).kind, "empty");
  assert.equal(parse({} as unknown as string).kind, "empty");
});

test("build refuses what it can't encode", () => {
  assert.throws(() => build([["1", "x"]]), RangeError);
  assert.throws(() => build([["59", ""]]), RangeError);
  assert.throws(() => build([["59", "x".repeat(100)]]), RangeError);
});
