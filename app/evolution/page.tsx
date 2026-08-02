"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type Point = { lat: number; lng: number };
type LocationBasis = "address_match" | "registry_context" | "city_mention";
type StatusEffect = "added" | "ceased" | "changed";
type MapPrecision = "building" | "street" | "neighborhood" | "approximate";

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
  map_eligible: boolean;
  map_location: {
    lat: number;
    lng: number;
    precision: MapPrecision;
    label: string;
    anchor_id: string;
    source: string | null;
    verified_premises: boolean;
  } | null;
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
  map_attribution: string | null;
  coverage: {
    issue_count: number;
    event_count: number;
    mapped_event_count: number;
    unmapped_event_count: number;
    mapped_anchor_count: number;
    needs_review_count: number;
    first_event_date: string | null;
    last_event_date: string | null;
    issues: Array<{
      issue_number: string;
      publication_date: string | null;
      filename: string;
    }>;
  };
  events: HistoryEvent[];
};

type LeafletMap = {
  remove: () => void;
  setView: (center: number[], zoom: number, options?: Record<string, unknown>) => LeafletMap;
  setMaxBounds: (bounds: number[][]) => void;
  on: (event: string, handler: (event: { latlng: { lat: number; lng: number } }) => void) => void;
  fitBounds: (bounds: unknown, options?: Record<string, unknown>) => void;
};

interface LeafletLayer {
  addTo(map: LeafletMap): this;
  remove: () => void;
}

type LeafletCircle = LeafletLayer & { getBounds: () => unknown };
type LeafletMarker = LeafletLayer & {
  bindTooltip: (content: string, options?: Record<string, unknown>) => LeafletMarker;
  on: (event: string, handler: () => void) => LeafletMarker;
};

type LeafletApi = {
  map: (node: HTMLDivElement, options?: Record<string, unknown>) => LeafletMap;
  tileLayer: (url: string, options?: Record<string, unknown>) => LeafletLayer;
  circle: (point: number[], options?: Record<string, unknown>) => LeafletCircle;
  marker: (point: number[], options?: Record<string, unknown>) => LeafletMarker;
  divIcon: (options?: Record<string, unknown>) => unknown;
  control: { zoom: (options?: Record<string, unknown>) => LeafletLayer };
};

const SETTAT_CENTER: Point = { lat: 32.9958, lng: -7.6112 };
const SETTAT_BOUNDS = [
  [32.91, -7.75],
  [33.1, -7.5],
];

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
  address_match: "Address names Settat",
  registry_context: "Settat registry context",
  city_mention: "Settat mentioned",
};

const PRECISION_LABELS: Record<MapPrecision, string> = {
  building: "Building-level",
  street: "Street-level approximation",
  neighborhood: "Neighborhood-level approximation",
  approximate: "Approximate location",
};

function getLeaflet() {
  return (window as Window & typeof globalThis & { L?: LeafletApi }).L;
}

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

function formatDistance(value: number) {
  return value < 1000 ? `${Math.round(value)} m` : `${(value / 1000).toFixed(1)} km`;
}

function distanceMeters(a: Point, b: Point) {
  const earthRadius = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const value =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return earthRadius * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/gu, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[character] || character);
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
  const mapNodeRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const areaCircleRef = useRef<LeafletCircle | null>(null);
  const areaCentreRef = useRef<LeafletLayer | null>(null);
  const eventLayersRef = useRef<LeafletLayer[]>([]);

  const [dataset, setDataset] = useState<HistoryDataset | null>(null);
  const [loadError, setLoadError] = useState("");
  const [mapReady, setMapReady] = useState(false);
  const [point, setPoint] = useState<Point>(SETTAT_CENTER);
  const [areaLabel, setAreaLabel] = useState("Central Settat");
  const [radius, setRadius] = useState(1200);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | StatusEffect>("all");
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
        const availableDates = [...new Set(value.events.map((event) => event.event_date))].sort();
        setAsOfIndex(Math.max(0, availableDates.length - 1));
      })
      .catch(() => {
        if (active) setLoadError("The Gazette history database could not be loaded.");
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let attempts = 0;
    const connect = window.setInterval(() => {
      const L = getLeaflet();
      if (!L || !mapNodeRef.current || mapRef.current) {
        attempts += 1;
        if (attempts > 80) window.clearInterval(connect);
        return;
      }

      window.clearInterval(connect);
      const map = L.map(mapNodeRef.current, {
        zoomControl: false,
        attributionControl: true,
        minZoom: 12,
        maxZoom: 19,
      }).setView([SETTAT_CENTER.lat, SETTAT_CENTER.lng], 14);

      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
      }).addTo(map);
      L.control.zoom({ position: "bottomright" }).addTo(map);
      map.setMaxBounds(SETTAT_BOUNDS);
      map.on("click", (event) => {
        const next = { lat: event.latlng.lat, lng: event.latlng.lng };
        setPoint(next);
        setAreaLabel(`${next.lat.toFixed(5)}, ${next.lng.toFixed(5)}`);
        setSelectedId(null);
      });

      mapRef.current = map;
      setMapReady(true);
    }, 100);

    return () => {
      window.clearInterval(connect);
      eventLayersRef.current.forEach((layer) => layer.remove());
      if (mapRef.current) mapRef.current.remove();
      mapRef.current = null;
    };
  }, []);

  const dates = useMemo(
    () => [...new Set((dataset?.events || []).map((event) => event.event_date))].sort(),
    [dataset],
  );
  const asOfDate = dates[Math.min(asOfIndex, Math.max(0, dates.length - 1))] || null;

  const visibleEvents = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return (dataset?.events || []).filter((event) => {
      const searchText = [
        event.company_name,
        event.commercial_register_number,
        event.display_address,
        event.business_purpose,
      ].filter(Boolean).join(" ").toLocaleLowerCase();
      return (
        (!asOfDate || event.event_date <= asOfDate) &&
        (statusFilter === "all" || event.status_effect === statusFilter) &&
        (includeReview || !event.needs_review) &&
        (!needle || searchText.includes(needle))
      );
    });
  }, [asOfDate, dataset, includeReview, query, statusFilter]);

  const mappedEvents = useMemo(
    () => visibleEvents.filter((event) => event.map_eligible && event.map_location),
    [visibleEvents],
  );

  const areaEvents = useMemo(
    () => mappedEvents
      .map((event) => ({
        event,
        distance: distanceMeters(point, {
          lat: event.map_location!.lat,
          lng: event.map_location!.lng,
        }),
      }))
      .filter((item) => item.distance <= radius)
      .sort((left, right) => (
        right.event.event_date.localeCompare(left.event.event_date) ||
        left.event.company_name.localeCompare(right.event.company_name, "en")
      )),
    [mappedEvents, point, radius],
  );

  const unmappedEvents = useMemo(
    () => visibleEvents
      .filter((event) => !event.map_eligible)
      .sort((left, right) => right.event_date.localeCompare(left.event_date)),
    [visibleEvents],
  );

  const counts = useMemo(() => areaEvents.reduce(
    (result, item) => {
      result[item.event.status_effect] += 1;
      return result;
    },
    { added: 0, changed: 0, ceased: 0 }),
  [areaEvents]);

  const activeEvent = useMemo(() => {
    const selected = visibleEvents.find((event) => event.id === selectedId);
    return selected || areaEvents[0]?.event || null;
  }, [areaEvents, selectedId, visibleEvents]);

  const companyHistory = useMemo(() => (
    activeEvent
      ? (dataset?.events || [])
        .filter((event) => event.company_id === activeEvent.company_id)
        .sort((left, right) => left.event_date.localeCompare(right.event_date))
      : []
  ), [activeEvent, dataset]);

  useEffect(() => {
    if (!mapReady) return;
    const L = getLeaflet();
    const map = mapRef.current;
    if (!L || !map) return;

    areaCircleRef.current?.remove();
    areaCentreRef.current?.remove();
    areaCircleRef.current = L.circle([point.lat, point.lng], {
      radius,
      color: "#17252f",
      weight: 2,
      opacity: 0.82,
      dashArray: "6 6",
      fillColor: "#ffffff",
      fillOpacity: 0.08,
    }).addTo(map);
    areaCentreRef.current = L.marker([point.lat, point.lng], {
      interactive: false,
      icon: L.divIcon({
        className: "history-area-centre-wrap",
        html: '<span class="history-area-centre"></span>',
        iconSize: [18, 18],
        iconAnchor: [9, 9],
      }),
    }).addTo(map);
  }, [mapReady, point, radius]);

  useEffect(() => {
    if (!mapReady) return;
    const L = getLeaflet();
    const map = mapRef.current;
    if (!L || !map) return;

    eventLayersRef.current.forEach((layer) => layer.remove());
    eventLayersRef.current = [];

    const groups = new Map<string, HistoryEvent[]>();
    for (const event of mappedEvents) {
      const key = event.map_location!.anchor_id;
      groups.set(key, [...(groups.get(key) || []), event]);
    }

    for (const events of groups.values()) {
      const ordered = events.toSorted((left, right) => right.event_date.localeCompare(left.event_date));
      const latest = ordered[0];
      const location = latest.map_location!;
      const inArea = distanceMeters(point, location) <= radius;
      const statuses = new Set(events.map((event) => event.status_effect));
      const tone = statuses.size === 1 ? latest.status_effect : "mixed";
      const selected = events.some((event) => event.id === activeEvent?.id);
      const marker = L.marker([location.lat, location.lng], {
        icon: L.divIcon({
          className: `history-marker-wrap ${inArea ? "in-area" : "outside-area"} ${selected ? "selected" : ""}`,
          html: `<span class="history-marker ${tone}"><b>${events.length}</b></span>`,
          iconSize: [40, 46],
          iconAnchor: [20, 42],
        }),
      })
        .bindTooltip(
          `<strong>${escapeHtml(location.label)}</strong><br>${events.length} legal event${events.length === 1 ? "" : "s"} · ${escapeHtml(PRECISION_LABELS[location.precision])}`,
          { direction: "top", offset: [0, -30] },
        )
        .on("click", () => {
          setSelectedId(latest.id);
          setPoint({ lat: location.lat, lng: location.lng });
          setAreaLabel(location.label);
          map.setView([location.lat, location.lng], 16, { animate: true });
        })
        .addTo(map);
      eventLayersRef.current.push(marker);
    }
  }, [activeEvent?.id, mapReady, mappedEvents, point, radius]);

  const fitArea = useCallback(() => {
    if (!mapRef.current || !areaCircleRef.current) return;
    mapRef.current.fitBounds(areaCircleRef.current.getBounds(), {
      padding: [36, 36],
      maxZoom: 17,
    });
  }, []);

  const resetArea = useCallback(() => {
    setPoint(SETTAT_CENTER);
    setAreaLabel("Central Settat");
    setSelectedId(null);
    mapRef.current?.setView([SETTAT_CENTER.lat, SETTAT_CENTER.lng], 14, { animate: true });
  }, []);

  const focusEvent = useCallback((event: HistoryEvent) => {
    setSelectedId(event.id);
    if (!event.map_location) return;
    const next = { lat: event.map_location.lat, lng: event.map_location.lng };
    setPoint(next);
    setAreaLabel(event.map_location.label);
    mapRef.current?.setView([next.lat, next.lng], 16, { animate: true });
  }, []);

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

      <section className="history-map-workspace">
        <aside className="history-map-controls" aria-label="Business evolution controls">
          <section className="history-control-section history-intro">
            <p>Official Gazette layer</p>
            <h1>Business evolution on the map.</h1>
            <span>Select a small area, then move through legal events over time.</span>
          </section>

          <section className="history-control-section">
            <div className="history-control-title">
              <span>Selected area</span>
              <button type="button" onClick={fitArea}>Fit</button>
            </div>
            <strong className="history-area-label">{areaLabel}</strong>
            <div className="label-row">
              <label htmlFor="history-radius">Radius</label>
              <output htmlFor="history-radius">{radius} m</output>
            </div>
            <input
              id="history-radius"
              type="range"
              min="300"
              max="1800"
              step="100"
              value={radius}
              onChange={(event) => setRadius(Number(event.target.value))}
            />
            <div className="range-scale"><span>300 m</span><span>1.8 km</span></div>
            <button className="history-reset" type="button" onClick={resetArea}>Reset to central Settat</button>
          </section>

          <section className="history-control-section history-time-control">
            <div className="history-control-title">
              <span>Observed through</span>
              <strong>{formatDate(asOfDate)}</strong>
            </div>
            <input
              aria-label="Business history date"
              type="range"
              min="0"
              max={Math.max(0, dates.length - 1)}
              step="1"
              value={Math.min(asOfIndex, Math.max(0, dates.length - 1))}
              onChange={(event) => {
                setAsOfIndex(Number(event.target.value));
                setSelectedId(null);
              }}
            />
            <div className="range-scale">
              <span>{formatDate(dates[0] || null)}</span>
              <span>{formatDate(dates.at(-1) || null)}</span>
            </div>
          </section>

          <section className="history-control-section history-filter-grid">
            <label>
              <span>Find a company</span>
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Name, RC or address"
              />
            </label>
            <label>
              <span>Legal activity</span>
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value as "all" | StatusEffect)}
              >
                <option value="all">All activity</option>
                <option value="added">New entities and branches</option>
                <option value="changed">Company changes</option>
                <option value="ceased">Dissolutions and closures</option>
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
          </section>

          <section className="history-control-section area-summary">
            <div className="history-control-title">
              <span>Events inside area</span>
              <strong>{areaEvents.length}</strong>
            </div>
            <dl>
              <div><dt>Added</dt><dd className="added">{counts.added}</dd></div>
              <div><dt>Changed</dt><dd className="changed">{counts.changed}</dd></div>
              <div><dt>Ceased</dt><dd className="ceased">{counts.ceased}</dd></div>
            </dl>
          </section>

          <section className="history-control-section area-event-list">
            <div className="history-control-title">
              <span>Area ledger</span>
              <small>Legal events</small>
            </div>
            {areaEvents.length ? areaEvents.map(({ event, distance }) => (
              <button
                key={event.id}
                type="button"
                className={activeEvent?.id === event.id ? "active" : ""}
                onClick={() => focusEvent(event)}
              >
                <i className={event.status_effect} />
                <span>
                  <strong>{event.company_name}</strong>
                  <small>{eventLabel(event.event_type)} · {formatDate(event.event_date)}</small>
                </span>
                <em>{formatDistance(distance)}</em>
              </button>
            )) : (
              <p className="history-list-empty">No mapped Gazette events match this area and date.</p>
            )}
          </section>

          {unmappedEvents.length > 0 && (
            <details className="history-unmapped">
              <summary>{unmappedEvents.length} records without a defensible map point</summary>
              <div>
                {unmappedEvents.map((event) => (
                  <button key={event.id} type="button" onClick={() => focusEvent(event)}>
                    <strong>{event.company_name}</strong>
                    <span>{eventLabel(event.event_type)} · {formatDate(event.event_date)}</span>
                  </button>
                ))}
              </div>
            </details>
          )}
        </aside>

        <section className="history-map-stage" aria-label="Timestamped Settat business map">
          <div ref={mapNodeRef} className="history-map-canvas" />
          <div className="history-map-status">
            <span>Gazette activity through</span>
            <strong>{formatDate(asOfDate)}</strong>
          </div>
          <div className="history-map-legend" aria-label="Legal event map legend">
            <span><i className="added" />Added</span>
            <span><i className="changed" />Changed</span>
            <span><i className="ceased" />Ceased</span>
            <small>Number = events at one map anchor</small>
          </div>
          {dataset && (
            <div className="history-map-coverage">
              <strong>{dataset.coverage.mapped_event_count} of {dataset.coverage.event_count}</strong>
              <span>events currently have a defensible Settat map anchor</span>
            </div>
          )}
          {!mapReady && !loadError && (
            <div className="map-loading">
              <span className="spinner dark" aria-hidden="true" />
              Loading Settat map…
            </div>
          )}
          {loadError && (
            <div className="map-loading history-load-error">
              <strong>History unavailable</strong>
              <span>{loadError}</span>
            </div>
          )}
        </section>

        <aside className="history-event-detail" aria-label="Selected Gazette event">
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
                <h3>Company record</h3>
                <dl>
                  <div><dt>Legal form</dt><dd>{activeEvent.legal_form || "Unavailable"}</dd></div>
                  <div><dt>Commercial register</dt><dd>{activeEvent.commercial_register_number || "Unavailable"}</dd></div>
                  <div><dt>Legal event date</dt><dd>{formatDate(activeEvent.event_date)}</dd></div>
                  <div><dt>Location evidence</dt><dd>{BASIS_LABELS[activeEvent.location_basis]}</dd></div>
                </dl>
              </section>

              <section className="detail-group">
                <h3>Gazette address</h3>
                <p dir="auto">{activeEvent.display_address || "No usable address was extracted."}</p>
                {activeEvent.branch_address && activeEvent.registered_address && (
                  <small dir="auto">Registered office: {activeEvent.registered_address}</small>
                )}
              </section>

              <section className="detail-group map-location-detail">
                <div className="detail-title-row">
                  <h3>Map location</h3>
                  {activeEvent.map_location && (
                    <button type="button" onClick={() => focusEvent(activeEvent)}>Center</button>
                  )}
                </div>
                {activeEvent.map_location ? (
                  <>
                    <strong>{activeEvent.map_location.label}</strong>
                    <span>{PRECISION_LABELS[activeEvent.map_location.precision]}</span>
                    <p>The Gazette address is mapped to a street or neighborhood anchor, not asserted as an exact storefront.</p>
                  </>
                ) : (
                  <p>This record stays in the ledger because its address cannot yet be located reliably.</p>
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
                <p>Gazette dates describe legal events. They do not necessarily equal a storefront opening date.</p>
              </section>
            </>
          ) : (
            <div className="history-empty">
              <strong>Select an event</strong>
              <p>Move the timestamp or choose a marker to inspect the source record.</p>
            </div>
          )}
        </aside>
      </section>
    </main>
  );
}
