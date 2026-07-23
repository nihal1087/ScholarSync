# ScholarSync

> A focused scholarship finder that turns a student profile into a practical shortlist.

[![Weekly scholarship data scrape](https://github.com/nihal1087/ScholarSync/actions/workflows/weekly-scraper.yml/badge.svg)](https://github.com/nihal1087/ScholarSync/actions/workflows/weekly-scraper.yml)

ScholarSync is a small web application for students looking for scholarships, fellowships, and internships in India. Instead of making people sift through long listing pages, it asks a few eligibility questions—location, education level, marks, gender, and family income—then surfaces opportunities that fit the profile.

The app is deliberately simple: a vanilla JavaScript chat interface, an Express matching API, and a JSON catalogue that can be refreshed automatically each week.

~~~mermaid
flowchart LR
    Student -->|answers eligibility prompts| UI[Chat interface<br/>public/]
    UI -->|POST /chat| API[Express matcher<br/>server.js]
    API -->|reads at startup| Data[(data/scholarships.json)]
    Workflow[Weekly GitHub Action] --> Scraper[Buddy4Study scraper<br/>Firecrawl + optional Hugging Face extraction]
    Scraper -->|updates| Data
~~~

## What it does

- Guides a student through opportunity type, state, gender, education level, percentage, and annual family income.
- Matches against scholarship, fellowship, and internship records using explicit eligibility rules.
- Explains why a result fits, shows deadline status and key details, and links out to the relevant application or listing page.
- Starts with five results and lets the student reveal the rest when more matches are available.
- Keeps the interface dependency-free on the client: no framework, build step, or separate frontend server.
- Refreshes the catalogue on a weekly schedule through GitHub Actions, with a manual trigger available when needed.

## Getting started

### Prerequisites

- Node.js 20 or newer is recommended. The scheduled workflow uses Node 20.
- npm

### Run locally

~~~bash
git clone https://github.com/nihal1087/ScholarSync.git
cd ScholarSync
npm ci
npm start
~~~

Open [http://localhost:4002](http://localhost:4002).

The server serves both the chat interface and its API, so no separate frontend command is required. A local server works from the checked-in JSON data; scraper credentials are only needed when you want to refresh that data.

## How matching works

ScholarSync is a deterministic matcher, not a general-purpose conversational assistant. A record is considered when it has a name and usable application link, then filtered by:

| Profile detail | Matching behaviour |
| --- | --- |
| Opportunity type | Exact category match, unless **All** is selected. |
| State | A matching state or an open-scope record such as **All India** can qualify. |
| Gender | The selected gender or an **All**-gender record can qualify. |
| Education | Recognises common equivalents such as UG / undergraduate / bachelor's and PG / postgraduate / master's. |
| Percentage | The student's score must meet the record's minimum percentage. |
| Family income | The student's annual income must not exceed the stated ceiling. |

Eligible records are de-duplicated, ranked by how specifically they match the profile, and then ordered by the earliest parseable deadline. Blank or unparseable deadlines fall to the end.

## API

The application exposes one API endpoint alongside the static site.

~~~http
POST /chat
Content-Type: application/json
~~~

Example request:

~~~json
{
  "category": "Scholarship",
  "state": "Maharashtra",
  "gender": "Female",
  "education": "UG",
  "percentage": 85,
  "income": 500000,
  "offset": 0,
  "limit": 5,
  "showAll": false
}
~~~

<code>income</code> is an annual family-income value in INR. Normal requests return up to 10 results; the UI uses five for the first page. <code>offset</code> and <code>showAll</code> support the **See All** flow.

Example response shape:

~~~json
{
  "reply": "Found <b>12</b> opportunities matching your profile.",
  "total": 12,
  "offset": 0,
  "limit": 5,
  "nextOffset": 5,
  "hasMore": true,
  "results": []
}
~~~

## Scholarship data

Records live in [data/scholarships.json](data/scholarships.json). Each entry follows this shape:

~~~json
{
  "scholarship_name": "Example Scholarship",
  "category": "Scholarship",
  "tags": {
    "state": "All India",
    "gender": "All",
    "class": ["UG"]
  },
  "requirements": {
    "min_percentage": 60,
    "max_family_income": 500000
  },
  "scholarship_amount": "₹50,000",
  "application_deadline": "31-May-2026",
  "provider": "Organisation",
  "region": "India",
  "summary": "Short description",
  "eligibility": "Concise eligibility details",
  "benefits": "Award or benefit details",
  "key_points": ["Useful note"],
  "apply_link": "https://example.org/apply",
  "url": "https://example.org/source"
}
~~~

The current scraper begins with Buddy4Study listing pages. That makes ScholarSync a discovery aid, not an authority on eligibility or availability: listings can change, close, or be incomplete. Students should always confirm the latest requirements and deadlines on the linked application page before applying.

## Refresh scholarship data

The JavaScript scraper is the supported refresh path:

~~~bash
npm run scrape
~~~

It fetches the Buddy4Study scholarship listing through Firecrawl, visits discovered detail pages one at a time, normalises the extracted information, and rewrites <code>data/scholarships.json</code>. Restart the server after a refresh because the catalogue is loaded when the server starts.

Create a local <code>.env</code> file—or set equivalent process environment variables—before running the scraper:

~~~dotenv
FIRECRAWL_API_KEY=your_firecrawl_key
HF_TOKEN=your_hugging_face_token
# Optional; defaults to openai/gpt-oss-120b
AI_MODEL=openai/gpt-oss-120b
~~~

<code>FIRECRAWL_API_KEY</code> is required to crawl the source site. <code>HF_TOKEN</code> improves structured extraction, but the JavaScript scraper falls back to local markdown and pattern-based extraction if no token is supplied, an inference request fails, or credits are exhausted.

> Keep API keys out of commits. For automated runs, store them as GitHub Actions secrets rather than in source control.

### Weekly automation

[.github/workflows/weekly-scraper.yml](.github/workflows/weekly-scraper.yml) runs every Monday at 00:00 UTC (05:30 IST) and can also be started manually from the Actions tab. It:

1. installs locked dependencies with <code>npm ci</code>;
2. requires the <code>FIRECRAWL_API_KEY</code> and <code>HF_TOKEN</code> repository secrets;
3. runs <code>npm run scrape</code>; and
4. commits and pushes <code>data/scholarships.json</code> only when it changed.

The workflow accepts an optional <code>AI_MODEL</code> repository secret or variable. If none is set, it uses <code>openai/gpt-oss-120b</code>.

## Project structure

~~~text
.
├── .github/workflows/weekly-scraper.yml  # Scheduled catalogue refresh
├── data/scholarships.json                # Generated opportunity catalogue
├── public/
│   ├── index.html                        # Chat UI markup
│   ├── script.js                         # Conversation flow and result rendering
│   └── style.css                         # Responsive visual design
├── scraper/
│   ├── _01_scraper.js                    # Supported Node.js scraper
│   └── _01_scraper.py                    # Earlier standalone Python alternative
├── server.js                             # Express server and matching logic
└── package.json
~~~

## Notes for maintainers

- The server has no database; it reads the JSON catalogue once at startup.
- The scraper only processes detail links visible in the fetched listing markdown. It does not yet paginate or crawl beyond that listing, so it is not guaranteed to produce a complete catalogue.
- A scrape replaces the JSON file with the records it obtained. Review data changes before treating them as authoritative.
- The Python scraper is not wired into npm and has no Python dependency manifest. Prefer <code>npm run scrape</code> for normal maintenance.
- There are currently no automated test, lint, build, deployment, or contribution scripts in this repository.

## License

No license file has been added to this repository yet.
