######## buidling env ########
python -m venv .venv
.\.venv\Scripts\activate
pip install -r requirements.txt


######## starting commands ########
python manage.py migrate
python manage.py seed_roles


######## building superuser ########
python manage.py createsuperuser


######## run server ########
python manage.py runserver 


######## sign in user ########
$body = @{
  username    = "user1"
  email       = "u1@example.com"
  first_name  = "U"
  last_name   = "One"
  national_id = "1234567890"
  phone_number= "09120000000"
  password    = "StrongPass123"
} | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:8000/api/v1/auth/register/" `
  -ContentType "application/json" -Body $body


######## login and get token ########
$login = @{identifier="user1"; password="StrongPass123"} | ConvertTo-Json
$resp = Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:8000/api/v1/auth/login/" `
  -ContentType "application/json" -Body $login
$resp.tokens.access
$resp.tokens.refresh


######## get request with token ########
$token = $resp.tokens.access
Invoke-RestMethod -Method Get -Uri "http://127.0.0.1:8000/api/v1/cases/" `
  -Headers @{Authorization="Bearer $token"}


