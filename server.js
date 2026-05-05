const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 4001;

app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));

const DATA_PATH = path.join(__dirname, 'data', 'scholarships.json');
const DEFAULT_PAGE_SIZE = 5;
const MAX_PAGE_SIZE = 10;
let SCHOLARSHIPS = [];

try {
    const rawData = fs.readFileSync(DATA_PATH);
    SCHOLARSHIPS = JSON.parse(rawData);
    console.log(`Database loaded: ${SCHOLARSHIPS.length} scholarships.`);
} catch (error) {
    console.error("Error: 'data/scholarships.json' is missing.");
}

function normalizeText(value) {
    return String(value || "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .trim();
}

function hasValue(value) {
    const text = normalizeText(value);
    return text && !["n a", "na", "not specified", "none", "unknown"].includes(text);
}

function toNumber(value, fallback) {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function isOpenScope(value) {
    const text = normalizeText(value);
    return !text || [
        "all",
        "all india",
        "india",
        "national",
        "pan india",
        "all states",
        "any"
    ].includes(text) || text.includes("all india") || text.includes("pan india");
}

function getApplyLink(item) {
    return hasValue(item.apply_link) ? item.apply_link : item.url;
}

function isValidItem(item) {
    return item && hasValue(item.scholarship_name) && hasValue(getApplyLink(item));
}

function getClassAliases(value) {
    const text = normalizeText(value);

    if (!text) return [];
    if (text.includes("10")) return ["class 10", "10", "pre matric", "matric"];
    if (text.includes("12")) return ["class 12", "12", "post matric", "intermediate", "higher secondary"];
    if (text.includes("ug") || text.includes("undergrad") || text.includes("bachelor")) {
        return ["ug", "undergraduate", "bachelor", "b tech", "be", "graduation", "degree", "post matric"];
    }
    if (text.includes("pg") || text.includes("master") || text.includes("postgrad")) {
        return ["pg", "postgraduate", "master", "m tech", "mba", "msc", "ma", "post matric"];
    }
    if (text.includes("phd") || text.includes("ph d") || text.includes("doctor")) {
        return ["phd", "ph d", "doctoral", "doctorate", "research"];
    }

    return [text];
}

function matchCategory(item, category) {
    const requested = normalizeText(category);
    if (!requested || requested === "all") return true;
    return normalizeText(item.category) === requested;
}

function matchState(itemState, userState) {
    const item = normalizeText(itemState);
    const user = normalizeText(userState);

    if (!user || isOpenScope(user)) {
        return { ok: true, score: isOpenScope(item) ? 1 : 2, label: isOpenScope(item) ? "All India" : itemState };
    }

    if (isOpenScope(item)) {
        return { ok: true, score: 1, label: "All India" };
    }

    if (item.includes(user) || user.includes(item)) {
        return { ok: true, score: 3, label: itemState };
    }

    return { ok: false, score: 0, label: itemState || "All India" };
}

function matchGender(itemGender, userGender) {
    const item = normalizeText(itemGender || "All");
    const user = normalizeText(userGender || "All");
    return !user || user === "all" || item === "all" || item === user;
}

function matchClass(itemClasses, education) {
    const classes = Array.isArray(itemClasses) ? itemClasses.map(normalizeText).filter(Boolean) : [];
    const aliases = getClassAliases(education);

    if (!aliases.length || classes.length === 0) {
        return { ok: true, score: classes.length === 0 ? 0 : 1 };
    }

    const ok = classes.some(itemClass => aliases.some(alias => itemClass.includes(alias) || alias.includes(itemClass)));
    return { ok, score: ok ? 2 : 0 };
}

function parseDeadline(value) {
    if (!hasValue(value)) return Number.POSITIVE_INFINITY;
    const time = Date.parse(value);
    return Number.isFinite(time) ? time : Number.POSITIVE_INFINITY;
}

function buildMatch(item, filters) {
    if (!isValidItem(item) || !item.tags) return null;

    const tags = item.tags || {};
    const requirements = item.requirements || {};
    const state = matchState(tags.state, filters.state);
    const classMatch = matchClass(tags.class, filters.education);
    const minPercentage = Math.max(0, toNumber(requirements.min_percentage, 0));
    const maxIncome = Math.max(0, toNumber(requirements.max_family_income, 999999999)) || 999999999;

    if (!matchCategory(item, filters.category)) return null;
    if (!state.ok) return null;
    if (!matchGender(tags.gender, filters.gender)) return null;
    if (!classMatch.ok) return null;
    if (filters.score < minPercentage) return null;
    if (filters.income > maxIncome) return null;

    const score = state.score + classMatch.score + (minPercentage > 0 ? 1 : 0) + (maxIncome < 999999999 ? 1 : 0);

    return {
        ...item,
        _match: {
            score,
            scope: state.label || "All India"
        }
    };
}

app.post('/chat', (req, res) => {
    const { category, state, gender, education, percentage, income } = req.body;
    const offset = Math.max(0, Number.parseInt(req.body.offset, 10) || 0);
    const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, Number.parseInt(req.body.limit, 10) || DEFAULT_PAGE_SIZE));

    const userScore = parseFloat(percentage) || 0;
    const userIncome = parseInt(income) || 999999999;
    const filters = {
        category,
        state,
        gender,
        education,
        score: userScore,
        income: userIncome
    };

    console.log("Filter request:", req.body);

    const seen = new Set();
    const matches = SCHOLARSHIPS
        .map(item => buildMatch(item, filters))
        .filter(Boolean)
        .filter(item => {
            const key = normalizeText(getApplyLink(item) || item.scholarship_name);
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });

    matches.sort((a, b) => {
        if (b._match.score !== a._match.score) return b._match.score - a._match.score;
        return parseDeadline(a.application_deadline) - parseDeadline(b.application_deadline);
    });

    const results = matches.slice(offset, offset + limit);
    const nextOffset = offset + results.length;

    res.json({
        reply: matches.length > 0
            ? `Found <b>${matches.length}</b> opportunities matching your profile.` 
            : `No exact matches found for your criteria.`,
        total: matches.length,
        offset,
        limit,
        nextOffset,
        hasMore: nextOffset < matches.length,
        results
    });
});

app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});
