const chatBox = document.getElementById("chat-box");
const userInput = document.getElementById("user-input");
const sendBtn = document.getElementById("send-btn");

const FLOW = {
  CATEGORY: 1,
  STATE: 2,
  GENDER: 3,
  CLASS: 4,
  SCORE: 5,
  INCOME: 6,
  FINISHED: 7
};

let currentStep = FLOW.CATEGORY;
let userSelections = {};
const INITIAL_RESULT_LIMIT = 5;
let resultCursor = {
  total: 0,
  nextOffset: 0,
  hasMore: false,
  loading: false
};

const OPTIONS = {
  categories: ["Scholarship", "Fellowship", "Internship", "All"],
  states: ["All India", "Maharashtra", "Delhi", "Odisha", "Bihar", "Karnataka"],
  genders: ["Female", "Male", "All"],
  classes: ["Class 10", "Class 12", "UG", "PG", "PhD"],
  incomes: ["< 2.5 Lakh", "< 5 Lakh", "< 8 Lakh", "No Limit"]
};

window.onload = () => {
  addBotMessage("Hi! I'm your Scholarship Assistant.");
  setTimeout(() => {
    addBotMessage("To get started, what type of opportunity are you looking for?");
    showOptions(OPTIONS.categories);
  }, 600);
};

function handleInput(text) {
  if (!text.trim()) return;

  userInput.value = "";
  removeOptions();
  removeResultActions();
  addUserMessage(text);

  setTimeout(() => {
    switch (currentStep) {
      case FLOW.CATEGORY:
        userSelections.category = text;
        currentStep = FLOW.STATE;
        addBotMessage("Great. Which <b>State</b> are you from?");
        showOptions(OPTIONS.states);
        break;

      case FLOW.STATE:
        userSelections.state = text;
        currentStep = FLOW.GENDER;
        addBotMessage("Got it. What is your <b>Gender</b>?");
        showOptions(OPTIONS.genders);
        break;

      case FLOW.GENDER:
        userSelections.gender = text;
        currentStep = FLOW.CLASS;
        addBotMessage("What is your current <b>Education Level</b>?");
        showOptions(OPTIONS.classes);
        break;

      case FLOW.CLASS:
        userSelections.education = text;
        currentStep = FLOW.SCORE;
        addBotMessage("What was your <b>Last Exam Percentage</b>? (e.g., 85)");
        break;

      case FLOW.SCORE:
        userSelections.percentage = text.replace(/[^0-9.]/g, '');

        currentStep = FLOW.INCOME;
        addBotMessage("Finally, what is your <b>Annual Family Income</b>?");
        showOptions(OPTIONS.incomes);
        break;

      case FLOW.INCOME:
        if (text.includes("2.5")) userSelections.income = 250000;
        else if (text.includes("5")) userSelections.income = 500000;
        else if (text.includes("8")) userSelections.income = 800000;
        else userSelections.income = 999999999;

        currentStep = FLOW.FINISHED;
        fetchResults();
        break;

      case FLOW.FINISHED:
        addBotMessage("Starting a new search...");
        userSelections = {};
        currentStep = FLOW.CATEGORY;
        setTimeout(() => {
           addBotMessage("What type of opportunity are you looking for?");
           showOptions(OPTIONS.categories);
        }, 1000);
        break;
    }
  }, 500);
}

async function fetchResults() {
  await loadResultsPage({ reset: true });
}

async function loadResultsPage({ reset = false, showAll = false } = {}) {
  if (resultCursor.loading) return;
  if (showAll && resultCursor.total <= resultCursor.nextOffset) return;

  resultCursor.loading = true;
  removeResultActions();

  if (reset) {
    resultCursor = {
      total: 0,
      nextOffset: 0,
      hasMore: false,
      loading: true
    };
  }

  const offset = reset ? 0 : resultCursor.nextOffset;
  const limit = showAll
    ? Math.max(1, resultCursor.total - offset)
    : INITIAL_RESULT_LIMIT;
  const loaderId = addResultsLoader(Math.min(INITIAL_RESULT_LIMIT, limit));

  try {
    const response = await fetch('/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...userSelections,
        offset,
        limit,
        showAll
      })
    });

    if (!response.ok) throw new Error(`Request failed with status ${response.status}`);

    const data = await response.json();
    const results = Array.isArray(data.results) ? data.results : [];
    const loader = document.getElementById(loaderId);
    if (loader) loader.remove();

    resultCursor.total = data.total || 0;
    resultCursor.nextOffset = data.nextOffset || 0;
    resultCursor.hasMore = Boolean(data.hasMore);

    if (results.length > 0) {
      await renderCardsGradually(results, showAll ? 55 : 120, { scrollToFirst: true });
    } else if (reset) {
      addBotMessage("No matching opportunities found. Try changing one or two profile details.");
    }

    addResultActions({ scroll: false });
  } catch (e) {
    console.error(e);
    const loader = document.getElementById(loaderId);
    if (loader) {
      loader.className = "message bot-msg fade-in";
      loader.innerText = "Server error. Please ensure the backend is running.";
    }
  } finally {
    resultCursor.loading = false;
  }
}

function addResultActions({ scroll = true } = {}) {
  removeResultActions();

  const container = document.createElement('div');
  container.className = 'result-actions fade-in';

  if (resultCursor.hasMore) {
    const remaining = Math.max(0, resultCursor.total - resultCursor.nextOffset);
    const btn = document.createElement('button');
    btn.className = 'show-more-btn';
    btn.type = 'button';
    btn.innerText = `See All (${remaining})`;
    btn.onclick = () => loadResultsPage({ showAll: true });
    container.appendChild(btn);
  }

  const restartBtn = document.createElement('button');
  restartBtn.className = 'restart-btn';
  restartBtn.type = 'button';
  restartBtn.innerText = 'Start Over';
  restartBtn.onclick = () => handleInput('Start Over');
  container.appendChild(restartBtn);

  chatBox.appendChild(container);
  if (scroll) scrollToBottom();
}

function removeResultActions() {
  const actions = document.querySelectorAll(".result-actions");
  actions.forEach((action) => action.remove());
}

function addResultsLoader(count = 3) {
  const loader = document.createElement("div");
  loader.className = "results-loader fade-in";
  loader.id = "loader-" + Date.now();
  loader.setAttribute("role", "status");
  loader.setAttribute("aria-label", "Loading scholarships");

  loader.innerHTML = Array.from({ length: count }, () => `
    <div class="skeleton-card">
      <div class="skeleton-line skeleton-badge"></div>
      <div class="skeleton-line skeleton-title"></div>
      <div class="skeleton-grid">
        <div class="skeleton-line"></div>
        <div class="skeleton-line"></div>
      </div>
      <div class="skeleton-line skeleton-text"></div>
      <div class="skeleton-line skeleton-text short"></div>
    </div>
  `).join("");

  chatBox.appendChild(loader);
  scrollToElement(loader);
  return loader.id;
}

function renderCardsGradually(items, delay = 120, { scrollToFirst = false } = {}) {
  return items.reduce((chain, item, index) => {
    return chain.then(() => new Promise((resolve) => {
      setTimeout(() => {
        const card = renderCard(item);
        if (scrollToFirst && index === 0) scrollToElement(card);
        resolve();
      }, index === 0 ? 0 : delay);
    }));
  }, Promise.resolve());
}

function renderCard(item) {
  const tags = item.tags || {};
  const reqs = item.requirements || {};
  const card = document.createElement("div");
  card.className = "result-card fade-in";

  const category = cleanText(item.category, "Scholarship");
  const scope = cleanText(item._match && item._match.scope, cleanText(tags.state, "All India"));
  const classes = formatClassList(tags.class);
  const amount = getUsefulText(item.scholarship_amount);
  const deadline = getUsefulText(item.application_deadline);
  const deadlineInfo = formatDeadlineInfo(deadline);
  const provider = getUsefulText(item.provider);
  const region = getUsefulText(item.region);
  const summary = truncateText(getUsefulText(item.summary) || getUsefulText(item.about_program), 190);
  const benefits = truncateText(getUsefulText(item.benefits), 180);
  const eligibility = truncateText(getUsefulText(item.eligibility), 220);
  const keyPoints = getUsefulList(item.key_points).slice(0, 3);
  const gender = formatGender(tags.gender);
  const officialLink = sanitizeUrl(item.apply_link) || sanitizeUrl(item.url);
  const metaItems = [
    provider ? `By ${provider}` : "",
    region || scope
  ].filter(Boolean);
  const summaryItems = [
    { label: "Award", value: amount },
    { label: "Deadline", value: deadline }
  ].filter((detail) => detail.value);
  const fitItems = buildFitItems({ scope, classes, gender, reqs, tags });
  const deadlineBadgeHtml = deadlineInfo ? `
                <span class="deadline-badge ${deadlineInfo.tone}">${escapeHtml(deadlineInfo.label)}</span>
  ` : "";
  const metaHtml = metaItems.length ? `
        <div class="card-meta">
            ${metaItems.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}
        </div>
  ` : "";
  const summaryHtml = summaryItems.length ? `
        <div class="card-summary priority-summary">
            ${renderDetailItems(summaryItems, "detail-item priority-item")}
        </div>
  ` : "";
  const fitHtml = fitItems.length ? renderFitSection(fitItems) : "";
  const eligibilityHtml = eligibility ? `
        <div class="detail-section">
            <span class="section-label">Eligibility</span>
            <p class="eligibility">${escapeHtml(eligibility)}</p>
        </div>
  ` : "";
  const summaryTextHtml = summary ? renderTextSection("Overview", summary) : "";
  const benefitsHtml = benefits ? renderTextSection("Benefits", benefits) : "";
  const keyPointsHtml = keyPoints.length ? renderListSection("Important", keyPoints) : "";
  const footerHtml = officialLink ? `
        <div class="card-footer">
            <a href="${officialLink}" target="_blank" rel="noopener noreferrer" class="apply-btn">Open Official Page</a>
        </div>
  ` : "";

  card.innerHTML = `
        <div class="card-header">
            <div>
                <div class="badge-row">
                  <span class="type-badge ${toCssClass(category)}">${escapeHtml(category)}</span>
                  ${deadlineBadgeHtml}
                </div>
                <h3>${escapeHtml(cleanText(item.scholarship_name, "Scholarship opportunity"))}</h3>
            </div>
        </div>
        ${metaHtml}
        ${summaryHtml}
        ${fitHtml}
        ${summaryTextHtml}
        ${eligibilityHtml}
        ${benefitsHtml}
        ${keyPointsHtml}
        ${footerHtml}
  `;
  chatBox.appendChild(card);
  return card;
}

function renderDetailItems(items, className) {
  return items.map((item) => `
    <div class="${className}">
      <span class="detail-label">${escapeHtml(item.label)}</span>
      <strong>${escapeHtml(item.value)}</strong>
    </div>
  `).join("");
}

function renderTextSection(label, text) {
  return `
    <div class="detail-section">
      <span class="section-label">${escapeHtml(label)}</span>
      <p class="eligibility">${escapeHtml(text)}</p>
    </div>
  `;
}

function renderListSection(label, items) {
  return `
    <div class="detail-section list-section">
      <span class="section-label">${escapeHtml(label)}</span>
      <ul class="detail-list">
        ${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
      </ul>
    </div>
  `;
}

function renderFitSection(items) {
  return `
    <div class="fit-section">
      <span class="section-label">Why This Fits</span>
      <div class="fit-chip-row">
        ${items.map((item) => `
          <div class="fit-chip ${item.tone}">
            <span>${escapeHtml(item.label)}</span>
            <strong>${escapeHtml(item.value)}</strong>
          </div>
        `).join("")}
      </div>
    </div>
  `;
}

function buildFitItems({ scope, classes, gender, reqs, tags }) {
  const minPercentage = Number(reqs.min_percentage);
  const maxIncome = Number(reqs.max_family_income);
  const userScore = Number(userSelections.percentage);
  const userIncome = Number(userSelections.income);
  const hasScoreRequirement = Number.isFinite(minPercentage) && minPercentage > 0;
  const hasIncomeLimit = Number.isFinite(maxIncome) && maxIncome > 0 && maxIncome < 999999999;
  const genderIsRestricted = normalizeForDisplay(tags.gender) !== "all";

  return [
    { label: "Location", value: scope || "All India", tone: "fit" },
    { label: "Level", value: classes, tone: "fit" },
    genderIsRestricted ? { label: "Gender", value: gender, tone: "watch" } : null,
    {
      label: "Score",
      value: hasScoreRequirement ? `${minPercentage}%+ needed` : "No minimum listed",
      tone: getFitTone(hasScoreRequirement, userScore, minPercentage)
    },
    {
      label: "Income",
      value: hasIncomeLimit ? formatIncomeLimit(maxIncome) : "No limit listed",
      tone: getIncomeTone(hasIncomeLimit, userIncome, maxIncome)
    }
  ].filter(Boolean);
}

function getFitTone(hasRequirement, userValue, requiredValue) {
  if (!hasRequirement) return "neutral";
  if (!Number.isFinite(userValue)) return "watch";
  return userValue >= requiredValue ? "fit" : "watch";
}

function getIncomeTone(hasRequirement, userValue, maxValue) {
  if (!hasRequirement) return "neutral";
  if (!Number.isFinite(userValue)) return "watch";
  return userValue <= maxValue ? "fit" : "watch";
}

function repairDisplayText(value) {
  return String(value || "")
    .replace(/\u00e2\u201a\u00b9|\u20b9/g, "Rs. ")
    .replace(/\u00e2\u20ac\u201c|\u00e2\u20ac\u201d|\u00e2\u20ac\u2018/g, "-")
    .replace(/\u00e2\u2030\u00a5/g, ">=")
    .replace(/\u00e2\u2030\u00a4/g, "<=")
    .replace(/\u00e2\u20ac\u2122/g, "'")
    .replace(/\u00e2\u20ac\u0153|\u00e2\u20ac\u009d/g, '"')
    .replace(/\u00c2\u00a0/g, " ");
}

function getUsefulText(value) {
  const text = repairDisplayText(value).replace(/\s+/g, " ").trim();
  const normalized = normalizeForDisplay(text);

  if (!text) return "";
  if (["n a", "na", "not specified", "none", "unknown"].includes(normalized)) return "";
  if (normalized.startsWith("details not provided")) return "";
  if (normalized.startsWith("details not specified")) return "";
  if (normalized.includes("not provided in the source text")) return "";

  return text;
}

function getUsefulList(value) {
  if (Array.isArray(value)) {
    return value.map(getUsefulText).filter(Boolean);
  }

  const text = getUsefulText(value);
  return text ? [text] : [];
}

function cleanText(value, fallback = "") {
  return getUsefulText(value) || fallback;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function truncateText(text, limit) {
  if (!text) return "";
  if (text.length <= limit) return text;
  return `${text.slice(0, limit).trim()}...`;
}

function formatDeadlineInfo(value) {
  const deadlineDate = parseDeadlineDate(value);
  if (!deadlineDate) return "";

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  deadlineDate.setHours(0, 0, 0, 0);

  const daysLeft = Math.ceil((deadlineDate.getTime() - today.getTime()) / 86400000);

  if (daysLeft < 0) return { label: "Closed", tone: "closed" };
  if (daysLeft === 0) return { label: "Due today", tone: "urgent" };
  if (daysLeft === 1) return { label: "1 day left", tone: "urgent" };
  if (daysLeft <= 7) return { label: `${daysLeft} days left`, tone: "soon" };

  return { label: "Open", tone: "open" };
}

function parseDeadlineDate(value) {
  const text = getUsefulText(value)
    .replace(/\b(\d{1,2})(st|nd|rd|th)\b/gi, "$1")
    .replace(/-/g, " ");

  if (!text) return null;

  const parsed = Date.parse(text);
  if (!Number.isFinite(parsed)) return null;

  return new Date(parsed);
}

function formatClassList(classes) {
  if (!Array.isArray(classes) || classes.length === 0) return "Open to all levels";
  return classes.map((item) => cleanText(item, "")).filter(Boolean).slice(0, 3).join(", ") || "Open to all levels";
}

function formatGender(value) {
  const gender = cleanText(value, "All");
  return normalizeForDisplay(gender) === "all" ? "All genders" : gender;
}

function formatIncomeLimit(value) {
  const income = Number(value);
  if (!Number.isFinite(income) || income <= 0 || income >= 999999999) return "";

  if (income >= 100000) {
    const lakhValue = income / 100000;
    return `Up to Rs. ${Number.isInteger(lakhValue) ? lakhValue : lakhValue.toFixed(1)} Lakh`;
  }

  return `Up to Rs. ${income.toLocaleString("en-IN")}`;
}

function sanitizeUrl(value) {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) return "";
    return String(value).trim().endsWith("#") ? "" : url.href;
  } catch (error) {
    return "";
  }
}

function normalizeForDisplay(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function toCssClass(value) {
  return normalizeForDisplay(value).replace(/\s+/g, "-") || "scholarship";
}

function showOptions(options) {
  const div = document.createElement("div");
  div.className = "options-container fade-in";
  options.forEach((opt) => {
    const btn = document.createElement("button");
    btn.className = "option-pill";
    btn.innerText = opt;
    btn.onclick = () => handleInput(opt);
    div.appendChild(btn);
  });
  chatBox.appendChild(div);
  scrollToBottom();
}

function removeOptions() {
  const opts = document.querySelectorAll(".options-container");
  opts.forEach((o) => o.remove());
}

function addBotMessage(html, { scroll = true } = {}) {
  const div = document.createElement("div");
  div.className = "message bot-msg fade-in";
  div.innerHTML = html;
  div.id = "msg-" + Date.now();
  chatBox.appendChild(div);
  if (scroll) scrollToBottom();
  return div.id;
}

function addUserMessage(text) {
  const div = document.createElement("div");
  div.className = "message user-msg fade-in";
  div.innerText = text;
  chatBox.appendChild(div);
  scrollToBottom();
}

function scrollToBottom() {
  chatBox.scrollTop = chatBox.scrollHeight;
}

function scrollToElement(element) {
  if (!element) return;

  const chatRect = chatBox.getBoundingClientRect();
  const elementRect = element.getBoundingClientRect();
  chatBox.scrollTop += elementRect.top - chatRect.top - 8;
}

userInput.addEventListener("keypress", (e) => {
  if (e.key === "Enter") handleInput(userInput.value);
});
sendBtn.addEventListener("click", () => handleInput(userInput.value));
