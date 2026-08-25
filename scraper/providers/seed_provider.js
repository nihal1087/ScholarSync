const fs = require("fs");
const path = require("path");

const projectRoot = path.join(__dirname, "..", "..");
const SEED_FILE = path.join(projectRoot, "data", "seed_scholarships.json");

async function fetchSeedScholarships() {
  try {
    if (!fs.existsSync(SEED_FILE)) {
      console.log("   [Seed Provider] Notice: seed_scholarships.json not found.");
      return [];
    }
    const raw = fs.readFileSync(SEED_FILE, "utf8");
    const list = JSON.parse(raw);
    if (Array.isArray(list)) {
      console.log(`   [Seed Provider] Loaded ${list.length} evergreen government scholarship(s).`);
      return list;
    }
  } catch (err) {
    console.error(`   [Seed Provider] Error: ${err.message}`);
  }
  return [];
}

module.exports = {
  name: "Evergreen Government Seed Provider",
  fetchScholarships: fetchSeedScholarships
};
