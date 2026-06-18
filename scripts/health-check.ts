#!/usr/bin/env node
// Daily project health check.
//
// Runs a set of lightweight checks against the repository and produces a
// machine- and human-readable report:
//   1. Type check (`tsc --noEmit`) across the whole project.
//   2. Syntax check (`node --check`) on every tracked JS/TS file.
//   3. Test suite (`node --test`).
//
// Behaviour:
//   - Prints a Markdown report to stdout.
//   - Writes the same report to the file given by HEALTH_REPORT_FILE
//     (default: health-report.md) so CI can attach it to an issue.
//   - Exits 0 when everything passes, 1 when any check fails.
//
// It runs directly with Node's built-in TypeScript support (no compile step).

import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const IGNORED_DIRS = new Set([".git", "node_modules", "tmp", "dist", "build"]);
const SOURCE_EXTENSIONS = [".ts", ".mts", ".cts", ".js", ".mjs", ".cjs"];

interface RunResult {
  ok: boolean;
  status: number | null;
  output: string;
  error?: Error;
}

interface Check {
  name: string;
  ok: boolean;
  summary: string;
  details: string;
}

function collectSourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      found.push(...collectSourceFiles(join(dir, entry.name)));
    } else if (SOURCE_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) {
      found.push(join(dir, entry.name));
    }
  }
  return found;
}

function run(command: string, args: string[], options: Record<string, unknown> = {}): RunResult {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    ...options
  });
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  return {
    ok: result.status === 0 && !result.error,
    status: result.status,
    output: [stdout, stderr].filter(Boolean).join("\n").trim(),
    error: result.error
  };
}

// --- Check 1: type-check the whole project --------------------------------
function typeCheck(): Check {
  let tscPath: string;
  try {
    tscPath = require.resolve("typescript/bin/tsc");
  } catch {
    return {
      name: "Type check (tsc --noEmit)",
      ok: false,
      summary: "TypeScript is not installed. Run `npm ci` (or `npm install`) first.",
      details: ""
    };
  }

  const result = run(process.execPath, [tscPath, "--noEmit", "-p", join(repoRoot, "tsconfig.json")]);
  return {
    name: "Type check (tsc --noEmit)",
    ok: result.ok,
    summary: result.ok ? "No type errors." : "Type errors detected.",
    details: result.ok ? "" : "```\n" + tail(result.output, 200) + "\n```"
  };
}

// `node --check` only type-strips files it detects as ES modules. A global
// (import/export-free) `.ts` script such as the content script is parsed as
// CommonJS and would choke on type syntax — but `tsc --noEmit` already validates
// every `.ts` file, so we let it own those and limit `node --check` to JS files
// and ES-module `.ts` (which still covers scripts tsc excludes, like the live runner).
function shouldNodeCheck(file: string): boolean {
  if (/\.(mjs|cjs|js)$/.test(file)) return true;
  if (/\.(ts|mts|cts)$/.test(file)) {
    return /^\s*(import|export)\b/m.test(readFileSync(file, "utf8"));
  }
  return false;
}

// --- Check 2: syntax check every source file ------------------------------
function syntaxCheck(): Check {
  const files = collectSourceFiles(repoRoot).sort().filter(shouldNodeCheck);
  const failures: string[] = [];
  for (const file of files) {
    const rel = relative(repoRoot, file);
    const result = run(process.execPath, ["--check", file]);
    if (!result.ok) {
      failures.push(`- \`${rel}\`\n\n  \`\`\`\n  ${result.output.replace(/\n/g, "\n  ")}\n  \`\`\``);
    }
  }
  return {
    name: "Syntax check (node --check)",
    ok: failures.length === 0,
    summary:
      failures.length === 0
        ? `All ${files.length} source file(s) parse cleanly.`
        : `${failures.length} of ${files.length} file(s) failed to parse.`,
    details: failures.join("\n\n")
  };
}

// --- Check 3: test suite --------------------------------------------------
function testSuite(): Check {
  const result = run(process.execPath, ["--test"]);
  return {
    name: "Test suite (node --test)",
    ok: result.ok,
    summary: result.ok ? "All tests passed." : "Test suite reported failures.",
    details: result.ok ? "" : "```\n" + tail(result.output, 200) + "\n```"
  };
}

function tail(text: string, maxLines: number): string {
  const lines = text.split("\n");
  if (lines.length <= maxLines) return text;
  return ["…(truncated)…", ...lines.slice(-maxLines)].join("\n");
}

function buildReport(checks: Check[]): string {
  const failed = checks.filter((c) => !c.ok);
  const timestamp = new Date().toISOString();
  const lines: string[] = [];
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
    lines.push(`| ${c.name} | ${c.ok ? "✅ pass" : "❌ fail"} — ${c.summary} |`);
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

function main(): void {
  const checks = [typeCheck(), syntaxCheck(), testSuite()];
  const report = buildReport(checks);
  const ok = checks.every((c) => c.ok);

  const reportFile = process.env.HEALTH_REPORT_FILE || join(repoRoot, "health-report.md");
  try {
    writeFileSync(reportFile, report);
  } catch (err) {
    console.error(`Could not write report file: ${(err as Error).message}`);
  }

  process.stdout.write(report + "\n");

  // Expose a one-line status for GitHub Actions step outputs.
  if (process.env.GITHUB_OUTPUT) {
    try {
      writeFileSync(process.env.GITHUB_OUTPUT, `status=${ok ? "healthy" : "failing"}\n`, {
        flag: "a"
      });
    } catch {
      // best effort only
    }
  }

  process.exit(ok ? 0 : 1);
}

main();
