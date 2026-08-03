import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("the web app manifest supports standalone installation", async () => {
  const manifest = JSON.parse(
    await readFile("public/manifest.webmanifest", "utf8"),
  );

  assert.equal(manifest.name, "The Family Bank");
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.start_url, ".");
  assert.deepEqual(
    manifest.icons.map((icon: { sizes: string }) => icon.sizes),
    ["192x192", "512x512"],
  );
});

test("the service worker leaves financial requests on the network", async () => {
  const worker = await readFile("public/sw.js", "utf8");

  assert.match(worker, /request\.method !== "GET"/);
  assert.match(worker, /url\.origin !== self\.location\.origin/);
  assert.doesNotMatch(worker, /backgroundSync|indexedDB|mutation/i);
});
