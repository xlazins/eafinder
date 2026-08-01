import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_SOURCE_DIRECTORY = path.join(
  process.cwd(),
  "data",
  "gazette",
  "issues",
);
const DEFAULT_OUTPUT_FILE = path.join(
  process.cwd(),
  "public",
  "data",
  "settat-business-history.json",
);

const SETTAT_PATTERN = /(?:\bsettat\b|سطات|سلطات|سطحات)/iu;
const SUSPICIOUS_ADDRESS_PATTERN =
  /(?:وصف\s+موجز|بيانات\s+حول|تأسست\s+من\s+أجلها|القائات\s+المذلاء)/u;
const ADDED_EVENTS = new Set(["INCORPORATION", "BRANCH_OPENING"]);
const CEASED_EVENTS = new Set([
  "DISSOLUTION",
  "LIQUIDATION",
  "LIQUIDATION_CLOSED",
  "REMOVAL_FROM_REGISTER",
]);

export async function buildHistoryDataset({
  sourceDirectory = DEFAULT_SOURCE_DIRECTORY,
  outputFile = DEFAULT_OUTPUT_FILE,
} = {}) {
  const filenames = (await readdir(sourceDirectory))
    .filter((filename) => filename.toLowerCase().endsWith(".json"))
    .sort((left, right) => left.localeCompare(right, "en"));

  if (!filenames.length) {
    throw new Error(`No Gazette JSON files found in ${sourceDirectory}`);
  }

  const issueSummaries = [];
  const candidates = [];

  for (const filename of filenames) {
    const sourcePath = path.join(sourceDirectory, filename);
    const payload = JSON.parse(await readFile(sourcePath, "utf8"));
    if (!Array.isArray(payload.records) || !payload.summary) {
      throw new Error(`${filename} is not a processed Gazette export.`);
    }

    const issueNumber = String(
      payload.summary.filename?.match(/BOAL[_-](\d+)/iu)?.[1] ||
      payload.records[0]?.source?.issue_number ||
      "unknown",
    );
    const issueCandidates = payload.records
      .filter((record) => record.company?.cities_mentioned?.includes("Settat"))
      .map((record) => toHistoryEvent(record, issueNumber));

    candidates.push(...issueCandidates);
    issueSummaries.push({
      issue_number: issueNumber,
      publication_date: payload.summary.publication_date || null,
      source_records: payload.records.length,
      settat_candidates: issueCandidates.length,
      filename,
    });
  }

  const events = deduplicateEvents(candidates)
    .sort((left, right) => (
      left.event_date.localeCompare(right.event_date) ||
      left.company_name.localeCompare(right.company_name, "en")
    ));
  const dates = events.map((event) => event.event_date).filter(Boolean);
  const coverage = {
    issue_count: issueSummaries.length,
    issues: issueSummaries,
    source_record_count: issueSummaries.reduce(
      (total, issue) => total + issue.source_records,
      0,
    ),
    settat_candidate_count: issueSummaries.reduce(
      (total, issue) => total + issue.settat_candidates,
      0,
    ),
    event_count: events.length,
    address_supported_count: events.filter(
      (event) => event.location_basis === "address_match",
    ).length,
    registry_supported_count: events.filter(
      (event) => event.location_basis === "registry_context",
    ).length,
    mention_only_count: events.filter(
      (event) => event.location_basis === "city_mention",
    ).length,
    needs_review_count: events.filter((event) => event.needs_review).length,
    first_event_date: dates[0] || null,
    last_event_date: dates.at(-1) || null,
  };
  const output = {
    schema_version: "1.0.0",
    coverage,
    events,
  };

  await mkdir(path.dirname(outputFile), { recursive: true });
  await writeFile(outputFile, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  return output;
}

function toHistoryEvent(record, issueNumber) {
  const companyName = cleanString(record.company?.name) || "Company name unavailable";
  const registeredAddress = cleanString(record.company?.registered_address);
  const branchAddress = cleanString(record.event?.branch_address);
  const displayAddress = branchAddress || registeredAddress;
  const court = cleanString(record.event?.filing?.court);
  const cities = unique(record.company?.cities_mentioned || []);
  const addressMatch = SETTAT_PATTERN.test(
    [registeredAddress, branchAddress].filter(Boolean).join(" "),
  );
  const registryContext = SETTAT_PATTERN.test(court || "") || (
    cities.length === 1 && cities[0] === "Settat"
  );
  const locationBasis = addressMatch
    ? "address_match"
    : registryContext
      ? "registry_context"
      : "city_mention";
  const addressQuality = !displayAddress
    ? "missing"
    : SUSPICIOUS_ADDRESS_PATTERN.test(displayAddress)
      ? "suspicious"
      : "usable";
  const eventType = record.event?.primary_type || "UNKNOWN";
  const eventDate =
    record.event?.decision_date ||
    record.event?.effective_date ||
    record.event?.filing?.date ||
    record.source?.publication_date;
  const eventDateSource = record.event?.decision_date
    ? "decision_date"
    : record.event?.effective_date
      ? "effective_date"
      : record.event?.filing?.date
        ? "filing_date"
        : "publication_date";
  const registerNumber = cleanString(record.company?.commercial_register_number);
  const normalizedName = normalizeKey(companyName);
  const companyId = registerNumber
    ? `rc-${registerNumber}`
    : `name-${slug(normalizedName).slice(0, 48)}-${hash(normalizedName)}`;
  const pages = unique(record.source?.pdf_pages || []);
  const sourceReference = cleanString(record.source?.notice_reference);
  const eventIdSeed = [
    issueNumber,
    sourceReference || pages.join("-"),
    normalizedName,
    eventType,
    eventDate,
  ].join("|");

  return {
    id: `boal-${issueNumber}-${hash(eventIdSeed)}`,
    company_id: companyId,
    company_name: companyName,
    legal_form: cleanString(record.company?.legal_form),
    commercial_register_number: registerNumber,
    event_type: eventType,
    event_date: eventDate,
    event_date_source: eventDateSource,
    effective_date: cleanString(record.event?.effective_date),
    status_effect: ADDED_EVENTS.has(eventType)
      ? "added"
      : CEASED_EVENTS.has(eventType)
        ? "ceased"
        : "changed",
    business_purpose: cleanString(record.event?.business_purpose),
    capital_mad: record.event?.capital_mad ?? null,
    manager_or_liquidator: cleanString(record.event?.manager_or_liquidator),
    registered_address: registeredAddress,
    branch_address: branchAddress,
    display_address: displayAddress,
    location_basis: locationBasis,
    address_quality: addressQuality,
    cities_mentioned: cities,
    filing: {
      court,
      date: cleanString(record.event?.filing?.date),
      number: cleanString(record.event?.filing?.number),
    },
    confidence: Number(record.confidence) || 0,
    needs_review: Boolean(record.needs_review) || addressQuality !== "usable",
    review_reasons: unique([
      ...(record.review_reasons || []),
      ...(addressQuality === "missing" ? ["usable_address_missing"] : []),
      ...(addressQuality === "suspicious" ? ["address_text_suspicious"] : []),
    ]),
    source: {
      series: "BOAL",
      issue_number: issueNumber,
      publication_date: cleanString(record.source?.publication_date),
      pdf_pages: pages,
      printed_pages: unique(record.source?.printed_pages || []),
      notice_reference: sourceReference,
      notice_reference_inferred: Boolean(record.source?.notice_reference_inferred),
    },
    _dedupe: {
      normalized_name: normalizedName,
      quality: eventQuality(record, addressQuality),
    },
  };
}

function deduplicateEvents(candidates) {
  const accepted = [];
  for (const candidate of candidates.toSorted(
    (left, right) => right._dedupe.quality - left._dedupe.quality,
  )) {
    const duplicate = accepted.find((event) => (
      event.source.issue_number === candidate.source.issue_number &&
      event._dedupe.normalized_name === candidate._dedupe.normalized_name &&
      event.event_type === candidate.event_type &&
      pagesOverlap(event.source.pdf_pages, candidate.source.pdf_pages) &&
      (
        !event.source.notice_reference ||
        !candidate.source.notice_reference ||
        event.source.notice_reference === candidate.source.notice_reference
      )
    ));
    if (!duplicate) accepted.push(candidate);
  }

  return accepted.map((event) => {
    const output = { ...event };
    delete output._dedupe;
    return output;
  });
}

function eventQuality(record, addressQuality) {
  return [
    record.company?.name ? 3 : 0,
    record.company?.commercial_register_number ? 3 : 0,
    record.event?.decision_date ? 3 : 0,
    record.source?.notice_reference ? 2 : 0,
    addressQuality === "usable" ? 2 : 0,
    record.event?.filing?.date ? 1 : 0,
    record.needs_review ? 0 : 2,
    Number(record.confidence) || 0,
  ].reduce((total, value) => total + value, 0);
}

function pagesOverlap(left, right) {
  return left.some((page) => right.includes(page));
}

function cleanString(value) {
  const cleaned = String(value ?? "").replace(/\s+/gu, " ").trim();
  return cleaned || null;
}

function normalizeKey(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/\p{Mark}/gu, "")
    .replace(/[أإآ]/gu, "ا")
    .replace(/ى/gu, "ي")
    .replace(/ة/gu, "ه")
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
    .trim()
    .toLocaleLowerCase("en");
}

function slug(value) {
  return String(value || "")
    .replace(/[^a-z0-9]+/giu, "-")
    .replace(/^-+|-+$/gu, "") || "company";
}

function hash(value) {
  let result = 2166136261;
  for (const character of String(value)) {
    result ^= character.codePointAt(0);
    result = Math.imul(result, 16777619);
  }
  return (result >>> 0).toString(36);
}

function unique(values) {
  return [...new Set(values.filter((value) => value != null && value !== ""))];
}

if (pathToFileURL(process.argv[1] || "").href === import.meta.url) {
  const output = await buildHistoryDataset();
  console.log(
    `Built ${output.coverage.event_count} Settat events from ` +
    `${output.coverage.issue_count} Gazette issue(s).`,
  );
}
