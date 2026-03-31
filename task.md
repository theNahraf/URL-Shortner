# Nanourl URL Shortener — Task Tracker

## Backend
- [x] Project scaffold (package.json, Docker, .env)
- [x] Config (database, Redis, env validation)
- [x] Snowflake ID + Base62 encoding
- [x] Database migrations (users, urls, analytics)
- [x] Auth service (JWT, bcrypt, refresh tokens)
- [x] URL service (shorten, redirect, CRUD, caching)
- [x] Analytics service (clicks, geo, device, time-series)
- [x] Payment service (Razorpay subscriptions)
- [x] QR code generation
- [x] Rate limiter (Token Bucket via Redis Lua)
- [x] BullMQ analytics worker
- [x] Express app (routes, middleware, Swagger)
- [x] Error handling & URL validation

## Frontend
- [x] Design system (base.css — glassmorphism, animations, components)
- [x] API client (api.js — fetch wrapper, JWT management, toast)
- [x] Landing page (hero, URL shortener, animated stats, features, CTA)
- [x] Login page (glassmorphism card, Google OAuth placeholder)
- [x] Signup page
- [x] Dashboard (sidebar, KPI cards, Chart.js charts, links table, analytics drill-down)
- [x] Create Link modal (URL, title, alias, expiry, password, one-time toggle)
- [x] QR Code modal
- [x] Pricing page (3-tier cards, FAQ accordion, Razorpay checkout)
- [x] Route fix — SPA pages before wildcard shortcode

## Infrastructure
- [x] Docker Compose (PostgreSQL 16, Redis 7)
- [x] Port conflict resolution (15432, 16379)
- [x] Database migrations run
- [x] Server startup verified

## Testing
- [x] Landing page renders correctly
- [x] URL shortening works (anonymous)
- [x] Signup flow works
- [x] Login flow works
- [x] Dashboard loads with KPI cards
- [x] Create Link modal creates links
- [x] My Links table shows links with actions
- [x] Clean URL routing (/login, /dashboard, /pricing) works
- [x] Pricing page renders with tiers
