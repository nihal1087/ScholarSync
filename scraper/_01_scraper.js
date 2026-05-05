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
    "eligibility",
    "scholarship_amount",
    "application_deadline",
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
    eligibility: { type: "string" },
    scholarship_amount: { type: "string" },
    application_deadline: { type: "string" },
    apply_link: { type: "string" }
  }
};

const app = new Firecrawl({ apiKey: FIRECRAWL_KEY });
const client = new InferenceClient(HF_TOKEN);

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
    max_tokens: 2500,
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

  const prompt = `
    Analyze the scholarship text and extract structured data.

    ### RULES:
    1. **Category**: Must be one of ["Scholarship", "Fellowship", "Internship"].
    2. **Income**: Extract maximum eligible family income as an INTEGER (e.g., 250000). If no limit, use 999999999.
    3. **Percentage**: Extract minimum required percentage as INTEGER (e.g., 60). If not mentioned, use 0.
    4. Return exactly one JSON object. Do not include markdown, code fences, comments, or extra text.

    ### TEXT:
    ${cleanedText.slice(0, 6500)}

    ### JSON FORMAT:
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
      "eligibility": "Summary",
      "scholarship_amount": "Amount",
      "application_deadline": "DD-MMM-YYYY",
      "apply_link": "URL"
    }
    `;

  try {
    const completion = await createExtractionCompletion([
      {
        role: "system",
        content: "You are a data extraction service. Return exactly one valid JSON object and nothing else."
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
      return null;
    }

    data.url = url;
    return data;
  } catch (error) {
    console.log(`   Warning: API error for ${url}: ${error.message}`);
    return null;
  }
}

async function main() {
  console.log(`Starting crawl on: ${BASE_URL}`);

  try {
    const doc = await app.scrape(BASE_URL, { formats: ["markdown"] });
    const markdownText = getMarkdown(doc);
    const links = markdownText.match(/https:\/\/www\.buddy4study\.com\/scholarship\/[^\)\s]+/g) || [];

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
