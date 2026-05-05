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
    Analyze the scholarship text and extract structured data.
    
    ### RULES:
    1. **Category**: Must be one of ["Scholarship", "Fellowship", "Internship"].
    2. **Income**: Extract maximum eligible family income as an INTEGER (e.g., 250000). If no limit, use 999999999.
    3. **Percentage**: Extract minimum required percentage as INTEGER (e.g., 60). If not mentioned, use 0.
    
    ### TEXT:
    {cleaned_text[:6500]}
    
    ### JSON FORMAT:
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
      "eligibility": "Summary",
      "scholarship_amount": "Amount",
      "application_deadline": "DD-MMM-YYYY",
      "apply_link": "URL"
    }}
    """

    try:
        completion = client.chat.completions.create(
            model=AI_MODEL,
            messages=[
                {"role": "system", "content": "You are a data extraction API. You output ONLY valid JSON. No conversational text."},
                {"role": "user", "content": prompt}
            ],
            temperature=0.1, 
            max_tokens=2500
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

    links = re.findall(r"https://www\.buddy4study\.com/scholarship/[^\)\s]+", markdown_text)
    
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
