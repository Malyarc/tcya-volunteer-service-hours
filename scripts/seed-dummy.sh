#!/usr/bin/env bash
# Seeds the running volunteer-tracker API with realistic dummy data for
# manual testing. Targets http://localhost:4042 by default; override with
# BASE=... to point elsewhere.
#
# Usage:
#   BASE=http://localhost:4042 ./scripts/seed-dummy.sh
#
# What it creates:
#   - 4 events spanning a few months
#   - Several volunteers on each attendance list
#   - A mix of submission states (✓✓ counted, ✓✗ pending staff, ✗✓ self-added)
#   - Some volunteers appearing in multiple events so the cumulative-hours
#     certificate date range has something to render.

set -euo pipefail

BASE=${BASE:-http://localhost:4042}
ADMIN_USER=${ADMIN_USER:-admin}
ADMIN_PASS=${ADMIN_PASS:-1013}

j() { python3 -c "import json,sys;print(json.load(sys.stdin)$1)"; }

echo "==> Logging in as admin..."
TOKEN=$(curl -fsS -X POST "$BASE/api/login" \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"$ADMIN_USER\",\"password\":\"$ADMIN_PASS\"}" | j "['token']")
H_AUTH="X-Admin-Token: $TOKEN"
H_JSON="Content-Type: application/json"

create_event() {
  local name=$1 date=$2
  curl -fsS -X POST "$BASE/api/events" \
    -H "$H_AUTH" -H "$H_JSON" \
    -d "{\"name\":\"$name\",\"date\":\"$date\"}" | j "['id']"
}

add_attendees() {
  local id=$1; shift
  local body
  body=$(python3 -c "import json,sys; print(json.dumps({'volunteerNames': sys.argv[1:]}))" "$@")
  curl -fsS -X POST "$BASE/api/events/$id/attendance" \
    -H "$H_AUTH" -H "$H_JSON" \
    -d "$body" >/dev/null
}

submit() {
  # submit <eventId> <volunteerName> <grade> <arrival HH:MM> <end HH:MM> <comments>
  local id=$1 name=$2 grade=$3 a=$4 e=$5 c=${6:-""}
  python3 - "$id" "$name" "$grade" "$a" "$e" "$c" <<'PY' | curl -fsS -X POST "$BASE/api/submissions" -H "$H_JSON" -d @- >/dev/null
import json, sys
eid, name, grade, a, e, c = sys.argv[1:]
print(json.dumps({
    "eventId": eid,
    "volunteerName": name,
    "grade": grade,
    "arrivalTime": a,
    "endTime": e,
    "comments": c,
}))
PY
}

patch_attendance() {
  # patch_attendance <eventId> <volunteerName> <staffCheckin true|false> <volunteerCheckout true|false>
  local id=$1 name=$2 s=$3 v=$4
  curl -fsS -X PATCH "$BASE/api/events/$id/attendance" \
    -H "$H_AUTH" -H "$H_JSON" \
    -d "{\"volunteerName\":\"$name\",\"staffCheckin\":$s,\"volunteerCheckout\":$v}" >/dev/null
}

echo "==> Creating events..."
E1=$(create_event "Culture - Beach Cleanup" "2026-03-15")
E2=$(create_event "Charity - Food Distribution 蔬果發放" "2026-04-20")
E3=$(create_event "Education - Service Learning Class" "2026-05-10")
E4=$(create_event "Culture - Tea Ceremony" "2026-05-25")
echo "    Beach Cleanup     $E1"
echo "    Food Distribution $E2"
echo "    Service Learning  $E3"
echo "    Tea Ceremony      $E4"

echo "==> Pre-registering attendance..."
add_attendees "$E1" "Aaron Tse" "Amber Wang" "Amelia Lin" "Andrew Luo"
add_attendees "$E2" "Aaron Tse" "Alan Huang" "Amber Wang" "Britney Wu" "Caitlyn Huang"
add_attendees "$E3" "Aaron Tse" "Alex Yang Xiong" "Amelia Lin" "Andrew Luo" "Christine Tang" "Davin Chen"
add_attendees "$E4" "Aaron Tse" "Britney Wu" "Christine Tang"

echo "==> Submitting hours (mostly fully confirmed)..."
# Beach Cleanup
submit "$E1" "Aaron Tse"     "10th" "08:00" "11:30" "Helped haul drift logs."
submit "$E1" "Amber Wang"    "9th"  "08:00" "11:00" "Sorted recyclables."
submit "$E1" "Amelia Lin"    "11th" "08:15" "11:30" ""
# Andrew Luo pre-registered but didn't submit -> staff ✓ / volunteer ✗ (pending)

# Food Distribution
submit "$E2" "Aaron Tse"     "10th" "09:00" "12:30" "Front line packing."
submit "$E2" "Alan Huang"    "12th" "09:00" "13:00" "Bagged produce."
submit "$E2" "Amber Wang"    "9th"  "09:30" "12:00" ""
submit "$E2" "Britney Wu"    "8th"  "09:00" "12:30" "First time helping out."
# Caitlyn Huang pre-registered, no submit -> pending

# Service Learning Class
submit "$E3" "Aaron Tse"        "10th" "13:00" "15:30" ""
submit "$E3" "Alex Yang Xiong"  "7th"  "13:00" "15:00" "Discussed compassion."
submit "$E3" "Amelia Lin"       "11th" "13:00" "15:30" ""
submit "$E3" "Christine Tang"   "12th" "13:15" "15:30" "Co-led group reflection."
submit "$E3" "Davin Chen"       "8th"  "13:00" "15:30" ""
# Andrew Luo pre-registered, no submit -> pending

# Tea Ceremony
submit "$E4" "Aaron Tse"      "10th" "10:00" "12:00" "Set up tea stations."
submit "$E4" "Britney Wu"     "8th"  "10:00" "12:00" ""
submit "$E4" "Christine Tang" "12th" "10:00" "12:30" "Demoed pour technique."

echo "==> Adding a self-added volunteer (showed up unscheduled)..."
# Dafne Kao submits for the Tea Ceremony but wasn't pre-added by staff.
# This produces a row at the bottom of the event with ✗ staff / ✓ volunteer
# (pending), demonstrating the third state.
submit "$E4" "Dafne Kao" "9th" "10:00" "11:30" "Walked in to help."

echo "==> Done."
echo
echo "Login at http://localhost:4042 with admin / 1013 and click any event"
echo "to see the attendance grid. Refresh the home page to see the new"
echo "Certificate column populated for fully-confirmed volunteers."
