# MarketFlow — Automated Supermarket Management System

**Course Context:** Year 3 Computer Science — System Analysis & Design (Live Defence Project)  
**Working Product Name:** MarketFlow  
**Architecture:** Classic 3-Tier Web Application (Presentation Tier, Application/Business Logic Tier, Relational Data Tier)

MarketFlow centralises supermarket product catalogue management, supplier stock receiving, inventory adjustments, fast point-of-sale (POS) checkout, receipt generation, sales reporting, and role-based audit logging into a single web application.

---

## Quick Start

### 1. Prerequisites
- **Node.js v22.5+ or v24+** (uses Node's built-in `node:sqlite` module — no external database server or C++ compiler required)

### 2. Install & Run
```bash
npm install
npm start
```
Then open **http://localhost:3000** in your browser.

> **Offline Defence Ready:** Bootstrap 5, Bootstrap Icons, and Chart.js are bundled locally inside `public/vendor/`, so the entire application runs with zero internet access during your presentation.

### 3. Useful Commands
- `npm start` — Start the Express server (auto-creates and seeds `data/marketflow.db` on first run)
- `npm test` — Run the full automated API & business-logic test suite (`node --test`)
- `npm run reset-db` — Wipe and re-seed `data/marketflow.db` cleanly before a live demonstration

---

## Demo Staff Accounts

| Role | Email | Password | Primary Workspace |
|---|---|---|---|
| **System Administrator** | `admin@marketflow.local` | `admin123` | Full access (Dashboard, POS, Products, Inventory, Suppliers, Sales, Reports, Staff & Settings) |
| **Owner / Manager** | `manager@marketflow.local` | `manager123` | Dashboard, POS, Products, Inventory, Suppliers, Sales, Reports, Staff & Settings |
| **Cashier** | `cashier@marketflow.local` | `cashier123` | POS Checkout & own transaction receipts only |
| **Inventory Officer** | `inventory@marketflow.local` | `inventory123` | Inventory, Products & Suppliers (no financial reports or POS) |

---

## Project Structure

```text
Project SuperMarket/
├── server.js                  # Express entrypoint (zero-config Vercel export + local HTTP server)
├── package.json
├── db/
│   ├── schema.js              # Bundled SQL schema string for serverless & local setup
│   ├── schema.sql             # 11 normalized relational tables + constraints + indexes (reference)
│   ├── database.js            # SQLite initialization, transaction wrapper, seed data
│   └── reset.js               # Clean database reset helper for demos
├── src/
│   ├── app.js                 # Express app factory, static mounts, error handler
│   ├── middleware/
│   │   ├── auth.js            # Authentication & RBAC enforcement
│   │   └── session.js         # Stateless HMAC-SHA256 signed HttpOnly cookie sessions
│   ├── services/
│   │   ├── audit.js           # Audit trail writer
│   │   └── settings.js        # Store configuration reader
│   └── routes/
│       ├── auth.js            # Login, logout, session check
│       ├── users.js           # Staff account & role management
│       ├── categories.js      # Product category management
│       ├── products.js        # Product catalogue & price change auditing
│       ├── suppliers.js       # Supplier directory
│       ├── inventory.js       # Stock overview, supplier receiving, stock adjustments
│       ├── sales.js           # Atomic POS checkout, receipts, permission-gated voiding
│       ├── reports.js         # Dashboard KPIs, sales analytics, inventory valuation
│       ├── audit.js           # Security & operational audit log viewer
│       └── settings.js        # Store name, currency, tax & discount cap settings
├── public/
│   ├── login.html             # Staff sign-in screen + quick-fill demo credentials
│   ├── index.html             # Authenticated workspace shell + modals
│   ├── css/styles.css         # MarketFlow forest-green design tokens + print styles
│   ├── vendor/                # Offline-bundled Bootstrap 5, Bootstrap Icons & Chart.js
│   └── js/
│       ├── api.js             # Fetch helper, formatting, confirm/receipt modals
│       ├── app.js             # Role-based navigation & session bootstrap
│       ├── dashboard.js       # Manager KPI cards, 7-day Chart.js trend, alerts
│       ├── pos.js             # Fast barcode/SKU search, cart, payment, receipt
│       ├── products.js        # Catalogue CRUD & category manager
│       ├── inventory.js       # Stock overview, multi-item receiving, movement history
│       ├── suppliers.js       # Supplier CRUD
│       ├── sales.js           # Transaction filtering, receipt reprint & sale voiding
│       ├── reports.js         # Sales, top products, inventory valuation + CSV/Print
│       └── admin.js           # Staff management, store settings & audit log
└── tests/
    └── api.test.js            # Automated integration tests covering all PRD criteria
```

---

## Deploying to Vercel

1. Push this repository to GitHub.
2. Import the repository in **Vercel** (zero-config Express preset auto-detects `server.js` + `public/`, with Node.js `24.x` via `package.json`).
3. Add an environment variable in Vercel Project Settings:
   - `SESSION_SECRET` — any long random string used to sign staff session cookies.
4. Deploy. Static assets in `public/` (including `public/vendor/`) are served from Vercel's CDN, while `/api/*` routes through `server.js`.

> **Database Note on Serverless:** On Vercel (`VERCEL=1`), SQLite runs in `/tmp/marketflow.db` with auto-seeded demo data, which resets whenever a serverless instance cold-starts. For persistent local demonstrations during your project defence, run `npm start` locally (which persists to `data/marketflow.db`).
