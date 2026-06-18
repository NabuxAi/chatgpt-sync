#!/usr/bin/env node
//
// Build distributable browser packages for ChatGPT Sync.
//
// Outputs (into ./dist):
//   chatgpt-sync-chrome-<version>.zip   Universal Chromium package
//                                       (Chrome, Edge, Brave, Opera, Vivaldi —
//                                        load unpacked or upload to a store).
//   chatgpt-sync-chrome-<version>.crx   Signed CRX3 for Chrome.
//   chatgpt-sync-firefox-<version>.xpi  Experimental Firefox build (unverified).
//   SHA256SUMS.txt                      Checksums for every artifact above.
//
// Signing key resolution for the CRX:
//   1. The CRX_PRIVATE_KEY env var (PEM contents) — use this in CI.
//   2. dist/chatgpt-sync.pem if it already exists.
//   3. Otherwise a fresh 2048-bit RSA key is generated and written to
//      dist/chatgpt-sync.pem. Reuse the same key to keep a stable extension ID.
//
// No third-party dependencies — only Node built-ins and the `zip` CLI.

import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { execFileSync } from "node:child_process";
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign as signData
} from "node:crypto";
import { resolve, join } from "node:path";

const root = resolve(import.meta.dirname, "..");
const extDir = resolve(root, "apps/extension");
const distDir = resolve(root, "dist");
const stageDir = resolve(distDir, ".stage");

const manifest = JSON.parse(readFileSync(join(extDir, "manifest.json"), "utf8"));
const version = manifest.version;
const FIREFOX_ADDON_ID = "chatgpt-sync@nabux.ai";

// Files that should never ship inside a packaged extension.
const isPackagedFile = (path) => !path.endsWith(".test.js");

function u32le(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value, 0);
  return buffer;
}

// Minimal protobuf helpers (length-delimited fields only — all we need here).
function varint(value) {
  const bytes = [];
  while (value > 0x7f) {
    bytes.push((value & 0x7f) | 0x80);
    value >>>= 7;
  }
  bytes.push(value);
  return Buffer.from(bytes);
}

function lengthDelimited(fieldNumber, payload) {
  const tag = varint((fieldNumber << 3) | 2);
  return Buffer.concat([tag, varint(payload.length), payload]);
}

function stage(name, transformManifest) {
  const target = resolve(stageDir, name);
  rmSync(target, { recursive: true, force: true });
  mkdirSync(target, { recursive: true });
  cpSync(extDir, target, { recursive: true, filter: isPackagedFile });

  if (transformManifest) {
    const staged = JSON.parse(readFileSync(join(target, "manifest.json"), "utf8"));
    transformManifest(staged);
    writeFileSync(join(target, "manifest.json"), `${JSON.stringify(staged, null, 2)}\n`);
  }

  return target;
}

function zipDir(dir, outFile) {
  rmSync(outFile, { force: true });
  // -r recurse, -X strip extra file attributes, -9 max compression, -q quiet.
  execFileSync("zip", ["-r", "-X", "-9", "-q", outFile, "."], { cwd: dir });
  return readFileSync(outFile);
}

function loadSigningKey() {
  const envKey = process.env.CRX_PRIVATE_KEY;
  if (envKey && envKey.trim()) {
    console.log("• Signing CRX with key from CRX_PRIVATE_KEY.");
    return envKey;
  }

  const keyPath = resolve(distDir, "chatgpt-sync.pem");
  if (existsSync(keyPath)) {
    console.log("• Signing CRX with existing dist/chatgpt-sync.pem.");
    return readFileSync(keyPath, "utf8");
  }

  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  writeFileSync(keyPath, pem, { mode: 0o600 });
  console.warn(
    "! No signing key found — generated a new one at dist/chatgpt-sync.pem.\n" +
      "  Keep it safe and reuse it (or set CRX_PRIVATE_KEY) to keep a stable extension ID."
  );
  return pem;
}

// Build a CRX3 file: "Cr24" + version + header(protobuf) + zip payload.
function buildCrx(zipBuffer, privateKeyPem) {
  const privateKey = createPrivateKey(privateKeyPem);
  const publicKeyDer = createPublicKey(privateKey).export({ type: "spki", format: "der" });

  // The extension id is the first 16 bytes of SHA256(public key).
  const crxId = createHash("sha256").update(publicKeyDer).digest().subarray(0, 16);
  const signedHeaderData = lengthDelimited(1, crxId); // SignedData { crx_id = 1 }

  const signaturePayload = Buffer.concat([
    Buffer.from("CRX3 SignedData"),
    Buffer.from([0]),
    u32le(signedHeaderData.length),
    signedHeaderData,
    zipBuffer
  ]);
  const signature = signData("sha256", signaturePayload, privateKey);

  const proof = Buffer.concat([
    lengthDelimited(1, publicKeyDer), // AsymmetricKeyProof { public_key = 1 }
    lengthDelimited(2, signature) //     AsymmetricKeyProof { signature  = 2 }
  ]);
  const header = Buffer.concat([
    lengthDelimited(2, proof), //          CrxFileHeader { sha256_with_rsa   = 2 }
    lengthDelimited(10000, signedHeaderData) // CrxFileHeader { signed_header_data = 10000 }
  ]);

  return Buffer.concat([
    Buffer.from("Cr24"),
    u32le(3),
    u32le(header.length),
    header,
    zipBuffer
  ]);
}

function writeChecksums(files) {
  const lines = files.map((file) => {
    const digest = createHash("sha256").update(readFileSync(file)).digest("hex");
    return `${digest}  ${file.replace(`${distDir}/`, "")}`;
  });
  const outFile = resolve(distDir, "SHA256SUMS.txt");
  writeFileSync(outFile, `${lines.join("\n")}\n`);
  return outFile;
}

// --- Build ---------------------------------------------------------------

rmSync(distDir, { recursive: true, force: true });
mkdirSync(stageDir, { recursive: true });

console.log(`Building ChatGPT Sync v${version}\n`);

// 1. Universal Chromium ZIP (Chrome, Edge, Brave, Opera, Vivaldi).
const chromiumDir = stage("chromium");
const chromiumZip = resolve(distDir, `chatgpt-sync-chrome-${version}.zip`);
const chromiumZipBuffer = zipDir(chromiumDir, chromiumZip);
console.log(`✓ ${chromiumZip.replace(`${distDir}/`, "dist/")}`);

// 2. Signed CRX for Chrome.
const crxFile = resolve(distDir, `chatgpt-sync-chrome-${version}.crx`);
writeFileSync(crxFile, buildCrx(chromiumZipBuffer, loadSigningKey()));
console.log(`✓ ${crxFile.replace(`${distDir}/`, "dist/")}`);

// 3. Experimental Firefox XPI. The runtime still targets Chrome APIs, so this
//    is provided to bootstrap a port — it is not yet a verified Firefox build.
const firefoxDir = stage("firefox", (staged) => {
  staged.background = { scripts: ["background.js"], type: "module" };
  staged.browser_specific_settings = {
    gecko: { id: FIREFOX_ADDON_ID, strict_min_version: "121.0" }
  };
});
const xpiFile = resolve(distDir, `chatgpt-sync-firefox-${version}.xpi`);
zipDir(firefoxDir, xpiFile);
console.log(`✓ ${xpiFile.replace(`${distDir}/`, "dist/")} (experimental)`);

// 4. Checksums + cleanup.
const checksums = writeChecksums([chromiumZip, crxFile, xpiFile]);
console.log(`✓ ${checksums.replace(`${distDir}/`, "dist/")}`);
rmSync(stageDir, { recursive: true, force: true });

console.log("\nDone. Artifacts are in ./dist");
