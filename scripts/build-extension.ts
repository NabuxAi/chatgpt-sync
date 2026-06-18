#!/usr/bin/env node
// Builds the loadable Manifest V3 extension into apps/extension/dist/.
//
//   1. Clean the output directory.
//   2. Compile the TypeScript sources with `tsc -p tsconfig.build.json`
//      (rewriteRelativeImportExtensions turns `./foo.ts` specifiers into
//      `./foo.js`, so the emitted modules load directly in the browser).
//   3. Copy the static assets the compiler does not touch (manifest.json,
//      *.html, *.css, and the icons/ folder).
//
// The result in apps/extension/dist/ is a self-contained extension you can
// "Load unpacked".

import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const extensionDir = join(root, "apps", "extension");
const distDir = join(extensionDir, "dist");

// 1. Start from a clean output directory.
rmSync(distDir, { recursive: true, force: true });
mkdirSync(distDir, { recursive: true });

// 2. Compile the TypeScript sources to plain ES modules.
const tsc = require.resolve("typescript/bin/tsc");
const compiled = spawnSync(process.execPath, [tsc, "-p", join(root, "tsconfig.build.json")], {
  cwd: root,
  stdio: "inherit"
});
if (compiled.status !== 0) {
  process.exit(compiled.status ?? 1);
}

// 3. Copy the static assets the compiler does not touch.
let copied = 0;
for (const entry of readdirSync(extensionDir, { withFileTypes: true })) {
  if (entry.name === "dist") continue;

  const src = join(extensionDir, entry.name);
  const dest = join(distDir, entry.name);

  if (entry.isDirectory()) {
    if (entry.name === "icons") {
      cpSync(src, dest, { recursive: true });
      copied += 1;
    }
    continue;
  }

  if (/\.(html|css|json)$/.test(entry.name)) {
    cpSync(src, dest);
    copied += 1;
  }
}

console.log(`Build complete. Compiled extension + ${copied} static asset group(s) → ${distDir}`);
console.log('Load it via chrome://extensions → "Load unpacked" → apps/extension/dist');
