# ELA TCYA Volunteer Service Hours

A modern web app for the **East Los Angeles Tzu Chi Youth Association** to log
volunteer event sign-in / sign-out times and track cumulative service hours.

- **Frontend**: React + TypeScript + Vite + Tailwind CSS
- **Backend**: Node.js + Express (JSON file storage)
- **Target host**: AWS EC2 t2.micro / t3.micro (Ubuntu)
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
├── client/               React + TS app (Vite)
│   ├── src/
│   │   ├── components/   Header, VolunteerTable, SubmissionForm, ExportButton, Toast
│   │   ├── data/         volunteers.ts, events.ts (edit to add new names)
│   │   ├── api.ts        Tiny fetch wrapper
│   │   ├── utils.ts      Hour formatting, summary aggregation
│   │   └── App.tsx
│   └── ...
├── server/               Express API + static-file server
│   ├── src/index.js
│   └── data/submissions.json   (created on first run, persists all data)
└── README.md
```

## Admin password

The admin account is gated by a single password. By default it is
`tcya-admin-2026` so you can log in immediately for testing. **For
production**, set the `ADMIN_PASSWORD` environment variable to something
different — preferably a long random string — when starting the server.

```bash
ADMIN_PASSWORD='your-strong-password' npm start
```

You can also (optionally) set `SESSION_SECRET` to a random value to control
how admin tokens are signed; if you don't, a deterministic value derived
from the password is used.

With PM2 + systemd you can pass the env vars in the unit file:

```ini
Environment=PORT=80
Environment=ADMIN_PASSWORD=your-strong-password
Environment=SESSION_SECRET=some-random-32-bytes
```

…or via PM2 ecosystem file:

```bash
pm2 delete tcya-volunteer-hours
ADMIN_PASSWORD='your-strong-password' PORT=80 \
  pm2 start src/index.js --name tcya-volunteer-hours --update-env
pm2 save
```

Changing the password invalidates any existing admin sessions on next page
load.

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

Every submission is appended to:

```
server/data/submissions.json
```

You can `scp` it down for backup any time. Format:

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

When you want to wipe all volunteer hours and start fresh — for example after
testing — SSH into the EC2 instance and run:

```bash
cd ~/tcya-volunteer-service-hours/server
npm run reset
```

The script automatically writes a timestamped backup to
`server/data/backups/` before clearing the data file, so the previous data is
recoverable. The web app picks up the empty state on the next page load — no
PM2 restart needed.

To restore from the most recent backup:

```bash
cd ~/tcya-volunteer-service-hours/server/data
cp "$(ls -t backups/*.json | head -1)" submissions.json
```

## Backups

The whole app state is `server/data/submissions.json`. A simple cron-based
backup is plenty:

```bash
# crontab -e (run as ubuntu)
0 * * * * cp /home/ubuntu/volunteer-tracker/server/data/submissions.json \
  /home/ubuntu/backups/submissions-$(date +\%Y\%m\%d-\%H).json
```
