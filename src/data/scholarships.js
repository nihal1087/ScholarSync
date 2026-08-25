const fs = require("fs");
const path = require("path");
const config = require("../config");

const SEED_PATH = path.join(__dirname, "..", "..", "data", "seed_scholarships.json");

let scholarships = [];

function load() {
  try {
    if (fs.existsSync(config.dataPath)) {
      const rawData = fs.readFileSync(config.dataPath, "utf8");
      const parsed = JSON.parse(rawData);
      if (Array.isArray(parsed) && parsed.length > 0) {
        scholarships = parsed;
        console.log(`Database loaded: ${scholarships.length} scholarships from ${config.dataPath}.`);
        return;
      }
    }
  } catch (error) {
    console.warn(`Notice: could not load primary data file (${error.message}). Checking seed fallback...`);
  }

  // Graceful fallback to evergreen seed database
  try {
    if (fs.existsSync(SEED_PATH)) {
      const seedRaw = fs.readFileSync(SEED_PATH, "utf8");
      const seedParsed = JSON.parse(seedRaw);
      if (Array.isArray(seedParsed) && seedParsed.length > 0) {
        scholarships = seedParsed;
        console.log(`[Seed Fallback Active]: Loaded ${scholarships.length} evergreen government scholarships from ${SEED_PATH}.`);
        return;
      }
    }
  } catch (seedErr) {
    console.error(`Error: could not load fallback seed database: ${seedErr.message}`);
  }

  scholarships = [];
}

function getAll() {
  return scholarships;
}

function getCount() {
  return scholarships.length;
}

load();

module.exports = { load, getAll, getCount };
