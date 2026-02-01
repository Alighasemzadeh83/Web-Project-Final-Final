# End-to-end scenario for the police case management API (PowerShell edition)
# Prereq: Server running at http://127.0.0.1:8000, roles seeded, superuser exists.
# Run: powershell -ExecutionPolicy Bypass -File .\total_scenario.ps1

$ErrorActionPreference = "Stop"

$Base = "http://127.0.0.1:8000"
$AdminUser = "Ali"         # <-- set your superuser username
$AdminPass = "changeme"    # <-- set your superuser password
$DefaultPass = "StrongPass123"

function Invoke-Api {
    param(
        [string]$Method,
        [string]$Path,
        [string]$Token = "",
        $Body = $null
    )
    $headers = @{}
    if ($Token) { $headers["Authorization"] = "Bearer $Token" }
    $options = @{
        Method = $Method
        Uri    = "$Base$Path"
        Headers= $headers
        ContentType = "application/json"
    }
    if ($null -ne $Body) {
        $options.Body = ($Body | ConvertTo-Json -Depth 8)
    }
    return Invoke-RestMethod @options
}

Write-Host "== Admin login =="
try {
    $adminLogin = Invoke-Api -Method Post -Path "/api/v1/auth/login/" -Body @{
        identifier = $AdminUser
        password   = $AdminPass
    }
    $adminToken = $adminLogin.tokens.access
    Write-Host "Admin token acquired."
} catch {
    Write-Error "Admin login failed. Set `\$AdminUser`/`\$AdminPass` correctly (superuser credentials) and re-run."
    throw
}

Write-Host "== Create base users =="
for ($i=1; $i -le 6; $i++) {
    Invoke-Api -Method Post -Path "/api/v1/auth/register/" -Body @{
        username    = "base$i"
        email       = "base$i@example.com"
        first_name  = "Base"
        last_name   = "$i"
        national_id = "10$i$i$i$i$i$i$i$i"
        phone_number= "0900$i$i$i$i$i$i"
        password    = $DefaultPass
    } | Out-Null
}

Write-Host "== Create role users =="
$roleUsers = @{
    cadet1     = "Cadet";   cadet2     = "Cadet";
    coroner1   = "Coroner"; coroner2   = "Coroner";
    officer1   = "Officer"; officer2   = "Officer";
    detective1 = "Detective"; detective2 = "Detective";
    sergeant1  = "Sergeant"; sergeant2  = "Sergeant";
    captain1   = "Captain";  captain2   = "Captain";
    chief1     = "Chief";    chief2     = "Chief";
    judge1     = "Judge";
}
foreach ($k in $roleUsers.Keys) {
    Invoke-Api -Method Post -Path "/api/v1/auth/register/" -Body @{
        username    = $k
        email       = "$k@example.com"
        first_name  = $roleUsers[$k]
        last_name   = "User"
        national_id = "20$($k.GetHashCode() -band 999999)"
        phone_number= "091$([string](Get-Random -Minimum 1000000 -Maximum 9999999))"
        password    = $DefaultPass
    } | Out-Null
}

Write-Host "== Fetch roles and assign =="
$roles = Invoke-Api -Method Get -Path "/api/v1/auth/roles/" -Token $adminToken
function RoleId($name) { ($roles | Where-Object { $_.name -ieq $name }).id }

$users = Invoke-Api -Method Get -Path "/api/v1/auth/users/?page_size=200" -Token $adminToken
function UserId($uname) { ($users.results | Where-Object { $_.username -ieq $uname }).id }
function SetRole($uname, $roleName) {
    $uid = UserId $uname
    $rid = RoleId $roleName
    Invoke-Api -Method Patch -Path "/api/v1/auth/users/$uid/roles/" -Token $adminToken -Body @{ role_ids = @($rid) } | Out-Null
    Write-Host "Assigned $uname -> $roleName"
}

foreach ($k in $roleUsers.Keys) {
    SetRole $k $roleUsers[$k]
}

Write-Host "== Login key actors =="
function Login($u) {
    (Invoke-Api -Method Post -Path "/api/v1/auth/login/" -Body @{identifier=$u; password=$DefaultPass}).tokens.access
}
$tokCad = Login "cadet1"
$tokOff = Login "officer1"
$tokDet = Login "detective1"
$tokSgt = Login "sergeant1"
$tokCpt = Login "captain1"
$tokChf = Login "chief1"
$tokCor = Login "coroner1"
$tokBase1 = Login "base1"
$tokBase2 = Login "base2"
$tokJudge = Login "judge1"

Write-Host "== Negative: cadet cannot create field case (expect 403) =="
try {
    Invoke-Api -Method Post -Path "/api/v1/cases/" -Token $tokCad -Body @{
        title="Forbidden by cadet"; description="Should fail"; source="field_report"; severity="level_3"
    } | Out-Null
} catch { Write-Host "Cadet create case blocked (expected)." }

Write-Host "== Create field cases (levels 3/2/1/critical) =="
function CreateCase($token,$title,$severity) {
    Invoke-Api -Method Post -Path "/api/v1/cases/" -Token $token -Body @{
        title=$title; description="desc $title"; source="field_report"; severity=$severity;
        location="L.A."; occurred_at="2025-01-01T10:00:00Z"
    }
}
$caseL3 = (CreateCase $tokOff "Minor theft" "level_3").id
$caseL2 = (CreateCase $tokDet "Car theft" "level_2").id
$caseL1 = (CreateCase $tokSgt "Homicide" "level_1").id
$caseCR = (CreateCase $tokChf "Critical terror" "critical").id

Write-Host "== Add witnesses to cases =="
function AddParticipant($caseId,$role,$name,$nid,$phone,$token=$tokOff) {
    Invoke-Api -Method Post -Path "/api/v1/cases/$caseId/participants/" -Token $token -Body @{
        role=$role; person=@{ full_name=$name; national_id=$nid; phone_number=$phone }
    } | Out-Null
}
AddParticipant $caseL3 "witness" "Witness A" "3001" "09130000001"
AddParticipant $caseL2 "witness" "Witness B" "3002" "09130000002"

Write-Host "== Complaints by base users =="
function MakeComplaint($token,$title) {
    (Invoke-Api -Method Post -Path "/api/v1/complaints/" -Token $token -Body @{title=$title; description="$title desc"}).id
}
$cmp1 = MakeComplaint $tokBase1 "Noise complaint"
$cmp2 = MakeComplaint $tokBase2 "Robbery complaint"
$cmp3 = MakeComplaint $tokBase1 "Fraud complaint"

Write-Host "== Cadet review (approve CMP1, return CMP2, return CMP3 thrice) =="
Invoke-Api -Method Post -Path "/api/v1/complaints/$cmp1/cadet-review/" -Token $tokCad -Body @{approve=$true} | Out-Null
Invoke-Api -Method Post -Path "/api/v1/complaints/$cmp2/cadet-review/" -Token $tokCad -Body @{approve=$false; note="missing data"} | Out-Null
for ($i=1; $i -le 3; $i++) {
    Invoke-Api -Method Post -Path "/api/v1/complaints/$cmp3/cadet-review/" -Token $tokCad -Body @{approve=$false; note="still incomplete"} | Out-Null
}

Write-Host "== Officer review: accept CMP1, return CMP2 =="
Invoke-Api -Method Post -Path "/api/v1/complaints/$cmp1/officer-review/" -Token $tokOff -Body @{accept=$true; severity="level_2"} | Out-Null
Invoke-Api -Method Post -Path "/api/v1/complaints/$cmp2/officer-review/" -Token $tokOff -Body @{accept=$false; note="more detail"} | Out-Null

Write-Host "== Cadet fixes CMP2 and officer accepts =="
Invoke-Api -Method Post -Path "/api/v1/complaints/$cmp2/cadet-review/" -Token $tokCad -Body @{approve=$true} | Out-Null
Invoke-Api -Method Post -Path "/api/v1/complaints/$cmp2/officer-review/" -Token $tokOff -Body @{accept=$true; severity="level_3"} | Out-Null

Write-Host "== Add extra complainant to caseL3 =="
AddParticipant $caseL3 "complainant" "Extra complainant" "4001" "09140000001" $tokCad

Write-Host "== Evidence negative test (missing title) =="
try {
    Invoke-Api -Method Post -Path "/api/v1/evidences/" -Token $tokOff -Body @{
        case=$caseL3; type="generic"; description="no title"
    } | Out-Null
} catch { Write-Host "Expected evidence validation error (no title)." }

Write-Host "== Evidence create all types =="
Invoke-Api -Method Post -Path "/api/v1/evidences/" -Token $tokOff -Body @{
    case=$caseL3; type="testimony"; title="Witness note"; description="Heard a noise"; extra_data=@{witness_phone="09150000001"}
} | Out-Null
Invoke-Api -Method Post -Path "/api/v1/evidences/" -Token $tokDet -Body @{
    case=$caseL2; type="forensic"; title="Blood sample"; description="DNA"; extra_data=@{}
} | Out-Null
Invoke-Api -Method Post -Path "/api/v1/evidences/" -Token $tokOff -Body @{
    case=$caseL1; type="vehicle"; title="Blue sedan"; description="Found nearby"; extra_data=@{plate_number="12A345"}
} | Out-Null
Invoke-Api -Method Post -Path "/api/v1/evidences/" -Token $tokOff -Body @{
    case=$caseCR; type="id_document"; title="ID card"; description="Possible suspect"; extra_data=@{owner_name="John Doe"; field_notes="worn"}
} | Out-Null
Invoke-Api -Method Post -Path "/api/v1/evidences/" -Token $tokSgt -Body @{
    case=$caseCR; type="generic"; title="Misc item"; description="Broken phone"
} | Out-Null

Write-Host "== Coroner approves forensic evidence =="
$forensicList = Invoke-Api -Method Get -Path "/api/v1/evidences/?case=$caseL2&type=forensic" -Token $tokDet
$forensicId = $forensicList.results[0].id
Invoke-Api -Method Post -Path "/api/v1/evidences/$forensicId/review/" -Token $tokCor -Body @{decision="approve"; note="Matches victim"} | Out-Null

Write-Host "== Pursuit and high alert =="
Invoke-Api -Method Post -Path "/api/v1/pursuits/" -Token $tokSgt -Body @{
    case=$caseCR; suspect=@{full_name="Suspect Critical"; national_id="5001"}; status="wanted"; pursuit_started_at="2024-12-01"; severity_at_report="critical"
} | Out-Null
Invoke-Api -Method Get -Path "/api/v1/pursuits/high-alert" -Token $tokSgt | Out-Null

Write-Host "== Tip and reward flow =="
$tip = Invoke-Api -Method Post -Path "/api/v1/tips/" -Token $tokBase1 -Body @{case=$caseL3; description="I saw a suspect"}
$tipId = $tip.id
Invoke-Api -Method Post -Path "/api/v1/tips/$tipId/officer-review/" -Token $tokOff -Body @{decision="forward"} | Out-Null
Invoke-Api -Method Post -Path "/api/v1/tips/$tipId/detective-review/" -Token $tokDet -Body @{decision="approve"; reward_amount=500000} | Out-Null
Invoke-Api -Method Post -Path "/api/v1/tips/$tipId/mark-rewarded" -Token $tokSgt | Out-Null

Write-Host "== Suspect evaluation (detective/sergeant/captain/chief) =="
$eval = Invoke-Api -Method Post -Path "/api/v1/suspect-evaluations/" -Token $tokDet -Body @{
    case=$caseCR; suspect=@{full_name="Suspect Critical"; national_id="5001"}
}
$evalId = $eval.id
Invoke-Api -Method Post -Path "/api/v1/suspect-evaluations/$evalId/detective-score/" -Token $tokDet -Body @{score=9; notes="Strong evidence"} | Out-Null
Invoke-Api -Method Post -Path "/api/v1/suspect-evaluations/$evalId/sergeant-score/" -Token $tokSgt -Body @{score=8; notes="Matches record"} | Out-Null
Invoke-Api -Method Post -Path "/api/v1/suspect-evaluations/$evalId/captain-decision/" -Token $tokCpt -Body @{decision="approve"} | Out-Null
Invoke-Api -Method Post -Path "/api/v1/suspect-evaluations/$evalId/chief-decision/" -Token $tokChf -Body @{decision="approve"} | Out-Null

Write-Host "== Trial (judge verdict) =="
if ($tokJudge) {
    Invoke-Api -Method Post -Path "/api/v1/trials/" -Token $tokJudge -Body @{
        case=$caseCR; judge=@{full_name="Judge Judy"; national_id="7001"}; verdict="guilty"; sentence_title="Prison"; sentence_description="25 years"
    } | Out-Null
}

Write-Host "Scenario completed."
