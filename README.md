# Al Nada Pharmacy (Node.js + Express + SQLite)

## Run
1. Install Node.js 18+ from nodejs.org
2. In this folder: `npm install`
3. `ADMIN_PASSWORD=yourpassword npm start`  (Windows PowerShell: `$env:ADMIN_PASSWORD="yourpassword"; npm start`)
4. Open http://localhost:3000

Default admin password is `admin123` — change it.

## Structure
- server.js — API + database (pharmacy.db is created automatically, with 13 sample products)
- public/index.html — the storefront (calls the API)
- uploads/ — prescription files (private, only the admin API can open them)

## API
GET /api/products · POST /api/products (admin) · POST /api/prescriptions
POST /api/orders · GET /api/orders?phone= · GET /api/admin/orders (admin) · PATCH /api/orders/:id (admin)
