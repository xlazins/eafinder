"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

type Point = { lat: number; lng: number };
type OSMTags = Record<string, string>;
type OSMElement = {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: OSMTags;
};

type SettatDataset = {
  elements?: OSMElement[];
  osm3s?: { timestamp_osm_base?: string };
};

type NearbyPlace = {
  id: string;
  name: string;
  kind: string;
  distance: number;
  point: Point;
};

type ScanResult = {
  score: number;
  verdict: string;
  confidence: number;
  mappedFeatures: number;
  competitors: NearbyPlace[];
  demandPlaces: NearbyPlace[];
  buildings: number;
  roads: number;
  majorRoads: number;
  transit: number;
  metrics: {
    demand: number;
    competition: number;
    access: number;
    intensity: number;
  };
  demandBreakdown: Record<string, number>;
  timestamp: string;
};

type BusinessProfile = {
  label: string;
  description: string;
  matches: (tags: OSMTags) => boolean;
  competitionReference: number;
  weights: { demand: number; competition: number; access: number; intensity: number };
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

type LeafletCircle = LeafletLayer & {
  getBounds: () => unknown;
};

type LeafletCircleMarker = LeafletLayer & {
  bindTooltip: (content: string, options?: Record<string, unknown>) => LeafletCircleMarker;
};

type LeafletApi = {
  map: (node: HTMLDivElement, options?: Record<string, unknown>) => LeafletMap;
  tileLayer: (url: string, options?: Record<string, unknown>) => LeafletLayer;
  circle: (point: number[], options?: Record<string, unknown>) => LeafletCircle;
  marker: (point: number[], options?: Record<string, unknown>) => LeafletLayer;
  circleMarker: (point: number[], options?: Record<string, unknown>) => LeafletCircleMarker;
  divIcon: (options?: Record<string, unknown>) => unknown;
  control: {
    zoom: (options?: Record<string, unknown>) => LeafletLayer;
  };
};

function getLeaflet() {
  return (window as Window & typeof globalThis & { L?: LeafletApi }).L;
}

const SETTAT_CENTER: Point = { lat: 33.0014, lng: -7.6167 };
const SETTAT_BOUNDS = [
  [32.91, -7.75],
  [33.1, -7.5],
];
let cityDataPromise: Promise<SettatDataset> | null = null;

const BUSINESS_PROFILES: Record<string, BusinessProfile> = {
  cafe: {
    label: "Cafe",
    description: "Coffee shops, cafes and similar quick-service venues",
    matches: (t) =>
      t.amenity === "cafe" ||
      t.cuisine?.includes("coffee_shop") ||
      t.shop === "coffee",
    competitionReference: 9,
    weights: { demand: 0.38, competition: 0.24, access: 0.24, intensity: 0.14 },
  },
  restaurant: {
    label: "Restaurant",
    description: "Restaurants and fast-food venues",
    matches: (t) => ["restaurant", "fast_food", "food_court"].includes(t.amenity),
    competitionReference: 12,
    weights: { demand: 0.36, competition: 0.27, access: 0.25, intensity: 0.12 },
  },
  grocery: {
    label: "Grocery",
    description: "Convenience stores, grocers and supermarkets",
    matches: (t) =>
      ["convenience", "supermarket", "grocery", "general", "greengrocer"].includes(t.shop),
    competitionReference: 8,
    weights: { demand: 0.43, competition: 0.2, access: 0.14, intensity: 0.23 },
  },
  bakery: {
    label: "Bakery",
    description: "Bakeries and pastry shops",
    matches: (t) => ["bakery", "pastry"].includes(t.shop),
    competitionReference: 6,
    weights: { demand: 0.42, competition: 0.23, access: 0.15, intensity: 0.2 },
  },
  pharmacy: {
    label: "Pharmacy",
    description: "Pharmacies and medicine dispensaries",
    matches: (t) => t.amenity === "pharmacy" || t.shop === "chemist",
    competitionReference: 7,
    weights: { demand: 0.37, competition: 0.27, access: 0.2, intensity: 0.16 },
  },
  salon: {
    label: "Hair & beauty",
    description: "Hairdressers, barbers and beauty salons",
    matches: (t) => ["hairdresser", "beauty"].includes(t.shop),
    competitionReference: 8,
    weights: { demand: 0.39, competition: 0.25, access: 0.15, intensity: 0.21 },
  },
  gym: {
    label: "Gym",
    description: "Fitness centres and sports facilities",
    matches: (t) =>
      t.leisure === "fitness_centre" ||
      t.leisure === "sports_centre" ||
      t.sport === "fitness",
    competitionReference: 3,
    weights: { demand: 0.3, competition: 0.27, access: 0.29, intensity: 0.14 },
  },
  clinic: {
    label: "Clinic",
    description: "Clinics, doctors and dental practices",
    matches: (t) => ["clinic", "doctors", "dentist"].includes(t.amenity),
    competitionReference: 5,
    weights: { demand: 0.3, competition: 0.28, access: 0.3, intensity: 0.12 },
  },
  clothing: {
    label: "Clothing",
    description: "Clothes, shoes and fashion retail",
    matches: (t) => ["clothes", "shoes", "fashion", "boutique"].includes(t.shop),
    competitionReference: 10,
    weights: { demand: 0.32, competition: 0.28, access: 0.27, intensity: 0.13 },
  },
};

function clamp(value: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
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

function elementPoint(element: OSMElement): Point | null {
  if (typeof element.lat === "number" && typeof element.lon === "number") {
    return { lat: element.lat, lng: element.lon };
  }
  if (element.center) {
    return { lat: element.center.lat, lng: element.center.lon };
  }
  return null;
}

function displayName(tags: OSMTags) {
  return (
    tags.name ||
    tags["name:fr"] ||
    tags["name:ar"] ||
    tags.brand ||
    "Mapped place"
  );
}

function demandCategory(tags: OSMTags) {
  if (["school", "kindergarten", "college", "university", "language_school"].includes(tags.amenity)) {
    return "Education";
  }
  if (["hospital", "clinic", "doctors", "dentist", "pharmacy"].includes(tags.amenity)) {
    return "Health";
  }
  if (["bank", "atm", "post_office", "townhall", "courthouse", "police"].includes(tags.amenity) || tags.office) {
    return "Work & services";
  }
  if (
    ["marketplace"].includes(tags.amenity) ||
    tags.shop ||
    ["mall", "department_store"].includes(tags.building)
  ) {
    return "Retail";
  }
  if (["cafe", "restaurant", "fast_food", "food_court"].includes(tags.amenity)) {
    return "Food & drink";
  }
  if (tags.public_transport || tags.highway === "bus_stop" || tags.amenity === "bus_station") {
    return "Transit";
  }
  if (tags.tourism || tags.leisure) {
    return "Leisure & visitors";
  }
  return null;
}

function placeKind(tags: OSMTags) {
  return (
    tags.shop ||
    tags.amenity ||
    tags.leisure ||
    tags.office ||
    tags.tourism ||
    "place"
  )
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

async function fetchOSM(point: Point, radius: number, signal: AbortSignal) {
  if (!cityDataPromise) {
    cityDataPromise = fetch("/data/settat-osm.json")
      .then((response) => {
        if (!response.ok) throw new Error(`Data file returned ${response.status}`);
        return response.json() as Promise<SettatDataset>;
      })
      .catch((error) => {
        cityDataPromise = null;
        throw error;
      });
  }

  const dataset = await cityDataPromise;
  if (signal.aborted) throw new DOMException("Scan cancelled", "AbortError");

  const elements = (dataset.elements || []).filter((element) => {
    const location = elementPoint(element);
    return location ? distanceMeters(point, location) <= radius : false;
  });

  return {
    elements,
    timestamp: dataset.osm3s?.timestamp_osm_base || new Date().toISOString(),
  };
}

function scoreScan(
  elements: OSMElement[],
  profile: BusinessProfile,
  point: Point,
  radius: number,
  timestamp: string,
): ScanResult {
  const areaKm2 = Math.PI * (radius / 1000) ** 2;
  const competitors: NearbyPlace[] = [];
  const demandPlaces: NearbyPlace[] = [];
  const demandBreakdown: Record<string, number> = {};
  let buildings = 0;
  let roads = 0;
  let majorRoads = 0;
  let transit = 0;

  for (const element of elements) {
    const tags = element.tags || {};
    const location = elementPoint(element);

    if (element.type === "way" && tags.building) buildings += 1;
    if (element.type === "way" && tags.highway) {
      roads += 1;
      if (["primary", "secondary", "tertiary", "trunk"].includes(tags.highway)) {
        majorRoads += 1;
      }
    }
    if (tags.public_transport || tags.highway === "bus_stop" || tags.amenity === "bus_station") {
      transit += 1;
    }

    if (!location) continue;

    if (profile.matches(tags)) {
      competitors.push({
        id: `${element.type}-${element.id}`,
        name: displayName(tags),
        kind: placeKind(tags),
        distance: Math.round(distanceMeters(point, location)),
        point: location,
      });
      continue;
    }

    const category = demandCategory(tags);
    if (category) {
      demandBreakdown[category] = (demandBreakdown[category] || 0) + 1;
      demandPlaces.push({
        id: `${element.type}-${element.id}`,
        name: displayName(tags),
        kind: category,
        distance: Math.round(distanceMeters(point, location)),
        point: location,
      });
    }
  }

  competitors.sort((a, b) => a.distance - b.distance);
  demandPlaces.sort((a, b) => a.distance - b.distance);

  const weightedDemand = Object.entries(demandBreakdown).reduce((total, [category, count]) => {
    const weight =
      category === "Education" || category === "Work & services"
        ? 1.3
        : category === "Transit"
          ? 1.2
          : 1;
    return total + count * weight;
  }, 0);

  const demandDensity = weightedDemand / Math.max(areaKm2, 0.1);
  const buildingDensity = buildings / Math.max(areaKm2, 0.1);
  const roadDensity = roads / Math.max(areaKm2, 0.1);
  const competitorDensity = competitors.length / Math.max(areaKm2, 0.1);

  const demand = Math.round(clamp(22 + demandDensity * 0.9));
  const intensity = Math.round(clamp(18 + buildingDensity / 5.5));
  const access = Math.round(
    clamp(22 + Math.min(43, roadDensity * 0.17) + Math.min(20, majorRoads * 3) + Math.min(15, transit * 2.5)),
  );
  const competitionPressure = Math.round(
    clamp((competitorDensity / profile.competitionReference) * 58),
  );
  const competitionOpportunity = 100 - competitionPressure;

  const score = Math.round(
    demand * profile.weights.demand +
      competitionOpportunity * profile.weights.competition +
      access * profile.weights.access +
      intensity * profile.weights.intensity,
  );

  const namedRecords = [...competitors, ...demandPlaces].filter(
    (place) => place.name !== "Mapped place",
  ).length;
  const confidence = Math.round(
    clamp(45 + Math.min(35, elements.length / 14) + Math.min(15, namedRecords / 4), 45, 95),
  );

  const verdict =
    score >= 78
      ? "Strong local fit"
      : score >= 64
        ? "Good potential"
        : score >= 50
          ? "Mixed signals"
          : "Weak mapped fit";

  return {
    score,
    verdict,
    confidence,
    mappedFeatures: elements.length,
    competitors,
    demandPlaces,
    buildings,
    roads,
    majorRoads,
    transit,
    metrics: { demand, competition: competitionPressure, access, intensity },
    demandBreakdown,
    timestamp,
  };
}

function formatDistance(value: number) {
  return value < 1000 ? `${value} m` : `${(value / 1000).toFixed(1)} km`;
}

function MetricRow({
  label,
  value,
  inverse = false,
}: {
  label: string;
  value: number;
  inverse?: boolean;
}) {
  const tone = inverse
    ? value <= 35
      ? "good"
      : value <= 65
        ? "medium"
        : "weak"
    : value >= 70
      ? "good"
      : value >= 48
        ? "medium"
        : "weak";

  return (
    <div className="metric-row">
      <div className="metric-label">
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
      <div className="metric-track" aria-hidden="true">
        <span className={tone} style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}

export default function Home() {
  const mapNodeRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const locationMarkerRef = useRef<LeafletLayer | null>(null);
  const radiusLayerRef = useRef<LeafletCircle | null>(null);
  const evidenceLayersRef = useRef<LeafletLayer[]>([]);
  const requestRef = useRef<AbortController | null>(null);

  const [businessKey, setBusinessKey] = useState("cafe");
  const [radius, setRadius] = useState(600);
  const [point, setPoint] = useState<Point>(SETTAT_CENTER);
  const [query, setQuery] = useState("");
  const [locationLabel, setLocationLabel] = useState("Settat city centre");
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [error, setError] = useState("");
  const [result, setResult] = useState<ScanResult | null>(null);
  const [mapReady, setMapReady] = useState(false);

  const profile = BUSINESS_PROFILES[businessKey];

  const updateLocationLayers = useCallback((nextPoint: Point, nextRadius: number) => {
    const L = getLeaflet();
    const map = mapRef.current;
    if (!L || !map) return;

    if (locationMarkerRef.current) locationMarkerRef.current.remove();
    if (radiusLayerRef.current) radiusLayerRef.current.remove();

    radiusLayerRef.current = L.circle([nextPoint.lat, nextPoint.lng], {
      radius: nextRadius,
      color: "#b4232f",
      weight: 2,
      opacity: 0.9,
      fillColor: "#b4232f",
      fillOpacity: 0.055,
    }).addTo(map);

    locationMarkerRef.current = L.marker([nextPoint.lat, nextPoint.lng], {
      icon: L.divIcon({
        className: "candidate-marker-wrap",
        html: '<span class="candidate-marker"><span></span></span>',
        iconSize: [28, 36],
        iconAnchor: [14, 34],
      }),
    }).addTo(map);
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
      }).setView([SETTAT_CENTER.lat, SETTAT_CENTER.lng], 15);

      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
      }).addTo(map);
      L.control.zoom({ position: "bottomright" }).addTo(map);
      map.setMaxBounds(SETTAT_BOUNDS);
      map.on("click", (event: { latlng: { lat: number; lng: number } }) => {
        const next = { lat: event.latlng.lat, lng: event.latlng.lng };
        setPoint(next);
        setLocationLabel(`${next.lat.toFixed(5)}, ${next.lng.toFixed(5)}`);
        setResult(null);
        setStatus("idle");
      });

      mapRef.current = map;
      setMapReady(true);
    }, 100);

    return () => {
      window.clearInterval(connect);
      requestRef.current?.abort();
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!mapReady) return;
    updateLocationLayers(point, radius);
  }, [mapReady, point, radius, updateLocationLayers]);

  const clearEvidenceLayers = useCallback(() => {
    evidenceLayersRef.current.forEach((layer) => layer.remove());
    evidenceLayersRef.current = [];
  }, []);

  const showEvidenceOnMap = useCallback(
    (scan: ScanResult) => {
      const L = getLeaflet();
      const map = mapRef.current;
      if (!L || !map) return;
      clearEvidenceLayers();

      const addDots = (places: NearbyPlace[], color: string, max: number) => {
        places.slice(0, max).forEach((place) => {
          const dot = L.circleMarker([place.point.lat, place.point.lng], {
            radius: 5,
            color: "#ffffff",
            weight: 1.5,
            fillColor: color,
            fillOpacity: 0.95,
          })
            .bindTooltip(
              `<strong>${place.name}</strong><br>${place.kind} · ${formatDistance(place.distance)}`,
              { direction: "top", offset: [0, -5] },
            )
            .addTo(map);
          evidenceLayersRef.current.push(dot);
        });
      };

      addDots(scan.demandPlaces, "#16734c", 70);
      addDots(scan.competitors, "#b4232f", 40);
    },
    [clearEvidenceLayers],
  );

  const runScan = useCallback(async () => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setStatus("loading");
    setError("");
    clearEvidenceLayers();

    try {
      const data = await fetchOSM(point, radius, controller.signal);
      const scan = scoreScan(data.elements, BUSINESS_PROFILES[businessKey], point, radius, data.timestamp);
      setResult(scan);
      setStatus("ready");
      showEvidenceOnMap(scan);
    } catch (scanError) {
      if ((scanError as Error).name === "AbortError") return;
      setStatus("error");
      setError("The live map data service did not respond. Please retry in a moment.");
    }
  }, [businessKey, clearEvidenceLayers, point, radius, showEvidenceOnMap]);

  const searchLocation = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) return;

    setError("");
    try {
      const dataset = await fetchOSM(SETTAT_CENTER, 8000, new AbortController().signal);
      const needle = trimmed.toLocaleLowerCase();
      const matches = dataset.elements
        .map((element) => ({
          point: elementPoint(element),
          name:
            element.tags?.name ||
            element.tags?.["name:fr"] ||
            element.tags?.["name:ar"] ||
            "",
        }))
        .filter((item) => item.point && item.name.toLocaleLowerCase().includes(needle))
        .sort((a, b) => {
          const aStarts = a.name.toLocaleLowerCase().startsWith(needle) ? 1 : 0;
          const bStarts = b.name.toLocaleLowerCase().startsWith(needle) ? 1 : 0;
          return bStarts - aStarts;
        });

      if (!matches.length || !matches[0].point) {
        setError("No matching address was found inside Settat.");
        return;
      }

      const next = matches[0].point;
      setPoint(next);
      setLocationLabel(matches[0].name);
      setResult(null);
      setStatus("idle");
      mapRef.current?.setView([next.lat, next.lng], 16, { animate: true });
    } catch {
      setError("Address search is temporarily unavailable. You can still choose a point on the map.");
    }
  };

  const fitCircle = () => {
    if (!mapRef.current || !radiusLayerRef.current) return;
    mapRef.current.fitBounds(radiusLayerRef.current.getBounds(), {
      padding: [34, 34],
      maxZoom: 17,
    });
  };

  const resetCentre = () => {
    setPoint(SETTAT_CENTER);
    setLocationLabel("Settat city centre");
    setResult(null);
    setStatus("idle");
    clearEvidenceLayers();
    mapRef.current?.setView([SETTAT_CENTER.lat, SETTAT_CENTER.lng], 15, { animate: true });
  };

  const sortedBreakdown = useMemo(
    () =>
      result
        ? Object.entries(result.demandBreakdown).sort((a, b) => b[1] - a[1])
        : [],
    [result],
  );
  const maxBreakdown = sortedBreakdown[0]?.[1] || 1;

  return (
    <main className="product-shell">
      <header className="app-header">
        <div className="brand-block">
          <span className="brand-mark">S</span>
          <div>
            <strong>SettatScope</strong>
            <span>Business location intelligence</span>
          </div>
        </div>
        <div className="header-location">
          <span className="live-dot" aria-hidden="true" />
          Settat OpenStreetMap data
        </div>
        <div className="city-lock">
          <span>City</span>
          <strong>Settat, Morocco</strong>
        </div>
      </header>

      <section className="workspace">
        <aside className="control-rail" aria-label="Location scan controls">
          <div className="rail-heading">
            <p>New location scan</p>
            <h1>Choose a business and a precise point.</h1>
          </div>

          <form className="search-form" onSubmit={searchLocation}>
            <label htmlFor="address">Find an address</label>
            <div className="search-field">
              <input
                id="address"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Street, landmark or area"
                autoComplete="off"
              />
              <button type="submit" aria-label="Search address" title="Search address">
                <span aria-hidden="true">⌕</span>
              </button>
            </div>
          </form>

          <div className="field-group">
            <label htmlFor="business">Business type</label>
            <select
              id="business"
              value={businessKey}
              onChange={(event) => {
                setBusinessKey(event.target.value);
                setResult(null);
                setStatus("idle");
                clearEvidenceLayers();
              }}
            >
              {Object.entries(BUSINESS_PROFILES).map(([key, item]) => (
                <option key={key} value={key}>
                  {item.label}
                </option>
              ))}
            </select>
            <small>{profile.description}</small>
          </div>

          <div className="field-group radius-field">
            <div className="label-row">
              <label htmlFor="radius">Walking-area radius</label>
              <output htmlFor="radius">{radius} m</output>
            </div>
            <input
              id="radius"
              type="range"
              min="300"
              max="1000"
              step="100"
              value={radius}
              onChange={(event) => {
                setRadius(Number(event.target.value));
                setResult(null);
                setStatus("idle");
                clearEvidenceLayers();
              }}
            />
            <div className="range-scale">
              <span>300 m</span>
              <span>1 km</span>
            </div>
          </div>

          <div className="selected-location">
            <span>Selected point</span>
            <strong>{locationLabel}</strong>
            <small>
              {point.lat.toFixed(5)}, {point.lng.toFixed(5)}
            </small>
          </div>

          {error && <p className="inline-error">{error}</p>}

          <button
            className="scan-button"
            type="button"
            onClick={runScan}
            disabled={status === "loading" || !mapReady}
          >
            {status === "loading" ? (
              <>
                <span className="spinner" aria-hidden="true" />
                Reading local data…
              </>
            ) : (
              "Analyze this location"
            )}
          </button>

          <div className="rail-actions">
            <button type="button" onClick={fitCircle} title="Fit the selected area">
              Fit area
            </button>
            <button type="button" onClick={resetCentre} title="Return to Settat centre">
              Reset centre
            </button>
          </div>

          <p className="selection-help">
            Click anywhere inside Settat to move the candidate point. The red circle is the exact area analyzed.
          </p>
        </aside>

        <section className="map-stage" aria-label="Settat business analysis map">
          <div ref={mapNodeRef} className="map-canvas" />
          <div className="map-legend" aria-label="Map legend">
            <span><i className="legend-dot demand-dot" />Demand generator</span>
            <span><i className="legend-dot competitor-dot" />Direct competitor</span>
          </div>
          {!mapReady && (
            <div className="map-loading">
              <span className="spinner dark" aria-hidden="true" />
              Loading Settat map…
            </div>
          )}
        </section>

        <aside className="result-rail" aria-live="polite">
          {status === "ready" && result ? (
            <>
              <section className="score-section">
                <div className="result-kicker">
                  <span>Location fit</span>
                  <span>{result.confidence}% data confidence</span>
                </div>
                <div className="score-line">
                  <div>
                    <strong>{result.score}</strong>
                    <span>/100</span>
                  </div>
                  <h2>{result.verdict}</h2>
                </div>
                <p>
                  {profile.label} within {radius} m of the selected point, based on {result.mappedFeatures.toLocaleString()} mapped features.
                </p>
              </section>

              <section className="result-section">
                <h3>Score components</h3>
                <MetricRow label="Demand signals" value={result.metrics.demand} />
                <MetricRow label="Competition pressure" value={result.metrics.competition} inverse />
                <MetricRow label="Street access" value={result.metrics.access} />
                <MetricRow label="Urban intensity" value={result.metrics.intensity} />
              </section>

              <section className="result-section evidence-summary">
                <h3>Local evidence</h3>
                <div className="evidence-grid">
                  <div><strong>{result.competitors.length}</strong><span>direct competitors</span></div>
                  <div><strong>{result.demandPlaces.length}</strong><span>demand generators</span></div>
                  <div><strong>{result.buildings}</strong><span>building footprints</span></div>
                  <div><strong>{result.roads}</strong><span>mapped street segments</span></div>
                </div>
              </section>

              <section className="result-section">
                <div className="section-title-row">
                  <h3>Nearest competitors</h3>
                  <span>{result.competitors.length} found</span>
                </div>
                {result.competitors.length ? (
                  <ol className="place-list">
                    {result.competitors.slice(0, 5).map((place) => (
                      <li key={place.id}>
                        <span className="list-index" />
                        <div>
                          <strong>{place.name}</strong>
                          <span>{place.kind}</span>
                        </div>
                        <em>{formatDistance(place.distance)}</em>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="empty-note">
                    No direct competitors are mapped in this radius. Verify the street in person because unmapped businesses may exist.
                  </p>
                )}
              </section>

              <section className="result-section">
                <h3>Demand mix</h3>
                <div className="breakdown-list">
                  {sortedBreakdown.map(([category, count]) => (
                    <div key={category}>
                      <span>{category}</span>
                      <i><b style={{ width: `${(count / maxBreakdown) * 100}%` }} /></i>
                      <strong>{count}</strong>
                    </div>
                  ))}
                </div>
              </section>

              <section className="source-note">
                <strong>How to use this result</strong>
                <p>
                  This measures mapped supply, services, streets and building activity. Confirm foot traffic, visibility, customer spending and current vacancies on site before committing.
                </p>
                <span>
                  OSM snapshot {new Date(result.timestamp).toLocaleDateString("en-GB")} · ODbL
                </span>
              </section>
            </>
          ) : status === "loading" ? (
            <div className="result-state">
              <span className="large-spinner" aria-hidden="true" />
              <h2>Reading the selected area</h2>
              <p>Counting mapped businesses, services, buildings, transit and streets.</p>
            </div>
          ) : status === "error" ? (
            <div className="result-state">
              <span className="state-symbol">!</span>
              <h2>Live data unavailable</h2>
              <p>{error}</p>
              <button type="button" onClick={runScan}>Retry scan</button>
            </div>
          ) : (
            <div className="result-state initial">
              <span className="state-symbol target-symbol">+</span>
              <h2>Ready to analyze</h2>
              <p>Select a business, choose the exact point on the map, then run the location analysis.</p>
              <div className="method-list">
                <span>Direct competition</span>
                <span>Demand generators</span>
                <span>Buildings and streets</span>
                <span>Transit and access</span>
              </div>
            </div>
          )}
        </aside>
      </section>
    </main>
  );
}
