// The page. Every piece of text from a code is added with textContent; nothing from a code becomes markup.
import jsQR from "jsqr";
import { parse, type Field, type Reading } from "../src/index.js";
import { describe, isHidden } from "../src/text.js";
import { examples } from "./examples.js";

const MAX_FILE = 25 * 1024 * 1024;
const MAX_PIXELS = 50_000_000;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const textArea = $<HTMLTextAreaElement>("text");
const result = $<HTMLElement>("result");
const statusLine = $<HTMLElement>("status");
const video = $<HTMLVideoElement>("video");
const camera = $<HTMLElement>("camera");
const photo = $<HTMLInputElement>("photo");

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, ...children: (Node | string)[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  e.append(...children);
  return e;
}

/** A value as text, with each invisible or direction-changing character shown as a marker instead. */
function value(s: string): DocumentFragment {
  const f = document.createDocumentFragment();
  let run = "";
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (isHidden(cp)) {
      if (run) f.append(run);
      run = "";
      const mark = el("span", "hid", "U+" + cp.toString(16).toUpperCase().padStart(4, "0"));
      mark.title = describe(cp);
      f.append(mark);
    } else run += ch;
  }
  if (run) f.append(run);
  return f;
}

const status = (message: string) => (statusLine.textContent = message);
const utc = (d: Date) => d.toISOString().replace("T", " ").slice(0, 16) + " UTC";

function render(r: Reading) {
  const parts: Node[] = [];
  const errors = r.issues.filter(i => i.severity === "error");
  const crc = r.issues.some(i => i.code === "CRC-MISMATCH");
  const verdict =
    r.kind !== "emv" ? ["bad", "This isn't a payment code", errors[0]?.message ?? ""]
    : crc ? ["bad", "This code was changed or damaged", "Its checksum doesn't match its content. Payment apps refuse it. Don't pay it; ask for a new code."]
    : errors.length ? ["bad", "This code has problems", `${errors.length} error${errors.length === 1 ? "" : "s"}: payment apps may refuse it or read it differently.`]
    : r.issues.length ? ["warn", "A readable payment code, with warnings", "It follows the rules, but look at the warnings below."]
    : ["ok", "A valid payment code", "It follows EMVCo's rules and its checksum matches."];
  parts.push(el("div", "verdict " + verdict[0], el("span", "", verdict[1]!), el("small", "", value(verdict[2]!))));

  if (r.payTo.length) {
    parts.push(el("h2", "sec", "Money goes to"));
    parts.push(el("div", "payto", ...r.payTo.map(p => {
      const card = el("article", "pay", el("span", "net", p.network), el("span", "kind", p.kind));
      if (p.account !== undefined) card.append(el("span", "acct", value(p.account)));
      if (p.institution !== undefined) card.append(el("span", "inst", value(p.institution)));
      if (p.details.length) card.append(el("dl", "", ...p.details.flatMap(d => [el("dt", "", d.label), el("dd", "", value(d.value))])));
      return card;
    })));
    if (r.merchant.name !== undefined) {
      const caution = el("p", "caution", "The name “", value(r.merchant.name), "” ");
      if (r.merchant.nameInLanguage !== undefined) caution.append("and “", value(r.merchant.nameInLanguage), "” ");
      caution.append("are written into the code by whoever made it. Your banking app shows them, but only the account above decides who gets the money.");
      parts.push(caution);
    }
  }

  if (r.kind === "emv") {
    const tiles: [string, string | DocumentFragment][] = [];
    tiles.push(["Amount", r.amount !== undefined ? `${r.amount} ${r.currency?.code ?? r.currency?.numeric ?? ""}`.trim() : "Not set: the payer types it"]);
    if (r.reusable !== undefined) tiles.push(["Kind of code", r.reusable ? "Static: the same code for every payment" : "Dynamic: a code for one payment"]);
    if (r.merchant.name !== undefined) tiles.push(["Merchant name", value(r.merchant.name)]);
    if (r.merchant.nameInLanguage !== undefined) tiles.push([`Name (${r.merchant.language ?? "other language"})`, value(r.merchant.nameInLanguage)]);
    const place = [r.merchant.city, r.merchant.cityInLanguage, r.merchant.postalCode, r.merchant.country].filter((x): x is string => x !== undefined).join(", ");
    if (place) tiles.push(["Place", value(place)]);
    if (r.merchant.category !== undefined) tiles.push(["Merchant category code", value(r.merchant.category)]);
    if (r.tip) tiles.push(["Tip or fee", r.tip.kind === "ask" ? "The app asks the payer for a tip" : r.tip.kind === "fixed" ? `A fixed fee of ${r.tip.value ?? "?"}` : `A fee of ${r.tip.value ?? "?"}%`]);
    if (r.created) tiles.push(["Created", utc(r.created)]);
    if (r.expires) tiles.push([r.expires < new Date() ? "Expired" : "Expires", utc(r.expires)]);
    for (const ref of r.references) tiles.push([ref.label, ref.value === "***" ? "The app asks the payer" : value(ref.value)]);
    parts.push(el("h2", "sec", "What the code says"));
    parts.push(el("div", "summary", ...tiles.map(([k, v]) => el("div", "", el("span", "k", k), el("span", "v", v)))));
  }

  if (r.issues.length) {
    parts.push(el("h2", "sec", r.issues.length === 1 ? "1 problem" : `${r.issues.length} problems`));
    parts.push(el("ul", "issues", ...r.issues.map(i =>
      el("li", i.severity, el("span", "code", `${i.severity === "error" ? "Error" : "Warning"} ${i.code}${i.path ? " · ID " + i.path : ""}`), el("span", "msg", i.message)))));
  }

  if (r.fields.length) {
    parts.push(el("h2", "sec", "Every field"));
    const body = el("tbody", "");
    const add = (f: Field, depth: number) => {
      const val = el("td", "val", value(f.value));
      if (f.meaning) val.append(el("span", "meaning", "= " + f.meaning));
      const row = el("tr", depth ? "d" + Math.min(depth, 2) : "", el("td", "id", f.path), el("td", "name", f.name), val);
      body.append(row);
      // a template's value is its children; show them instead of repeating it
      if (f.children?.length) {
        val.replaceChildren(el("span", "meaning", `${f.children.length} field${f.children.length === 1 ? "" : "s"} below`));
        for (const c of f.children) add(c, depth + 1);
      }
    };
    for (const f of r.fields) add(f, 0);
    parts.push(el("table", "fields", el("thead", "", el("tr", "", el("th", "", "ID"), el("th", "", "Field"), el("th", "", "Value"))), body));
  }
  result.replaceChildren(...parts);
}

function read(text: string) {
  const trimmed = text.replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, "");
  if (!trimmed) {
    result.replaceChildren();
    return;
  }
  render(parse(trimmed));
}

let timer = 0;
textArea.addEventListener("input", () => {
  clearTimeout(timer);
  timer = window.setTimeout(() => read(textArea.value), 120);
});

const exampleBox = document.querySelector<HTMLElement>(".examples")!;
for (const ex of examples()) {
  const b = el("button", "chip", ex.label);
  b.type = "button";
  b.addEventListener("click", () => {
    stopCamera();
    textArea.value = ex.payload;
    status(`Example: ${ex.label}.`);
    read(ex.payload);
  });
  exampleBox.append(b);
}

// ---- decoding images ----

interface Detector { detect(source: CanvasImageSource): Promise<{ rawValue: string }[]> }
let detector: Detector | null | undefined;
async function nativeDetector(): Promise<Detector | null> {
  if (detector !== undefined) return detector;
  detector = null;
  try {
    const BD = (window as unknown as { BarcodeDetector?: { new (o: object): Detector; getSupportedFormats(): Promise<string[]> } }).BarcodeDetector;
    if (BD && (await BD.getSupportedFormats()).includes("qr_code")) detector = new BD({ formats: ["qr_code"] });
  } catch { /* not available */ }
  return detector;
}

const canvas = document.createElement("canvas");
const ctx = canvas.getContext("2d", { willReadFrequently: true })!;

function bytesToText(bytes: number[], fallback: string): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(bytes));
  } catch {
    return fallback;
  }
}

async function decode(source: CanvasImageSource, width: number, height: number): Promise<string | null> {
  const native = await nativeDetector();
  if (native) {
    try {
      const found = await native.detect(source);
      if (found[0]?.rawValue) return found[0].rawValue;
    } catch { /* fall back to jsQR */ }
  }
  for (const max of [1200, 640]) {
    const scale = Math.min(1, max / Math.max(width, height));
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const code = jsQR(image.data, image.width, image.height, { inversionAttempts: "attemptBoth" });
    if (code) return bytesToText(code.binaryData, code.data);
    if (scale === 1) break;
  }
  return null;
}

function found(text: string, from: string) {
  textArea.value = text;
  status(`Read a code from ${from}.`);
  read(text);
}

// ---- photo ----

$<HTMLButtonElement>("photo-button").addEventListener("click", () => photo.click());
photo.addEventListener("change", async () => {
  const file = photo.files?.[0];
  photo.value = "";
  if (!file) return;
  stopCamera();
  if (file.size > MAX_FILE) return void status("That file is over 25 MB; use a smaller photo or a screenshot of the code.");
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("unreadable"));
      img.src = url;
    });
    if (img.naturalWidth * img.naturalHeight > MAX_PIXELS) return void status("That image is too large to read here; crop it to the code.");
    status("Looking for a code…");
    const text = await decode(img, img.naturalWidth, img.naturalHeight);
    if (text === null) status("No QR code found in that image. Try a sharper, closer photo with the whole code in view.");
    else found(text, "the photo");
  } catch {
    status("That file couldn't be opened as an image.");
  } finally {
    URL.revokeObjectURL(url);
  }
});

// ---- camera ----

let stream: MediaStream | null = null;
let busy = false;
let lastTry = 0;

async function startCamera() {
  if (stream) return;
  if (!navigator.mediaDevices?.getUserMedia) return void status("This browser can't use the camera on this page. Open a photo of the code instead.");
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
  } catch (e) {
    const name = e instanceof DOMException ? e.name : "";
    return void status(name === "NotAllowedError" ? "Camera access was refused. Allow it in your browser's site settings, or open a photo instead." : name === "NotFoundError" ? "No camera was found. Open a photo of the code instead." : "The camera couldn't be started. Open a photo of the code instead.");
  }
  video.srcObject = stream;
  camera.hidden = false;
  status("Point the camera at a payment QR code.");
  try { await video.play(); } catch { /* autoplay rules; the frames still arrive */ }
  requestAnimationFrame(tick);
}

async function tick(time: number) {
  if (!stream) return;
  if (!busy && time - lastTry > 200 && video.readyState >= 2 && video.videoWidth) {
    busy = true;
    lastTry = time;
    try {
      const text = await decode(video, video.videoWidth, video.videoHeight);
      if (text !== null && stream) {
        stopCamera();
        found(text, "the camera");
      }
    } finally {
      busy = false;
    }
  }
  if (stream) requestAnimationFrame(tick);
}

function stopCamera() {
  stream?.getTracks().forEach(t => t.stop());
  stream = null;
  video.srcObject = null;
  camera.hidden = true;
}

$<HTMLButtonElement>("scan").addEventListener("click", () => void startCamera());
$<HTMLButtonElement>("stop").addEventListener("click", () => {
  stopCamera();
  status("Camera stopped.");
});
document.addEventListener("visibilitychange", () => { if (document.hidden && stream) { stopCamera(); status("Camera stopped while the page was hidden."); } });
