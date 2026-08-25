// Provider for Central & State Government Scholarship Schemes
// Ingests verified central schemes live from NSP (https://scholarships.gov.in/All-Scholarships)
// and fuses with permanent evergreen central/state schemes.

function cleanText(str) {
  return String(str || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

async function fetchNspLive() {
  const url = "https://scholarships.gov.in/All-Scholarships";
  console.log(`   [Gov Schemes Provider] Fetching live schemes from ${url}...`);

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 12000);

      const res = await fetch(url, {
        signal: controller.signal,
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9"
        }
      });

      clearTimeout(timeoutId);
      if (!res.ok) continue;

      const htmlContent = await res.text();
      const liveSchemes = parseAllNspSchemes(htmlContent);
      if (liveSchemes.length > 0) {
        console.log(`   [Gov Schemes Provider] Successfully parsed ${liveSchemes.length} live Ministry schemes from NSP.`);
        return liveSchemes;
      }
    } catch (e) {
      console.log(`   [Gov Schemes Provider] Live fetch attempt ${attempt} notice: ${e.message}`);
    }
  }

  return [];
}

function parseAllNspSchemes(htmlContent) {
  const schemes = [];
  const accordionItemMatches = [...htmlContent.matchAll(/<div class=\"accordion-item\">([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/gi)];

  for (const item of accordionItemMatches) {
    const itemHtml = item[1];
    const ministryMatch = itemHtml.match(/<h7[^>]*class=\"accordion-header\"[^>]*>([\s\S]*?)<\/h7>/i);
    const ministry = ministryMatch ? cleanText(ministryMatch[1]) : "Government of India";

    const cardMatches = [...itemHtml.matchAll(/<h6[^>]*>([\s\S]*?)<\/h6>([\s\S]*?)(?=<h6|$)/gi)];

    for (const card of cardMatches) {
      const rawTitle = cleanText(card[1]);
      if (!rawTitle || rawTitle.toLowerCase().includes("choose your option") || rawTitle.toLowerCase().startsWith("by ")) {
        continue;
      }

      const cardBody = card[2];

      // Extract closing date
      const dateMatch = cardBody.match(/\b([0-9]{1,2}-[0-9]{2}-[0-9]{4})\b/)
        || cardBody.match(/(?:Closing Date|Open till|Last Date|Open upto|Open Upto|Application Closes on)[^:]*:\s*([0-9]{1,2}[-/\s][a-zA-Z0-9]+[-/\s][0-9]{2,4})/i)
        || cardBody.match(/\b([0-9]{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]+\s+[0-9]{4})\b/);

      const deadline = dateMatch ? dateMatch[1] : "31-Oct-2026";

      // Extract guidelines link
      const guidelineMatch = cardBody.match(/href=\"([^\"]*(?:pdf|guideline|scheme)[^\"]*)\"/i);
      const apply_link = guidelineMatch && guidelineMatch[1].startsWith("http")
        ? guidelineMatch[1]
        : (guidelineMatch ? `https://scholarships.gov.in/${guidelineMatch[1].replace(/^\//, "")}` : "https://scholarships.gov.in/");

      const tLower = rawTitle.toLowerCase();
      const isFemale = tLower.includes("girl") || tLower.includes("pragati") || tLower.includes("women");
      const isPg = tLower.includes("post graduate") || tLower.includes("post-graduate") || tLower.includes("pg ");
      const isUg = tLower.includes("under graduate") || tLower.includes("ug") || tLower.includes("degree") || tLower.includes("college") || tLower.includes("university");
      const isPreMatric = tLower.includes("pre matric") || tLower.includes("pre-matric") || tLower.includes("schools");
      const isPostMatric = tLower.includes("post matric") || tLower.includes("post-matric");
      const isFellowship = tLower.includes("fellowship") || tLower.includes("phd") || tLower.includes("research");

      const classes = [];
      if (isPreMatric) classes.push("Class 10");
      if (isPostMatric || isUg) classes.push("UG");
      if (isPg) classes.push("PG");
      if (isFellowship) classes.push("PhD");
      if (classes.length === 0) classes.push("UG", "PG");

      schemes.push({
        scholarship_name: rawTitle.replace(/\s*\(.*Scheme\)/i, "").trim(),
        category: isFellowship ? "Fellowship" : "Scholarship",
        tags: {
          state: "All India",
          gender: isFemale ? "Female" : "All",
          class: [...new Set(classes)]
        },
        requirements: {
          min_percentage: 50,
          max_family_income: tLower.includes("top class") ? 800000 : (tLower.includes("sc") || tLower.includes("st") || tLower.includes("obc") ? 250000 : 450000)
        },
        scholarship_amount: "Tuition fees, academic allowance & maintenance grant via DBT",
        application_deadline: deadline,
        provider: ministry,
        region: "India",
        summary: `Official central government scheme by ${ministry} hosted on the National Scholarship Portal (NSP).`,
        eligibility: `Eligible students meeting criteria under ${ministry} guidelines. Open for online applications on NSP portal.`,
        benefits: "Full or partial fee reimbursement, monthly stipend, and academic allowance credited directly via DBT.",
        key_points: [
          `Offered by ${ministry}`,
          "Apply online at https://scholarships.gov.in/",
          "Disbursed directly through Direct Benefit Transfer (DBT)"
        ],
        apply_link,
        url: "https://scholarships.gov.in/All-Scholarships"
      });
    }
  }

  return schemes;
}

const STATIC_GOV_BACKUP = [
  {
    scholarship_name: "Post Matric Scholarship for OBC Students",
    category: "Scholarship",
    tags: {
      state: "All India",
      gender: "All",
      class: ["Class 11", "Class 12", "UG", "PG", "Diploma"]
    },
    requirements: {
      min_percentage: 50,
      max_family_income: 250000
    },
    scholarship_amount: "Tuition fee waiver + maintenance allowance",
    application_deadline: "31-Dec-2026",
    provider: "Ministry of Social Justice and Empowerment",
    region: "India",
    summary: "Financial assistance to Other Backward Classes (OBC) students for pursuing post-matriculation courses.",
    eligibility: "OBC students with family income <= ₹2.5 Lakh pursuing post-matric studies in recognized institutions.",
    benefits: "Reimbursement of compulsory course fees and academic maintenance allowance.",
    key_points: ["Apply on state scholarship portal or NSP", "Valid OBC NCL certificate required"],
    apply_link: "https://scholarships.gov.in/",
    url: "https://socialjustice.gov.in/"
  },
  {
    scholarship_name: "PM-USP Special Scholarship Scheme for Jammu & Kashmir and Ladakh (PM-USPY / SSSJKL)",
    category: "Scholarship",
    tags: {
      state: "All India",
      gender: "All",
      class: ["UG", "Diploma"]
    },
    requirements: {
      min_percentage: 50,
      max_family_income: 800000
    },
    scholarship_amount: "Up to ₹3.0 Lakh tuition fee + ₹1.0 Lakh maintenance allowance",
    application_deadline: "31-Oct-2026",
    provider: "AICTE / Ministry of Education",
    region: "India",
    summary: "Special scholarship for youth of J&K and Ladakh to study in colleges outside the union territories.",
    eligibility: "Domicile of J&K or Ladakh passed 10+2 with family income <= ₹8.0 Lakh seeking admission in colleges outside J&K.",
    benefits: "Tuition fee up to ₹3.0 Lakh/year for Engineering/Medical and ₹1.0 Lakh/year maintenance fee.",
    key_points: ["5,000 fresh scholarships awarded every year", "Counseling and allotment conducted by AICTE"],
    apply_link: "https://www.aicte-india.org/bureaus/jk",
    url: "https://www.aicte-india.org/"
  },
  {
    scholarship_name: "National Fellowship for OBC Students (NFOBC)",
    category: "Fellowship",
    tags: {
      state: "All India",
      gender: "All",
      class: ["PhD"]
    },
    requirements: {
      min_percentage: 55,
      max_family_income: 800000
    },
    scholarship_amount: "₹37,000 to ₹42,000 per month + HRA & contingency grant",
    application_deadline: "31-Dec-2026",
    provider: "Ministry of Social Justice & Empowerment / UGC",
    region: "India",
    summary: "Fellowship for Other Backward Class students pursuing full-time regular M.Phil and Ph.D. degrees in Sciences, Humanities, and Engineering.",
    eligibility: "OBC candidates qualified UGC-NET / CSIR-NET and enrolled in regular Ph.D. programs.",
    benefits: "JRF of ₹37,000/month for first 2 years, SRF of ₹42,000/month for remaining period + contingency.",
    key_points: ["1,000 fellowships awarded annually", "Disbursed via UGC Canara Bank scholarship portal"],
    apply_link: "https://www.ugc.gov.in/",
    url: "https://www.ugc.gov.in/"
  }
];

async function fetchGovScholarships() {
  const liveNsp = await fetchNspLive();
  if (liveNsp.length > 0) {
    return [...liveNsp, ...STATIC_GOV_BACKUP];
  }
  console.log(`   [Gov Schemes Provider] Using static central schemes fallback (${STATIC_GOV_BACKUP.length} schemes).`);
  return STATIC_GOV_BACKUP;
}

module.exports = {
  name: "National Scholarship Portal (NSP) Live Schemes Provider",
  fetchScholarships: fetchGovScholarships
};
