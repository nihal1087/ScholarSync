import os
import re
import time
import json
import urllib.request
from datetime import datetime
from dotenv import load_dotenv
from firecrawl import FirecrawlApp

load_dotenv()

FIRECRAWL_KEY = os.getenv("FIRECRAWL_API_KEY")
GROQ_API_KEY = os.getenv("GROQ_API_KEY")
GROQ_MODEL = os.getenv("GROQ_MODEL", "openai/gpt-oss-120b")
BASE_URL = "https://www.buddy4study.com/scholarships"
OUTPUT_PATH = "data/scholarships.json"

app = FirecrawlApp(api_key=FIRECRAWL_KEY) if FIRECRAWL_KEY else None

def clean_html(raw_html):
    if not raw_html:
        return ""
    text = re.sub(r"<style[^>]*>[\s\S]*?</style>", "", raw_html, flags=re.I)
    text = re.sub(r"<script[^>]*>[\s\S]*?</script>", "", text, flags=re.I)
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"&nbsp;", " ", text)
    text = re.sub(r"&amp;", "&", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text

def clean_markdown(text):
    text = re.sub(r"!\[.*?\]\(.*?\)", "", text or "")
    text = re.sub(r"\n\s*\n", "\n", text)
    return text.strip()

def is_live_deadline(deadline_str, deadline_date_diff=None):
    if deadline_date_diff is not None:
        try:
            return float(deadline_date_diff) >= 0
        except (ValueError, TypeError):
            pass
    if not deadline_str or not isinstance(deadline_str, str):
        return True
    c = deadline_str.lower().strip()
    if "always open" in c or "open" in c or "ongoing" in c:
        return True
    if "closed" in c or "expired" in c or "passed" in c:
        return False
    try:
        clean_date = re.sub(r"(\d+)(st|nd|rd|th)", r"\1", deadline_str)
        clean_date = clean_date.replace("-", " ")
        # Try basic formats
        for fmt in ("%d %b %Y", "%d %B %Y", "%Y %m %d", "%d/%m/%Y"):
            try:
                dt = datetime.strptime(clean_date.strip(), fmt)
                return dt.date() >= datetime.now().date()
            except ValueError:
                continue
    except Exception:
        pass
    return True

def is_valid_scholarship_url(url):
    if not url or not isinstance(url, str):
        return False
    if "buddy4study.com" not in url or "/scholarship/" not in url:
        return False
    slug = url.split("/scholarship/")[-1].strip("/").split("?")[0].split("#")[0]
    if not slug or slug == "scholarships":
        return False
    pathname = url.split("buddy4study.com")[-1].lower()
    if any(sub in pathname for sub in ["/qna", "/result", "/faq", "/application", "/login", "/register", "/terms-and-conditions", "/privacy-policy"]):
        return False
    if slug.lower() in ["all", "featured", "login", "register", "terms-and-conditions", "privacy-policy"]:
        return False
    return True

def extract_from_next_data(html, url):
    if not html or '<script id="__NEXT_DATA__"' not in html:
        return None
    try:
        start = html.find('<script id="__NEXT_DATA__"')
        json_start = html.find('>', start) + 1
        json_end = html.find('</script>', json_start)
        data = json.loads(html[json_start:json_end])
        page_props = data.get("props", {}).get("pageProps", {})
        s_data = page_props.get("scholarship") or page_props.get("data")
        if not s_data:
            return None

        brand_scholarships = s_data.get("brandPage", {}).get("scholarships", [])
        items = brand_scholarships if isinstance(brand_scholarships, list) and brand_scholarships else ([s_data.get("scholarship")] if s_data.get("scholarship") else [])
        if not items:
            return None

        live_items = []
        for item in items:
            if not is_live_deadline(item.get("deadline"), item.get("deadlineDateDiff")):
                continue

            title = item.get("title") or s_data.get("brandPage", {}).get("programName") or data.get("props", {}).get("seoData", {}).get("title")
            if not title or title.lower().strip() in ["apply now", "search and filter"]:
                continue

            clean_eligibility = clean_html(item.get("eligibility", ""))
            clean_benefits = clean_html(item.get("benefits", "") or item.get("purposeAward", ""))

            live_items.append({
                "scholarship_name": title[:140],
                "category": s_data.get("oppurtunityType", "Scholarship"),
                "tags": {
                    "state": "All India",
                    "gender": "Female" if "female" in clean_eligibility.lower() or "girl" in clean_eligibility.lower() else "All",
                    "class": [item.get("applicableFor", "UG")]
                },
                "requirements": {
                    "min_percentage": 60,
                    "max_family_income": 600000
                },
                "scholarship_amount": item.get("purposeAward") or "Variable",
                "application_deadline": item.get("deadline", "Open"),
                "provider": s_data.get("brandPage", {}).get("name", "Buddy4Study"),
                "region": "India",
                "summary": (clean_benefits or clean_eligibility)[:180],
                "eligibility": clean_eligibility[:260],
                "benefits": clean_benefits[:220],
                "key_points": [f"Apply before {item.get('deadline', 'closing date')}"],
                "apply_link": item.get("applyLink") or url,
                "url": url
            })

        return {
            "has_brand_data": True,
            "total_found": len(items),
            "live_items": live_items
        }
    except Exception:
        return None

def extract_with_groq(markdown_text, url):
    if not GROQ_API_KEY:
        return None
    cleaned_text = clean_markdown(markdown_text)
    prompt = f"""
    Extract this Buddy4Study scholarship detail page into compact structured JSON.
    Schema:
    {{
      "scholarship_name": "Full official name",
      "category": "Scholarship",
      "tags": {{ "state": "All India", "gender": "All", "class": ["UG"] }},
      "requirements": {{ "min_percentage": 0, "max_family_income": 999999999 }},
      "scholarship_amount": "Amount",
      "application_deadline": "DD-MMM-YYYY or Open",
      "provider": "Organisation",
      "region": "India",
      "summary": "Short overview",
      "eligibility": "Eligibility details",
      "benefits": "Benefits",
      "key_points": ["Point 1"],
      "apply_link": "{url}"
    }}
    Never extract button labels (e.g. "Apply Now") as scholarship_name. Return valid JSON only.

    PAGE TEXT:
    {cleaned_text[:8000]}
    """
    try:
        req_data = json.dumps({
            "model": GROQ_MODEL,
            "messages": [
                {"role": "system", "content": "You are a precise scholarship extraction assistant. Return valid JSON only."},
                {"role": "user", "content": prompt}
            ],
            "response_format": {"type": "json_object"},
            "temperature": 0
        }).encode("utf-8")

        req = urllib.request.Request(
            "https://api.groq.com/openai/v1/chat/completions",
            data=req_data,
            headers={
                "Authorization": f"Bearer {GROQ_API_KEY}",
                "Content-Type": "application/json",
                "User-Agent": "ScholarSync/1.0"
            }
        )
        with urllib.request.urlopen(req, timeout=15) as res:
            res_json = json.loads(res.read().decode("utf-8"))
            content = res_json["choices"][0]["message"]["content"]
            data = json.loads(content)
            data["url"] = url
            return data
    except Exception as e:
        print(f"   Groq AI notice: {e}")
        return None

def extract_scholarship_records(url, firecrawl_app):
    html = ""
    markdown = ""
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=10) as res:
            html = res.read().decode("utf-8", errors="ignore")
    except Exception:
        pass

    # Tier 1: Next.js Native State
    if html:
        t1 = extract_from_next_data(html, url)
        if t1 and t1.get("has_brand_data"):
            if t1["live_items"]:
                print(f"   [Tier 1: Native Live Data] Extracted {len(t1['live_items'])} active live edition(s).")
                return t1["live_items"]
            else:
                print(f"   [Tier 1: Live Filter] All {t1['total_found']} edition(s) are CLOSED/expired. Skipped.")
                return []

    # Firecrawl fallback if available
    if firecrawl_app:
        try:
            doc = firecrawl_app.scrape(url, formats=["markdown", "html"])
            markdown = doc.get("markdown") if isinstance(doc, dict) else getattr(doc, "markdown", "")
        except Exception:
            pass

    if not markdown and html:
        markdown = clean_html(html)

    if not markdown:
        return []

    # Tier 2: Groq AI
    groq_data = extract_with_groq(markdown, url)
    if groq_data and groq_data.get("scholarship_name"):
        if not is_live_deadline(groq_data.get("application_deadline")):
            print(f"   [Tier 2: Live Filter] Deadline '{groq_data.get('application_deadline')}' is CLOSED/expired. Skipped.")
            return []
        print(f"   [Tier 2: Groq AI] Extracted: {groq_data.get('scholarship_name')}")
        return [groq_data]

    return []

def discover_scholarship_links(firecrawl_app, base_url):
    print("Discovering live scholarship links across Buddy4Study...")
    raw_items = []
    try:
        req = urllib.request.Request("https://www.buddy4study.com/sitemap.xml", headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=10) as response:
            sitemap_index_text = response.read().decode("utf-8")
            sub_sitemaps = re.findall(r"<loc>(https://www\.buddy4study\.com/sitemap\d+\.xml)</loc>", sitemap_index_text)
            print(f"   Found {len(sub_sitemaps)} sub-sitemaps. Parsing scholarship URLs...")
            for sub_url in sub_sitemaps:
                try:
                    s_req = urllib.request.Request(sub_url, headers={"User-Agent": "Mozilla/5.0"})
                    with urllib.request.urlopen(s_req, timeout=10) as s_res:
                        sub_text = s_res.read().decode("utf-8")
                        url_blocks = re.findall(r"<url>[\s\S]*?</url>", sub_text)
                        for block in url_blocks:
                            loc_m = re.search(r"<loc>(.*?)</loc>", block)
                            lastmod_m = re.search(r"<lastmod>(.*?)</lastmod>", block)
                            loc = loc_m.group(1) if loc_m else ""
                            lastmod = lastmod_m.group(1) if lastmod_m else ""
                            if loc and is_valid_scholarship_url(loc):
                                raw_items.append({"url": loc.split("?")[0].split("#")[0].strip(), "lastmod": lastmod})
                except Exception:
                    continue
    except Exception as e:
        print(f"   Sitemap notice: {e}")

    raw_items.sort(key=lambda x: x.get("lastmod", ""), reverse=True)
    unique_links = []
    seen = set()
    for item in raw_items:
        u = item["url"]
        if u not in seen:
            seen.add(u)
            unique_links.append(u)

    scrape_limit = int(os.getenv("SCRAPE_LIMIT", "300"))
    print(f"   Found {len(unique_links)} unique scholarships. Limiting to top {min(scrape_limit, len(unique_links))} live opportunities.")
    return unique_links[:scrape_limit]

print(f"Starting crawl process for: {BASE_URL}")
print(f"Using AI Model: {GROQ_MODEL} (Groq API)")

try:
    results_map = {}
    if os.path.exists(OUTPUT_PATH):
        try:
            with open(OUTPUT_PATH, "r", encoding="utf-8") as f:
                existing_data = json.load(f)
                if isinstance(existing_data, list):
                    for item in existing_data:
                        k = item.get("url") or item.get("apply_link") or item.get("scholarship_name")
                        if k:
                            results_map[k] = item
        except Exception:
            pass

    links = discover_scholarship_links(app, BASE_URL)
    print(f"\nDiscovered {len(links)} total target scholarship links.")

    newly_extracted = 0

    for idx, link in enumerate(links, start=1):
        print(f"[{idx}/{len(links)}] Processing: {link}")
        try:
            records = extract_scholarship_records(link, app)
            for record in records:
                if record and record.get("scholarship_name"):
                    k = record.get("url") or record.get("apply_link") or record.get("scholarship_name")
                    results_map[k] = record
                    newly_extracted += 1

            if idx % 5 == 0:
                os.makedirs(os.path.dirname(OUTPUT_PATH) or ".", exist_ok=True)
                with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
                    json.dump(list(results_map.values()), f, indent=2, ensure_ascii=False)

            time.sleep(1.0)
        except Exception as e:
            print(f"   Error processing {link}: {e}")

    os.makedirs(os.path.dirname(OUTPUT_PATH) or ".", exist_ok=True)
    final_list = list(results_map.values())
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(final_list, f, indent=2, ensure_ascii=False)

    print(f"\nSaved {len(final_list)} total live scholarships ({newly_extracted} newly updated/added) to {OUTPUT_PATH}")

except Exception as e:
    print(f"\nCritical error: {e}")
