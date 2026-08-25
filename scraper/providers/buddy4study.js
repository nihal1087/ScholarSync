const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");

const projectRoot = path.join(__dirname, "..", "..");
dotenv.config({ path: path.join(projectRoot, ".env"), quiet: true });

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = process.env.GROQ_MODEL || "openai/gpt-oss-120b";
const CONCURRENCY = parseInt(process.env.SCRAPER_CONCURRENCY, 10) || 10;

function stripHtml(html) {
  return String(html || "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function cleanMarkdown(text) {
  return String(text || "")
    .replace(/!\[.*?\]\(.*?\)/g, "")
    .replace(/\n\s*\n/g, "\n")
    .trim();
}

function compactWhitespace(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function getUsefulText(value) {
  const text = compactWhitespace(value);
  const normalized = text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

  if (!text) return "";
  if (["n a", "na", "not specified", "none", "unknown"].includes(normalized)) return "";
  if (normalized.startsWith("details not provided")) return "";
  if (normalized.startsWith("details not specified")) return "";

  return text;
}

function normalizeForSearch(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function truncateAtWord(value, limit) {
  const text = getUsefulText(value);
  if (text.length <= limit) return text;

  const sliced = text.slice(0, limit + 1).trim();
  const lastSpace = sliced.lastIndexOf(" ");
  const trimmed = lastSpace > Math.floor(limit * 0.65) ? sliced.slice(0, lastSpace) : text.slice(0, limit);
  return `${trimmed.replace(/[.,;:\s]+$/, "")}...`;
}

function toInteger(value, fallback) {
  if (Number.isFinite(value)) return Math.round(value);

  const text = compactWhitespace(value).toLowerCase().replace(/,/g, "");
  const match = text.match(/\d+(?:\.\d+)?/);
  if (!match) return fallback;

  const parsed = Number.parseFloat(match[0]);
  if (!Number.isFinite(parsed)) return fallback;

  if (/\b(crore|cr)\b/.test(text)) return Math.round(parsed * 10000000);
  if (/\b(lakh|lac|lacs)\b/.test(text)) return Math.round(parsed * 100000);
  if (/\b(k|thousand)\b/.test(text)) return Math.round(parsed * 1000);

  return Math.round(parsed);
}

function sanitizeLink(value, fallbackUrl) {
  const text = compactWhitespace(value);

  try {
    const url = new URL(text);
    if (["http:", "https:"].includes(url.protocol) && !text.endsWith("#")) {
      return url.href;
    }
  } catch (error) {}

  return fallbackUrl;
}

function normalizeList(value, limit, itemLimit) {
  const list = Array.isArray(value) ? value : value ? [value] : [];
  return list
    .map((item) => truncateAtWord(item, itemLimit))
    .filter(Boolean)
    .slice(0, limit);
}

function normalizeExtractedData(rawData, url) {
  const tags = rawData.tags || {};
  const requirements = rawData.requirements || {};
  const category = ["Scholarship", "Fellowship", "Internship"].includes(rawData.category)
    ? rawData.category
    : "Scholarship";
  const gender = ["Female", "Male", "All"].includes(tags.gender) ? tags.gender : "All";

  return {
    scholarship_name: truncateAtWord(rawData.scholarship_name, 140),
    category,
    tags: {
      state: truncateAtWord(tags.state, 60) || "All India",
      gender,
      class: normalizeList(tags.class, 4, 30)
    },
    requirements: {
      min_percentage: Math.max(0, toInteger(requirements.min_percentage, 0)),
      max_family_income: Math.max(0, toInteger(requirements.max_family_income, 999999999)) || 999999999
    },
    scholarship_amount: truncateAtWord(rawData.scholarship_amount, 120),
    application_deadline: truncateAtWord(rawData.application_deadline, 40),
    provider: truncateAtWord(rawData.provider, 120),
    region: truncateAtWord(rawData.region, 80),
    summary: truncateAtWord(rawData.summary || rawData.about_program, 180),
    eligibility: truncateAtWord(rawData.eligibility, 260),
    benefits: truncateAtWord(rawData.benefits, 220),
    key_points: normalizeList(rawData.key_points, 3, 110),
    apply_link: sanitizeLink(rawData.apply_link, url),
    url
  };
}

function isUsableScholarship(data) {
  if (!data || !data.scholarship_name) return false;
  const name = normalizeForSearch(data.scholarship_name);
  if (["apply now", "search and filter", "view details", "login", "register", "check eligibility"].includes(name)) {
    return false;
  }
  return Boolean(data.apply_link || data.url);
}

function isLiveDeadline(deadlineStr, deadlineDateDiff) {
  if (deadlineDateDiff !== undefined && deadlineDateDiff !== null && Number.isFinite(Number(deadlineDateDiff))) {
    return Number(deadlineDateDiff) >= 0;
  }
  if (!deadlineStr || typeof deadlineStr !== "string") return true;

  const clean = deadlineStr.toLowerCase().trim();
  if (clean.includes("always open") || clean.includes("open") || clean.includes("ongoing")) return true;
  if (clean.includes("closed") || clean.includes("expired") || clean.includes("passed")) return false;

  const parsed = Date.parse(deadlineStr.replace(/-/g, " "));
  if (Number.isFinite(parsed)) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return parsed >= today.getTime();
  }
  return true;
}

const INDIAN_REGIONS = [
  "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chhattisgarh",
  "Delhi", "Goa", "Gujarat", "Haryana", "Himachal Pradesh", "Jharkhand",
  "Karnataka", "Kerala", "Madhya Pradesh", "Maharashtra", "Manipur",
  "Meghalaya", "Mizoram", "Nagaland", "Odisha", "Punjab", "Rajasthan",
  "Sikkim", "Tamil Nadu", "Telangana", "Tripura", "Uttar Pradesh",
  "Uttarakhand", "West Bengal", "Jammu and Kashmir", "Ladakh", "Puducherry", "Chandigarh"
];

function inferCategory(text) {
  const normalized = normalizeForSearch(text);
  if (normalized.includes("internship") || normalized.includes("intern ")) return "Internship";
  if (normalized.includes("fellowship") || normalized.includes("fellow ")) return "Fellowship";
  return "Scholarship";
}

function inferEducationLevels(text) {
  const normalized = normalizeForSearch(text);
  const levels = [];

  if (/\b(class|std|standard)\s*10\b|\b10th\b|\bmatric\b/.test(normalized)) levels.push("Class 10");
  if (/\b(class|std|standard)\s*12\b|\b12th\b|\bhigher secondary\b|\bintermediate\b/.test(normalized)) levels.push("Class 12");
  if (/\bug\b|\bundergraduate\b|\bbachelor\b|\bb tech\b|\bbe\b|\bbsc\b|\bba\b|\bbcom\b/.test(normalized)) levels.push("UG");
  if (/\bpg\b|\bpostgraduate\b|\bpost graduate\b|\bmaster\b|\bm tech\b|\bmba\b|\bmsc\b|\bma\b|\bmcom\b/.test(normalized)) levels.push("PG");
  if (/\bphd\b|\bph d\b|\bdoctoral\b|\bdoctorate\b/.test(normalized)) levels.push("PhD");
  if (/\bdiploma\b/.test(normalized)) levels.push("Diploma");
  if (/\biti\b/.test(normalized)) levels.push("ITI");

  return [...new Set(levels)];
}

function inferGender(text) {
  const normalized = normalizeForSearch(text);
  if (/\b(female|women|woman|girls?|kanya)\b/.test(normalized)) return "Female";
  if (/\b(male|boys?)\b/.test(normalized) && !/\bfemale\b/.test(normalized)) return "Male";
  return "All";
}

function inferState(text, region) {
  const searchable = `${text} ${region}`;
  const normalized = normalizeForSearch(searchable);
  const regionMatch = INDIAN_REGIONS.find((state) => normalized.includes(normalizeForSearch(state)));

  if (regionMatch) return regionMatch;
  if (/\ball india\b|\bnational\b|\bpan india\b|\bindian students\b/.test(normalized)) return "All India";
  if (/\boverseas\b|\binternational\b|\bglobal\b|\bforeign\b/.test(normalized)) return "All";

  return "All India";
}

function parseJsonObject(text) {
  const rawText = String(text || "").trim();
  const fencedText = rawText
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  try {
    return JSON.parse(fencedText);
  } catch (error) {
    return null;
  }
}

// -------------------------------------------------------------
// TIER 1: Native Next.js State & Live Filtering Extraction
// -------------------------------------------------------------
function extractFromNextData(html, url) {
  if (!html || typeof html !== "string") return null;
  const start = html.indexOf('<script id="__NEXT_DATA__"');
  if (start === -1) return null;

  try {
    const jsonStart = html.indexOf(">", start) + 1;
    const jsonEnd = html.indexOf("</script>", jsonStart);
    const parsed = JSON.parse(html.substring(jsonStart, jsonEnd));

    const pageProps = parsed?.props?.pageProps;
    const scholarshipData = pageProps?.scholarship || pageProps?.data;
    if (!scholarshipData) return null;

    const brandScholarships = scholarshipData?.brandPage?.scholarships;
    const items = Array.isArray(brandScholarships) && brandScholarships.length > 0
      ? brandScholarships
      : (scholarshipData?.scholarship ? [scholarshipData.scholarship] : []);

    if (items.length === 0) return null;

    const liveItems = [];

    for (const item of items) {
      if (!isLiveDeadline(item.deadline, item.deadlineDateDiff)) {
        continue;
      }

      const cleanEligibility = stripHtml(item.eligibility || "");
      const cleanBenefits = stripHtml(item.benefits || item.purposeAward || "");
      const title = item.title || scholarshipData?.brandPage?.programName || parsed?.props?.seoData?.title;
      if (!title || /^(apply now|search and filter)$/i.test(title.trim())) continue;

      const combinedText = `${title} ${cleanEligibility} ${cleanBenefits}`;

      liveItems.push(
        normalizeExtractedData(
          {
            scholarship_name: title,
            category: inferCategory(`${title} ${scholarshipData?.oppurtunityType || ""}`),
            tags: {
              state: inferState(combinedText, "All India"),
              gender: inferGender(combinedText),
              class: inferEducationLevels(combinedText)
            },
            requirements: {
              min_percentage: 60,
              max_family_income: 600000
            },
            scholarship_amount: item.purposeAward || "Variable",
            application_deadline: item.deadline || "Open",
            provider: scholarshipData?.brandPage?.name || "Buddy4Study",
            region: "India",
            summary: truncateAtWord(cleanBenefits || cleanEligibility, 180),
            eligibility: truncateAtWord(cleanEligibility, 260),
            benefits: truncateAtWord(cleanBenefits, 220),
            key_points: [item.deadline ? `Apply by ${item.deadline}` : "Check official link for details"],
            apply_link: item.applyLink || url
          },
          url
        )
      );
    }

    return {
      hasBrandData: true,
      totalFound: items.length,
      liveItems
    };
  } catch (err) {
    return null;
  }
}

// -------------------------------------------------------------
// TIER 2: Groq AI Extraction
// -------------------------------------------------------------
async function extractWithGroq(markdownText, url) {
  if (!GROQ_API_KEY) return null;

  const cleanedText = cleanMarkdown(markdownText);
  const prompt = `
Extract this Buddy4Study scholarship detail page into structured JSON.
Schema:
{
  "scholarship_name": "Full official scholarship name",
  "category": "Scholarship" | "Fellowship" | "Internship",
  "tags": { "state": "All India", "gender": "All", "class": ["UG"] },
  "requirements": { "min_percentage": 0, "max_family_income": 999999999 },
  "scholarship_amount": "Amount",
  "application_deadline": "DD-MMM-YYYY or Open",
  "provider": "Offering organization",
  "region": "India",
  "summary": "Short overview (<= 180 chars)",
  "eligibility": "Eligibility requirements (<= 260 chars)",
  "benefits": "Benefits summary (<= 220 chars)",
  "key_points": ["Point 1"],
  "apply_link": "${url}"
}
Never use button text ("Apply Now") as name. Return valid JSON only.

PAGE TEXT:
${cleanedText.slice(0, 8000)}
  `;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      signal: controller.signal,
      method: "POST",
      headers: {
        "Authorization": `Bearer ${GROQ_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [
          { role: "system", content: "You are a precise scholarship extraction assistant. Return valid JSON only matching schema." },
          { role: "user", content: prompt }
        ],
        response_format: { type: "json_object" },
        temperature: 0,
        max_tokens: 1800
      })
    });

    clearTimeout(timeoutId);
    if (!response.ok) return null;

    const json = await response.json();
    const rawContent = json.choices?.[0]?.message?.content?.trim();
    const parsed = parseJsonObject(rawContent);
    if (!parsed) return null;

    return normalizeExtractedData(parsed, url);
  } catch (err) {
    return null;
  }
}

// -------------------------------------------------------------
// SITEMAP & LINK DISCOVERY
// -------------------------------------------------------------
function isValidScholarshipUrl(url) {
  if (!url || typeof url !== "string") return false;
  try {
    const parsed = new URL(url);
    if (!parsed.hostname.includes("buddy4study.com")) return false;
    const pathname = parsed.pathname.replace(/\/+$/, "");
    if (!pathname.startsWith("/scholarship/")) return false;
    const slug = pathname.replace("/scholarship/", "").trim();
    if (!slug || slug === "scholarships" || slug.includes("?")) return false;
    if (
      pathname.includes("/qna") ||
      pathname.includes("/result") ||
      pathname.includes("/faq") ||
      pathname.includes("/application") ||
      pathname.includes("/login") ||
      pathname.includes("/register") ||
      pathname.includes("/terms-and-conditions") ||
      pathname.includes("/privacy-policy")
    ) {
      return false;
    }
    if (["all", "featured", "login", "register", "terms-and-conditions", "privacy-policy"].includes(slug.toLowerCase())) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

async function discoverScholarshipLinks() {
  const rawItems = [];
  try {
    const sitemapIndexRes = await fetch("https://www.buddy4study.com/sitemap.xml", {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; ScholarSync/1.0)" }
    });

    if (sitemapIndexRes.ok) {
      const sitemapIndexText = await sitemapIndexRes.text();
      const subSitemaps = [
        ...sitemapIndexText.matchAll(/<loc>(https:\/\/www\.buddy4study\.com\/sitemap\d+\.xml)<\/loc>/g)
      ].map((m) => m[1]);

      const sitemapPromises = subSitemaps.map(async (subSitemapUrl) => {
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 8000);
          const subRes = await fetch(subSitemapUrl, {
            signal: controller.signal,
            headers: { "User-Agent": "Mozilla/5.0 (compatible; ScholarSync/1.0)" }
          });
          clearTimeout(timeoutId);
          if (!subRes.ok) return [];

          const subText = await subRes.text();
          const urlBlocks = subText.match(/<url>[\s\S]*?<\/url>/g) || [];
          const extracted = [];

          for (const block of urlBlocks) {
            const loc = (block.match(/<loc>(.*?)<\/loc>/) || [])[1];
            const lastmod = (block.match(/<lastmod>(.*?)<\/lastmod>/) || [])[1] || "";
            if (loc && isValidScholarshipUrl(loc)) {
              extracted.push({
                url: loc.split("?")[0].split("#")[0].trim(),
                lastmod
              });
            }
          }
          return extracted;
        } catch (subErr) {
          return [];
        }
      });

      const sitemapResults = await Promise.all(sitemapPromises);
      for (const list of sitemapResults) {
        rawItems.push(...list);
      }
    }
  } catch (err) {}

  rawItems.sort((a, b) => (b.lastmod || "").localeCompare(a.lastmod || ""));

  const uniqueLinks = [];
  const seen = new Set();
  for (const item of rawItems) {
    if (!seen.has(item.url)) {
      seen.add(item.url);
      uniqueLinks.push(item.url);
    }
  }

  const limitEnv = process.env.SCRAPE_LIMIT;
  const limit = limitEnv && parseInt(limitEnv, 10) > 0 ? parseInt(limitEnv, 10) : 500;
  console.log(`   [Buddy4Study Provider] Discovered ${uniqueLinks.length} unique opportunities in sitemaps. Crawling top: ${limit}.`);
  return uniqueLinks.slice(0, limit);
}

// Extract a single link with timeout
async function processSingleLink(link, index, total) {
  const slug = link.split("/").pop();
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    const res = await fetch(link, {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" }
    });
    clearTimeout(timeoutId);

    if (!res.ok) {
      console.log(`   [${index}/${total}] ${slug} -> HTTP ${res.status}`);
      return [];
    }

    const html = await res.text();

    // Tier 1: Next.js Native State
    const tier1 = extractFromNextData(html, link);
    if (tier1 && tier1.hasBrandData) {
      if (tier1.liveItems.length > 0) {
        console.log(`   [${index}/${total}] ${slug} -> Extracted ${tier1.liveItems.length} LIVE program(s).`);
        return tier1.liveItems;
      } else {
        console.log(`   [${index}/${total}] ${slug} -> Closed/expired (skipped).`);
        return [];
      }
    }

    // Tier 2: Groq AI Extraction
    if (GROQ_API_KEY) {
      const groqData = await extractWithGroq(stripHtml(html), link);
      if (groqData && isUsableScholarship(groqData) && isLiveDeadline(groqData.application_deadline)) {
        console.log(`   [${index}/${total}] ${slug} -> Extracted 1 LIVE program via Groq AI.`);
        return [groqData];
      }
    }

    console.log(`   [${index}/${total}] ${slug} -> Closed/expired (skipped).`);
    return [];
  } catch (err) {
    console.log(`   [${index}/${total}] ${slug} -> Notice: ${err.message}`);
    return [];
  }
}

async function fetchScholarships() {
  console.log("   [Buddy4Study Provider] Querying sitemap index for live opportunities...");
  const links = await discoverScholarshipLinks();
  console.log(`   [Buddy4Study Provider] Discovered ${links.length} scholarship targets.`);
  console.log(`   [Buddy4Study Provider] Ingesting with concurrency ${CONCURRENCY}...\n`);

  const liveScholarships = [];

  for (let i = 0; i < links.length; i += CONCURRENCY) {
    const chunk = links.slice(i, i + CONCURRENCY);
    const chunkPromises = chunk.map((url, cIdx) => processSingleLink(url, i + cIdx + 1, links.length));
    const chunkResults = await Promise.all(chunkPromises);
    for (const res of chunkResults) {
      liveScholarships.push(...res);
    }
  }

  console.log(`\n   [Buddy4Study Provider] Completed. Extracted ${liveScholarships.length} live scholarship(s).`);
  return liveScholarships;
}

module.exports = {
  name: "Buddy4Study Live Scraper Provider",
  fetchScholarships
};
