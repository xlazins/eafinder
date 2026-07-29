import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("server-renders the SettatScope product", async () => {
  const html = await readFile(
    new URL("../.next/server/app/index.html", import.meta.url),
    "utf8",
  );
  assert.match(html, /<title>SettatScope \| Business Location Intelligence<\/title>/i);
  assert.match(html, /SettatScope/);
  assert.match(html, /Settat, Morocco/);
  assert.match(html, /Analyze this location/);
  assert.doesNotMatch(html, /prototype|demo|monthly rent|codex-preview/i);
});
