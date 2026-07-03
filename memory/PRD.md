# RCB Events CRM - Product Requirements Document

## Original Problem Statement
Build a comprehensive CRM for **RCB Events**, a birthday and event decoration company (balloon decorations, kids' themes, welcome boards, backdrops, baby showers, anniversaries, corporate events). Manage the entire business from lead generation to booking completion.

## Tech Stack
- Frontend: React 19 + React Router 7 + Tailwind + Framer Motion + Sonner (toasts) + Lucide icons
- Backend: FastAPI + Motor (async MongoDB) + Razorpay + qrcode + emergentintegrations
- Database: MongoDB
- Auth: JWT Bearer tokens (localStorage on client)

## Design System
- Primary: Red `#E63946` · Secondary: Black `#0A0A0A` · Background: White
- Fonts: **Outfit** (headings) + **DM Sans** (body)

## Core Modules
1. Dashboard – KPIs, calendar, recent bookings
2. Bookings – full lifecycle w/ Razorpay integration + QR
3. Pipeline – Leads + embedded WhatsApp chat (split view)
4. Packages, Payments, Expenses, Vendors, Staff, Users
5. Invoice (PDF-ready)

## What's Been Implemented

### 2026-07-03 — WhatsApp Chat + Booking/Payments Sync (this session)
- **Embedded WhatsApp chat inside Pipeline page** (split view like WhatsApp Web)
  - Left: filterable lead list (stage tabs, search)
  - Right: chat panel with message bubbles, composer, stage dropdown
  - Auto-lead creation on incoming message (via `/api/whatsapp/webhook`)
  - Mock incoming endpoint `/api/whatsapp/mock/incoming` for dev testing
  - Meta Cloud API send endpoint wired — will go live once creds added
  - LLM-based location/date extraction from chat text (Emergent LLM key)
- **Booking + Customer Payments Synchronization**
  - Unified state machine: `booking_status` (Pending → Confirmed → In Progress → Completed / Cancelled) + `payment_status` (Advance Pending → Partial Paid → Advance Received → Fully Paid)
  - Auto-generate ₹2000 Razorpay **advance payment link** on booking create
  - Auto-generate **balance QR code** (Razorpay payment link → PNG QR via `qrcode` lib) after advance received
  - Background sweep (hourly) flips Confirmed → In Progress on event date
  - Fully Paid + In Progress → Completed automatically
  - Payment history endpoint with receipt numbers
  - Frontend Bookings + Payments both poll every 10s → real-time sync
  - New actions: Send Advance Link, View/Share/Download/Print QR, Payment History, Sync from Razorpay
  - Google Review URL wired: https://maps.app.goo.gl/RA3EktprJ4rqN5Su7
- **Backend tests**: 12/12 pass (`/app/backend/tests/test_booking_payments_sync.py`)

### 2026-02-07 — Earlier work
- Full JWT auth, RBAC, admin seeded
- Dashboard with embedded calendar
- Bookings CRUD + theme photo upload + addon limits
- Razorpay payment links + webhook + manual sync
- Packages (4 tiers), Payments, Expenses, Vendors, Staff, Users
- Pipeline (7-stage kanban)
- Invoice (print-ready with QR)
- Mobile responsive w/ bottom nav

## API Endpoints (new this session)
- `POST /api/bookings` (enhanced) – auto-generates advance link
- `POST /api/bookings/{id}/regenerate-advance-link`
- `POST /api/bookings/{id}/generate-balance-qr`
- `GET /api/bookings/{id}/payment-history`
- `POST /api/payments/sync/{id}` (enhanced) – syncs both advance link + balance QR
- `POST /api/payments/webhook` (enhanced) – handles both advance + balance events
- `GET /api/config/review-url`
- `GET /api/whatsapp/conversations`, `GET /api/whatsapp/conversations/{wa_id}/messages`
- `POST /api/whatsapp/send`, `POST /api/whatsapp/webhook`, `GET /api/whatsapp/webhook`
- `POST /api/whatsapp/mock/incoming` (dev)

## Environment Variables
- `MONGO_URL`, `DB_NAME`, `JWT_SECRET`
- `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`
- `EMERGENT_LLM_KEY` (universal key for Claude/OpenAI/Gemini **AND Emergent Object Storage**)
- `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET` (empty — plug in later)
- `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `GOOGLE_REVIEW_URL`

## File Uploads
- All new theme photos uploaded via `/api/upload` are stored in **Emergent Object Storage** (`rcbevents/uploads/{user_id}/{uuid}.{ext}` path convention)
- Served via `/api/files/{path:path}` with Bearer token OR `?auth=<token>` query param (for `<img src>`)
- MongoDB `files` collection tracks references with `is_deleted` soft-delete flag
- Legacy `/api/uploads/*` static mount kept for existing bookings' images

## Backlog / Deferred
### P1
- **Wire live Meta WhatsApp Cloud API** (creds pending from user)
- Reports & Analytics Dashboard (Sales, Expense, Profit)
- Meta Ads / Website lead auto-ingestion webhooks
- Split server.py (960 lines) into routers per module

### P2
- Customer Portal + Staff Attendance App
- Google Calendar sync
- AI Chatbot / WhatsApp AI assistant
- Inventory management
- Auto Thank-You WhatsApp + Google Review on Completed transition

## Known Trade-offs
- Razorpay QR-code API returns 404 in test mode → we generate a Razorpay payment link and render its short_url as a base64 PNG QR locally (using `qrcode` python lib). Webhook events still flow through Razorpay so payments auto-reconcile.
- Emergent LLM key had a 0-budget on last check → LLM-based location parsing from chat text is best-effort; leads still get created (location left empty on parse failure per user preference).

## Test Credentials
- admin@rcbevents.com / admin123 (role: admin)
- See `/app/memory/test_credentials.md` for other seeded roles
