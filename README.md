# Shift Rota

A small web app to calculate, display and track a rotating weekly shift pattern, handle
per-day swaps and holidays, and keep an accurate history — signed in with Microsoft 365.

- **Shifts:** Earlies `08:00–16:00`, Lates `09:15–17:30`, Normal `08:45–17:00` (all editable in Settings).
- **Pattern:** each person does one shift type per week; the rota cycles fairly so everyone rotates through every slot.
- **Weekly target:** 2 on Earlies, 1 on Lates, the rest Normal — auto-adjusts to the number of employees.
- **Hard rule:** there must always be **≥1 Early and ≥1 Late every working day**. Any swap/holiday that would break this is blocked.
- **Swaps & holidays:** per **day** (swap two people for one day, change one person's day, or book days/weeks off).
- **History:** past days are frozen snapshots and never change, even after employees are renamed, added or removed.

## Architecture & cost

| Concern | Choice | Cost |
|---|---|---|
| Hosting + API + auth | Azure **Static Web Apps (Free plan)** | £0 |
| Sign-in | **Microsoft Entra ID** (preconfigured `aad` provider) | £0 |
| Data | **Azure Table Storage** (one Storage account) | ~pennies/month |
| CI/CD | GitHub Actions (auto-wired by SWA) | £0 |

Effectively free to run — only the storage account costs anything (a few pence a month for this volume).

```
shift-rota/
  web/    React + Vite + TypeScript frontend
  api/    Azure Functions (Node 20+, TypeScript, v4 model) + Table Storage
  staticwebapp.config.json   routing + auth gating
  .github/workflows/         deploy pipeline
```

`web/src/lib/rota.ts` and `api/src/lib/rota.ts` are identical pure logic. The **server is authoritative**
(it re-validates every change); the web copy only powers instant UI previews.

## Authentication model (important)

The **Free plan** only offers the preconfigured Entra provider, which lets *any* Microsoft account
authenticate. So the app authorises in the API: a signed-in user is allowed only if their email is

1. listed in the `ALLOWED_ADMINS` app setting (the bootstrap), **or**
2. an **active employee** in the app.

Unknown users get a friendly "ask an admin to add you" screen.

**Bootstrap:** set `ALLOWED_ADMINS` to your email, sign in, then add the other employees on the
Employees tab. After that everyone listed can sign in and edit.

**Optional hard tenant lock (paid):** to restrict the *login screen itself* to your organisation,
upgrade the SWA to the **Standard plan** (~£7–9/mo) and add a custom Entra registration pinned to your
tenant in `staticwebapp.config.json`. Not required for the model above.

---

## Run locally

Prerequisites: **Node 18+**, plus these dev tools (one-time global installs):

```bash
npm i -g @azure/static-web-apps-cli azure-functions-core-tools@4
```

Azurite (local Table Storage) is already a dev-dependency of `api/`.

```bash
# 1. install
cd api && npm install
cd ../web && npm install

# 2. create api/local.settings.json from the example and set ALLOWED_ADMINS to your email
#    (TABLES_CONNECTION_STRING defaults to the local Azurite emulator)
cp api/local.settings.json.example api/local.settings.json

# 3. start the local Table Storage emulator (separate terminal)
cd api && npx azurite-table --silent --location ./.azurite

# 4. run everything together via the Static Web Apps CLI (handles /api + emulated /.auth)
cd ..
swa start web --run "npm --prefix web run dev" --api-location api
# open http://localhost:4280  — use the emulated login to sign in as your ALLOWED_ADMINS email
```

> Tip: `swa start`'s emulated login lets you type any email/roles, so you can test the
> "authorised", "unknown user", and "admin" states without real M365.

### Tests

```bash
cd api
npm test                 # 18 unit tests for the rota logic (no emulator needed)

# full storage + sealing + swap integration test against Azurite:
npx azurite-table --silent --location ./.azurite &   # in another terminal
npm run build && node scripts/smoke.cjs              # 15 integration checks
```

---

## Deploy to Azure

### 1. Create the resources

```bash
# Storage account (Table Storage)
az group create -n rg-shift-rota -l uksouth
az storage account create -n strshiftrota$RANDOM -g rg-shift-rota -l uksouth --sku Standard_LRS
# grab its connection string:
az storage account show-connection-string -g rg-shift-rota -n <storageName> -o tsv
```

Create the Static Web App (Free) from the portal **or** CLI, pointing at your GitHub repo. The portal
flow auto-creates the GitHub Actions workflow and the `AZURE_STATIC_WEB_APPS_API_TOKEN` secret.

- **App location:** `web`  ·  **Api location:** `api`  ·  **Output location:** `dist`
- (This repo already includes a workflow at `.github/workflows/` assuming `shift-rota/` is the repo root.)

### 2. App settings (Configuration → Application settings on the SWA)

| Name | Value |
|---|---|
| `TABLES_CONNECTION_STRING` | the Storage account connection string from above |
| `ALLOWED_ADMINS` | your email (comma-separate for several), e.g. `you@company.com` |

### 3. Deploy

Push to `main` → GitHub Actions builds `web` (Vite) and `api` (Functions) and deploys. Or deploy
manually:

```bash
cd web && npm run build && cd ..
swa deploy ./web --api-location ./api --deployment-token <SWA_DEPLOYMENT_TOKEN>
```

### 4. First sign-in

Open the SWA URL → **Sign in with Microsoft** → sign in with an `ALLOWED_ADMINS` email →
go to **Employees** and add the team (name + their M365 email) → set **Settings** (shift times,
targets, working days, and the rotation start week). Done.

---

## How the rota is calculated

For `n` active employees, each week's slots are `2 Earlies, 1 Late, n-3 Normal` (targets configurable).
Sorting employees by their rotation order, week `w` assigns employee `i` the slot at
`(i + w) mod n` — a cyclic shift, so coverage is exact every week and everyone rotates fairly. Days
default to that weekly shift; **day overrides** and **days off** layer on top for swaps/holidays, and
every change is validated to keep ≥1 Early and ≥1 Late.

**History:** completed working days are frozen into immutable `DayRecords` (capturing each person's
name at the time). The freeze advances automatically as days pass and always runs *before* any roster
or settings change, so the past can never be retroactively rewritten.
