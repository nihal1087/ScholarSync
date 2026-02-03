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

REPO_ID = "meta-llama/Meta-Llama-3-8B-Instruct"
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
    Analyze the scholarship text below and extract structured data.
    
    ### CRITICAL RULES:
    1. **Inference**: If the State is not explicitly written but a city is mentioned (e.g., "Patna"), infer the State (e.g., "Bihar").
    2. **Gender**: MUST be one of: "Female", "Male", "Transgender", or "All". Never use other words.
    3. **Class**: Return a standard list like ["Class 10", "Class 12", "UG", "PG", "PhD"].
    4. **Nulls**: If data is missing, use null.
    
    ### TEXT TO ANALYZE:
    {cleaned_text[:4500]}
    
    ### REQUIRED JSON FORMAT:
    {{
      "scholarship_name": "Extract exact name",
      "type": "Scholarship",
      "tags": {{
        "state": "State Name or 'All India' or 'International'",
        "gender": "Female / Male / All",
        "religion": "Minority / SC/ST / All",
        "class": ["List", "of", "Levels"]
      }},
      "eligibility": "Summarize eligibility in 1 sentence",
      "scholarship_amount": "Extract amount or benefits",
      "application_deadline": "DD-MMM-YYYY",
      "apply_link": "Extract apply URL if present"
    }}
    """

    try:
        completion = client.chat.completions.create(
            model=REPO_ID,
            messages=[
                {"role": "system", "content": "You are a data extraction API. You output ONLY valid JSON. No conversational text."},
                {"role": "user", "content": prompt}
            ],
            temperature=0.1, 
            max_tokens=1000
        )

        raw_content = completion.choices[0].message.content.strip()

        json_match = re.search(r"\{[\s\S]*\}", raw_content)
        
        if json_match:
            clean_json = json_match.group(0)
            data = json.loads(clean_json)
            data["url"] = url
            return data
        else:
            print(f"   ⚠️ LLM output invalid JSON for {url}")
            return None

    except json.JSONDecodeError:
        print(f"   ⚠️ JSON Parsing Failed for {url}")
        return None
    except Exception as e:
        print(f"   ⚠️ API Error for {url}: {e}")
        return None



BASE_URL = "https://www.buddy4study.com/scholarships"
print(f"🚀 Starting crawl on: {BASE_URL}")

try:
    doc = app.scrape(BASE_URL, formats=["markdown"])
    markdown_text = doc["markdown"] if isinstance(doc, dict) else doc.markdown

    links = re.findall(r"https://www\.buddy4study\.com/scholarship/[^\)\s]+", markdown_text)
    
    print(f"✅ Found {len(links)} scholarship links.")

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
                    print(f"   🎉 Extracted: {data.get('scholarship_name', 'Unknown')}")
            else:
                print("   ⚠️ Page content was empty.")

            time.sleep(2) 

        except Exception as e:
            print(f"   ❌ Failed to scrape link: {e}")

    os.makedirs("data", exist_ok=True)
    with open("data/scholarships.json", "w", encoding="utf-8") as f:
        json.dump(results, f, indent=2, ensure_ascii=False)

    print(f"\n💾 Saved {len(results)} scholarships to data/scholarships.json")

except Exception as e:
    print(f"\n❌ Critical Error: {e}")