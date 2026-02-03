const chatBox = document.getElementById("chat-box");
const userInput = document.getElementById("user-input");
const sendBtn = document.getElementById("send-btn");

const FLOW = {
  STATE: 1,
  GENDER: 2,
  CLASS: 3,
  FINISHED: 4,
};

let currentStep = FLOW.STATE;
let userSelections = { state: null, gender: null, education: null };

const OPTIONS = {
  states: ["All India", "Maharashtra", "Delhi", "Odisha", "Bihar", "Karnataka"],
  genders: ["Female", "Male", "All"],
  classes: ["Class 10", "Class 12", "UG", "PG", "PhD"],
};

window.onload = () => {
  addBotMessage("👋 Hi! I'm your Scholarship Assistant.");
  setTimeout(() => {
    addBotMessage(
      "Let's find funding for you. First, which <b>State</b> are you from?",
    );
    showOptions(OPTIONS.states);
  }, 600);
};

function handleInput(text) {
  if (!text.trim()) return;

  userInput.value = "";
  removeOptions();
  addUserMessage(text);

  setTimeout(() => {
    switch (currentStep) {
      case FLOW.STATE:
        userSelections.state = text;
        currentStep = FLOW.GENDER;
        addBotMessage(
          "Got it. What is your <b>Gender</b>? (Some grants are gender-specific)",
        );
        showOptions(OPTIONS.genders);
        break;

      case FLOW.GENDER:
        userSelections.gender = text;
        currentStep = FLOW.CLASS;
        addBotMessage(
          "Great. Finally, what is your current <b>Education Level</b>?",
        );
        showOptions(OPTIONS.classes);
        break;

      case FLOW.CLASS:
        userSelections.education = text;
        currentStep = FLOW.FINISHED;
        fetchResults();
        break;

      case FLOW.FINISHED:
        addBotMessage("Starting a new search...");
        setTimeout(() => location.reload(), 1000);
        break;
    }
  }, 500); 
}

async function fetchResults() {
  const loaderId = addBotMessage(
    `<div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div>`,
  );

  try {
    const response = await fetch("/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(userSelections),
    });
    const data = await response.json();

    document.getElementById(loaderId).remove(); 
    addBotMessage(data.reply);

    if (data.results.length > 0) {
      data.results.forEach(renderCard);
    } else {
      addBotMessage("Would you like to try a different search?");
    }

    showOptions(["🔄 Start Over"]);
  } catch (e) {
    console.error(e);
    document.getElementById(loaderId).innerText =
      "⚠️ Server Error. Please ensure backend is running.";
  }
}

function renderCard(item) {
  const tags = item.tags || {};
  const card = document.createElement("div");
  card.className = "result-card fade-in";

  card.innerHTML = `
        <div class="card-header">
            <h3>${item.scholarship_name}</h3>
            <span class="type-badge">${item.type}</span>
        </div>
        <div class="card-tags">
            <span>📍 ${tags.state || "All India"}</span>
            <span>🎓 ${tags.class ? tags.class[0] : "General"}</span>
        </div>
        <p class="eligibility">${item.eligibility}</p>
        <div class="card-footer">
            <span class="amount">💰 ${item.scholarship_amount}</span>
            <a href="${item.apply_link}" target="_blank" class="apply-btn">Apply ↗</a>
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
