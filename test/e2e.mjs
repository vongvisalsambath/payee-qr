// The built site in Chromium, served with the production headers from vercel.json.
// Usage: npm run build:site && node test/e2e.mjs
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, devices } from "playwright";

const root = resolve("site-dist");
const port = 4800 + Math.floor(Math.random() * 400);
const base = `http://127.0.0.1:${port}/`;
const fixture = readFileSync("test/fixtures/khqr.txt", "utf8");
let failures = 0;
const check = (ok, name, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${!ok && detail ? "  " + detail : ""}`);
  if (!ok) failures++;
};
const squash = s => (s ?? "").replace(/\s+/g, " ").trim();

const server = spawn("python3", ["test/serve.py", process.env.VERCEL_JSON || "vercel.json", root, String(port)], { stdio: "inherit" });
try {
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(base)).ok) break; } catch { /* starting */ }
    await new Promise(r => setTimeout(r, 100));
  }
  const page0 = await fetch(base);
  const csp = page0.headers.get("content-security-policy") ?? "";
  check(/script-src 'self';/.test(csp) && csp.includes("connect-src 'none'") && csp.includes("require-trusted-types-for 'script'") && csp.includes("frame-ancestors 'none'"), "strict Content-Security-Policy with Trusted Types");
  check((page0.headers.get("permissions-policy") ?? "").includes("camera=(self)"), "only this page may use the camera");

  // a fake camera that shows the fixture code: render the PNG to grey pixels in a browser, write a Y4M video
  const helper = await chromium.launch();
  const hp = await helper.newPage();
  const png = readFileSync("test/fixtures/khqr.png").toString("base64");
  const gray = await hp.evaluate(async b64 => {
    const img = new Image();
    img.src = "data:image/png;base64," + b64;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = 640; c.height = 480;
    const x = c.getContext("2d");
    x.fillStyle = "#eee"; x.fillRect(0, 0, 640, 480);
    const s = Math.min(640 / img.width, 480 / img.height);
    x.drawImage(img, (640 - img.width * s) / 2, (480 - img.height * s) / 2, img.width * s, img.height * s);
    const d = x.getImageData(0, 0, 640, 480).data;
    const out = new Array(640 * 480);
    for (let i = 0; i < out.length; i++) out[i] = Math.round(0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]);
    return out;
  }, png);
  await helper.close();
  const dir = mkdtempSync(join(tmpdir(), "payee-e2e-"));
  const y4m = join(dir, "camera.y4m");
  const frame = Buffer.concat([Buffer.from("FRAME\n"), Buffer.from(gray), Buffer.alloc(640 * 480 / 2, 128)]);
  writeFileSync(y4m, Buffer.concat([Buffer.from("YUV4MPEG2 W640 H480 F10:1 Ip A1:1 C420jpeg\n"), frame, frame]));

  const browser = await chromium.launch({ args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-video-capture=${y4m}`] });
  const open = async (options = {}) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, ...options });
    await ctx.grantPermissions(["camera"], { origin: base.slice(0, -1) });
    const p = await ctx.newPage();
    const problems = [];
    p.on("pageerror", e => problems.push("error: " + e.message));
    p.on("dialog", d => { problems.push("dialog: " + d.message()); d.dismiss(); });
    p.on("console", m => { if (m.type() === "error") problems.push("console: " + m.text().slice(0, 200)); });
    p.on("request", r => { if (!r.url().startsWith(base) && !r.url().startsWith("blob:") && !r.url().startsWith("data:")) problems.push("request: " + r.url()); });
    await p.addInitScript(() => {
      window.__csp = [];
      document.addEventListener("securitypolicyviolation", e => window.__csp.push(e.violatedDirective + " " + e.blockedURI));
    });
    await p.goto(base);
    await p.waitForSelector(".examples .chip");
    const done = async () => [...problems, ...(await p.evaluate(() => window.__csp)).map(v => "csp: " + v)];
    return { ctx, p, done };
  };

  // examples
  {
    const { ctx, p, done } = await open();
    const expect = {
      "KHQR": ["A valid payment code", "demo_coffee@demo", "KHQR (Bakong)"],
      "PromptPay": ["A valid payment code", "+66 000000001", "PromptPay"],
      "DuitNow": ["with warnings", "123456789", "DuitNow QR"],
      "VietQR": ["A valid payment code", "0000000001", "VietQR"],
      "PayNow": ["A valid payment code", "+6500000000", "PayNow"],
      "QRIS": ["A valid payment code", "ID0000000000001", "QRIS"],
      "An edited code": ["changed or damaged", "someone_else@demo", "KHQR"],
      "A disguised name": ["with warnings", "demo_coffee@demo", "KHQR"],
    };
    for (const [label, [verdict, account, network]] of Object.entries(expect)) {
      await p.click(`.examples .chip >> text="${label}"`);
      const v = squash(await p.textContent(".verdict"));
      const pay = squash(await p.textContent(".pay"));
      check(v.includes(verdict) && pay.includes(account) && pay.includes(network), `example: ${label}`, `${v} | ${pay}`);
    }
    await p.click('.examples .chip >> text="A link"');
    check(squash(await p.textContent(".verdict")).includes("isn't a payment code") && (await p.locator("#result a").count()) === 0, "a link is reported, and not made clickable");

    await p.click('.examples .chip >> text="A disguised name"');
    const marker = await p.locator(".caution .hid").first().textContent();
    const raw = await p.evaluate(() => document.getElementById("result").innerText.includes("\u202E"));
    check(marker === "U+202E" && !raw, "a right-to-left override is shown as a marker, never as the character itself");

    await p.click('.examples .chip >> text="KHQR"');
    check((await p.locator(".fields tr").count()) > 15, "every field is listed");
    const issues = await done();
    check(issues.length === 0, "examples: no errors, policy violations or outside requests", issues.join(" | "));
    await ctx.close();
  }

  // pasted text that tries to become markup
  {
    const { ctx, p, done } = await open();
    const hostile = [
      '<img src=x onerror=alert(1)>',
      'javascript:alert(1)',
      '000201' + '5920<script>alert(1)</script>' + '6304ABCD',
      '00020101021229140010a@b<i>x</i>',
      '\u001B[2J\u202Etxt.exe',
      '0'.repeat(20000),
    ];
    for (const text of hostile) {
      await p.fill("#text", text);
      await p.waitForTimeout(250);
      const injected = await p.evaluate(() => document.querySelectorAll("#result img, #result script, #result i, #result a").length);
      check(injected === 0 && (await p.locator(".verdict").count()) === 1, "pasted text stays text: " + JSON.stringify(text.slice(0, 40)));
    }
    const sink = await p.evaluate(() => { try { document.body.insertAdjacentHTML("beforeend", "<b>x</b>"); return "allowed"; } catch (e) { return e.name; } });
    check(sink === "TypeError", "Trusted Types block HTML injection sinks", sink);
    const issues = (await done()).filter(i => !i.includes("require-trusted-types-for") && !i.includes("requires 'TrustedHTML'")); // the deliberate sink test above
    check(issues.length === 0, "hostile paste: no errors, dialogs or outside requests", issues.join(" | "));
    await ctx.close();
  }

  // a photo, then the camera, on a phone
  {
    const { ctx, p, done } = await open({ ...devices["Pixel 7"] });
    const [chooser] = await Promise.all([p.waitForEvent("filechooser"), p.click("#photo-button")]);
    await chooser.setFiles("test/fixtures/khqr.png");
    await p.waitForSelector(".pay", { timeout: 15000 });
    check((await p.inputValue("#text")) === fixture && squash(await p.textContent(".pay")).includes("demo_coffee@demo"), "a photo of a code is read, Khmer text included");

    const [notImage] = await Promise.all([p.waitForEvent("filechooser"), p.click("#photo-button")]);
    await notImage.setFiles({ name: "not-an-image.png", mimeType: "image/png", buffer: Buffer.from("this is not a PNG") });
    await p.waitForFunction(() => document.getElementById("status").textContent.includes("couldn't be opened"));
    check(true, "a file that isn't an image is refused politely");

    await p.fill("#text", "");
    await p.click("#scan");
    await p.waitForFunction(() => document.getElementById("status").textContent.includes("from the camera"), null, { timeout: 20000 });
    check((await p.inputValue("#text")) === fixture && (await p.locator("#camera").isHidden()), "the camera reads the code, then turns itself off");
    const tracks = await p.evaluate(() => document.getElementById("video").srcObject);
    check(tracks === null, "no camera stream is left running");

    const [scroll, width] = await p.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
    check(scroll <= width, "no sideways scrolling on a phone", `page ${scroll}px, screen ${width}px`);
    await p.screenshot({ path: join(dir, "phone.png"), fullPage: true });
    const issues = await done();
    check(issues.length === 0, "phone: no errors or policy violations", issues.join(" | "));
    console.log("     screenshot:", join(dir, "phone.png"));
    await ctx.close();
  }

  // the page can't be framed by another site
  {
    const ctx = await browser.newContext();
    const p = await ctx.newPage();
    await p.setContent(`<iframe src="${base}" width="400" height="300"></iframe>`);
    await p.waitForTimeout(1500);
    const frame = p.frames().find(f => f !== p.mainFrame());
    const framed = frame ? await frame.evaluate(() => !!document.querySelector(".brand")).catch(() => false) : false;
    check(!framed, "the page can't be framed");
    await ctx.close();
  }
  await browser.close();
} finally {
  server.kill();
}
console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
