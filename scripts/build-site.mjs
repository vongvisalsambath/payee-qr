// Builds the site into site-dist/. With --serve, serves it at http://127.0.0.1:8010 and rebuilds on change.
import * as esbuild from "esbuild";
import { copyFileSync, mkdirSync, rmSync } from "node:fs";

const serve = process.argv.includes("--serve");
rmSync("site-dist", { recursive: true, force: true });
mkdirSync("site-dist");
for (const f of ["index.html", "style.css", "favicon.svg"]) copyFileSync(`site/${f}`, `site-dist/${f}`);
const options = { entryPoints: ["site/app.ts"], bundle: true, minify: !serve, format: "esm", target: "es2020", outfile: "site-dist/app.js", legalComments: "eof", logLevel: "warning" };
if (serve) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  await ctx.serve({ servedir: "site-dist", host: "127.0.0.1", port: 8010 });
  console.log("http://127.0.0.1:8010");
} else await esbuild.build(options);
