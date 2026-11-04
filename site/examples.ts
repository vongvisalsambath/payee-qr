// Example codes. Every account is made up, except DuitNow's, which is PayNet's published test code.
import { build } from "../src/index.js";

const ymd = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, "");

export function examples(now = new Date()): { label: string; payload: string }[] {
  const khqrFor = (account: string) => build([
    ["00", "01"], ["01", "12"],
    ["29", [["00", account], ["01", "000123456"], ["02", "Demo Bank"]]],
    ["52", "5814"], ["53", "840"], ["54", "2.50"], ["58", "KH"], ["59", "DEMO COFFEE"], ["60", "Phnom Penh"],
    ["62", [["01", "INV-0445"], ["07", "COUNTER-1"]]],
    ["64", [["00", "km"], ["01", "កាហ្វេសាកល្បង"], ["02", "ភ្នំពេញ"]]],
    ["99", [["00", String(now.getTime())], ["01", String(now.getTime() + 3600_000)]]],
  ]);
  const khqr = khqrFor("demo_coffee@demo");
  return [
    { label: "KHQR", payload: khqr },
    { label: "PromptPay", payload: build([["00", "01"], ["01", "11"], ["29", [["00", "A000000677010111"], ["01", "0066000000001"]]], ["52", "0000"], ["53", "764"], ["58", "TH"], ["59", "DEMO SHOP"], ["60", "BANGKOK"]]) },
    { label: "DuitNow", payload: "00020201021126410014A000000615000101065016640209123456789520499995303458540510.005802MY5909QRCSDNBHD6005BANGI6304343F" },
    { label: "VietQR", payload: build([["00", "01"], ["01", "12"], ["38", [["00", "A000000727"], ["01", [["00", "970400"], ["01", "0000000001"]]], ["02", "QRIBFTTA"]]], ["52", "0000"], ["53", "704"], ["54", "50000"], ["58", "VN"], ["59", "DEMO"], ["60", "HA NOI"], ["62", [["08", "Invoice 445"]]]]) },
    { label: "PayNow", payload: build([["00", "01"], ["01", "12"], ["26", [["00", "SG.PAYNOW"], ["01", "0"], ["02", "+6500000000"], ["03", "0"], ["04", ymd(new Date(now.getTime() + 30 * 86400_000))]]], ["52", "0000"], ["53", "702"], ["54", "12.50"], ["58", "SG"], ["59", "DEMO"], ["60", "Singapore"]]) },
    { label: "QRIS", payload: build([["00", "01"], ["01", "11"], ["51", [["00", "ID.CO.QRIS.WWW"], ["02", "ID0000000000001"], ["03", "UMI"]]], ["52", "5812"], ["53", "360"], ["58", "ID"], ["59", "DEMO WARUNG"], ["60", "JAKARTA"]]) },
    // the account swapped for another, with the lengths updated but the old checksum kept
    { label: "An edited code", payload: khqrFor("someone_else@demo").slice(0, -4) + khqr.slice(-4) },
    { label: "A disguised name", payload: build([["00", "01"], ["01", "11"], ["29", [["00", "demo_coffee@demo"]]], ["52", "5814"], ["53", "840"], ["58", "KH"], ["59", "DEMO COFFEE"], ["60", "Phnom Penh"], ["64", [["00", "en"], ["01", "Demo Coffee ‮4130"]]]]) },
    { label: "A link", payload: "https://pay.example.com/demo-coffee" },
  ];
}
