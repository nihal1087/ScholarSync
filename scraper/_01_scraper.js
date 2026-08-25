const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");

const projectRoot = path.join(__dirname, "..");
dotenv.config({ path: path.join(projectRoot, ".env"), quiet: true });

const OUTPUT_PATH = path.join(projectRoot, "data", "scholarships.json");
const SEED_PATH = path.join(projectRoot, "data", "seed_scholarships.json");

// Multi-Provider Registry
const buddy4studyProvider = require("./providers/buddy4study");
const govSchemesProvider = require("./providers/gov_schemes");
const seedProvider = require("./providers/seed_provider");

const PROVIDERS = [
  seedProvider,
  govSchemesProvider,
  buddy4studyProvider
];

function loadExistingScholarships(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, "utf8");
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    }
  } catch (err) {}
  return [];
}

function saveScholarships(filePath, items) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(items, null, 2)}\n`, "utf8");
}

// -------------------------------------------------------------
// STEMMED TOKEN FUZZY DEDUPLICATION & RECORD FUSION
// -------------------------------------------------------------
function stemWord(word) {
  return String(word || "")
    .toLowerCase()
    .replace(/(?:ing|ies|es|s|ed|tion|tions)$/, "")
    .trim();
}

function cleanTokenStr(str) {
  return String(str || "")
    .toLowerCase()
    .replace(/(\d{4}[-\s]\d{2,4}|\d{4})/g, "")
    .replace(/\b(scholarship|fellowship|internship|scheme|program|programme|yojna|yojana|for|the|and|of|in|to|by|portal|online|apply|awards?)\b/gi, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function getStemmedTokens(str) {
  return cleanTokenStr(str)
    .split(/\s+/)
    .filter((w) => w.length > 2)
    .map(stemWord)
    .filter(Boolean);
}

function overlapSimilarity(titleA, titleB) {
  const setA = new Set(getStemmedTokens(titleA));
  const setB = new Set(getStemmedTokens(titleB));
  if (setA.size === 0 || setB.size === 0) return 0;

  let intersection = 0;
  for (const token of setA) {
    if (setB.has(token)) intersection += 1;
  }
  const minSize = Math.min(setA.size, setB.size);
  return intersection / minSize;
}

function isDuplicate(itemA, itemB) {
  const urlA = (itemA.url || itemA.apply_link || "").toLowerCase().trim();
  const urlB = (itemB.url || itemB.apply_link || "").toLowerCase().trim();
  if (urlA && urlB && urlA === urlB) return true;

  const overlap = overlapSimilarity(itemA.scholarship_name, itemB.scholarship_name);
  if (overlap >= 0.75) {
    const catA = (itemA.category || "Scholarship").toLowerCase();
    const catB = (itemB.category || "Scholarship").toLowerCase();
    if (catA === catB) return true;
  }

  return false;
}

function fuseRecords(existing, incoming) {
  const isOfficialLink = (url) =>
    url && (url.includes(".gov.in") || url.includes(".nic.in") || url.includes(".edu") || url.includes(".org"));

  // 1. Pick cleanest/official title
  const scholarship_name =
    incoming.scholarship_name && incoming.scholarship_name.length > existing.scholarship_name.length
      ? incoming.scholarship_name
      : existing.scholarship_name;

  // 2. Prioritize official portal apply links
  const apply_link = isOfficialLink(incoming.apply_link)
    ? incoming.apply_link
    : isOfficialLink(existing.apply_link)
    ? existing.apply_link
    : incoming.apply_link || existing.apply_link;

  // 3. Union of educational class levels
  const existingClasses = existing.tags?.class || [];
  const incomingClasses = incoming.tags?.class || [];
  const mergedClasses = [...new Set([...existingClasses, ...incomingClasses])];

  // 4. Tightest matching requirements
  const min_percentage = Math.max(existing.requirements?.min_percentage || 0, incoming.requirements?.min_percentage || 0);
  const max_family_income = Math.min(
    existing.requirements?.max_family_income || 999999999,
    incoming.requirements?.max_family_income || 999999999
  );

  return {
    ...existing,
    ...incoming,
    scholarship_name,
    apply_link,
    tags: {
      state: existing.tags?.state || incoming.tags?.state || "All India",
      gender: existing.tags?.gender !== "All" ? existing.tags?.gender : incoming.tags?.gender || "All",
      class: mergedClasses
    },
    requirements: {
      min_percentage,
      max_family_income
    },
    summary:
      incoming.summary && incoming.summary.length > (existing.summary || "").length
        ? incoming.summary
        : existing.summary || incoming.summary,
    eligibility:
      incoming.eligibility && incoming.eligibility.length > (existing.eligibility || "").length
        ? incoming.eligibility
        : existing.eligibility || incoming.eligibility,
    benefits:
      incoming.benefits && incoming.benefits.length > (existing.benefits || "").length
        ? incoming.benefits
        : existing.benefits || incoming.benefits
  };
}

async function runMultiProviderPipeline() {
  console.log("=================================================================");
  console.log("ScholarSync Multi-Source Scholarship Ingestion Pipeline");
  console.log(`Registered Providers: ${PROVIDERS.map((p) => p.name).join(", ")}`);
  console.log("=================================================================\n");

  const existingScholarships = loadExistingScholarships(OUTPUT_PATH);
  console.log(`Loaded existing catalogue: ${existingScholarships.length} scholarships.\n`);

  const deduplicatedList = [];

  // Helper to insert with fuzzy deduplication and fusion
  function addOrFuse(item) {
    if (!item || !item.scholarship_name) return;
    const existingIndex = deduplicatedList.findIndex((existing) => isDuplicate(existing, item));
    if (existingIndex !== -1) {
      deduplicatedList[existingIndex] = fuseRecords(deduplicatedList[existingIndex], item);
    } else {
      deduplicatedList.push(item);
    }
  }

  // Load existing records into deduplication buffer
  for (const item of existingScholarships) {
    addOrFuse(item);
  }

  // Run all providers in parallel with isolated error boundaries
  console.log("Running all providers in parallel with Promise.allSettled()...\n");
  const providerPromises = PROVIDERS.map(async (provider) => {
    console.log(`[Provider Start] ${provider.name}...`);
    const t0 = Date.now();
    try {
      const records = await provider.fetchScholarships();
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      console.log(`[Provider Success] ${provider.name}: Fetched ${records.length} records in ${elapsed}s.`);
      return { name: provider.name, success: true, records };
    } catch (err) {
      console.error(`[Provider Error] ${provider.name} failed: ${err.message}`);
      return { name: provider.name, success: false, error: err.message, records: [] };
    }
  });

  const providerResults = await Promise.allSettled(providerPromises);

  let successfulProviders = 0;
  let totalIncomingRecords = 0;

  for (const res of providerResults) {
    if (res.status === "fulfilled" && res.value) {
      const { success, records } = res.value;
      if (success) {
        successfulProviders += 1;
        totalIncomingRecords += records.length;
        for (const item of records) {
          addOrFuse(item);
        }
      }
    }
  }

  console.log("\n=================================================================");
  console.log("Ingestion Pipeline Summary & Smart Deduplication Results");
  console.log(`Providers Succeeded: ${successfulProviders}/${PROVIDERS.length}`);
  console.log(`Total Incoming Opportunities: ${totalIncomingRecords}`);
  console.log(`Total Clean Unique Deduplicated Records: ${deduplicatedList.length}`);
  console.log("=================================================================");

  // -----------------------------------------------------------
  // CIRCUIT BREAKER / DATA SAFEGUARD
  // -----------------------------------------------------------
  if (deduplicatedList.length === 0) {
    console.error("\n[CIRCUIT BREAKER TRIGGERED]: All sources returned 0 records.");
    if (fs.existsSync(SEED_PATH)) {
      const seedData = JSON.parse(fs.readFileSync(SEED_PATH, "utf8"));
      saveScholarships(OUTPUT_PATH, seedData);
      console.log(`[Circuit Breaker Recovery]: Restored ${seedData.length} evergreen schemes to ${OUTPUT_PATH}`);
      return;
    } else {
      console.error("[CRITICAL]: Both live ingestion and seed file are unavailable.");
      process.exitCode = 1;
      return;
    }
  }

  // Safe to persist merged deduplicated dataset
  saveScholarships(OUTPUT_PATH, deduplicatedList);
  console.log(`\nSuccessfully saved ${deduplicatedList.length} unique live opportunities to data/scholarships.json\n`);
}

runMultiProviderPipeline();
