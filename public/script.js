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

const OPTIONS = {
  categories: ["Scholarship", "Fellowship", "Internship", "All"],
  states: ["All India", "Maharashtra", "Delhi", "Odisha", "Bihar", "Karnataka"],
  genders: ["Female", "Male", "All"],
  classes: ["Class 10", "Class 12", "UG", "PG", "PhD"],
  incomes: ["< 2.5 Lakh", "< 5 Lakh", "< 8 Lakh", "No Limit"]
};

window.onload = () => {
  addBotMessage("👋 Hi! I'm your Scholarship Assistant.");
  setTimeout(() => {
    addBotMessage("To get started, what type of opportunity are you looking for?");
    showOptions(OPTIONS.categories);
  }, 600);
};

function handleInput(text) {
  if (!text.trim()) return;

  userInput.value = "";
  removeOptions();
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
    const loaderId = addBotMessage(`<div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div>`);
    
    try {
        const response = await fetch('/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(userSelections)
        });
        const data = await response.json();
        
        document.getElementById(loaderId).remove(); 
        addBotMessage(data.reply);

        if (data.results.length > 0) {
            // Render Top 10 first
            const top10 = data.results.slice(0, 10);
            const remaining = data.results.slice(10);

            top10.forEach(renderCard);

            if (remaining.length > 0) {
                addShowMoreButton(remaining);
            }
        } else {
            addBotMessage("Would you like to try a different search?");
        }
        
        showOptions(["🔄 Start Over"]);

    } catch (e) {
        console.error(e);
        document.getElementById(loaderId).innerText = "⚠️ Server Error. Please ensure backend is running.";
    }
}


function addShowMoreButton(remainingItems) {
    const container = document.createElement('div');
    container.className = 'show-more-container fade-in';
    
    const btn = document.createElement('button');
    btn.className = 'show-more-btn';
    btn.innerText = `Show ${remainingItems.length} More ⇩`;
    
    btn.onclick = () => {
        container.remove();
        remainingItems.forEach(renderCard);
    };

    container.appendChild(btn);
    chatBox.appendChild(container);
    chatBox.scrollTop = chatBox.scrollHeight;
}

function renderCard(item) {
  const tags = item.tags || {};
  const reqs = item.requirements || {};
  const card = document.createElement("div");
  card.className = "result-card fade-in";

  let badgeStyle = "background:#eff6ff; color:#3b82f6;"; 
  if (item.category === "Fellowship") badgeStyle = "background:#fffbeb; color:#d97706;"; 
  if (item.category === "Internship") badgeStyle = "background:#f0fdf4; color:#16a34a;"; 

  // Dynamic Percentage Tag
  const percentTag = reqs.min_percentage > 0 
      ? `<div class="info-item" style="background:#fff1f2; color:#be123c;">📊 >${reqs.min_percentage}%</div>` 
      : '';

  card.innerHTML = `
        <div class="card-header">
            <h3>${item.scholarship_name}</h3>
            <span class="type-badge" style="${badgeStyle}">${item.category || "Scholarship"}</span>
        </div>
        <div class="card-info">
            <div class="info-item">📍 ${tags.state || "India"}</div>
            <div class="info-item">🎓 ${tags.class ? tags.class[0] : "General"}</div>
            ${percentTag}
        </div>
        <p class="eligibility" style="margin-top:8px; font-size:13px; color:#6b7280; line-height:1.4;">
            ${item.eligibility ? item.eligibility.substring(0, 100) + '...' : 'Check details.'}
        </p>
        <div class="card-footer">
            <div style="display:flex; flex-direction:column;">
                <span class="amount">💰 ${item.scholarship_amount || "Variable"}</span>
                <span style="font-size:11px; color:#9ca3af; margin-top:2px;">📅 Due: ${item.application_deadline || "Open"}</span>
            </div>
            <a href="${item.apply_link || item.url}" target="_blank" class="apply-btn">Apply ↗</a>
        </div>
    `;
  chatBox.appendChild(card);
  chatBox.scrollTop = chatBox.scrollHeight;
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