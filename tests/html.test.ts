import assert from "node:assert/strict";
import test from "node:test";
import { escapeHtml } from "../src/lib/html.ts";

test("family-entered text is safe in generated HTML", () => {
  assert.equal(
    escapeHtml('<img src=x onerror="alert(1)">\''),
    "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;&#039;",
  );
});
