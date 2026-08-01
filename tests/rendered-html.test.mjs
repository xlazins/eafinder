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

test("server-renders the business evolution view", async () => {
  const html = await readFile(
    new URL("../.next/server/app/evolution.html", import.meta.url),
    "utf8",
  );
  assert.match(html, /<title>Business Evolution \| SettatScope<\/title>/i);
  assert.match(html, /Track business activity over time/);
  assert.match(html, /Legal event timeline|Gazette history/i);
  assert.doesNotMatch(html, /monthly rent|prototype|demo/i);
});

test("builds a compact, deduplicated Gazette history database", async () => {
  const dataset = JSON.parse(
    await readFile(
      new URL("../public/data/settat-business-history.json", import.meta.url),
      "utf8",
    ),
  );
  assert.equal(dataset.coverage.issue_count, 1);
  assert.equal(dataset.coverage.source_record_count, 1618);
  assert.equal(dataset.coverage.settat_candidate_count, 25);
  assert.equal(dataset.coverage.event_count, 24);
  assert.equal(dataset.events.some((event) => "raw_text" in event), false);

  const kleat = dataset.events.find((event) => event.company_name === "KLEAT");
  assert.ok(kleat);
  assert.equal(kleat.event_type, "BRANCH_OPENING");
  assert.equal(kleat.event_date, "2026-02-26");
  assert.equal(kleat.branch_address.includes("بير انزاران"), true);
  assert.equal(kleat.location_basis, "registry_context");

  const safres = dataset.events.find((event) => event.company_name === "SAFRES");
  assert.ok(safres);
  assert.equal(safres.status_effect, "ceased");
  assert.equal(safres.event_date, "2026-03-27");
});
