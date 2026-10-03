const express = require('express');
const Database = require('better-sqlite3');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123'; // change it!
const UP = path.join(__dirname, 'uploads');
fs.mkdirSync(UP, { recursive: true });

// ---------- Database ----------
const db = new Database(process.env.DB_FILE || path.join(__dirname, 'pharmacy.db'));
db.pragma('journal_mode = WAL');
db.exec(`
CREATE TABLE IF NOT EXISTS products(
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, ingredient TEXT,
  category TEXT, price REAL NOT NULL, rx INTEGER DEFAULT 0, emoji TEXT DEFAULT '💊');
CREATE TABLE IF NOT EXISTS orders(
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, phone TEXT NOT NULL,
  address TEXT NOT NULL, total REAL NOT NULL, rx_file TEXT,
  status TEXT DEFAULT 'New', created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS order_items(
  order_id INTEGER NOT NULL REFERENCES orders(id), product_id INTEGER,
  name TEXT, qty INTEGER, price REAL);
`);

if (db.prepare('SELECT COUNT(*) c FROM products').get().c === 0) {
  const ins = db.prepare('INSERT INTO products(name,ingredient,category,price,rx,emoji) VALUES(?,?,?,?,?,?)');
  [
    ['Panadol Extra','Paracetamol + caffeine','Pain relief',12,0,'💊'],
    ['Brufen 400','Ibuprofen','Pain relief',18,0,'💊'],
    ['Vitamin D3 1000','Cholecalciferol','Vitamins',35,0,'🟡'],
    ['Omega 3','Fish oil','Vitamins',55,0,'🐟'],
    ['Daily Moisturizer','Glycerin + vitamin E','Skin care',28,0,'🧴'],
    ['Sunscreen SPF50','Mineral filters','Skin care',45,0,'☀️'],
    ['Infant Vitamin Drops','Vitamin D + A','Mother & baby',22,0,'🍼'],
    ['Digital Thermometer','Reads in 10 seconds','Devices & first aid',25,0,'🌡️'],
    ['Adhesive Bandages (20)','Waterproof','Devices & first aid',8,0,'🩹'],
    ['Blood Pressure Monitor','Upper arm, 90 readings memory','Devices & first aid',120,0,'🩺'],
    ['Amoxicillin 500','Amoxicillin','Prescription',24,1,'💊'],
    ['Atorvastatin 20','Atorvastatin','Prescription',38,1,'💊'],
    ['Metformin 500','Metformin','Prescription',15,1,'💊'],
  ].forEach(r => ins.run(...r));
}

// ---------- App ----------
const app = express();
app.use(express.json({ limit: '100kb' }));
app.use(express.static(path.join(__dirname, 'public')));

const upload = multer({
  storage: multer.diskStorage({
    destination: UP,
    filename: (req, file, cb) =>
      cb(null, crypto.randomBytes(12).toString('hex') + path.extname(file.originalname).toLowerCase().slice(0, 6)),
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) =>
    cb(null, /^(image\/|application\/pdf)/.test(file.mimetype)),
});

const admin = (req, res, next) =>
  req.get('x-admin-password') === ADMIN_PASSWORD ? next() : res.status(401).json({ error: 'Wrong admin password' });

const withItems = rows => {
  const q = db.prepare('SELECT name, qty, price FROM order_items WHERE order_id=?');
  return rows.map(o => ({ ...o, items: q.all(o.id) }));
};

// Products
app.get('/api/products', (req, res) =>
  res.json(db.prepare('SELECT * FROM products ORDER BY id').all()));

app.post('/api/products', admin, (req, res) => {
  const { name, ingredient, category, price, rx } = req.body || {};
  if (!name || !(+price > 0)) return res.status(400).json({ error: 'Name and a positive price are required' });
  const r = db.prepare('INSERT INTO products(name,ingredient,category,price,rx,emoji) VALUES(?,?,?,?,?,?)')
    .run(String(name).slice(0, 120), String(ingredient || '').slice(0, 160), String(category || 'Vitamins').slice(0, 60),
      +price, rx ? 1 : 0, rx ? '💊' : '📦');
  res.json({ id: r.lastInsertRowid });
});

app.delete('/api/products/:id', admin, (req, res) => {
  db.prepare('DELETE FROM products WHERE id=?').run(+req.params.id);
  res.json({ ok: true });
});

// Prescriptions
app.post('/api/prescriptions', upload.single('file'), (req, res) =>
  req.file ? res.json({ file: req.file.filename, name: req.file.originalname })
           : res.status(400).json({ error: 'Upload an image or PDF (max 5 MB)' }));

app.get('/api/admin/prescriptions/:file', admin, (req, res) => {
  const f = path.join(UP, path.basename(req.params.file));
  fs.existsSync(f) ? res.sendFile(f) : res.status(404).json({ error: 'File not found' });
});

// Orders
app.post('/api/orders', (req, res) => {
  const { name, phone, address, items, rx_file } = req.body || {};
  if (!name || !phone || !address || !Array.isArray(items) || !items.length)
    return res.status(400).json({ error: 'Please fill in all fields' });
  const get = db.prepare('SELECT * FROM products WHERE id=?');
  let total = 0, needRx = false;
  const rows = [];
  for (const it of items) {
    const p = get.get(+it.id), qty = Math.floor(+it.qty);
    if (!p || !(qty > 0 && qty <= 50)) return res.status(400).json({ error: 'Invalid item in cart' });
    total += p.price * qty; // price always comes from the database, never from the browser
    if (p.rx) needRx = true;
    rows.push([p, qty]);
  }
  if (needRx && !(rx_file && fs.existsSync(path.join(UP, path.basename(rx_file)))))
    return res.status(400).json({ error: 'A prescription is required for this order' });
  const create = db.transaction(() => {
    const id = db.prepare('INSERT INTO orders(name,phone,address,total,rx_file) VALUES(?,?,?,?,?)')
      .run(String(name).slice(0, 100), String(phone).slice(0, 30), String(address).slice(0, 200), total,
        needRx ? path.basename(rx_file) : null).lastInsertRowid;
    const ins = db.prepare('INSERT INTO order_items(order_id,product_id,name,qty,price) VALUES(?,?,?,?,?)');
    rows.forEach(([p, q]) => ins.run(id, p.id, p.name, q, p.price));
    return id;
  });
  res.json({ id: create() });
});

app.get('/api/orders', (req, res) => {
  const phone = String(req.query.phone || '').trim();
  if (phone.length < 6) return res.status(400).json({ error: 'Enter the phone number used for the order' });
  res.json(withItems(db.prepare('SELECT * FROM orders WHERE phone=? ORDER BY id DESC').all(phone)));
});

app.get('/api/admin/orders', admin, (req, res) =>
  res.json(withItems(db.prepare('SELECT * FROM orders ORDER BY id DESC').all())));

app.patch('/api/orders/:id', admin, (req, res) => {
  const st = req.body && req.body.status;
  if (!['New', 'Preparing', 'Delivered'].includes(st)) return res.status(400).json({ error: 'Invalid status' });
  db.prepare('UPDATE orders SET status=? WHERE id=?').run(st, +req.params.id);
  res.json({ ok: true });
});

app.listen(PORT, () => console.log(`Pharmacy running on http://localhost:${PORT}`));
