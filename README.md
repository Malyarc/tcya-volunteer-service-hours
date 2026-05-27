# ELA TCYA Volunteer Service Hours

A modern web app for the **East Los Angeles Tzu Chi Youth Association** to log
volunteer event sign-in / sign-out times and track cumulative service hours.

- **Frontend**: React + TypeScript + Vite + Tailwind CSS
- **Backend**: Node.js + Express (JSON file storage)
- **Target host**: AWS EC2 t2.micro / t3.micro (Ubuntu)
- **Branding**: Tzu Chi-inspired navy palette (`brand-700` ≈ deep "blue sky" navy)
  with warm gold accents.

> **Note on the logo**: the lotus mark in the header is a generic stylized
> lotus drawn from scratch — it is intentionally distinct from the Tzu Chi
> Foundation's registered 8-petal-with-ship trademark. If your chapter has
> rights to use the official logo, replace the SVG in `client/public/favicon.svg`
> and the `LotusMark` component in `client/src/components/Header.tsx` (or drop
> in an `<img src="/logo.png" />`).

## Features

- Hero dashboard showing total hours, total submissions, and active volunteers.
- Alphabetically-sorted volunteer roster with searchable / filterable table.
- Click a volunteer row to expand and see every service log they've submitted.
- Submission form with searchable volunteer dropdown, predefined event names,
  conditional "Others - please specify" input, date / time pickers, comments,
  and live-calculated hours.
- Backend computes and stores hours, validates input, and serializes writes so
  concurrent submissions don't clobber each other.
- One-click **Download Excel Report** button (Summary, All Submissions, and a
  Per-Volunteer breakdown — three sheets).
- Page auto-refreshes whenever the tab regains focus, so anyone visiting the
  site always sees the latest numbers.

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
  "submissions": [
    {
      "id": "uuid",
      "volunteerName": "Aaron Tse",
      "grade": "10th",
      "eventName": "Charity - Food Distribution 蔬果發放",
      "customEventName": null,
      "eventDate": "2026-05-20",
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

## Backups

The whole app state is `server/data/submissions.json`. A simple cron-based
backup is plenty:

```bash
# crontab -e (run as ubuntu)
0 * * * * cp /home/ubuntu/volunteer-tracker/server/data/submissions.json \
  /home/ubuntu/backups/submissions-$(date +\%Y\%m\%d-\%H).json
```
