#!/usr/bin/env node
// Daily project health check.
//
// Runs a set of checks against the repository and produces a machine- and
// human-readable report:
//   1. Syntax check (`node --check`) on every tracked JS/MJS file.
//   2. Lint (ESLint) — skipped gracefully if dependencies are not installed.
//   3. Chrome extension manifest validation.
//   4. Test suite (`node --test`).
//   5. Dependency audit (`npm audit`) — skipped when there is no lockfile.
//
// Behaviour:
//   - Prints a Markdown report to stdout.
//   - Writes the same report to the file given by HEALTH_REPORT_FILE
//     (default: health-report.md) so CI can attach it to an issue.
//   - Exits 0 when everything passes, 1 when any check fails. Skipped checks
//     do not count as failures.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const IGNORED_DIRS = new Set([".git", "node_modules", "tmp", "dist", "build"]);
const JS_EXTENSIONS = [".js", ".mjs", ".cjs"];

function collectJsFiles(dir) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      found.push(...collectJsFiles(join(dir, entry.name)));
    } else if (JS_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) {
      found.push(join(dir, entry.name));
    }
  }
  return found;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    ...options,
  });
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  return {
    ok: result.status === 0 && !result.error,
    status: result.status,
    output: [stdout, stderr].filter(Boolean).join("\n").trim(),
    error: result.error,
  };
}

function codeBlock(text, maxLines = 200) {
  return "```\n" + tail(text, maxLines) + "\n```";
}

function tail(text, maxLines) {
  const lines = text.split("\n");
  if (lines.length <= maxLines) return text;
  return ["…(truncated)…", ...lines.slice(-maxLines)].join("\n");
}

// --- Check 1: syntax check every JS file ---------------------------------
function syntaxCheck() {
  const files = collectJsFiles(repoRoot).sort();
  const failures = [];
  for (const file of files) {
    const rel = relative(repoRoot, file);
    const result = run(process.execPath, ["--check", file]);
    if (!result.ok) {
      failures.push(`- \`${rel}\`\n\n  ${codeBlock(result.output).replace(/\n/g, "\n  ")}`);
    }
  }
  return {
    name: "Syntax check (node --check)",
    ok: failures.length === 0,
    summary:
      failures.length === 0
        ? `All ${files.length} JS file(s) parse cleanly.`
        : `${failures.length} of ${files.length} file(s) failed to parse.`,
    details: failures.join("\n\n"),
  };
}

// --- Check 2: ESLint -----------------------------------------------------
function lint() {
  const eslintEntry = join(repoRoot, "node_modules", "eslint", "bin", "eslint.js");
  if (!existsSync(eslintEntry)) {
    return {
      name: "Lint (ESLint)",
      skipped: true,
      summary: "Skipped — run `npm ci` to install ESLint first.",
    };
  }
  const result = run(process.execPath, [eslintEntry, "."]);
  return {
    name: "Lint (ESLint)",
    ok: result.ok,
    summary: result.ok
      ? result.output
        ? "No lint errors (warnings only)."
        : "No lint problems."
      : "ESLint reported errors.",
    details: result.ok ? "" : codeBlock(result.output),
  };
}

// --- Check 3: extension manifest validation ------------------------------
function manifestCheck() {
  const manifestPath = join(repoRoot, "apps", "extension", "manifest.json");
  const name = "Extension manifest (manifest.json)";
  if (!existsSync(manifestPath)) {
    return { name, skipped: true, summary: "Skipped — manifest.json not found." };
  }
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (err) {
    return {
      name,
      ok: false,
      summary: "manifest.json is not valid JSON.",
      details: codeBlock(err.message),
    };
  }
  const problems = [];
  if (manifest.manifest_version !== 3) {
    problems.push(`\`manifest_version\` should be 3 (found ${JSON.stringify(manifest.manifest_version)}).`);
  }
  for (const field of ["name", "version"]) {
    if (!manifest[field]) problems.push(`Missing required field \`${field}\`.`);
  }
  return {
    name,
    ok: problems.length === 0,
    summary: problems.length === 0 ? "Valid MV3 manifest." : `${problems.length} problem(s) found.`,
    details: problems.length === 0 ? "" : problems.map((p) => `- ${p}`).join("\n"),
  };
}

// --- Check 4: test suite -------------------------------------------------
function testSuite() {
  const result = run(process.execPath, ["--test"]);
  return {
    name: "Test suite (node --test)",
    ok: result.ok,
    summary: result.ok ? "All tests passed." : "Test suite reported failures.",
    details: result.ok ? "" : codeBlock(result.output),
  };
}

// --- Check 5: dependency audit -------------------------------------------
function dependencyAudit() {
  const name = "Dependency audit (npm audit)";
  if (!existsSync(join(repoRoot, "package-lock.json"))) {
    return { name, skipped: true, summary: "Skipped — no package-lock.json." };
  }
  // Only fail on high/critical vulnerabilities in production dependencies.
  const result = run("npm", ["audit", "--omit=dev", "--audit-level=high"]);
  return {
    name,
    ok: result.ok,
    summary: result.ok ? "No high/critical production vulnerabilities." : "Vulnerabilities found.",
    details: result.ok ? "" : codeBlock(result.output),
  };
}

function buildReport(checks) {
  const failed = checks.filter((c) => !c.skipped && !c.ok);
  const timestamp = new Date().toISOString();
  const lines = [];
  lines.push(`# Project health report`);
  lines.push("");
  lines.push(`- Generated: ${timestamp}`);
  lines.push(`- Node: ${process.version}`);
  lines.push(`- Status: ${failed.length === 0 ? "✅ healthy" : `❌ ${failed.length} check(s) failing`}`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push("| Check | Result |");
  lines.push("| --- | --- |");
  for (const c of checks) {
    const icon = c.skipped ? "⚠️ skipped" : c.ok ? "✅ pass" : "❌ fail";
    lines.push(`| ${c.name} | ${icon} — ${c.summary} |`);
  }
  if (failed.length > 0) {
    lines.push("");
    lines.push("## Failures");
    for (const c of failed) {
      lines.push("");
      lines.push(`### ${c.name}`);
      lines.push("");
      lines.push(c.summary);
      if (c.details) {
        lines.push("");
        lines.push(c.details);
      }
    }
  }
  lines.push("");
  return lines.join("\n");
}

function main() {
  const checks = [syntaxCheck(), lint(), manifestCheck(), testSuite(), dependencyAudit()];
  const report = buildReport(checks);
  const ok = checks.every((c) => c.skipped || c.ok);

  const reportFile = process.env.HEALTH_REPORT_FILE || join(repoRoot, "health-report.md");
  try {
    writeFileSync(reportFile, report);
  } catch (err) {
    console.error(`Could not write report file: ${err.message}`);
  }

  process.stdout.write(report + "\n");

  // Expose a one-line status for GitHub Actions step outputs.
  if (process.env.GITHUB_OUTPUT) {
    try {
      writeFileSync(process.env.GITHUB_OUTPUT, `status=${ok ? "healthy" : "failing"}\n`, {
        flag: "a",
      });
    } catch {
      // best effort only
    }
  }

  process.exit(ok ? 0 : 1);
}

main();
