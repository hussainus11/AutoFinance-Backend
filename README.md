# Auto Finance API

Express + Prisma + PostgreSQL.

## Setup

1. Copy `.env.example` to `.env` and set `DATABASE_URL` to your Postgres instance (database `autofinance`).

2. Install and apply migrations:

```bash
npm install
npx prisma migrate deploy
npx prisma generate
```

3. (Optional) Seed demo data:

```bash
npm run db:seed
```

4. Run the server:

```bash
npm run dev
```

API base URL: `http://localhost:4000/api` (configure `PORT` and `CORS_ORIGIN` in `.env`).

## Development migrations

If you change `prisma/schema.prisma`:

```bash
npx prisma migrate dev --name your_change_name
```

## Testing

Unit tests (pure functions, no DB — `emi.ts`, `auth/jwt.ts`):

```bash
npm test
```

Integration tests (real Postgres — full login/refresh-rotation/reuse-detection/logout flow) run
against a disposable database, kept separate from your dev data:

1. Create a database named `autofinance_test` on the same Postgres instance as `.env`'s `DATABASE_URL`.
2. Create `backend/.env.test` with a `DATABASE_URL` identical to `.env` but pointing at
   `autofinance_test` instead of `autofinance`.
3. Push the schema to it once: `DATABASE_URL="<the autofinance_test URL>" npx prisma db push --skip-generate`.
4. Run: `npm run test:integration`.

Tests truncate `RefreshToken`/`User` between runs and upsert their own `Company`/`User` fixtures —
safe to re-run freely against the same test database.
