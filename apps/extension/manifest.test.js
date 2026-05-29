import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("manifest enables automatic background sync", async () => {
  const manifest = JSON.parse(
    await readFile(new URL("./manifest.json", import.meta.url), "utf8")
  );

  assert.equal(manifest.background.service_worker, "background.js");
  assert.equal(manifest.background.type, "module");
  assert.ok(manifest.permissions.includes("alarms"));
  assert.ok(manifest.permissions.includes("tabs"));
  assert.ok(manifest.permissions.includes("storage"));
  assert.ok(manifest.permissions.includes("scripting"));
  assert.equal(manifest.icons["128"], "icons/icon-128.png");
  assert.equal(manifest.action.default_icon["32"], "icons/icon-32.png");
});
