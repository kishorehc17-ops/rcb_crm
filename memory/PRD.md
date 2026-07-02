# RCB Events CRM - Product Requirements Document

## Original Problem Statement
Build a comprehensive CRM for **RCB Events**, a birthday and event decoration company (balloon decorations, kids' themes, welcome boards, backdrops, baby showers, anniversaries, corporate events). Manage the entire business from lead generation to booking completion.

## Tech Stack
- Frontend: React 19 + React Router 7 + Tailwind + Framer Motion + Sonner (toasts) + Lucide icons
- Backend: FastAPI + Motor (async MongoDB)
- Database: MongoDB
- Auth: JWT Bearer tokens (localStorage on client)

## Design System
- Primary: Red `#E63946` · Secondary: Black `#0A0A0A` · Background: White
- Fonts: **Outfit** (headings) + **DM Sans** (body)
- Rounded 2xl/3xl cards, full-radius pill buttons, mobile-first responsive
- Desktop: fixed left sidebar; Mobile: sticky top bar + bottom nav

## User Personas
- **Admin/Owner**: full access — manages bookings, staff, expenses, packages
- **Manager/Sales/Staff**: role field on user (seeded roles ready; UI enforcement is P2)

## Core Requirements (Static)
1. Dashboard – KPIs & recent activity
2. Bookings CRUD with 6-status pipeline (Inquiry → Cancelled)
3. Monthly Calendar (green=available / red=booked)
4. Package Management (Standard / Gold / Gold Plus / Diamond)
5. Customer Payments – advance/balance tracking
6. Expense Book (categories: Vendor/Staff/Petrol/Transportation/Materials/Food/Other)
7. Vendors + Staff directories
8. Invoice PDF (print-to-PDF, QR code, company branding)
9. WhatsApp click-to-chat (wa.me)
10. Lead Management + 7-stage CRM Pipeline (Kanban)
11. JWT-based auth with seeded admin

## What's Been Implemented (2026-02-07)
- Full JWT auth (login, /auth/me, admin seeded on startup)
- Dashboard with 8 KPI stat cards + Recent Bookings + Pipeline tip card
- Bookings: full CRUD, filters, search, WhatsApp/Invoice/Edit/Delete actions, mobile card view
- Calendar: monthly grid with color-coded booking status, day-detail panel
- Packages: 4 seeded packages, full CRUD, tiered card visuals
- Payments: record payment → auto-update booking advance, totals dashboard
- Expenses: category filter, totals, CRUD
- Vendors + Staff: card-grid CRUD
- Pipeline: 7-column kanban with "Advance stage" action
- Invoice: professional print-ready invoice with QR code
- Mobile bottom nav (5 items) + desktop sidebar (9 items)
- All interactive elements have `data-testid` attributes

## Backlog / Deferred (P1/P2)
- **P1** WhatsApp Cloud API automation (booking confirmation, reminders, thank-you, review requests)
- **P1** Razorpay payment link generation
- **P1** Meta Ads / Website lead auto-ingestion webhooks
- **P2** Role-based access control (admin/manager/sales/staff)
- **P2** Reports: sales analytics, expense analytics, profit dashboard
- **P2** Customer Portal + Staff Attendance App
- **P2** Google Calendar sync
- **P2** AI Chatbot + WhatsApp AI assistant
- **P2** Inventory management

## Test Credentials
- admin@rcbevents.com / admin123 (role: admin)
