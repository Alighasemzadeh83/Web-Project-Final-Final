# Police Case Management

This repo contains a Django REST backend and a Next.js frontend.

## Prerequisites

- Python 3.10+
- Node.js 18+ (for frontend)
- (Optional) Docker + Docker Compose for full stack (Postgres + backend + frontend)

---

## Backend (local, SQLite)

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# If Django reports model changes without migrations:
python3 manage.py makemigrations
python3 manage.py migrate
python3 manage.py seed_roles

python3 manage.py runserver 0.0.0.0:8000
```

Swagger / API docs:
- Swagger UI: `http://127.0.0.1:8000/api/v1/docs/swagger/`
- Redoc: `http://127.0.0.1:8000/api/v1/docs/redoc/`
- OpenAPI schema: `http://127.0.0.1:8000/api/v1/schema/`

Seed demo data (admin only):
```bash
curl -X POST http://127.0.0.1:8000/api/v1/auth/seed/ \
  -H "Authorization: Bearer <ADMIN_TOKEN>"
```
Seed creates demo users and roles only. Seeded accounts use the shared password: `changeme`.

Reset database + re-seed (admin only, DEBUG only):
```bash
curl -X POST http://127.0.0.1:8000/api/v1/auth/reset/ \
  -H "Authorization: Bearer <ADMIN_TOKEN>"
```
Note: Reset wipes application data but preserves existing superusers.

Payment return page:
- `http://127.0.0.1:8000/payments/return/?status=success&reference=REF123&amount=250000`

Payment gateway (Stripe test):
- Set `STRIPE_SECRET_KEY` in `.env`
- Optional: `STRIPE_CURRENCY` (default: `usd`)
- Optional: `PAYMENT_CALLBACK_BASE` to override callback URL
- API: create a payment via `POST /api/v1/bail-payments/` to receive `payment_url`
- Gateway callback will hit `/payments/return/?payment_id=<id>&status=success&session_id=<session>`
- If `STRIPE_SECRET_KEY` is empty, the system uses a local mock gateway at `/payments/mock/`.

Stripe test cards (use in Test mode):
- Success (Visa): `4242 4242 4242 4242`
- Exp: any future date (e.g. `12/34`)
- CVC: any 3 digits (e.g. `123`)
- ZIP/Postal (if asked): `12345` or `00000`

---

## Docker Compose (Full Stack)

```bash
docker compose up --build
```

Services:
- Backend API: `http://127.0.0.1:8000`
- Frontend: `http://127.0.0.1:3000`
- PostgreSQL: `127.0.0.1:5432`

---

## Frontend (local)

```bash
cd frontend
npm install

# Optional: set API base URL (defaults to http://127.0.0.1:8000/api/v1)
echo "NEXT_PUBLIC_API_BASE=http://127.0.0.1:8000/api/v1" > .env.local

npm run dev
```

Frontend will be at `http://127.0.0.1:3000`.

Admin tools (seed/reset + user/role controls):
- `http://127.0.0.1:3000/admin-tools`

---

## Full Test Runner

Runs migrations, seeds roles, and all Django tests with verbose output:

```bash
python3 scripts/full_test.py
```

Optional scenario script (requires backend running + admin creds):

```bash
RUN_SCENARIO=1 ADMIN_USER=admin ADMIN_PASS=changeme BASE_URL=http://127.0.0.1:8000 python3 scripts/full_test.py
```

---

## Frontend Manual Testing (Doc Checklist)

Use this quick checklist:

- Home page shows intro + 3+ metrics
- Login/Register works
- Modular dashboard hides modules by role
- Detective board supports drag, link, export
- High alert list (public/role-based)
- Complaints flow: submit + add extra complainant
- Status flow: cadet review → officer approval → case
- Evidence: recorded date + coroner review
- Reports show per-case details

If any step is missing, verify the related endpoint in Swagger and treat it as a gap.

## Frontend Automated Tests

```bash
cd frontend
npm install
npm run test
```

Also recommended before delivery:

```bash
npm run build
npm run lint
```

---

## Common Issues

- **"models have changes not yet reflected in a migration"**
  - Run:
    ```bash
    python3 manage.py makemigrations
    python3 manage.py migrate
    ```
- **Frontend not showing data**
  - Ensure backend is running and `NEXT_PUBLIC_API_BASE` points to your backend.
  - Login with a user that has the required role(s).

---

## Useful Commands

```bash
# Create a superuser
python3 manage.py createsuperuser

# Run only backend tests
python3 manage.py test
```
