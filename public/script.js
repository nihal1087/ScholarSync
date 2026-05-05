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
const RESULT_PAGE_SIZE = 5;
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
  await loadResultsPage(true);
}

async function loadResultsPage(reset = false) {
  if (resultCursor.loading) return;

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

  const loaderId = addBotMessage(`<div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div>`);

  try {
    const response = await fetch('/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...userSelections,
        offset: reset ? 0 : resultCursor.nextOffset,
        limit: RESULT_PAGE_SIZE
      })
    });

    if (!response.ok) throw new Error(`Request failed with status ${response.status}`);

    const data = await response.json();
    const loader = document.getElementById(loaderId);
    if (loader) loader.remove();

    resultCursor.total = data.total || 0;
    resultCursor.nextOffset = data.nextOffset || 0;
    resultCursor.hasMore = Boolean(data.hasMore);

    if (reset) {
      addBotMessage(data.reply);
    } else if (data.results.length > 0) {
      addBotMessage(`Showing ${data.offset + 1}-${data.nextOffset} of ${data.total} matches.`);
    }

    if (data.results.length > 0) {
      await renderCardsGradually(data.results);
    } else if (reset) {
      addBotMessage("Would you like to try a different search?");
    }

    addResultActions();
  } catch (e) {
    console.error(e);
    const loader = document.getElementById(loaderId);
    if (loader) loader.innerText = "Server error. Please ensure the backend is running.";
  } finally {
    resultCursor.loading = false;
  }
}

function addResultActions() {
  removeResultActions();

  const container = document.createElement('div');
  container.className = 'result-actions fade-in';

  if (resultCursor.hasMore) {
    const remaining = Math.max(0, resultCursor.total - resultCursor.nextOffset);
    const btn = document.createElement('button');
    btn.className = 'show-more-btn';
    btn.innerText = `Show next ${Math.min(RESULT_PAGE_SIZE, remaining)}`;
    btn.onclick = () => loadResultsPage(false);
    container.appendChild(btn);
  }

  const restartBtn = document.createElement('button');
  restartBtn.className = 'restart-btn';
  restartBtn.innerText = 'Start Over';
  restartBtn.onclick = () => handleInput('Start Over');
  container.appendChild(restartBtn);

  chatBox.appendChild(container);
  chatBox.scrollTop = chatBox.scrollHeight;
}

function removeResultActions() {
  const actions = document.querySelectorAll(".result-actions");
  actions.forEach((action) => action.remove());
}

function renderCardsGradually(items) {
  return items.reduce((chain, item, index) => {
    return chain.then(() => new Promise((resolve) => {
      setTimeout(() => {
        renderCard(item);
        resolve();
      }, index === 0 ? 0 : 140);
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
  const amount = cleanText(item.scholarship_amount, "Variable");
  const deadline = cleanText(item.application_deadline, "Open");
  const eligibility = truncateText(cleanText(item.eligibility, "Check the official page for eligibility details."), 220);
  const minScore = Number(reqs.min_percentage) > 0 ? `${reqs.min_percentage}%` : "Not specified";
  const incomeLimit = formatIncomeLimit(reqs.max_family_income);
  const applyLink = sanitizeUrl(item.apply_link || item.url);

  card.innerHTML = `
        <div class="card-header">
            <div>
                <span class="type-badge ${category.toLowerCase()}">${escapeHtml(category)}</span>
                <h3>${escapeHtml(cleanText(item.scholarship_name, "Scholarship opportunity"))}</h3>
            </div>
        </div>
        <div class="card-summary">
            <div class="detail-item">
                <span class="detail-label">Amount</span>
                <strong>${escapeHtml(amount)}</strong>
            </div>
            <div class="detail-item">
                <span class="detail-label">Deadline</span>
                <strong>${escapeHtml(deadline)}</strong>
            </div>
        </div>
        <div class="card-info">
            <span class="info-item">Scope: ${escapeHtml(scope)}</span>
            <span class="info-item">Level: ${escapeHtml(classes)}</span>
            <span class="info-item">Min score: ${escapeHtml(minScore)}</span>
            <span class="info-item">Income: ${escapeHtml(incomeLimit)}</span>
        </div>
        <p class="eligibility">
            ${escapeHtml(eligibility)}
        </p>
        <div class="card-footer">
            <span class="match-note">${escapeHtml(scope)} match</span>
            <a href="${applyLink}" target="_blank" rel="noopener noreferrer" class="apply-btn">View Details</a>
        </div>
    `;
  chatBox.appendChild(card);
  chatBox.scrollTop = chatBox.scrollHeight;
}

function cleanText(value, fallback) {
  const text = String(value || "").trim();
  if (!text || ["N/A", "NA", "Not specified", "None", "Unknown"].includes(text)) return fallback;
  return text;
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
  if (text.length <= limit) return text;
  return `${text.slice(0, limit).trim()}...`;
}

function formatClassList(classes) {
  if (!Array.isArray(classes) || classes.length === 0) return "Open to all levels";
  return classes.map((item) => cleanText(item, "")).filter(Boolean).slice(0, 3).join(", ") || "Open to all levels";
}

function formatIncomeLimit(value) {
  const income = Number(value);
  if (!Number.isFinite(income) || income <= 0 || income >= 999999999) return "No limit";

  if (income >= 100000) {
    const lakhValue = income / 100000;
    return `Up to Rs. ${Number.isInteger(lakhValue) ? lakhValue : lakhValue.toFixed(1)} Lakh`;
  }

  return `Up to Rs. ${income.toLocaleString("en-IN")}`;
}

function sanitizeUrl(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.href : "#";
  } catch (error) {
    return "#";
  }
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
  chatBox.scrollTop = chatBox.scrollHeight;
}

function removeOptions() {
  const opts = document.querySelectorAll(".options-container");
  opts.forEach((o) => o.remove());
}

function addBotMessage(html) {
  const div = document.createElement("div");
  div.className = "message bot-msg fade-in";
  div.innerHTML = html;
  div.id = "msg-" + Date.now();
  chatBox.appendChild(div);
  chatBox.scrollTop = chatBox.scrollHeight;
  return div.id;
}

function addUserMessage(text) {
  const div = document.createElement("div");
  div.className = "message user-msg fade-in";
  div.innerText = text;
  chatBox.appendChild(div);
  chatBox.scrollTop = chatBox.scrollHeight;
}

userInput.addEventListener("keypress", (e) => {
  if (e.key === "Enter") handleInput(userInput.value);
});
sendBtn.addEventListener("click", () => handleInput(userInput.value));
