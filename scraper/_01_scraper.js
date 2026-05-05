const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");
const FirecrawlModule = require("firecrawl");
const { InferenceClient } = require("@huggingface/inference");

const projectRoot = path.join(__dirname, "..");
dotenv.config({ path: path.join(projectRoot, ".env"), quiet: true });

const Firecrawl = FirecrawlModule.default || FirecrawlModule.Firecrawl || FirecrawlModule;

const FIRECRAWL_KEY = process.env.FIRECRAWL_API_KEY;
const HF_TOKEN = process.env.HF_TOKEN;
const DEFAULT_AI_MODEL = "openai/gpt-oss-120b";
const AI_MODEL = process.env.AI_MODEL || DEFAULT_AI_MODEL;
const BASE_URL = "https://www.buddy4study.com/scholarships";
const OUTPUT_PATH = path.join(projectRoot, "data", "scholarships.json");
const EXTRACTION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "scholarship_name",
    "category",
    "tags",
    "requirements",
    "scholarship_amount",
    "application_deadline",
    "provider",
    "region",
    "summary",
    "eligibility",
    "benefits",
    "key_points",
    "apply_link"
  ],
  properties: {
    scholarship_name: { type: "string" },
    category: { type: "string", enum: ["Scholarship", "Fellowship", "Internship"] },
    tags: {
      type: "object",
      additionalProperties: false,
      required: ["state", "gender", "class"],
      properties: {
        state: { type: "string" },
        gender: { type: "string", enum: ["Female", "Male", "All"] },
        class: {
          type: "array",
          items: { type: "string" }
        }
      }
    },
    requirements: {
      type: "object",
      additionalProperties: false,
      required: ["min_percentage", "max_family_income"],
      properties: {
        min_percentage: { type: "integer" },
        max_family_income: { type: "integer" }
      }
    },
    scholarship_amount: { type: "string" },
    application_deadline: { type: "string" },
    provider: { type: "string" },
    region: { type: "string" },
    summary: { type: "string" },
    eligibility: { type: "string" },
    benefits: { type: "string" },
    key_points: {
      type: "array",
      items: { type: "string" }
    },
    apply_link: { type: "string" }
  }
};

const app = new Firecrawl({ apiKey: FIRECRAWL_KEY });
const client = new InferenceClient(HF_TOKEN);
let aiExtractionDisabled = !HF_TOKEN;

function cleanMarkdown(text) {
  return String(text || "")
    .replace(/!\[.*?\]\(.*?\)/g, "")
    .replace(/\n\s*\n/g, "\n")
    .trim();
}

function getMarkdown(document) {
  if (!document) return "";
  if (typeof document.markdown === "string") return document.markdown;
  if (document.data && typeof document.data.markdown === "string") return document.data.markdown;
  return "";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

function stripMarkdown(value) {
  return compactWhitespace(value)
    .replace(/!\[[^\]]*]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s*/, "")
    .replace(/^[-*+]\s*/, "")
    .replace(/^\d+[.)]\s*/, "")
    .replace(/[*_`~|]/g, "")
    .replace(/<[^>]+>/g, "")
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
  } catch (error) {
    // Fall back to the Buddy4Study detail page below.
  }

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
  return Boolean(data && data.scholarship_name && (data.apply_link || data.url));
}

const SECTION_HEADINGS = [
  "about the program",
  "about program",
  "eligibility",
  "benefits",
  "documents",
  "how can you apply",
  "how to apply",
  "important dates",
  "selection criteria",
  "terms and conditions",
  "contact details",
  "faq",
  "faqs"
];

const INDIAN_REGIONS = [
  "Andhra Pradesh",
  "Arunachal Pradesh",
  "Assam",
  "Bihar",
  "Chhattisgarh",
  "Delhi",
  "Goa",
  "Gujarat",
  "Haryana",
  "Himachal Pradesh",
  "Jharkhand",
  "Karnataka",
  "Kerala",
  "Madhya Pradesh",
  "Maharashtra",
  "Manipur",
  "Meghalaya",
  "Mizoram",
  "Nagaland",
  "Odisha",
  "Punjab",
  "Rajasthan",
  "Sikkim",
  "Tamil Nadu",
  "Telangana",
  "Tripura",
  "Uttar Pradesh",
  "Uttarakhand",
  "West Bengal",
  "Jammu and Kashmir",
  "Ladakh",
  "Puducherry",
  "Chandigarh"
];

function isLikelySectionHeading(line) {
  const normalized = normalizeForSearch(line);
  return SECTION_HEADINGS.some((heading) => normalized === heading || normalized.startsWith(`${heading} `));
}

function getCleanLines(markdownText) {
  return String(markdownText || "")
    .split(/\r?\n/)
    .map(stripMarkdown)
    .filter(Boolean)
    .filter((line) => !/^(login|register|search|home|scholarships|featured scholarships)$/i.test(line));
}

function getTitle(markdownText, lines, url) {
  const heading = String(markdownText || "")
    .split(/\r?\n/)
    .map((line) => {
      const match = line.match(/^#\s+(.+)/);
      return match ? stripMarkdown(match[1]) : "";
    })
    .find((line) => line && !/scholarships?\s*$/i.test(line));

  if (heading) return heading;

  const titleLine = lines.find((line) => {
    const normalized = normalizeForSearch(line);
    return normalized && !isLikelySectionHeading(line) && !normalized.includes("buddy4study");
  });

  if (titleLine) return titleLine;

  const slug = url.split("/").filter(Boolean).pop() || "";
  return slug
    .replace(/-\d{4}(?:-\d{2})?$/, "")
    .replace(/-/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function getNextUsefulLine(lines, startIndex) {
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line || isLikelySectionHeading(line)) continue;
    if (/^(apply now|view details|read more)$/i.test(line)) continue;
    return line;
  }

  return "";
}

function extractLabeledValue(lines, labels) {
  const normalizedLabels = labels.map(normalizeForSearch);

  for (const [index, line] of lines.entries()) {
    const normalizedLine = normalizeForSearch(line);

    for (const [labelIndex, label] of normalizedLabels.entries()) {
      if (normalizedLine === label) {
        return getNextUsefulLine(lines, index);
      }

      const inlineMatch = line.match(new RegExp(`^${labels[labelIndex]}\\s*[:|-]\\s*(.+)$`, "i"));
      if (inlineMatch) return inlineMatch[1];

      if (normalizedLine.startsWith(`${label} `)) {
        return line.slice(labels[labelIndex].length).replace(/^[:\s-]+/, "");
      }
    }
  }

  return "";
}

function extractSection(markdownText, headings, limit) {
  const normalizedHeadings = headings.map(normalizeForSearch);
  const rawLines = String(markdownText || "").split(/\r?\n/);
  const sectionLines = [];
  let capturing = false;

  for (const rawLine of rawLines) {
    const line = stripMarkdown(rawLine);
    if (!line) continue;

    const normalized = normalizeForSearch(line);
    const startsSection = normalizedHeadings.some((heading) => normalized === heading || normalized.startsWith(`${heading} `));

    if (startsSection) {
      capturing = true;
      const remainder = normalizedHeadings.reduce((value, heading) => {
        if (normalizeForSearch(value).startsWith(`${heading} `)) {
          return value.slice(heading.length).replace(/^[:\s-]+/, "");
        }

        return value;
      }, line);

      if (remainder && !normalizedHeadings.includes(normalizeForSearch(remainder))) {
        sectionLines.push(remainder);
      }

      continue;
    }

    if (capturing && (rawLine.match(/^#{1,6}\s+/) || isLikelySectionHeading(line))) {
      break;
    }

    if (capturing && !/^(apply now|click here|login|register)$/i.test(line)) {
      sectionLines.push(line);
    }
  }

  return truncateAtWord(sectionLines.join(" "), limit);
}

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

function extractDeadline(lines, text) {
  const labeled = extractLabeledValue(lines, ["Application Deadline", "Deadline", "Last Date", "Last date to apply"]);
  if (labeled) return labeled;

  const dateMatch = text.match(/\b\d{1,2}[-/\s](?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*[-/,\s]\d{4}\b/i)
    || text.match(/\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{4}\b/i)
    || text.match(/\b\d{1,2}[-/]\d{1,2}[-/]\d{2,4}\b/);

  return dateMatch ? dateMatch[0] : "";
}

function extractAmount(lines, text, benefits) {
  const labeled = extractLabeledValue(lines, ["Award", "Awards", "Reward", "Rewards", "Scholarship Amount", "Amount"]);
  if (labeled) return labeled;

  const moneyMatch = text.match(/(?:Rs\.?|INR|₹)\s*[0-9][0-9,]*(?:\.\d+)?\s*(?:lakh|lac|crore|per month|per annum|p\.a\.)?/i);
  if (moneyMatch) return moneyMatch[0];

  const waiverMatch = benefits.match(/\b(?:full|partial|up to|upto|100%)?[\w\s-]*(?:tuition|fee|stipend|grant|waiver|allowance)[\w\s.,%-]*/i);
  return waiverMatch ? waiverMatch[0] : "";
}

function extractIncomeLimit(text) {
  const incomeMatch = text.match(/(?:family|annual|parental|household).{0,80}income.{0,80}(?:Rs\.?|INR|₹)?\s*[0-9][0-9,.]*\s*(?:lakh|lac|crore)?/i)
    || text.match(/income.{0,80}(?:less than|below|up to|upto|not more than).{0,40}(?:Rs\.?|INR|₹)?\s*[0-9][0-9,.]*\s*(?:lakh|lac|crore)?/i);

  return incomeMatch ? toInteger(incomeMatch[0], 999999999) : 999999999;
}

function extractMinPercentage(text) {
  const percentageMatches = [...text.matchAll(/\b(\d{2,3})\s*%/g)]
    .map((match) => Number.parseInt(match[1], 10))
    .filter((value) => value >= 30 && value <= 100);

  return percentageMatches.length ? Math.min(...percentageMatches) : 0;
}

function extractApplyLink(markdownText, url) {
  const applyMatch = String(markdownText || "").match(/\[[^\]]*apply[^\]]*]\((https?:\/\/[^)\s]+)\)/i);
  if (applyMatch) return sanitizeLink(applyMatch[1], url);

  const externalLinks = [...String(markdownText || "").matchAll(/\((https?:\/\/[^)\s]+)\)/g)]
    .map((match) => match[1])
    .filter((link) => !link.includes("buddy4study.com/scholarships"));

  return sanitizeLink(externalLinks[0], url);
}

function buildKeyPoints(deadline, selectionCriteria, importantDates) {
  return [
    deadline ? `Apply by ${deadline}` : "",
    selectionCriteria ? `Selection: ${selectionCriteria}` : "",
    importantDates && !deadline.includes(importantDates) ? importantDates : ""
  ].filter(Boolean);
}

function fallbackExtractFromMarkdown(markdownText, url) {
  const cleanedText = cleanMarkdown(markdownText);
  const lines = getCleanLines(cleanedText);
  const plainText = lines.join(" ");
  const title = getTitle(cleanedText, lines, url);
  const region = extractLabeledValue(lines, ["Region", "Location", "Country"]) || "";
  const summary = extractSection(cleanedText, ["About The Program", "About Program", "About"], 180);
  const eligibility = extractSection(cleanedText, ["Eligibility"], 260);
  const benefits = extractSection(cleanedText, ["Benefits", "Awards", "Rewards"], 220);
  const selectionCriteria = extractSection(cleanedText, ["Selection Criteria", "Selection Process"], 110);
  const importantDates = extractSection(cleanedText, ["Important Dates", "Dates"], 110);
  const deadline = extractDeadline(lines, plainText);
  const amount = extractAmount(lines, plainText, benefits);
  const provider = extractLabeledValue(lines, ["Provider", "Offered by", "Organization", "Organisation"]);
  const combinedForMatching = `${title} ${summary} ${eligibility} ${benefits} ${region}`;

  return normalizeExtractedData({
    scholarship_name: title,
    category: inferCategory(`${title} ${url}`),
    tags: {
      state: inferState(combinedForMatching, region),
      gender: inferGender(combinedForMatching),
      class: inferEducationLevels(combinedForMatching)
    },
    requirements: {
      min_percentage: extractMinPercentage(eligibility || plainText),
      max_family_income: extractIncomeLimit(eligibility || plainText)
    },
    scholarship_amount: amount,
    application_deadline: deadline,
    provider,
    region,
    summary,
    eligibility,
    benefits,
    key_points: buildKeyPoints(deadline, selectionCriteria, importantDates),
    apply_link: extractApplyLink(markdownText, url)
  }, url);
}

function isInferenceQuotaError(error) {
  return /depleted|monthly included credits|pre-paid credits|subscribe to pro|quota|insufficient credits/i.test(error.message || "");
}

function getFallbackData(markdownText, url, reason) {
  const fallbackData = fallbackExtractFromMarkdown(markdownText, url);

  if (isUsableScholarship(fallbackData)) {
    console.log(`   Using local fallback extraction${reason ? ` (${reason})` : ""}.`);
    return fallbackData;
  }

  console.log(`   Warning: local fallback could not extract a usable record for ${url}`);
  return null;
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
    const start = fencedText.indexOf("{");
    if (start === -1) return null;

    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let index = start; index < fencedText.length; index += 1) {
      const char = fencedText[index];

      if (escaped) {
        escaped = false;
        continue;
      }

      if (char === "\\") {
        escaped = true;
        continue;
      }

      if (char === "\"") {
        inString = !inString;
        continue;
      }

      if (inString) continue;

      if (char === "{") depth += 1;
      if (char === "}") depth -= 1;

      if (depth === 0) {
        try {
          return JSON.parse(fencedText.slice(start, index + 1));
        } catch (nestedError) {
          return null;
        }
      }
    }

    return null;
  }
}

async function createExtractionCompletion(messages) {
  const request = {
    model: AI_MODEL,
    messages,
    temperature: 0,
    max_tokens: 1800,
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "scholarship_extraction",
        strict: true,
        schema: EXTRACTION_SCHEMA
      }
    }
  };

  try {
    return await client.chatCompletion(request);
  } catch (error) {
    if (!/response_format|json_schema|structured/i.test(error.message || "")) {
      throw error;
    }

    const { response_format: responseFormat, ...fallbackRequest } = request;
    return client.chatCompletion(fallbackRequest);
  }
}

async function repairJson(rawContent) {
  const completion = await createExtractionCompletion([
    {
      role: "system",
      content: "Return one valid JSON object only. Do not include markdown or explanatory text."
    },
    {
      role: "user",
      content: `Repair this extraction into valid JSON matching the required schema:\n\n${rawContent}`
    }
  ]);

  return parseJsonObject(completion.choices?.[0]?.message?.content);
}

async function extractWithLlm(markdownText, url) {
  const cleanedText = cleanMarkdown(markdownText);

  if (aiExtractionDisabled) {
    return getFallbackData(cleanedText, url, "AI extraction unavailable");
  }

  const prompt = `
    Extract one Buddy4Study scholarship detail page into compact structured data for a readable scholarship card.

    ### WHAT TO KEEP
    Keep only details that help a student decide whether to open/apply:
    - name, opportunity type, award/benefits, deadline, provider, region
    - matching fields: state/scope, gender, education level, minimum percentage, family income ceiling
    - one short summary, concise eligibility, concise benefit, and up to 3 important key points
    - the best official application link

    ### WHAT TO IGNORE
    Do not extract full documents lists, complete application instructions, contact blocks, long terms and conditions, FAQs, footer/navigation text, ads, login/register text, related scholarships, or unrelated recommendations.

    ### EXTRACTION RULES
    - Return exactly one JSON object matching the schema. No markdown, comments, or extra text.
    - Use only facts visible in the supplied Buddy4Study page text. Do not invent values.
    - If a field is not present, use "" or [] as appropriate. Do not write "Not specified", "N/A", or "Details not provided".
    - Keep text card-friendly: summary <= 180 chars, eligibility <= 260 chars, benefits <= 220 chars, each key point <= 110 chars.
    - Prefer concrete values over vague prose: percentages, dates, rupee amounts, provider names, eligible levels, and region.

    ### NORMALIZATION RULES
    - category must be exactly one of: "Scholarship", "Fellowship", "Internship".
    - tags.gender must be exactly "Female", "Male", or "All". Use "All" unless the page explicitly restricts gender.
    - tags.class should contain normalized education levels such as "Class 10", "Class 12", "UG", "PG", "PhD", "Diploma", "ITI".
    - tags.state is for matching Indian state/open scope. Use "All India" for national India opportunities, the exact Indian state if stated, or "All" for global/overseas opportunities.
    - requirements.max_family_income must be an integer rupee amount. Use 999999999 if no family-income ceiling is mentioned.
    - requirements.min_percentage must be an integer percentage. Use 0 if no percentage is mentioned.
    - application_deadline should be DD-MMM-YYYY when possible, for example "31-May-2026".
    - key_points should include only critical constraints or useful application notes, not generic instructions.
    - apply_link should be the final application URL if visible; otherwise use this Buddy4Study page URL: ${url}

    ### BUDDY4STUDY PAGE TEXT
    ${cleanedText.slice(0, 9000)}

    ### JSON FORMAT
    {
      "scholarship_name": "Name",
      "category": "Scholarship/Fellowship/Internship",
      "tags": {
        "state": "State Name",
        "gender": "Female/Male/All",
        "class": ["Class 10", "UG", "PG"]
      },
      "requirements": {
        "min_percentage": 0,
        "max_family_income": 999999999
      },
      "scholarship_amount": "Amount",
      "application_deadline": "DD-MMM-YYYY",
      "provider": "Provider or institution",
      "region": "Displayed region or geographic scope",
      "summary": "One short useful summary",
      "eligibility": "Concise eligibility summary",
      "benefits": "Concise benefits summary",
      "key_points": ["Important point 1", "Important point 2"],
      "apply_link": "URL"
    }
    `;

  try {
    const completion = await createExtractionCompletion([
      {
        role: "system",
        content: "You are a precise Buddy4Study page extraction service. Return exactly one valid JSON object matching the requested schema and nothing else."
      },
      {
        role: "user",
        content: prompt
      }
    ]);

    const rawContent = String(completion.choices?.[0]?.message?.content || "").trim();
    const data = parseJsonObject(rawContent) || (rawContent ? await repairJson(rawContent) : null);

    if (!data) {
      console.log(`   Warning: LLM output invalid JSON for ${url}`);
      return getFallbackData(cleanedText, url, "invalid AI output");
    }

    const normalizedData = normalizeExtractedData(data, url);

    if (!isUsableScholarship(normalizedData)) {
      console.log(`   Warning: skipped unusable extraction for ${url}`);
      return getFallbackData(cleanedText, url, "empty AI output");
    }

    return normalizedData;
  } catch (error) {
    if (isInferenceQuotaError(error)) {
      aiExtractionDisabled = true;
      console.log("   Warning: AI inference credits are depleted. Switching to local fallback extraction for this run.");
      return getFallbackData(cleanedText, url, "credit fallback");
    }

    console.log(`   Warning: API error for ${url}: ${error.message}`);
    return getFallbackData(cleanedText, url, "API fallback");
  }
}

async function main() {
  console.log(`Starting crawl on: ${BASE_URL}`);
  if (aiExtractionDisabled) {
    console.log("HF_TOKEN is missing, so the scraper will use local fallback extraction.");
  }

  try {
    const doc = await app.scrape(BASE_URL, { formats: ["markdown"] });
    const markdownText = getMarkdown(doc);
    const links = [
      ...new Set(markdownText.match(/https:\/\/www\.buddy4study\.com\/scholarship\/[^\)\s]+/g) || [])
    ];

    console.log(`Found ${links.length} scholarship links.`);

    const results = [];

    for (const [index, link] of links.entries()) {
      console.log(`[${index + 1}] Processing: ${link}`);

      try {
        const page = await app.scrape(link, { formats: ["markdown"] });
        const pageMarkdown = getMarkdown(page);

        if (pageMarkdown) {
          const data = await extractWithLlm(pageMarkdown, link);

          if (data) {
            results.push(data);
            console.log(`   Extracted: ${data.scholarship_name || "Unknown"}`);
          }
        } else {
          console.log("   Warning: page content was empty.");
        }

        await sleep(2000);
      } catch (error) {
        console.log(`   Error: failed to scrape link: ${error.message}`);
      }
    }

    fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
    fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(results, null, 2)}\n`, "utf8");

    console.log(`\nSaved ${results.length} scholarships to data/scholarships.json`);
  } catch (error) {
    console.log(`\nCritical error: ${error.message}`);
    process.exitCode = 1;
  }
}

main();
