const { MongoClient } = require("mongodb");

const uri = "mongodb://127.0.0.1:27017";
let db;

async function connectDB() {
  if (!db) {
    const client = new MongoClient(uri);
    await client.connect();
    db = client.db("dms");
    console.log("✅ MongoDB connected");
  }
  return db;
}

module.exports = { connectDB };
