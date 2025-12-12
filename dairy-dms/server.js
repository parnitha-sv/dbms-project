const express = require("express");
const session = require("express-session");
const path = require("path");
const { Pool } = require("pg");
const bcrypt = require("bcrypt");
const dotenv = require("dotenv");

dotenv.config(); // load .env for DB config

const app = express();

// ============ DB CONNECTION ============
const pool = new Pool({
  host: process.env.DB_HOST || "localhost",
  port: process.env.DB_PORT || 5432,
  user: process.env.DB_USER || "postgres",
  password: process.env.DB_PASSWORD || "", // set in .env
  database: process.env.DB_NAME || "milk_dairy",
});

// ============ APP SETUP ============
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

app.use(express.urlencoded({ extended: true }));

// static files (CSS, images, etc.)
app.use(express.static(path.join(__dirname, "public")));

// session setup (secret is hardcoded, not from .env)
app.use(
  session({
    secret: "dairy_inventory_secret",
    resave: false,
    saveUninitialized: false,
  })
);

// ============ MIDDLEWARE ============
function requireLogin(req, res, next) {
  if (!req.session.user) {
    return res.redirect("/login");
  }
  next();
}

// ============ ROUTES ============

// root → redirect based on login
app.get("/", (req, res) => {
  if (req.session.user) return res.redirect("/dashboard");
  res.redirect("/login");
});

// ---------- SIGNUP ----------

// signup page
app.get("/signup", (req, res) => {
  res.render("signup", { error: null });
});

// signup submit
app.post("/signup", async (req, res) => {
  const { full_name, username, password } = req.body;

  if (!full_name || !username || !password) {
    return res.render("signup", { error: "All fields are required" });
  }

  try {
    const hash = await bcrypt.hash(password, 10);

    await pool.query(
      "INSERT INTO users_cred (full_name, username, password_hash) VALUES ($1, $2, $3)",
      [full_name, username, hash]
    );

    res.redirect("/login");
  } catch (err) {
    console.error("Signup error:", err.message);
    let msg = "Something went wrong";

    // unique username error
    if (err.message.includes("users_cred_username_key")) {
      msg = "Username already exists";
    }

    res.render("signup", { error: msg });
  }
});

// ---------- LOGIN ----------

// login page
app.get("/login", (req, res) => {
  res.render("login", { error: null });
});

// login submit
app.post("/login", async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.render("login", { error: "Please enter username and password" });
  }

  try {
    const result = await pool.query(
      "SELECT * FROM users_cred WHERE username = $1",
      [username]
    );

    if (result.rows.length === 0) {
      return res.render("login", { error: "User not found" });
    }

    const user = result.rows[0];
    const match = await bcrypt.compare(password, user.password_hash);

    if (!match) {
      return res.render("login", { error: "Invalid password" });
    }

    // store minimal user info in session
    req.session.user = {
      user_id: user.user_id,
      full_name: user.full_name,
      username: user.username,
    };

    res.redirect("/dashboard");
  } catch (err) {
    console.error("Login error:", err.message);
    res.render("login", { error: "Something went wrong" });
  }
});

// ---------- LOGOUT ----------
app.get("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/login");
  });
});

// ---------- DASHBOARD ----------
app.get("/dashboard", requireLogin, async (req, res) => {
  try {
    // total farmers
    const farmersCountResult = await pool.query(
      "SELECT COUNT(*) AS total_farmers FROM farmers"
    );
    const totalFarmers = Number(farmersCountResult.rows[0].total_farmers);

    // today's milk (sum of quantity_liters for current date)
    const todayMilkResult = await pool.query(
      "SELECT COALESCE(SUM(quantity_liters), 0) AS today_milk FROM milk_collections WHERE collection_date = CURRENT_DATE"
    );
    const todayMilk = Number(todayMilkResult.rows[0].today_milk);

    // today's amount: sum(quantity_liters * rate_per_liter)
    const todayAmountResult = await pool.query(
      `
      SELECT COALESCE(SUM(quantity_liters * rate_per_liter), 0) AS today_amount
      FROM milk_collections
      WHERE collection_date = CURRENT_DATE
      `
    );
    const todayAmount = Number(todayAmountResult.rows[0].today_amount);

    // total milk available (all time)
    const totalMilkAvailableResult = await pool.query(
      "SELECT COALESCE(SUM(quantity_liters), 0) AS total_milk_available FROM milk_collections"
    );
    let milkAvailable = Number(
      totalMilkAvailableResult.rows[0].total_milk_available
    );
    if (isNaN(milkAvailable)) milkAvailable = 0;

    // pending payments (status not equal to 'paid')
    const pendingPaymentsResult = await pool.query(
      "SELECT COUNT(*) AS pending_count FROM payments WHERE status <> 'paid'"
    );
    const pendingPayments = Number(pendingPaymentsResult.rows[0].pending_count);

    res.render("dashboard", {
      user: req.session.user,
      totalFarmers,
      todayMilk,
      todayAmount,
      pendingPayments,
      milkAvailable, // 👈 passed to EJS
    });
  } catch (err) {
    console.error("Dashboard stats error:", err.message);
    // fallback values if any query fails
    res.render("dashboard", {
      user: req.session.user,
      totalFarmers: 0,
      todayMilk: 0,
      todayAmount: 0,
      pendingPayments: 0,
      milkAvailable: 0,
    });
  }
});

// ---------- FARMERS PAGE ----------
app.get("/farmers", requireLogin, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT farmer_id, name, village, phone FROM farmers ORDER BY farmer_id DESC"
    );

    res.render("farmers", {
      user: req.session.user,
      farmers: result.rows,
      message: null,
      error: null,
    });
  } catch (err) {
    console.error("Farmers page error:", err.message);
    res.render("farmers", {
      user: req.session.user,
      farmers: [],
      message: null,
      error: "Could not load farmers",
    });
  }
});

// add farmer (POST)
app.post("/farmers", requireLogin, async (req, res) => {
  const { name, village, phone } = req.body;

  if (!name) {
    const result = await pool.query(
      "SELECT farmer_id, name, village, phone FROM farmers ORDER BY farmer_id DESC"
    );
    return res.render("farmers", {
      user: req.session.user,
      farmers: result.rows,
      message: null,
      error: "Farmer name is required",
    });
  }

  try {
    await pool.query(
      "INSERT INTO farmers (name, village, phone) VALUES ($1, $2, $3)",
      [name, village || null, phone || null]
    );

    const result = await pool.query(
      "SELECT farmer_id, name, village, phone FROM farmers ORDER BY farmer_id DESC"
    );

    res.render("farmers", {
      user: req.session.user,
      farmers: result.rows,
      message: "Farmer added successfully",
      error: null,
    });
  } catch (err) {
    console.error("Add farmer error:", err.message);
    const result = await pool.query(
      "SELECT farmer_id, name, village, phone FROM farmers ORDER BY farmer_id DESC"
    );
    res.render("farmers", {
      user: req.session.user,
      farmers: result.rows,
      message: null,
      error: "Could not add farmer",
    });
  }
});

// ---------- MILK COLLECTION PAGE ----------
app.get("/milk", requireLogin, async (req, res) => {
  try {
    const farmersResult = await pool.query(
      "SELECT farmer_id, name FROM farmers WHERE is_active = TRUE ORDER BY name"
    );

    const milkResult = await pool.query(
      `
      SELECT 
        mc.collection_id,
        to_char(mc.collection_date, 'YYYY-MM-DD') AS collection_date,
        mc.session,
        mc.milk_type,
        mc.quantity_liters,
        mc.rate_per_liter,
        (mc.quantity_liters * mc.rate_per_liter) AS amount,
        f.name AS farmer_name
      FROM milk_collections mc
      JOIN farmers f ON mc.farmer_id = f.farmer_id
      ORDER BY mc.collection_date DESC, mc.collection_id DESC
      LIMIT 50
      `
    );

    res.render("milk", {
      user: req.session.user,
      farmers: farmersResult.rows,
      collections: milkResult.rows,
      message: null,
      error: null,
    });
  } catch (err) {
    console.error("Milk page error:", err.message);
    res.render("milk", {
      user: req.session.user,
      farmers: [],
      collections: [],
      message: null,
      error: "Could not load milk records",
    });
  }
});

// add milk collection (POST)
app.post("/milk", requireLogin, async (req, res) => {
  const {
    farmer_id,
    collection_date,
    session: milkSession,
    milk_type,
    quantity_liters,
    fat_percentage,
    rate_per_liter,
  } = req.body;

  if (
    !farmer_id ||
    !collection_date ||
    !milkSession ||
    !milk_type ||
    !quantity_liters ||
    !rate_per_liter
  ) {
    const farmersResult = await pool.query(
      "SELECT farmer_id, name FROM farmers WHERE is_active = TRUE ORDER BY name"
    );
    const milkResult = await pool.query(
      `
      SELECT 
        mc.collection_id,
        to_char(mc.collection_date, 'YYYY-MM-DD') AS collection_date,
        mc.session,
        mc.milk_type,
        mc.quantity_liters,
        mc.rate_per_liter,
        (mc.quantity_liters * mc.rate_per_liter) AS amount,
        f.name AS farmer_name
      FROM milk_collections mc
      JOIN farmers f ON mc.farmer_id = f.farmer_id
      ORDER BY mc.collection_date DESC, mc.collection_id DESC
      LIMIT 50
      `
    );
    return res.render("milk", {
      user: req.session.user,
      farmers: farmersResult.rows,
      collections: milkResult.rows,
      message: null,
      error: "All fields except fat are required (including rate per liter)",
    });
  }

  try {
    await pool.query(
      `INSERT INTO milk_collections 
       (farmer_id, collection_date, session, milk_type, quantity_liters, fat_percentage, rate_per_liter)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        farmer_id,
        collection_date,
        milkSession,
        milk_type,
        quantity_liters,
        fat_percentage || null,
        rate_per_liter,
      ]
    );

    const farmersResult = await pool.query(
      "SELECT farmer_id, name FROM farmers WHERE is_active = TRUE ORDER BY name"
    );
    const milkResult = await pool.query(
      `
      SELECT 
        mc.collection_id,
        to_char(mc.collection_date, 'YYYY-MM-DD') AS collection_date,
        mc.session,
        mc.milk_type,
        mc.quantity_liters,
        mc.rate_per_liter,
        (mc.quantity_liters * mc.rate_per_liter) AS amount,
        f.name AS farmer_name
      FROM milk_collections mc
      JOIN farmers f ON mc.farmer_id = f.farmer_id
      ORDER BY mc.collection_date DESC, mc.collection_id DESC
      LIMIT 50
      `
    );

    res.render("milk", {
      user: req.session.user,
      farmers: farmersResult.rows,
      collections: milkResult.rows,
      message: "Milk entry added successfully",
      error: null,
    });
  } catch (err) {
    console.error("Add milk error:", err.message);
    const farmersResult = await pool.query(
      "SELECT farmer_id, name FROM farmers WHERE is_active = TRUE ORDER BY name"
    );
    const milkResult = await pool.query(
      `
      SELECT 
        mc.collection_id,
        to_char(mc.collection_date, 'YYYY-MM-DD') AS collection_date,
        mc.session,
        mc.milk_type,
        mc.quantity_liters,
        mc.rate_per_liter,
        (mc.quantity_liters * mc.rate_per_liter) AS amount,
        f.name AS farmer_name
      FROM milk_collections mc
      JOIN farmers f ON mc.farmer_id = f.farmer_id
      ORDER BY mc.collection_date DESC, mc.collection_id DESC
      LIMIT 50
      `
    );
    res.render("milk", {
      user: req.session.user,
      farmers: farmersResult.rows,
      collections: milkResult.rows,
      message: null,
      error: "Could not add milk entry",
    });
  }
});

// ---------- PAYMENTS PAGE (Pending payment summary per farmer) ----------

// GET: show empty form
app.get("/payments", requireLogin, async (req, res) => {
  res.render("payments", {
    user: req.session.user,
    statement: null,
    error: null,
  });
});

// POST: generate pending payment summary for a farmer (all dates)
app.post("/payments", requireLogin, async (req, res) => {
  const { name, village } = req.body;

  if (!name || !village) {
    return res.render("payments", {
      user: req.session.user,
      statement: null,
      error: "Please enter farmer name and village",
    });
  }

  try {
    const result = await pool.query(
      `
      SELECT 
        f.name,
        f.village,
        mc.milk_type,
        SUM(mc.quantity_liters) AS total_liters,
        AVG(mc.rate_per_liter) AS rate_per_liter,
        SUM(mc.quantity_liters * mc.rate_per_liter) AS amount
      FROM milk_collections mc
      JOIN farmers f ON mc.farmer_id = f.farmer_id
      WHERE f.name = $1
        AND f.village = $2
      GROUP BY 
        f.name,
        f.village,
        mc.milk_type
      ORDER BY mc.milk_type;
      `,
      [name, village]
    );

    if (result.rows.length === 0) {
      return res.render("payments", {
        user: req.session.user,
        statement: null,
        error: "No milk records found for this farmer",
      });
    }

    let totalLitersNum = 0;
    let totalAmountNum = 0;

    const items = result.rows.map((row) => {
      const liters = Number(row.total_liters || 0);
      const rate = Number(row.rate_per_liter || 0);
      const amount = Number(row.amount || 0);

      totalLitersNum += liters;
      totalAmountNum += amount;

      return {
        ...row,
        total_liters: liters.toFixed(2),
        rate_per_liter: rate.toFixed(2),
        amount: amount.toFixed(2),
      };
    });

    const statement = {
      farmerName: result.rows[0].name,
      village: result.rows[0].village,
      items,
      totalLiters: totalLitersNum.toFixed(2),
      totalAmount: totalAmountNum.toFixed(2),
    };

    res.render("payments", {
      user: req.session.user,
      statement,
      error: null,
    });
  } catch (err) {
    console.error("Payment summary error:", err.message);
    res.render("payments", {
      user: req.session.user,
      statement: null,
      error: "Error calculating pending payment",
    });
  }
});

// ---------- REPORTS PAGE (Daily collection with amount & type) ----------

// GET: show empty form
app.get("/reports", requireLogin, async (req, res) => {
  res.render("reports", {
    user: req.session.user,
    daily: null,
    error: null,
  });
});

// POST: generate daily report for given farmer, village & date
app.post("/reports", requireLogin, async (req, res) => {
  const { name, village, date } = req.body;

  if (!name || !village || !date) {
    return res.render("reports", {
      user: req.session.user,
      daily: null,
      error: "Please enter farmer name, village and date",
    });
  }

  try {
    const result = await pool.query(
      `
      SELECT 
        f.name,
        f.village,
        to_char(mc.collection_date, 'YYYY-MM-DD') AS collection_date,
        mc.milk_type,
        SUM(mc.quantity_liters) AS total_liters,
        AVG(mc.rate_per_liter) AS rate_per_liter,
        SUM(mc.quantity_liters * mc.rate_per_liter) AS amount
      FROM milk_collections mc
      JOIN farmers f ON mc.farmer_id = f.farmer_id
      WHERE f.name = $1
        AND f.village = $2
        AND mc.collection_date = $3
      GROUP BY 
        f.name,
        f.village,
        collection_date,
        mc.milk_type
      ORDER BY mc.milk_type;
      `,
      [name, village, date]
    );

    if (result.rows.length === 0) {
      return res.render("reports", {
        user: req.session.user,
        daily: null,
        error: "No milk records found for this farmer and date",
      });
    }

    let totalLitersNum = 0;
    let totalAmountNum = 0;

    const rowsFormatted = result.rows.map((row) => {
      const liters = Number(row.total_liters || 0);
      const rate = Number(row.rate_per_liter || 0);
      const amount = Number(row.amount || 0);

      totalLitersNum += liters;
      totalAmountNum += amount;

      return {
        ...row,
        total_liters: liters.toFixed(2),
        rate_per_liter: rate.toFixed(2),
        amount: amount.toFixed(2),
      };
    });

    const daily = {
      farmerName: result.rows[0].name,
      village: result.rows[0].village,
      date: result.rows[0].collection_date, // 'YYYY-MM-DD'
      rows: rowsFormatted,
      totalLiters: totalLitersNum.toFixed(2),
      totalAmount: totalAmountNum.toFixed(2),
    };

    res.render("reports", {
      user: req.session.user,
      daily,
      error: null,
    });
  } catch (err) {
    console.error("Daily report error:", err.message);
    res.render("reports", {
      user: req.session.user,
      daily: null,
      error: "Error generating report",
    });
  }
});

// ============ SERVER START ============
const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Dairy Inventory running at http://localhost:${PORT}`);
});
