import express from "express";
import cors from "cors";
import mysql from "mysql2";
import bcrypt from "bcryptjs";

const app = express();

// ---- Hardcoded config ----
const PORT = 5000;

const DB_HOST = "interchange.proxy.rlwy.net";
const DB_USER = "root";
const DB_PASSWORD = "utOMWFDRSosmkVncSRAhHlVWPfMbhbCy";
const DB_NAME = "order_managementnew";
const DB_PORT = 20711;

app.use(cors());
app.use(express.json());

// ------ MySQL Connection ------
const db = mysql
  .createPool({
    host: DB_HOST,
    user: DB_USER,
    password: DB_PASSWORD,
    database: DB_NAME,
    port: DB_PORT,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
  })
  .promise();

db.getConnection()
  .then(() => console.log("✅ MySQL connected"))
  .catch((err) => {
    console.error("❌ MySQL connection failed:", err);
    process.exit(1);
  });

// ------ Register ------
app.post("/register", async (req, res) => {
  const { username, email, password, branch, role } = req.body;
  if (!username || !email || !password || !branch || !role)
    return res.status(400).json({ error: "All fields required" });
  if (!["Admin", "User"].includes(role))
    return res.status(400).json({ error: "Role must be Admin or User" });

  try {
    const hashed = await bcrypt.hash(password, 10);
    await db.query(
      "INSERT INTO users (username, email, password, branch, role) VALUES (?, ?, ?, ?, ?)",
      [username, email, hashed, branch, role]
    );
    res.json({ message: "Registered successfully" });
  } catch (err) {
    console.error(err);
    if (err.code === "ER_DUP_ENTRY")
      return res
        .status(409)
        .json({ error: "Username or email already exists" });
    res.status(500).json({ error: err.message });
  }
});

// ------ Login ------
app.post("/login", async (req, res) => {
  const { username, password, branch, role } = req.body;
  if (!username || !password || !branch || !role)
    return res.status(400).json({ error: "All fields required" });

  try {
    const [rows] = await db.query(
      "SELECT id, username, password, branch, role FROM users WHERE username=? AND branch=? AND role=?",
      [username, branch, role]
    );
    if (!rows.length)
      return res
        .status(401)
        .json({ error: "Invalid credentials or branch/role" });

    const user = rows[0];
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ error: "Invalid credentials" });

    res.json({
      message: "Login successful",
      user: {
        id: user.id,
        username: user.username,
        branch: user.branch,
        role: user.role,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ------ Orders ------
app.post("/orders", async (req, res) => {
  const { customer_name, cart, transaction_id, payment_method } = req.body;
  if (!customer_name || !transaction_id || !payment_method)
    return res.status(400).json({ error: "Missing required fields" });

  const items = Array.isArray(cart)
    ? cart.map((item) => [
        customer_name,
        item.name,
        item.quantity,
        item.price,
        transaction_id,
        payment_method,
      ])
    : [
        [
          customer_name,
          req.body.product_name,
          req.body.quantity,
          req.body.price,
          transaction_id,
          payment_method,
        ],
      ];

  if (items.some((i) => i.includes(undefined)))
    return res.status(400).json({ error: "Cart items missing fields" });

  try {
    const [result] = await db.query(
      `INSERT INTO orders (customer_name, product_name, quantity, price, transaction_id, payment_method) VALUES ?`,
      [items]
    );
    res.json({ message: "Order placed", inserted: result.affectedRows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/orders", async (req, res) => {
  const { customer_name } = req.query;
  const sql = customer_name
    ? "SELECT * FROM orders WHERE customer_name = ?"
    : "SELECT * FROM orders";
  try {
    const [rows] = await db.query(sql, customer_name ? [customer_name] : []);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.put("/orders/:id", async (req, res) => {
  const { status } = req.body;
  if (!status) return res.status(400).json({ error: "Status required" });
  try {
    const [result] = await db.query("UPDATE orders SET status=? WHERE id=?", [
      status,
      req.params.id,
    ]);
    if (!result.affectedRows)
      return res.status(404).json({ error: "Order not found" });
    res.json({ message: "Order updated" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ------ Inventory ------
app.get("/inventory", async (req, res) => {
  try {
    const [rows] = await db.query("SELECT * FROM inventory");
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/inventory", async (req, res) => {
  const { item_name, quantity, supplier_name, price } = req.body;
  if (!item_name || quantity == null || !supplier_name || price == null)
    return res.status(400).json({ error: "All fields required" });
  if (quantity < 0 || price < 0)
    return res.status(400).json({ error: "Must be non-negative" });

  try {
    const [result] = await db.query(
      "INSERT INTO inventory (item_name, quantity, supplier_name, price) VALUES (?, ?, ?, ?)",
      [item_name, quantity, supplier_name, price]
    );
    res.json({ id: result.insertId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.put("/inventory/:id", async (req, res) => {
  const { item_name, quantity, supplier_name, price } = req.body;
  if (!item_name || quantity == null || !supplier_name || price == null)
    return res.status(400).json({ error: "All fields required" });
  if (quantity < 0 || price < 0)
    return res.status(400).json({ error: "Must be non-negative" });

  try {
    const [exists] = await db.query("SELECT id FROM inventory WHERE id=?", [
      req.params.id,
    ]);
    if (!exists.length)
      return res.status(404).json({ error: "Item not found" });

    await db.query(
      "UPDATE inventory SET item_name=?, quantity=?, supplier_name=?, price=? WHERE id=?",
      [item_name, quantity, supplier_name, price, req.params.id]
    );
    res.json({ message: "Inventory updated" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.delete("/inventory/:id", async (req, res) => {
  try {
    const [result] = await db.query("DELETE FROM inventory WHERE id=?", [
      req.params.id,
    ]);
    if (!result.affectedRows)
      return res.status(404).json({ error: "Item not found" });
    res.json({ message: "Inventory deleted" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ------ Inventory Request ------
app.post("/inventory/request", async (req, res) => {
  const { item_id, item_name, quantity, branch } = req.body;
  if (!item_id || !item_name || !quantity || !branch)
    return res.status(400).json({ error: "All fields required" });
  if (quantity <= 0)
    return res.status(400).json({ error: "Quantity must be positive" });

  try {
    const [result] = await db.query(
      "INSERT INTO inventory_requests (item_id, item_name, quantity, branch, request_date) VALUES (?, ?, ?, ?, NOW())",
      [item_id, item_name, quantity, branch]
    );
    res.json({ id: result.insertId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ------ Inventory Transfer ------
app.post("/inventory/transfer", async (req, res) => {
  const { item_id, item_name, quantity, from_branch, to_branch } = req.body;
  if (!item_id || !item_name || !quantity || !from_branch || !to_branch)
    return res.status(400).json({ error: "All fields required" });
  if (quantity <= 0)
    return res.status(400).json({ error: "Quantity must be positive" });
  if (from_branch === to_branch)
    return res.status(400).json({ error: "Branches must differ" });

  try {
    const [result] = await db.query(
      "INSERT INTO inventory_transfers (item_id, item_name, quantity, from_branch, to_branch, transfer_date) VALUES (?, ?, ?, ?, ?, NOW())",
      [item_id, item_name, quantity, from_branch, to_branch]
    );
    res.json({ id: result.insertId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ------ Start ------
app.listen(PORT, "0.0.0.0", () =>
  console.log(`🚀 Server running on http://0.0.0.0:${PORT}`)
);
