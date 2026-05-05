from firecrawl import FirecrawlApp
from huggingface_hub import InferenceClient
from dotenv import load_dotenv
import os
import re
import time
import json

load_dotenv()

FIRECRAWL_KEY = os.getenv("FIRECRAWL_API_KEY")
HF_TOKEN = os.getenv("HF_TOKEN")

app = FirecrawlApp(api_key=FIRECRAWL_KEY)

AI_MODEL = os.getenv("AI_MODEL", "openai/gpt-oss-120b")
client = InferenceClient(token=HF_TOKEN)

def clean_markdown(text):
    """
    Removes clutter (links, images, menu items) to give the LLM high-quality text.
    """
    text = re.sub(r"!\[.*?\]\(.*?\)", "", text)

    text = re.sub(r"\n\s*\n", "\n", text)
    return text.strip()

def extract_with_llm(markdown_text, url):

    cleaned_text = clean_markdown(markdown_text)
    
    prompt = f"""
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
    - Return exactly one JSON object. No markdown, comments, or extra text.
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
    - apply_link should be the final application URL if visible; otherwise use this Buddy4Study page URL: {url}

    ### BUDDY4STUDY PAGE TEXT
    {cleaned_text[:9000]}

    ### JSON FORMAT
    {{
      "scholarship_name": "Name",
      "category": "Scholarship/Fellowship/Internship",
      "tags": {{
        "state": "State Name",
        "gender": "Female/Male/All",
        "class": ["Class 10", "UG", "PG"]
      }},
      "requirements": {{
        "min_percentage": 0,
        "max_family_income": 999999999
      }},
      "scholarship_amount": "Amount",
      "application_deadline": "DD-MMM-YYYY",
      "provider": "Provider or institution",
      "region": "Displayed region or geographic scope",
      "summary": "One short useful summary",
      "eligibility": "Concise eligibility summary",
      "benefits": "Concise benefits summary",
      "key_points": ["Important point 1", "Important point 2"],
      "apply_link": "URL"
    }}
    """

    try:
        completion = client.chat.completions.create(
            model=AI_MODEL,
            messages=[
                {"role": "system", "content": "You are a precise Buddy4Study page extraction service. Return exactly one valid JSON object and nothing else."},
                {"role": "user", "content": prompt}
            ],
            temperature=0.1, 
            max_tokens=1800
        )

        raw_content = completion.choices[0].message.content.strip()

        json_match = re.search(r"\{[\s\S]*\}", raw_content)
        
        if json_match:
            clean_json = json_match.group(0)
            data = json.loads(clean_json)
            data["url"] = url
            return data
        else:
            print(f"   Warning: LLM output invalid JSON for {url}")
            return None

    except json.JSONDecodeError:
        print(f"   Warning: JSON parsing failed for {url}")
        return None
    except Exception as e:
        print(f"   Warning: API error for {url}: {e}")
        return None



BASE_URL = "https://www.buddy4study.com/scholarships"
print(f"Starting crawl on: {BASE_URL}")

try:
    doc = app.scrape(BASE_URL, formats=["markdown"])
    markdown_text = doc["markdown"] if isinstance(doc, dict) else doc.markdown

    links = list(dict.fromkeys(re.findall(r"https://www\.buddy4study\.com/scholarship/[^\)\s]+", markdown_text)))
    
    print(f"Found {len(links)} scholarship links.")

    results = []

    for idx, link in enumerate(links, start=1):
        print(f"[{idx}] Processing: {link}")

        try:
            page = app.scrape(link, formats=["markdown"])
            page_markdown = page["markdown"] if isinstance(page, dict) else page.markdown

            if page_markdown:
                data = extract_with_llm(page_markdown, link)
                if data:
                    results.append(data)
                    print(f"   Extracted: {data.get('scholarship_name', 'Unknown')}")
            else:
                print("   Warning: page content was empty.")

            time.sleep(2)

        except Exception as e:
            print(f"   Error: failed to scrape link: {e}")

    os.makedirs("data", exist_ok=True)
    with open("data/scholarships.json", "w", encoding="utf-8") as f:
        json.dump(results, f, indent=2, ensure_ascii=False)

    print(f"\nSaved {len(results)} scholarships to data/scholarships.json")

except Exception as e:
    print(f"\nCritical error: {e}")
