# SettatScope

Small-area business location analysis for Settat, Morocco.

SettatScope lets a user choose an exact point on a real map, select a business
type, and analyze a 300-1000 metre walking area. It scores:

- demand signals;
- direct competition;
- street and transit access;
- building and urban intensity.

The result includes nearby competitors, demand generators, mapped buildings,
roads, a location-fit score, and a data-confidence indicator.

## Data

The application uses a bundled OpenStreetMap snapshot for Settat. The browser
does not depend on the Overpass API while running an analysis. Map tiles and
address search still require internet access.

OpenStreetMap data is available under the ODbL and is attributed in the
interface.

## Development

Requirements:

- Node.js 22.13 or newer
- npm

```bash
npm install
npm run dev
```

Build and test:

```bash
npm test
npm run lint
```

The main product is implemented in `app/page.tsx`. The Settat dataset is stored
at `public/data/settat-osm.json`.
