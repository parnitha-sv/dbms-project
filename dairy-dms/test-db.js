const { Pool } = require("pg");
const dotenv = require("dotenv");

dotenv.config();

const pool = new Pool({
  host: process.env.DB_HOST || "localhost",
  port: process.env.DB_PORT || 5432,
  user: process.env.DB_USER || "postgres",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "milk_dairy",
});

console.log("Attempting to connect with:");
console.log(`Host: ${process.env.DB_HOST}`);
console.log(`Port: ${process.env.DB_PORT}`);
console.log(`User: ${process.env.DB_USER}`);
console.log(`Database: ${process.env.DB_NAME}`);
console.log(`Password: ${process.env.DB_PASSWORD ? "***set***" : "not set"}`);
console.log("");

pool.query("SELECT NOW()", (err, result) => {
  if (err) {
    console.error("❌ Connection failed:", err.message);
    process.exit(1);
  } else {
    console.log("✅ Connected successfully!");
    console.log("Current time:", result.rows[0]);
    
    // Check if users_cred table exists
    pool.query(
      "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'users_cred')",
      (err, result) => {
        if (err) {
          console.error("Error checking tables:", err.message);
        } else {
          if (result.rows[0].exists) {
            console.log("✅ users_cred table exists");
          } else {
            console.log("❌ users_cred table NOT found - you need to create it");
          }
        }
        pool.end();
      }
    );
  }
});
