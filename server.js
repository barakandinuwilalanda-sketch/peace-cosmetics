const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");

const app = express();
const PORT = process.env.PORT || 3000;

/* =========================
   PERSISTENT STORAGE (Render Disk)
   Weka env variable DATA_DIR=/var/data kwenye Render (Environment tab),
   ikilingana na Mount Path ya Disk. Bila hii, database na uploads
   zitafutwa kila deploy kwa sababu Render ina ephemeral filesystem.
   Kama DATA_DIR haijawekwa (mfano ukiendesha localhost), inatumia
   folda ya kawaida ya app - haitaathiri kuendesha kwenye kompyuta yako.
========================= */
const DATA_DIR = process.env.DATA_DIR || __dirname;
fs.mkdirSync(DATA_DIR, { recursive: true });

// Passcode ya Admin - BADILISHA hii kwenye Environment Variables za Render
// (Key: ADMIN_PASSCODE) kabla ya kuweka site live. Default ni kwa majaribio tu.
const ADMIN_PASSCODE = process.env.ADMIN_PASSCODE || "peace2026";

/* =========================
   DATABASE SETUP
========================= */
const db = new Database(path.join(DATA_DIR, "shop.db"));

db.exec(`
    CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        category TEXT NOT NULL,
        price INTEGER NOT NULL,
        image TEXT,
        description TEXT,
        created_at TEXT NOT NULL
    )
`);

db.exec(`
    CREATE TABLE IF NOT EXISTS orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        customer_name TEXT NOT NULL,
        contact TEXT NOT NULL,
        items TEXT NOT NULL,
        total INTEGER NOT NULL,
        message TEXT,
        status TEXT DEFAULT 'Mpya',
        created_at TEXT NOT NULL
    )
`);

// Seed - weka bidhaa za awali mara moja tu kama jedwali la products ni tupu
const productCount = db.prepare(`SELECT COUNT(*) AS total FROM products`).get().total;
if (productCount === 0) {
    const now = new Date().toISOString();
    const seed = db.prepare(`
        INSERT INTO products (name, category, price, image, description, created_at)
        VALUES (@name, @category, @price, @image, @description, @created_at)
    `);
    const initialProducts = [
        { name: "Kitenge cha Wax (Original)", category: "Vitenge", price: 35000, image: "https://images.unsplash.com/photo-1590736704728-f4730bb30770?q=80&w=500", description: "Pamba 100% - Rangi Hazichuji" },
        { name: "Kitenge cha Batik / Doti", category: "Vitenge", price: 25000, image: "https://images.unsplash.com/photo-1607604276583-eef5d076aa5f?q=80&w=500", description: "Muundo wa Kisasa wa Kiafrika" },
        { name: "Kitenge cha Holland Super", category: "Vitenge", price: 45000, image: "https://images.unsplash.com/photo-1609171767030-d1e90e78553f?q=80&w=500", description: "Rangi za Dhahabu na Mng'ao" },
        { name: "Kanga za Msimu (Doti Mbili)", category: "Vitenge", price: 20000, image: "https://images.unsplash.com/photo-1528459801416-a9e53bbf4e17?q=80&w=500", description: "Kanga Laini Zenye Ujumbe Vizuri" },
        { name: "Peace Body Lotion", category: "Vipodozi", price: 30000, image: "https://images.unsplash.com/photo-1608248597260-84c17e30d1d1?q=80&w=500", description: "Mafuta ya Laini kwa Ngozi Yote" },
        { name: "Peace Body Scrub", category: "Vipodozi", price: 25000, image: "https://images.unsplash.com/photo-1556228720-195a672e8a03?q=80&w=500", description: "Kusafisha Ngozi na Kuondoa Seli Zilizokufa" },
        { name: "Vitamin C Face Serum", category: "Vipodozi", price: 35000, image: "https://images.unsplash.com/photo-1620916566398-39f1143ab7be?q=80&w=500", description: "Inang'arisha Uso na Kuondoa Madoa" },
        { name: "Lipstick & Gloss Set", category: "Vipodozi", price: 15000, image: "https://images.unsplash.com/photo-1586495777744-4413f21062fa?q=80&w=500", description: "Rangi za Lipsti Mbalimbali" },
        { name: "Pafumu ya Kupima (30ml)", category: "Pafumu", price: 10000, image: "https://images.unsplash.com/photo-1594035910387-fea47794261f?q=80&w=500", description: "Harufu Kali Inayokaa Muda Mrefu" },
        { name: "Pafumu ya Kupima (50ml)", category: "Pafumu", price: 15000, image: "https://images.unsplash.com/photo-1588405748880-12d1d2a59f75?q=80&w=500", description: "Chupa ya Vioo Vizuri & Spray" },
        { name: "Peace Luxury Perfume (Original)", category: "Pafumu", price: 45000, image: "https://images.unsplash.com/photo-1523293182086-7651a899d37f?q=80&w=500", description: "Pafumu ya Chupa Nzima" }
    ];
    initialProducts.forEach(p => seed.run({ ...p, created_at: now }));
    console.log(`Bidhaa ${initialProducts.length} za awali zimewekwa kwenye database.`);
}

/* =========================
   UPLOAD FOLDERS
========================= */
const uploadDir = path.join(DATA_DIR, "uploads");
const imageDir = path.join(uploadDir, "images");
fs.mkdirSync(imageDir, { recursive: true });

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, imageDir),
    filename: (req, file, cb) => {
        const unique = Date.now() + "-" + Math.round(Math.random() * 1e9);
        cb(null, unique + path.extname(file.originalname));
    }
});
const upload = multer({ storage, limits: { fileSize: 15 * 1024 * 1024 } }); // 15MB kwa picha

/* =========================
   MIDDLEWARE
========================= */
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Home page rasmi
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "index.html"));
});

app.use(express.static(__dirname));
app.use("/uploads", express.static(uploadDir));

// Ulinzi wa Admin - endpoints zenye taarifa nyeti (oda za wateja, kuhariri bidhaa)
// zinahitaji ADMIN_PASSCODE sahihi kwenye header "x-admin-key"
function requireAdmin(req, res, next) {
    const key = req.headers["x-admin-key"];
    if (key !== ADMIN_PASSCODE) {
        return res.status(401).json({ success: false, message: "Huna ruhusa. Passcode si sahihi." });
    }
    next();
}

/* =========================
   ADMIN LOGIN
========================= */
app.post("/api/admin/verify", (req, res) => {
    const { passcode } = req.body;
    if (passcode === ADMIN_PASSCODE) {
        res.json({ success: true });
    } else {
        res.status(401).json({ success: false, message: "Passcode si sahihi." });
    }
});

/* =========================
   PRODUCTS - Umma (Public)
========================= */
app.get("/api/products", (req, res) => {
    const { category, search } = req.query;
    let query = "SELECT * FROM products WHERE 1=1";
    const params = [];

    if (category && category !== "all") {
        query += " AND category = ?";
        params.push(category);
    }
    if (search) {
        query += " AND (name LIKE ? OR description LIKE ?)";
        params.push(`%${search}%`, `%${search}%`);
    }
    query += " ORDER BY created_at DESC";

    const products = db.prepare(query).all(...params);
    res.json(products);
});

/* =========================
   PRODUCTS - Admin (Weka/Hariri/Futa)
========================= */
app.post("/api/products", requireAdmin, upload.single("imageFile"), (req, res) => {
    try {
        const body = req.body;
        let image = body.image || null;
        if (req.file) image = "/uploads/images/" + req.file.filename;

        const now = new Date().toISOString();
        const result = db.prepare(`
            INSERT INTO products (name, category, price, image, description, created_at)
            VALUES (@name, @category, @price, @image, @description, @created_at)
        `).run({
            name: body.name,
            category: body.category,
            price: Number(body.price) || 0,
            image,
            description: body.description || "",
            created_at: now
        });

        res.json({ success: true, id: result.lastInsertRowid });
    } catch (error) {
        console.error("Add Product Error:", error);
        res.status(500).json({ success: false, message: "Imeshindikana kuongeza bidhaa." });
    }
});

app.put("/api/products/:id", requireAdmin, upload.single("imageFile"), (req, res) => {
    try {
        const id = req.params.id;
        const old = db.prepare(`SELECT * FROM products WHERE id = ?`).get(id);
        if (!old) return res.status(404).json({ success: false, message: "Bidhaa haipo." });

        let image = req.body.image || old.image;
        if (req.file) image = "/uploads/images/" + req.file.filename;

        db.prepare(`
            UPDATE products
            SET name = ?, category = ?, price = ?, image = ?, description = ?
            WHERE id = ?
        `).run(
            req.body.name,
            req.body.category,
            Number(req.body.price) || 0,
            image,
            req.body.description || "",
            id
        );

        res.json({ success: true });
    } catch (error) {
        console.error("Update Product Error:", error);
        res.status(500).json({ success: false, message: "Imeshindikana kuhariri bidhaa." });
    }
});

app.delete("/api/products/:id", requireAdmin, (req, res) => {
    db.prepare(`DELETE FROM products WHERE id = ?`).run(req.params.id);
    res.json({ success: true });
});

/* =========================
   ORDERS - Mteja anaweka Oda (Public)
========================= */
app.post("/api/orders", (req, res) => {
    try {
        const { customerName, contact, items, message } = req.body;

        if (!customerName || !contact || !items || !Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ success: false, message: "Tafadhali jaza jina, mawasiliano, na uchague bidhaa kabla ya kutuma oda." });
        }

        const total = items.reduce((sum, it) => sum + (Number(it.price) || 0) * (Number(it.quantity) || 1), 0);
        const now = new Date().toISOString();

        const result = db.prepare(`
            INSERT INTO orders (customer_name, contact, items, total, message, status, created_at)
            VALUES (?, ?, ?, ?, ?, 'Mpya', ?)
        `).run(customerName, contact, JSON.stringify(items), total, message || "", now);

        res.json({ success: true, id: result.lastInsertRowid, total });
    } catch (error) {
        console.error("Create Order Error:", error);
        res.status(500).json({ success: false, message: "Imeshindikana kutuma oda. Jaribu tena." });
    }
});

/* =========================
   ORDERS - Admin (Kuona/Kubadilisha Status/Kufuta)
========================= */
app.get("/api/orders", requireAdmin, (req, res) => {
    const orders = db.prepare(`SELECT * FROM orders ORDER BY created_at DESC`).all();
    const parsed = orders.map(o => ({ ...o, items: JSON.parse(o.items) }));
    res.json(parsed);
});

app.put("/api/orders/:id", requireAdmin, (req, res) => {
    const { status } = req.body;
    db.prepare(`UPDATE orders SET status = ? WHERE id = ?`).run(status, req.params.id);
    res.json({ success: true });
});

app.delete("/api/orders/:id", requireAdmin, (req, res) => {
    db.prepare(`DELETE FROM orders WHERE id = ?`).run(req.params.id);
    res.json({ success: true });
});

app.listen(PORT, () => {
    console.log(`Peace Cosmetics & Vitenge inaendesha kwenye port ${PORT}`);
});
