# Davao WiFi Logger

A Node.js + Express app that aggregates WiFi presence logs from a source API, stores them in SQLite, and produces monthly presence reports and Excel exports.

## Project structure

- `server.js` — Express server and API endpoints
- `public/` — Static frontend (HTML/JS/CSS)
- `database.sqlite` — Local SQLite DB (ignored by Git)
- `package.json` — Dependencies and scripts

## Prerequisites

- Node.js 18+ (tested with Node 22)
- npm
- Git

## Setup

1) Install dependencies

```
npm install
```

2) Start the server

```
npm start
```

The app serves the frontend from `public/` and listens on http://localhost:3000.

## API endpoints

- POST `/api/sync` — Pulls logs from the source API into SQLite (last 60 days). Edit `SOURCE_API_BASE_URL` in `server.js` as needed.
- GET `/api/presence-report?year=YYYY&month=MM` — Returns simplified monthly presence data.
- GET `/api/export-excel?year=YYYY&month=MM` — Downloads an Excel attendance report.

## Notes

- The database file (`database.sqlite`) is ignored by Git via `.gitignore`.
- Presence logic uses heuristics to exclude non-employee device names.
- Excel export groups days by week (Mon–Fri) and marks presence per day.

## GitHub: create and push a repo

1) Initialize Git, commit files

```
git init
git add .
git commit -m "Initial commit: Davao WiFi Logger"
```

Optionally set the primary branch name to `main`:

```
git branch -M main
```

2) Create a new repo on GitHub (via the UI):

- Go to https://github.com/new
- Name it `davao-wifi-logger` (or any name)
- Keep it empty (no README, no .gitignore — you already have them)

3) Add the remote and push

```
git remote add origin https://github.com/<your-username>/<your-repo>.git
git push -u origin main
```

Git Credential Manager will prompt for authentication if needed.

## Configuration

- Port: see `PORT` in `server.js` (default 3000)
- Source API base URL: `SOURCE_API_BASE_URL` in `server.js`

## License

Choose a license (e.g., MIT) and add a `LICENSE` file if desired.
