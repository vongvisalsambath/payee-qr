# Payee

**Who does this payment QR really pay?** Payee reads EMV payment QR codes, the kind used by KHQR (Cambodia), PromptPay (Thailand), DuitNow (Malaysia), QRIS (Indonesia), VietQR (Vietnam), PayNow and SGQR (Singapore) and many others. It does three things:
- says which account a payment would go to;
- explains every field in plain English;
- checks the code against EMVCo's specification.

It comes as a TypeScript library with no dependencies, and a website that runs entirely in the browser: scan with the camera, open a photo or paste the text. Nothing is uploaded.

## Why

A payment QR code holds the account the money goes to. The shop name your banking app shows is just text that whoever made the code typed in. Printing a new code over a shop's sticker is a known fraud: the code is perfectly valid and shows the shop's name, but it pays someone else.

Payee puts the account first, so you see what will actually be paid:

```ts
parse("00020101021229460016demo_coffee@demo…").payTo
// [{ network: "KHQR (Bakong)", kind: "Bakong account (individual)", account: "demo_coffee@demo", institution: "Demo Bank", … }]
```

It also catches codes that were changed after they were made. Every EMV code ends with a checksum, and changing one character makes it fail. The checksum isn't a signature, though: a fraudster's own new code passes it. That's why the account matters more than the verdict.

## Library

> Not on npm yet. Build from source: `npm ci && npm run build`, then import from `dist/`.

```ts
import { parse } from "payee-qr";

const r = parse(text);              // never throws; everything is in the reading
r.valid;                            // false if anything is an error (warnings are allowed)
r.payTo;                            // [{ network, kind, account, institution, details }] — one per payment network in the code
r.merchant;                         // { name, city, country, postalCode, category, language, nameInLanguage, cityInLanguage }
r.amount; r.currency;               // "2.50", { numeric: "840", code: "USD", decimals: 2 }; no amount means the payer types it
r.reusable;                         // true for a static code (11), false for a one-payment code (12)
r.created; r.expires;               // KHQR timestamps, PayNow expiry
r.references;                       // bill number, terminal, purpose… ("***" means the app asks the payer)
r.issues;                           // [{ code, severity, message, path, offset }]
r.fields;                           // every data object, nested, with names and the meaning of coded values
```

`build([["00", "01"], ["29", [["00", "name@bank"]]], …])` writes a payload with its checksum, for tests and examples. `crc16(text)` is the checksum itself.

### What is checked

The rules come from EMVCo's *QR Code Specification for Payment Systems: Merchant-Presented Mode*, v1.1:

| Code | Severity | Meaning |
|---|---|---|
| `NOT-EMV` | error | The code holds a link or other text, not a payment code. A link isn't followed or made clickable. |
| `MALFORMED` | error | The ID-length-value structure breaks: a non-digit ID, a length of 00, or a value that runs past the end. The message gives the position. |
| `CRC-MISMATCH` | error | The checksum doesn't match: the code was damaged, misread or edited. Also `CRC-MISSING`, `CRC-NOT-LAST`, `CRC-FORMAT`, and `CRC-LOWERCASE` (warning). |
| `DUPLICATE` | error | An ID appears twice, so apps may read either value. |
| `MISSING`, `ORDER`, `NO-ACCOUNT` | error | A required object is missing (payload format, MCC, currency, country, name, city, an account), or ID 00 isn't first. |
| `AMOUNT` | error | The amount isn't digits with one optional `.`, or it's zero. `AMOUNT-DECIMALS` (warning): more decimals than the currency has. |
| `VALUE`, `UNEXPECTED`, `FORMAT`, `LENGTH` | error | A coded value isn't allowed: point of initiation, tip indicator and fees, consumer data request, digits-only fields, fixed lengths. |
| `HIDDEN-CHARACTERS` | warning | A value contains invisible or direction-changing characters, such as a right-to-left override or a zero-width space. These can make a name display as something else. |
| `CHARSET`, `TOO-LONG-VALUE`, `RESERVED`, `PFI-VERSION`, `CURRENCY-UNKNOWN`, `COUNTRY`, `LONG-PAYLOAD` | warning | Outside the specification, but codes like these do circulate and get paid. |
| `EXPIRED` | warning | A KHQR or PayNow code past its expiry time. |
| `PROMPTPAY-ID`, `PROMPTPAY-MOBILE`, `PROMPTPAY-WALLET`, `VIETQR-BIN`, `VIETQR-SERVICE`, `KHQR-RIEL-DECIMALS`, `KHQR-TIMESTAMP` | warning | Network-specific checks, such as the check digit of a Thai national ID or tax ID. `PROMPTPAY-NO-ID` is an error. |

Lengths count characters, not bytes, and the checksum covers the UTF-8 bytes, as in EMVCo's own example, which has Chinese text. Both are tested against the example in the specification's appendix.

### Where the network details come from

EMVCo defines the outer structure; each network defines what goes inside its own template. Some of those definitions are public and some aren't:

| Network | Template | Source |
|---|---|---|
| DuitNow | 26, `A0000006150001` | PayNet's published DuitNow QR specification. Its four example codes are in the tests and pass with their published checksums. |
| KHQR | 29 (individual), 30 (merchant), 99 (timestamps) | ABA PayWay's published KHQR guideline. NBC's own specification wasn't available to check against. |
| PromptPay | 29 `A000000677010111`, 30 `A000000677010112` (bill payment) | Open-source readers of Thai QR codes. The Thai Bankers' Association specification isn't published openly. |
| VietQR | 38, `A000000727` | Open-source readers of NAPAS codes. |
| PayNow, SGQR | 26 `SG.PAYNOW`, 51 `SG.SGQR` | Open-source PayNow generators. |
| QRIS | 51 `ID.CO.QRIS.WWW`, and providers' `ID.…` templates | Published sample codes and open-source readers. |
| Card networks | 02 to 25 | EMVCo's allocation table: Visa, Mastercard, Discover, Amex, JCB, UnionPay. |

A template from any other network is still shown, field by field, as "Unrecognised network". Corrections from people with access to the national specifications are very welcome.

## Website

```
npm ci
npm run dev           # http://127.0.0.1:8010
npm run build:site    # static site in site-dist/
npm run test:e2e      # the built site in Chromium, with the production headers
```

The camera uses the browser's own `BarcodeDetector` where there is one, and [jsQR](https://github.com/cozmo/jsQR) (Apache-2.0) otherwise, bundled into the page. The browser tests do the following:
- feed a fake camera a photo of a KHQR code, check the reader decodes it, and check the camera then turns off;
- open the same photo through the file picker;
- try pasted text that looks like markup;
- check the page's security headers.

## Tests

```
npm test
```

The tests cover:
- the official examples (EMVCo's, and PayNet's four DuitNow codes);
- every network's template;
- every error and warning;
- 20,000 randomly damaged codes, which must never throw and must finish fast;
- worst-case inputs up to 10 MB;
- the names of JavaScript's built-in properties used as values;
- invisible characters, which must never reach a message.

## Security

See [SECURITY.md](SECURITY.md).

## Licence

Apache-2.0 (see [LICENSE](LICENSE)). Not affiliated with EMVCo or any payment network; KHQR, PromptPay, DuitNow, QRIS, VietQR, PayNow and SGQR are their owners' names. All example accounts are made up. Written with the help of Claude (Anthropic).
