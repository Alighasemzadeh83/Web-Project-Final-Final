#!/usr/bin/env bash
# End-to-end scenario script for the police case management backend.
# Requirements: bash + curl + python3; Django server running at 127.0.0.1:8000
# Fill in admin credentials below, then: `bash total_scenario.bash`

set -euo pipefail

BASE="http://127.0.0.1:8000"
ADMIN_USER="Ali"           # <-- set superuser username
ADMIN_PASS="changeme"      # <-- set superuser password
DEFAULT_PASS="StrongPass123"

json_field() { python - "$@" <<'PY'
import json,sys
data=json.load(sys.stdin)
import argparse
ap=argparse.ArgumentParser()
ap.add_argument("path")
args=ap.parse_args(sys.argv[1:])
cur=data
for part in args.path.split("."):
    cur=cur[part]
print(cur)
PY
}

echo "== Login as admin =="
ADMIN_LOGIN=$(curl -s -X POST "$BASE/api/v1/auth/login/" \
  -H "Content-Type: application/json" \
  -d "{\"identifier\":\"$ADMIN_USER\",\"password\":\"$ADMIN_PASS\"}")
ADMIN_TOKEN=$(echo "$ADMIN_LOGIN" | json_field tokens.access)
echo "Admin token acquired."

AUTH_ADMIN=(-H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json")

echo "== Create users =="
# 6 base users
for i in {1..6}; do
  curl -s -X POST "$BASE/api/v1/auth/register/" -H "Content-Type: application/json" \
    -d "{\"username\":\"base$i\",\"email\":\"base$i@example.com\",\"first_name\":\"Base\",\"last_name\":\"$i\",\"national_id\":\"10$i$i$i$i$i$i$i$i\",\"phone_number\":\"0900$i$i$i$i$i$i\",\"password\":\"$DEFAULT_PASS\"}" >/dev/null
done
# role users
declare -A ROLE_USERS=(
  [cadet1]="Cadet" [cadet2]="Cadet"
  [coroner1]="Coroner" [coroner2]="Coroner"
  [officer1]="Officer" [officer2]="Officer"
  [detective1]="Detective" [detective2]="Detective"
  [sergeant1]="Sergeant" [sergeant2]="Sergeant"
  [captain1]="Captain" [captain2]="Captain"
  [chief1]="Chief" [chief2]="Chief"
)
for name in "${!ROLE_USERS[@]}"; do
  curl -s -X POST "$BASE/api/v1/auth/register/" -H "Content-Type: application/json" \
    -d "{\"username\":\"$name\",\"email\":\"$name@example.com\",\"first_name\":\"${ROLE_USERS[$name]}\",\"last_name\":\"User\",\"national_id\":\"20${name//[^0-9]/}${RANDOM}\",\"phone_number\":\"091${RANDOM:0:7}\",\"password\":\"$DEFAULT_PASS\"}" >/dev/null
done
echo "Users created."

echo "== Fetch role IDs =="
ROLES_JSON=$(curl -s "${AUTH_ADMIN[@]}" "$BASE/api/v1/auth/roles/")
get_role_id() { echo "$ROLES_JSON" | python - <<'PY' "$1"
import json,sys
roles=json.load(sys.stdin)
target=sys.argv[1].lower()
for r in roles:
    if r["name"].lower()==target:
        print(r["id"])
        sys.exit(0)
raise SystemExit(f"role {target} not found")
PY
}
ROLE_CADET=$(get_role_id "Cadet")
ROLE_CORONER=$(get_role_id "Coroner")
ROLE_OFFICER=$(get_role_id "Officer")
ROLE_DETECTIVE=$(get_role_id "Detective")
ROLE_SERGEANT=$(get_role_id "Sergeant")
ROLE_CAPTAIN=$(get_role_id "Captain")
ROLE_CHIEF=$(get_role_id "Chief")

echo "== Assign roles to users =="
USERS_JSON=$(curl -s "${AUTH_ADMIN[@]}" "$BASE/api/v1/auth/users/?page_size=200")
get_user_id() { echo "$USERS_JSON" | python - <<'PY' "$1"
import json,sys
users=json.load(sys.stdin)["results"]
target=sys.argv[1].lower()
for u in users:
    if u["username"].lower()==target:
        print(u["id"]); sys.exit(0)
raise SystemExit(f"user {target} not found")
PY
}
assign_role() { uname=$1; roleid=$2; uid=$(get_user_id "$uname"); curl -s -X PATCH "${AUTH_ADMIN[@]}" \
  -d "{\"role_ids\":[$roleid]}" "$BASE/api/v1/auth/users/$uid/roles/" >/dev/null; echo "assigned $uname -> role $roleid"; }

assign_role cadet1 $ROLE_CADET; assign_role cadet2 $ROLE_CADET
assign_role coroner1 $ROLE_CORONER; assign_role coroner2 $ROLE_CORONER
assign_role officer1 $ROLE_OFFICER; assign_role officer2 $ROLE_OFFICER
assign_role detective1 $ROLE_DETECTIVE; assign_role detective2 $ROLE_DETECTIVE
assign_role sergeant1 $ROLE_SERGEANT; assign_role sergeant2 $ROLE_SERGEANT
assign_role captain1 $ROLE_CAPTAIN; assign_role captain2 $ROLE_CAPTAIN
assign_role chief1 $ROLE_CHIEF; assign_role chief2 $ROLE_CHIEF

echo "== Helper: login function =="
login_user() {
  local u=$1 p=$2
  curl -s -X POST "$BASE/api/v1/auth/login/" -H "Content-Type: application/json" \
    -d "{\"identifier\":\"$u\",\"password\":\"$p\"}" | json_field tokens.access
}

CAD1_TOK=$(login_user cadet1 "$DEFAULT_PASS")
OFF1_TOK=$(login_user officer1 "$DEFAULT_PASS")
DET1_TOK=$(login_user detective1 "$DEFAULT_PASS")
SGT1_TOK=$(login_user sergeant1 "$DEFAULT_PASS")
CPT1_TOK=$(login_user captain1 "$DEFAULT_PASS")
CHF1_TOK=$(login_user chief1 "$DEFAULT_PASS")
COR1_TOK=$(login_user coroner1 "$DEFAULT_PASS")
BASE1_TOK=$(login_user base1 "$DEFAULT_PASS")
BASE2_TOK=$(login_user base2 "$DEFAULT_PASS")

echo "== Negative test: cadet cannot create field case (should 403) =="
curl -s -o /dev/null -w "HTTP:%{http_code}\n" -X POST "$BASE/api/v1/cases/" \
  -H "Authorization: Bearer $CAD1_TOK" -H "Content-Type: application/json" \
  -d '{"title":"Forbidden by cadet","description":"Should fail","source":"field_report","severity":"level_3"}'

echo "== Create field report cases by police ranks (levels 3/2/1/critical) =="
CASE_IDS=()
create_case() {
  local token=$1 title=$2 severity=$3
  resp=$(curl -s -X POST "$BASE/api/v1/cases/" \
    -H "Authorization: Bearer $token" -H "Content-Type: application/json" \
    -d "{\"title\":\"$title\",\"description\":\"desc $title\",\"source\":\"field_report\",\"severity\":\"$severity\",\"location\":\"L.A.\",\"occurred_at\":\"2025-01-01T10:00:00Z\"}")
  echo "$resp" | json_field id
}
CID_L3=$(create_case "$OFF1_TOK" "Minor theft" "level_3"); CASE_IDS+=($CID_L3)
CID_L2=$(create_case "$DET1_TOK" "Car theft" "level_2"); CASE_IDS+=($CID_L2)
CID_L1=$(create_case "$SGT1_TOK" "Homicide" "level_1"); CASE_IDS+=($CID_L1)
CID_CR=$(create_case "$CHF1_TOK" "Critical terror" "critical"); CASE_IDS+=($CID_CR)

echo "== Add witnesses to cases (phone/national_id) =="
add_witness() {
  local case_id=$1 name=$2 nid=$3 phone=$4
  curl -s -X POST "$BASE/api/v1/cases/$case_id/participants/" \
    -H "Authorization: Bearer $OFF1_TOK" -H "Content-Type: application/json" \
    -d "{\"role\":\"witness\",\"person\":{\"full_name\":\"$name\",\"national_id\":\"$nid\",\"phone_number\":\"$phone\"}}"
}
add_witness $CID_L3 "Witness A" "3001" "09130000001"
add_witness $CID_L2 "Witness B" "3002" "09130000002"

echo "== Complaints by base users =="
complaint_ids=()
make_complaint() {
  local token=$1 title=$2
  resp=$(curl -s -X POST "$BASE/api/v1/complaints/" -H "Authorization: Bearer $token" \
    -H "Content-Type: application/json" -d "{\"title\":\"$title\",\"description\":\"$title desc\"}")
  echo "$resp" | json_field id
}
CMP1=$(make_complaint "$BASE1_TOK" "Noise complaint"); complaint_ids+=($CMP1)
CMP2=$(make_complaint "$BASE2_TOK" "Robbery complaint"); complaint_ids+=($CMP2)
CMP3=$(make_complaint "$BASE1_TOK" "Fraud complaint"); complaint_ids+=($CMP3)

echo "== Cadet reviews complaints (some returned) =="
# CMP1 approve, CMP2 return, CMP3 return thrice to void
curl -s -X POST "$BASE/api/v1/complaints/$CMP1/cadet-review/" -H "Authorization: Bearer $CAD1_TOK" \
  -H "Content-Type: application/json" -d '{"approve": true}' >/dev/null
curl -s -X POST "$BASE/api/v1/complaints/$CMP2/cadet-review/" -H "Authorization: Bearer $CAD1_TOK" \
  -H "Content-Type: application/json" -d '{"approve": false, "note":"missing data"}' >/dev/null
for i in {1..3}; do
  curl -s -X POST "$BASE/api/v1/complaints/$CMP3/cadet-review/" -H "Authorization: Bearer $CAD1_TOK" \
    -H "Content-Type: application/json" -d '{"approve": false, "note":"still incomplete"}' >/dev/null
done

echo "== Officer reviews (accept CMP1, return CMP2, CMP3 already void) =="
curl -s -X POST "$BASE/api/v1/complaints/$CMP1/officer-review/" -H "Authorization: Bearer $OFF1_TOK" \
  -H "Content-Type: application/json" -d '{"accept": true, "severity":"level_2"}' >/dev/null
curl -s -X POST "$BASE/api/v1/complaints/$CMP2/officer-review/" -H "Authorization: Bearer $OFF1_TOK" \
  -H "Content-Type: application/json" -d '{"accept": false, "note":"more detail"}' >/dev/null

echo "== Cadet fixes CMP2 and resubmits, officer accepts =="
curl -s -X POST "$BASE/api/v1/complaints/$CMP2/cadet-review/" -H "Authorization: Bearer $CAD1_TOK" \
  -H "Content-Type: application/json" -d '{"approve": true}' >/dev/null
curl -s -X POST "$BASE/api/v1/complaints/$CMP2/officer-review/" -H "Authorization: Bearer $OFF1_TOK" \
  -H "Content-Type: application/json" -d '{"accept": true, "severity":"level_3"}' >/dev/null

echo "== Add extra complainant to a complaint (via participants as complainant) =="
curl -s -X POST "$BASE/api/v1/cases/$CID_L3/participants/" \
  -H "Authorization: Bearer $CAD1_TOK" -H "Content-Type: application/json" \
  -d '{"role":"complainant","person":{"full_name":"Extra complainant","national_id":"4001","phone_number":"09140000001"}}' >/dev/null

echo "== Evidence: negative tests and then valid for all types =="
# Missing title -> expect 400
curl -s -o /dev/null -w "HTTP:%{http_code}\n" -X POST "$BASE/api/v1/evidences/" \
  -H "Authorization: Bearer $OFF1_TOK" -H "Content-Type: application/json" \
  -d "{\"case\":$CID_L3,\"type\":\"generic\",\"description\":\"no title\"}"

# Valid evidences
curl -s -X POST "$BASE/api/v1/evidences/" -H "Authorization: Bearer $OFF1_TOK" -H "Content-Type: application/json" \
  -d "{\"case\":$CID_L3,\"type\":\"testimony\",\"title\":\"Witness note\",\"description\":\"Heard a noise\",\"extra_data\":{\"witness_phone\":\"09150000001\"}}" >/dev/null
curl -s -X POST "$BASE/api/v1/evidences/" -H "Authorization: Bearer $DET1_TOK" -H "Content-Type: application/json" \
  -d "{\"case\":$CID_L2,\"type\":\"forensic\",\"title\":\"Blood sample\",\"description\":\"DNA\",\"extra_data\":{}}" >/dev/null
curl -s -X POST "$BASE/api/v1/evidences/" -H "Authorization: Bearer $OFF1_TOK" -H "Content-Type: application/json" \
  -d "{\"case\":$CID_L1,\"type\":\"vehicle\",\"title\":\"Blue sedan\",\"description\":\"Found nearby\",\"extra_data\":{\"plate_number\":\"12A345\"}}" >/dev/null
curl -s -X POST "$BASE/api/v1/evidences/" -H "Authorization: Bearer $OFF1_TOK" -H "Content-Type: application/json" \
  -d "{\"case\":$CID_CR,\"type\":\"id_document\",\"title\":\"ID card\",\"description\":\"Possible suspect\",\"extra_data\":{\"owner_name\":\"John Doe\",\"field_notes\":\"worn\"}}" >/dev/null
curl -s -X POST "$BASE/api/v1/evidences/" -H "Authorization: Bearer $SGT1_TOK" -H "Content-Type: application/json" \
  -d "{\"case\":$CID_CR,\"type\":\"generic\",\"title\":\"Misc item\",\"description\":\"Broken phone\"}" >/dev/null

echo "== Coroner reviews forensic evidence (approve) =="
FORENSIC_ID=$(curl -s "$BASE/api/v1/evidences/?case=$CID_L2&type=forensic" -H "Authorization: Bearer $DET1_TOK" | json_field results.0.id)
curl -s -X POST "$BASE/api/v1/evidences/$FORENSIC_ID/review/" \
  -H "Authorization: Bearer $COR1_TOK" -H "Content-Type: application/json" \
  -d '{"decision":"approve","note":"Matches victim"}' >/dev/null

echo "== Pursuit: mark suspects, one becomes high_alert (30+ days) =="
SUSPECT_RESP=$(curl -s -X POST "$BASE/api/v1/pursuits/" -H "Authorization: Bearer $SGT1_TOK" \
  -H "Content-Type: application/json" -d "{\"case\":$CID_CR,\"suspect\":{\"full_name\":\"Suspect Critical\",\"national_id\":\"5001\"},\"status\":\"wanted\",\"pursuit_started_at\":\"2024-12-01\",\"severity_at_report\":\"critical\"}")
curl -s "$BASE/api/v1/pursuits/high-alert" -H "Authorization: Bearer $SGT1_TOK" >/dev/null

echo "== Tips and rewards flow =="
TIP_RESP=$(curl -s -X POST "$BASE/api/v1/tips/" -H "Authorization: Bearer $BASE1_TOK" \
  -H "Content-Type: application/json" -d "{\"case\":$CID_L3,\"description\":\"I saw a suspect\"}")
TIP_ID=$(echo "$TIP_RESP" | json_field id)
curl -s -X POST "$BASE/api/v1/tips/$TIP_ID/officer-review/" -H "Authorization: Bearer $OFF1_TOK" \
  -H "Content-Type: application/json" -d '{"decision":"forward"}' >/dev/null
curl -s -X POST "$BASE/api/v1/tips/$TIP_ID/detective-review/" -H "Authorization: Bearer $DET1_TOK" \
  -H "Content-Type: application/json" -d '{"decision":"approve","reward_amount":500000}"' >/dev/null
curl -s -X POST "$BASE/api/v1/tips/$TIP_ID/mark-rewarded" -H "Authorization: Bearer $SGT1_TOK" >/dev/null

echo "== Suspect evaluation (detective/sergeant/captain, chief for critical) =="
EVAL_RESP=$(curl -s -X POST "$BASE/api/v1/suspect-evaluations/" -H "Authorization: Bearer $DET1_TOK" \
  -H "Content-Type: application/json" -d "{\"case\":$CID_CR,\"suspect\":{\"full_name\":\"Suspect Critical\",\"national_id\":\"5001\"}}")
EVAL_ID=$(echo "$EVAL_RESP" | json_field id)
curl -s -X POST "$BASE/api/v1/suspect-evaluations/$EVAL_ID/detective-score/" -H "Authorization: Bearer $DET1_TOK" \
  -H "Content-Type: application/json" -d '{"score":9,"notes":"Strong evidence"}' >/dev/null
curl -s -X POST "$BASE/api/v1/suspect-evaluations/$EVAL_ID/sergeant-score/" -H "Authorization: Bearer $SGT1_TOK" \
  -H "Content-Type: application/json" -d '{"score":8,"notes":"Matches record"}' >/dev/null
curl -s -X POST "$BASE/api/v1/suspect-evaluations/$EVAL_ID/captain-decision/" -H "Authorization: Bearer $CPT1_TOK" \
  -H "Content-Type: application/json" -d '{"decision":"approve"}' >/dev/null
curl -s -X POST "$BASE/api/v1/suspect-evaluations/$EVAL_ID/chief-decision/" -H "Authorization: Bearer $CHF1_TOK" \
  -H "Content-Type: application/json" -d '{"decision":"approve"}' >/dev/null

echo "== Trial: judge verdicts (guilty / not_guilty) =="
JUDGE_TOK=$(login_user judge1 "$DEFAULT_PASS" || true)
if [ -n "${JUDGE_TOK:-}" ]; then
  curl -s -X POST "$BASE/api/v1/trials/" -H "Authorization: Bearer $JUDGE_TOK" -H "Content-Type: application/json" \
    -d "{\"case\":$CID_CR,\"judge\":{\"full_name\":\"Judge Judy\",\"national_id\":\"7001\"},\"verdict\":\"guilty\",\"sentence_title\":\"Prison\",\"sentence_description\":\"25 years\"}" >/dev/null
fi

echo "Scenario completed."
