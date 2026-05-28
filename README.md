# ELA TCYA Volunteer Service Hours

A modern web app for the **East Los Angeles Tzu Chi Youth Association** to log
volunteer event sign-in / sign-out times and track cumulative service hours.

- **Frontend**: React + TypeScript + Vite + Tailwind CSS
- **Backend**: Node.js + Express (shared route layer)
- **Storage**: JSON file (EC2) **or** Netlify Blobs (Netlify) — same schema
- **Hosting options**: AWS EC2 t2.micro / t3.micro **or** Netlify (free tier)
- **Branding**: Tzu Chi-inspired navy palette (`brand-700` ≈ deep "blue sky" navy)
  with warm gold accents.

> **Note on branding**: The header displays the chapter's official logo file
> at `client/public/tzu-chi-logo.png`. To swap it for a different image,
> replace that file (PNG or SVG) and adjust the `<img>` tag in
> `client/src/components/Header.tsx` if needed.

## Features

**Public (no login required)**

- Hero dashboard with total confirmed hours, total submissions, and active volunteers.
- Alphabetically-sorted volunteer roster — click a name to expand and see every
  confirmed service log.
- "Log Volunteer Hours" submission form: searchable volunteer dropdown,
  selectable event (with auto-filled date from the admin-created event),
  arrival / end times, comments. Hours are calculated automatically.
- One-click **Download Excel Report** — summary, confirmed submissions, and
  per-volunteer breakdown (three sheets).
- Auto-refreshes whenever the tab regains focus.

**Admin (login required)**

- "Admin Login" button at the top of the page. Single shared admin account.
- After login, the dashboard adds an **Events** panel.
- **Create Event**: pick from the master event list, set a date, optionally
  add a custom name for "Others".
- Click any event → **Event Detail Page** with:
  - Volunteer picker (searchable, multi-select via checkboxes)
  - Attendance table with three columns: Volunteer Name · Staff Check-in · Volunteer Check-out
  - Click any check icon to toggle ✓ ↔ ✗
  - Volunteers who submit a form but weren't pre-added by staff appear at the
    bottom with a clear "Submitted but not pre-added by staff" banner.
- **Hours only count toward the main page when BOTH check-in icons are green.**

## How the flow works

1. **Admin creates an event** (e.g. "Culture - Beach Cleanup, June 15, 2026").
2. **Admin adds volunteers** to the event's attendance list — each entry
   starts as ✓ Staff Check-in / ✗ Volunteer Check-out.
3. **Volunteer fills out the form** and selects that event. The form
   auto-fills the date from the event; the volunteer just enters their
   arrival / end times and comments.
4. **Server links the submission to the event**:
   - If the volunteer was on the attendance list, their ✗ flips to ✓.
   - If they were not on the list, they're added at the bottom with ✗ Staff /
     ✓ Volunteer.
5. **Admin reviews** the Event Detail Page and toggles any remaining check
   icons. Once a row is ✓ ✓, that submission's hours show up on the main
   page roster.

## Project layout

```
volunteer-tracker/
├── client/                  React + TS app (Vite)
│   ├── src/
│   │   ├── components/      Header, VolunteerTable, SubmissionForm, ExportButton, Toast
│   │   ├── data/            volunteers.ts, events.ts (edit to add new names)
│   │   ├── api.ts           Tiny fetch wrapper
│   │   ├── utils.ts         Hour formatting, summary aggregation
│   │   └── App.tsx
│   └── ...
├── server/                  Backend
│   └── src/
│       ├── routes.js        Shared Express router (used by both deployments)
│       ├── storage-file.js  File-backed storage (EC2)
│       ├── index.js         EC2 entry point — listens on a port, serves /api + static client
│       └── reset.js         Local "wipe data" script (file storage only)
├── netlify/
│   └── functions/
│       └── api/
│           ├── api.mjs            Netlify Function entry (wraps Express via serverless-http)
│           ├── storage-blobs.js   Netlify Blobs storage
│           └── package.json       Function-local deps (@netlify/blobs, serverless-http, …)
├── netlify.toml             Netlify build + /api/* redirect
└── README.md
```

## Admin credentials

The admin account is gated by a single username + password. Defaults:

| Field | Default |
|---|---|
| Username | `admin` |
| Password | `1013` |

**For production**, override either or both via environment variables.

```bash
ADMIN_USERNAME='admin' ADMIN_PASSWORD='your-strong-password' npm start
```

You can also (optionally) set `SESSION_SECRET` to a random value to control
how admin tokens are signed; if you don't, a deterministic value derived
from the credentials is used.

With PM2 + systemd you can pass the env vars in the unit file:

```ini
Environment=PORT=80
Environment=ADMIN_USERNAME=admin
Environment=ADMIN_PASSWORD=your-strong-password
Environment=SESSION_SECRET=some-random-32-bytes
```

…or via PM2 ecosystem file:

```bash
pm2 delete tcya-volunteer-hours
ADMIN_USERNAME='admin' ADMIN_PASSWORD='your-strong-password' PORT=80 \
  pm2 start src/index.js --name tcya-volunteer-hours --update-env
pm2 save
```

Changing the credentials invalidates any existing admin sessions on next
page load.

## Local development

Install everything from the repo root:

```bash
npm run install:all
```

Then in two terminals:

```bash
# terminal 1 — backend on :4000
npm run dev:server

# terminal 2 — Vite dev server on :5173 (proxies /api to :4000)
npm run dev:client
```

Open http://localhost:5173 .

## Production build (single port)

```bash
npm run build         # builds client/dist
npm start             # express serves the API and the built client on :4000
```

Visit `http://<host>:4000`.

## Deploy to Netlify (recommended)

Netlify hosts the React build on its CDN, runs the Express API as a serverless
function, and persists data in **Netlify Blobs** — all on the free tier. There
are no EC2 instances or PM2 processes to manage.

### 1. Create the site

1. Push this repo to GitHub (or GitLab / Bitbucket).
2. In the Netlify dashboard: **Add new site → Import an existing project →**
   pick the repo. Leave the build settings as auto-detected; Netlify reads
   `netlify.toml` for the build command, publish directory, and function
   directory.
3. Netlify Blobs is enabled automatically for new sites — no extra setup.

### 2. Set environment variables (Site configuration → Environment variables)

| Key | Value |
|---|---|
| `ADMIN_USERNAME` | `admin` (or your choice) |
| `ADMIN_PASSWORD` | `1013` (change this for production) |
| `SESSION_SECRET` | A random 32+ character string (optional but recommended) |

If you don't set these the defaults from local development are used.

### 3. Deploy

Click **Deploy site**. Netlify will:

1. Run `cd client && npm install && npm run build` (from `netlify.toml`).
2. Bundle `netlify/functions/api/api.mjs` and its dependencies with esbuild.
3. Publish `client/dist` and route `/api/*` to the function.

The site is live at the assigned `*.netlify.app` URL, or attach a custom
domain in **Domain management**.

### 4. (Optional) Test locally with the Netlify CLI

```bash
npm install -g netlify-cli
netlify login
cd path/to/volunteer-tracker
netlify dev
```

`netlify dev` runs the Vite frontend, the function (with a local Blobs
emulator), and the `/api/*` redirect — the production setup, but on
`localhost`.

### 5. Resetting data on Netlify

Two options:

- **From the admin account**, while logged in, hit the admin reset endpoint
  (the admin token is in browser `localStorage` under `ela-tcya-admin-token`):

  ```bash
  curl -X POST https://your-site.netlify.app/api/admin/reset \
       -H "X-Admin-Token: <paste-token>"
  ```

- **From your laptop** via the Netlify CLI:

  ```bash
  netlify blobs:delete volunteer-data main
  ```

Both produce an empty `{ submissions: [], events: [] }` state on the next
page load.

### 6. Free-tier capacity check

For a chapter of ~80 volunteers running 2 events / week, free-tier usage is
nowhere near the limits:

| Resource | Free tier | Estimated usage |
|---|---|---|
| Bandwidth | 100 GB / mo | < 1 GB |
| Function invocations | 125k / mo | a few thousand |
| Function runtime | 100h / mo | < 1h |
| Blobs storage | 1 GB | a few MB |

## Deploy to an Ubuntu EC2 micro instance

The app fits comfortably on a t2.micro / t3.micro. Express serves both the API
and the static React build on a single port, so you only need one process.

### 1. Launch and connect

- Launch an Ubuntu 22.04 (or newer) EC2 instance.
- Security group: open inbound **22/tcp** (your IP) and **80/tcp** (anywhere).
- SSH in: `ssh -i your-key.pem ubuntu@<public-ip>`.

### 2. Install Node.js 20 and git

```bash
sudo apt update
sudo apt install -y git
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node -v   # should print v20.x
```

### 3. Get the code on the instance

Either upload the folder via `scp -r volunteer-tracker ubuntu@<ip>:~/`, or push
to GitHub and clone:

```bash
cd ~
git clone <your-repo-url> volunteer-tracker
cd volunteer-tracker
```

### 4. Install dependencies and build the frontend

```bash
npm run install:all
npm run build
```

### 5. Pick a port

`PORT=4000` is the default. To listen on the standard HTTP port 80 without
running Node as root, allow Node to bind to low ports once:

```bash
sudo setcap 'cap_net_bind_service=+ep' "$(readlink -f "$(which node)")"
```

You can now use `PORT=80`.

### 6. Run it as a service with `systemd`

Create `/etc/systemd/system/volunteer-tracker.service`:

```ini
[Unit]
Description=Volunteer Hours Tracker
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/volunteer-tracker/server
Environment=NODE_ENV=production
Environment=PORT=80
ExecStart=/usr/bin/node src/index.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Then:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now volunteer-tracker
sudo systemctl status volunteer-tracker
```

Visit `http://<public-ip>/`.

### 7. (Optional) Custom domain + HTTPS

Point a domain at the EC2 public IP, install nginx and certbot, and reverse
proxy to `localhost:4000`. The app sets no special headers and works fine
behind a reverse proxy.

## Where is the data?

The data shape is identical across both deployments — only the storage backend
differs:

- **EC2**: a JSON file at `server/data/submissions.json`. Back it up with
  `scp` or cron.
- **Netlify**: a single JSON blob under the `volunteer-data` store, key
  `main`. Download it any time with:

  ```bash
  netlify blobs:get volunteer-data main > submissions.json
  ```

  Or, while logged in as admin, hit `GET /api/admin/export` to download a
  timestamped backup straight from the browser.

Format:

```jsonc
{
  "events": [
    {
      "id": "uuid",
      "name": "Culture - Beach Cleanup",
      "customName": null,            // populated only when "Others" was picked
      "date": "2026-06-15",
      "createdAt": "2026-05-27T01:15:31.207Z",
      "attendance": [
        {
          "volunteerName": "Aaron Tse",
          "staffCheckin": true,      // admin added → true
          "volunteerCheckout": true, // volunteer submitted form → true
          "selfAdded": false         // true when not pre-added by staff
        }
      ]
    }
  ],
  "submissions": [
    {
      "id": "uuid",
      "eventId": "uuid-of-event",
      "volunteerName": "Aaron Tse",
      "grade": "10th",
      "eventName": "Culture - Beach Cleanup",
      "customEventName": null,
      "eventDate": "2026-06-15",
      "arrivalTime": "09:00",
      "endTime": "12:30",
      "hours": 3.5,
      "comments": "Helped pack vegetables.",
      "submittedAt": "2026-05-27T01:15:31.207Z"
    }
  ]
}
```

## Editing volunteer / event lists

- Volunteers: `client/src/data/volunteers.ts`
- Events: `client/src/data/events.ts`
- Grades: `client/src/data/events.ts`

After editing, run `npm run build` and restart the service:

```bash
sudo systemctl restart volunteer-tracker
```

## Resetting all hours to zero (for testing)

**On EC2** — SSH in and run:

```bash
cd ~/volunteer-tracker/server
npm run reset
```

The script writes a timestamped backup to `server/data/backups/` before
clearing the data file. The web app picks up the empty state on the next
page load — no PM2 restart needed.

To restore from the most recent backup:

```bash
cd ~/volunteer-tracker/server/data
cp "$(ls -t backups/*.json | head -1)" submissions.json
```

**On Netlify** — see the
["Resetting data on Netlify"](#5-resetting-data-on-netlify) section above.
Either hit `POST /api/admin/reset` as an authenticated admin, or run
`netlify blobs:delete volunteer-data main` from your laptop.

## Backups

**EC2.** The whole app state is `server/data/submissions.json`. A simple
cron-based backup is plenty:

```bash
# crontab -e (run as ubuntu)
0 * * * * cp /home/ubuntu/volunteer-tracker/server/data/submissions.json \
  /home/ubuntu/backups/submissions-$(date +\%Y\%m\%d-\%H).json
```

**Netlify.** While logged in as admin, hit
`GET /api/admin/export` from a browser to download a timestamped JSON of
the full data — or from your laptop:

```bash
netlify blobs:get volunteer-data main > backups/submissions-$(date +%Y%m%d-%H).json
```
