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

The Business evolution view adds a dated ledger of official company events. A
user can move an `as of` control through the available Gazette dates, compare
incorporations and branches with dissolutions, filter by evidence strength, and
inspect the history and source reference for each company.

## Data

The application uses a bundled OpenStreetMap snapshot for Settat. The browser
does not depend on the Overpass API while running an analysis. Map tiles and
address search still require internet access.

OpenStreetMap data is available under the ODbL and is attributed in the
interface.

Processed Gazette exports are stored in `data/gazette/issues`. The build reads
every JSON file in that directory, keeps all-city source records available for
audit, deduplicates split notices, and generates the compact browser dataset at
`public/data/settat-business-history.json`.

To add another issue:

1. Convert the official BOAL PDF with PaddleOCR-VL.
2. Import the complete Paddle JSON into the Gazette Extractor.
3. Export the processed all-city JSON with machine text disabled when possible.
4. Put the processed file in `data/gazette/issues`.
5. Run `npm run build:data` or the normal production build.

Settat evidence is intentionally separated into address matches, registry
context, and broad city mentions. Gazette event dates describe legal actions;
they do not necessarily represent the day a storefront opened to customers.

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
at `public/data/settat-osm.json`, and the company timeline is implemented in
`app/evolution/page.tsx`.
