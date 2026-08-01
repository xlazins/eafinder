"use client";

import Link from "next/link";
import { CSSProperties, useEffect, useMemo, useState } from "react";

type LocationBasis = "address_match" | "registry_context" | "city_mention";
type StatusEffect = "added" | "ceased" | "changed";

type HistoryEvent = {
  id: string;
  company_id: string;
  company_name: string;
  legal_form: string | null;
  commercial_register_number: string | null;
  event_type: string;
  event_date: string;
  event_date_source: string;
  effective_date: string | null;
  status_effect: StatusEffect;
  business_purpose: string | null;
  capital_mad: number | null;
  manager_or_liquidator: string | null;
  registered_address: string | null;
  branch_address: string | null;
  display_address: string | null;
  location_basis: LocationBasis;
  address_quality: "usable" | "missing" | "suspicious";
  cities_mentioned: string[];
  filing: {
    court: string | null;
    date: string | null;
    number: string | null;
  };
  confidence: number;
  needs_review: boolean;
  review_reasons: string[];
  source: {
    series: string;
    issue_number: string;
    publication_date: string | null;
    pdf_pages: number[];
    printed_pages: string[];
    notice_reference: string | null;
    notice_reference_inferred: boolean;
  };
};

type HistoryDataset = {
  coverage: {
    issue_count: number;
    issues: Array<{
      issue_number: string;
      publication_date: string | null;
      source_records: number;
      settat_candidates: number;
      filename: string;
    }>;
    source_record_count: number;
    settat_candidate_count: number;
    event_count: number;
    address_supported_count: number;
    registry_supported_count: number;
    mention_only_count: number;
    needs_review_count: number;
    first_event_date: string | null;
    last_event_date: string | null;
  };
  events: HistoryEvent[];
};

const EVENT_LABELS: Record<string, string> = {
  INCORPORATION: "Incorporation",
  BRANCH_OPENING: "Branch created",
  DISSOLUTION: "Dissolution",
  LIQUIDATION: "Liquidation",
  LIQUIDATION_CLOSED: "Liquidation closed",
  REMOVAL_FROM_REGISTER: "Removed from register",
  REGISTERED_OFFICE_CHANGE: "Registered office changed",
  SHARE_TRANSFER: "Share transfer",
  MANAGER_CHANGE: "Manager changed",
  CAPITAL_CHANGE: "Capital changed",
  LEGAL_FORM_CHANGE: "Legal form changed",
  BUSINESS_PURPOSE_CHANGE: "Business purpose changed",
};

const BASIS_LABELS: Record<LocationBasis, string> = {
  address_match: "Settat address",
  registry_context: "Settat registry context",
  city_mention: "Settat mentioned",
};

function eventLabel(value: string) {
  return EVENT_LABELS[value] || value.toLocaleLowerCase().replaceAll("_", " ");
}

function formatDate(value: string | null) {
  if (!value) return "Date unavailable";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00Z`));
}

function sourceLabel(event: HistoryEvent) {
  const parts = [`BOAL ${event.source.issue_number}`];
  if (event.source.notice_reference) parts.push(`ref. ${event.source.notice_reference}`);
  if (event.source.printed_pages.length) {
    parts.push(`p. ${event.source.printed_pages.join(", ")}`);
  } else if (event.source.pdf_pages.length) {
    parts.push(`PDF p. ${event.source.pdf_pages.join(", ")}`);
  }
  return parts.join(" · ");
}

export default function EvolutionPage() {
  const [dataset, setDataset] = useState<HistoryDataset | null>(null);
  const [loadError, setLoadError] = useState("");
  const [query, setQuery] = useState("");
  const [eventType, setEventType] = useState("all");
  const [locationScope, setLocationScope] = useState("supported");
  const [includeReview, setIncludeReview] = useState(true);
  const [asOfIndex, setAsOfIndex] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetch("/data/settat-business-history.json")
      .then((response) => {
        if (!response.ok) throw new Error(`History data returned ${response.status}`);
        return response.json() as Promise<HistoryDataset>;
      })
      .then((value) => {
        if (!active) return;
        setDataset(value);
        const dates = [...new Set(value.events.map((event) => event.event_date))].sort();
        setAsOfIndex(Math.max(0, dates.length - 1));
      })
      .catch(() => {
        if (active) setLoadError("The Gazette history database could not be loaded.");
      });
    return () => {
      active = false;
    };
  }, []);

  const dates = useMemo(
    () => [...new Set((dataset?.events || []).map((event) => event.event_date))].sort(),
    [dataset],
  );
  const asOfDate = dates[Math.min(asOfIndex, Math.max(0, dates.length - 1))] || null;
  const eventTypes = useMemo(
    () => [...new Set((dataset?.events || []).map((event) => event.event_type))]
      .sort((left, right) => eventLabel(left).localeCompare(eventLabel(right), "en")),
    [dataset],
  );

  const scopedEvents = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return (dataset?.events || []).filter((event) => {
      const supported = event.location_basis !== "city_mention";
      const searchText = [
        event.company_name,
        event.commercial_register_number,
        event.display_address,
        event.business_purpose,
      ].filter(Boolean).join(" ").toLocaleLowerCase();
      return (
        (!asOfDate || event.event_date <= asOfDate) &&
        (eventType === "all" || event.event_type === eventType) &&
        (locationScope === "all" || supported) &&
        (includeReview || !event.needs_review) &&
        (!needle || searchText.includes(needle))
      );
    }).sort((left, right) => (
      right.event_date.localeCompare(left.event_date) ||
      left.company_name.localeCompare(right.company_name, "en")
    ));
  }, [asOfDate, dataset, eventType, includeReview, locationScope, query]);

  const activeEvent = scopedEvents.find((event) => event.id === selectedId) || scopedEvents[0] || null;
  const companyHistory = useMemo(() => (
    activeEvent
      ? (dataset?.events || [])
        .filter((event) => event.company_id === activeEvent.company_id)
        .sort((left, right) => left.event_date.localeCompare(right.event_date))
      : []
  ), [activeEvent, dataset]);
  const counts = useMemo(() => scopedEvents.reduce(
    (result, event) => ({
      ...result,
      [event.status_effect]: result[event.status_effect] + 1,
    }),
    { added: 0, ceased: 0, changed: 0 },
  ), [scopedEvents]);
  const observedNet = counts.added - counts.ceased;
  const activity = useMemo(() => {
    const byDate = new Map<string, { added: number; ceased: number; changed: number }>();
    for (const event of scopedEvents) {
      const item = byDate.get(event.event_date) || { added: 0, ceased: 0, changed: 0 };
      item[event.status_effect] += 1;
      byDate.set(event.event_date, item);
    }
    return [...byDate.entries()].sort(([left], [right]) => left.localeCompare(right));
  }, [scopedEvents]);
  const maxActivity = Math.max(1, ...activity.map(([, item]) => (
    item.added + item.ceased + item.changed
  )));

  return (
    <main className="product-shell evolution-product">
      <header className="app-header">
        <div className="brand-block">
          <span className="brand-mark">S</span>
          <div>
            <strong>SettatScope</strong>
            <span>Business location intelligence</span>
          </div>
        </div>
        <nav className="app-nav" aria-label="Primary navigation">
          <Link href="/">Location fit</Link>
          <Link className="active" href="/evolution">Business evolution</Link>
        </nav>
        <div className="city-lock">
          <span>City</span>
          <strong>Settat, Morocco</strong>
        </div>
      </header>

      <section className="evolution-workspace">
        <aside className="evolution-controls" aria-label="Business history filters">
          <div className="evolution-heading">
            <p>Gazette history</p>
            <h1>Track business activity over time.</h1>
            <span>Legal events from official BOAL publications.</span>
          </div>

          <label className="history-field">
            <span>Search companies</span>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Name, RC or address"
            />
          </label>

          <label className="history-field">
            <span>Event type</span>
            <select value={eventType} onChange={(event) => setEventType(event.target.value)}>
              <option value="all">All legal events</option>
              {eventTypes.map((type) => (
                <option key={type} value={type}>{eventLabel(type)}</option>
              ))}
            </select>
          </label>

          <label className="history-field">
            <span>Settat evidence</span>
            <select value={locationScope} onChange={(event) => setLocationScope(event.target.value)}>
              <option value="supported">Address or registry context</option>
              <option value="all">Include city mentions</option>
            </select>
          </label>

          <label className="review-toggle">
            <input
              type="checkbox"
              checked={includeReview}
              onChange={(event) => setIncludeReview(event.target.checked)}
            />
            <span>Include records needing review</span>
          </label>

          {dataset && (
            <section className="coverage-block">
              <span>Current coverage</span>
              <strong>{dataset.coverage.issue_count} Gazette issue</strong>
              <dl>
                <div><dt>Normalized events</dt><dd>{dataset.coverage.event_count}</dd></div>
                <div><dt>Address matches</dt><dd>{dataset.coverage.address_supported_count}</dd></div>
                <div><dt>Registry context</dt><dd>{dataset.coverage.registry_supported_count}</dd></div>
                <div><dt>Review queue</dt><dd>{dataset.coverage.needs_review_count}</dd></div>
              </dl>
              <small>
                {dataset.coverage.issues.map((issue) => `BOAL ${issue.issue_number}`).join(", ")}
              </small>
            </section>
          )}
        </aside>

        <section className="evolution-main" aria-live="polite">
          {loadError ? (
            <div className="history-empty">
              <strong>History unavailable</strong>
              <p>{loadError}</p>
            </div>
          ) : !dataset ? (
            <div className="history-empty">
              <span className="large-spinner" aria-hidden="true" />
              <strong>Loading Gazette history</strong>
            </div>
          ) : (
            <>
              <section className="timestamp-panel">
                <div className="timestamp-heading">
                  <div>
                    <p>Observed through</p>
                    <h2>{formatDate(asOfDate)}</h2>
                  </div>
                  <output>{scopedEvents.length} matching events</output>
                </div>
                <input
                  aria-label="History date"
                  type="range"
                  min="0"
                  max={Math.max(0, dates.length - 1)}
                  step="1"
                  value={Math.min(asOfIndex, Math.max(0, dates.length - 1))}
                  onChange={(event) => setAsOfIndex(Number(event.target.value))}
                />
                <div className="timestamp-scale">
                  <span>{formatDate(dates[0] || null)}</span>
                  <span>{formatDate(dates.at(-1) || null)}</span>
                </div>
              </section>

              <section className="evolution-stats" aria-label="Business activity snapshot">
                <div><span>New entities and branches</span><strong>{counts.added}</strong></div>
                <div><span>Closures and dissolutions</span><strong>{counts.ceased}</strong></div>
                <div><span>Company changes</span><strong>{counts.changed}</strong></div>
                <div><span>Observed net change</span><strong>{observedNet >= 0 ? "+" : ""}{observedNet}</strong></div>
              </section>

              <section className="activity-panel">
                <div className="history-section-heading">
                  <div><p>Timeline density</p><h2>Legal activity by date</h2></div>
                  <div className="activity-legend">
                    <span className="added">Added</span>
                    <span className="changed">Changed</span>
                    <span className="ceased">Ceased</span>
                  </div>
                </div>
                <div className="activity-chart">
                  {activity.map(([date, item]) => {
                    const dateIndex = dates.indexOf(date);
                    const total = item.added + item.changed + item.ceased;
                    const style = {
                      "--activity-height": `${Math.max(10, (total / maxActivity) * 100)}%`,
                      "--added-share": `${(item.added / Math.max(1, total)) * 100}%`,
                      "--changed-share": `${(item.changed / Math.max(1, total)) * 100}%`,
                    } as CSSProperties;
                    return (
                      <button
                        key={date}
                        type="button"
                        className={date === asOfDate ? "active" : ""}
                        style={style}
                        onClick={() => setAsOfIndex(dateIndex)}
                        title={`${formatDate(date)}: ${total} events`}
                        aria-label={`Show history through ${formatDate(date)}`}
                      >
                        <i><b /><em /><span /></i>
                      </button>
                    );
                  })}
                </div>
              </section>

              <section className="event-feed">
                <div className="history-section-heading">
                  <div><p>Event ledger</p><h2>Companies and legal changes</h2></div>
                  <span>{scopedEvents.length} records</span>
                </div>
                {scopedEvents.length ? (
                  <div className="event-table">
                    {scopedEvents.map((event) => (
                      <button
                        key={event.id}
                        type="button"
                        className={event.id === activeEvent?.id ? "active" : ""}
                        onClick={() => setSelectedId(event.id)}
                      >
                        <time>{formatDate(event.event_date)}</time>
                        <div className="event-company">
                          <strong>{event.company_name}</strong>
                          <span>{event.legal_form || "Legal form unavailable"}</span>
                        </div>
                        <div className={`event-kind ${event.status_effect}`}>
                          <strong>{eventLabel(event.event_type)}</strong>
                          <span>{BASIS_LABELS[event.location_basis]}</span>
                        </div>
                        <div className="event-source">
                          <span>{event.commercial_register_number ? `RC ${event.commercial_register_number}` : "RC unavailable"}</span>
                          {event.needs_review && <em>Review</em>}
                        </div>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="history-empty compact">
                    <strong>No matching Gazette events</strong>
                    <p>Adjust the date or evidence filters.</p>
                  </div>
                )}
              </section>
            </>
          )}
        </section>

        <aside className="event-detail" aria-label="Selected company event">
          {activeEvent ? (
            <>
              <section className="detail-header">
                <span className={`status-label ${activeEvent.status_effect}`}>
                  {eventLabel(activeEvent.event_type)}
                </span>
                <h2>{activeEvent.company_name}</h2>
                <p>{sourceLabel(activeEvent)}</p>
              </section>

              <section className="detail-group">
                <h3>Company</h3>
                <dl>
                  <div><dt>Legal form</dt><dd>{activeEvent.legal_form || "Unavailable"}</dd></div>
                  <div><dt>Commercial register</dt><dd>{activeEvent.commercial_register_number || "Unavailable"}</dd></div>
                  <div><dt>Legal event date</dt><dd>{formatDate(activeEvent.event_date)}</dd></div>
                  <div><dt>Evidence</dt><dd>{BASIS_LABELS[activeEvent.location_basis]}</dd></div>
                </dl>
              </section>

              <section className="detail-group">
                <h3>Address</h3>
                <p dir="auto">{activeEvent.display_address || "No usable address was extracted."}</p>
                {activeEvent.branch_address && activeEvent.registered_address && (
                  <small dir="auto">Registered office: {activeEvent.registered_address}</small>
                )}
              </section>

              {(activeEvent.business_purpose || activeEvent.manager_or_liquidator) && (
                <section className="detail-group">
                  <h3>Notice details</h3>
                  {activeEvent.business_purpose && <p dir="auto">{activeEvent.business_purpose}</p>}
                  {activeEvent.manager_or_liquidator && (
                    <small dir="auto">Manager or liquidator: {activeEvent.manager_or_liquidator}</small>
                  )}
                </section>
              )}

              <section className="detail-group">
                <div className="detail-title-row">
                  <h3>Company history</h3>
                  <span>{companyHistory.length} event{companyHistory.length === 1 ? "" : "s"}</span>
                </div>
                <ol className="company-history">
                  {companyHistory.map((event) => (
                    <li key={event.id}>
                      <i className={event.status_effect} />
                      <div>
                        <strong>{eventLabel(event.event_type)}</strong>
                        <span>{formatDate(event.event_date)}</span>
                      </div>
                    </li>
                  ))}
                </ol>
              </section>

              <section className="record-quality">
                <strong>{activeEvent.needs_review ? "Review recommended" : "Parser checks passed"}</strong>
                <p>
                  Gazette dates describe legal events. They do not necessarily equal a storefront opening date.
                </p>
              </section>
            </>
          ) : (
            <div className="history-empty">
              <strong>Select an event</strong>
              <p>Company details and source evidence will appear here.</p>
            </div>
          )}
        </aside>
      </section>
    </main>
  );
}
