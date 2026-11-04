# Security

Payee reads QR codes from anywhere: a sticker on a counter, a photo in a chat, text pasted from a message. So the library and the website treat every code as hostile.

## Reporting a problem

Please report vulnerabilities privately through GitHub's **Security → Report a vulnerability** on this repository, not in a public issue.

## What is protected, and how

| Threat | Protection | Tested by |
|---|---|---|
| **Paying the wrong account** | The account a payment goes to is shown first, for every network in the code, and the page says plainly that the displayed name is only text. A changed account fails the checksum (`CRC-MISMATCH`), and the verdict says not to pay. | `a changed account is always caught by the checksum` (2,000 random edits); e2e "An edited code" |
| **A name disguised with invisible characters** | Right-to-left overrides, zero-width characters, controls and similar characters produce a `HIDDEN-CHARACTERS` warning naming the exact field. Messages show them as `‮`, and the page shows them as visible markers. Every value is isolated from the text around it (`unicode-bidi: isolate`). | hostile tests; e2e "a right-to-left override is shown as a marker, never as the character itself" |
| **Links posing as payment codes** | A code holding a URL is reported as `NOT-EMV`, with the link shown as text, never as a clickable link. | e2e "a link is reported, and not made clickable" |
| **Crashes and runaway work** | `parse` never throws: 20,000 randomly damaged codes and inputs of any type are tested. Input over 4,096 characters is refused before it is split, and there are at most 200 issues. Templates nest at most three levels, the deepest EMV codes have. | `20,000 mutated codes…`, `the worst inputs at the size limit finish quickly` (each under 200 ms, a 10 MB input included) |
| **Prototype pollution** | Lookups keyed by values from a code use own properties only, so `__proto__`, `constructor` or `toString` in a code are ordinary text. | `names of JavaScript's built-in properties are ordinary values` |
| **Terminal escapes** | Messages quote values only after escaping control characters, and cut them to 80 characters. | `terminal escape sequences never reach a message` |
| **Script injection in the website** | All text goes into the page with `textContent`; nothing from a code becomes markup. Trusted Types are enforced, so even a future mistake (`innerHTML` with code data) would be blocked by the browser. | e2e "pasted text stays text", "Trusted Types block HTML injection sinks" |
| **Data leaving the device** | No server, no analytics. The page's Content-Security-Policy has `connect-src 'none'`, and it loads nothing from other origins. Photos are read locally through a temporary `blob:` URL that is released straight away. | e2e: every request is checked to be same-origin |
| **The camera** | Only this page may use it (`Permissions-Policy: camera=(self)`). It starts only when you press the button. It stops as soon as a code is read, when you press Stop, or when the page is hidden. | e2e "the camera reads the code, then turns itself off", "no camera stream is left running" |
| **Huge or hostile images** | Files over 25 MB and images over 50 megapixels are refused. Images are scaled down to 1,200 pixels before decoding. A file that isn't an image gets a plain message. | e2e "a file that isn't an image is refused politely" |
| **Clickjacking** | `frame-ancestors 'none'` and `X-Frame-Options: DENY`. | e2e "the page can't be framed" |
| **Supply chain** | The library has no dependencies. The site bundles one, jsQR 1.4.0 (Apache-2.0), at an exact version. Development tools are pinned with a lockfile. CI runs `npm audit` and pins GitHub Actions to commits. | CI |

## What it doesn't do

- It doesn't check that an account exists, belongs to the shop, or is safe to pay. Nothing outside the code can be checked without the payment network.
- A valid checksum only means the code wasn't changed after it was made. Anyone can make a valid code for their own account.
- Some national specifications aren't public (see the README), so their network-specific checks are only as good as the published sources.
