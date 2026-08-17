const { normalizeText, hasValue, toNumber, isOpenScope, getApplyLink, isValidItem } = require("../utils/text");
const { getAll } = require("../data/scholarships");
const config = require("../config");

const CLASS_ALIASES = {
  10: ["class 10", "10", "pre matric", "matric"],
  12: ["class 12", "12", "post matric", "intermediate", "higher secondary"],
  ug: ["ug", "undergraduate", "bachelor", "b tech", "be", "graduation", "degree", "post matric"],
  pg: ["pg", "postgraduate", "master", "m tech", "mba", "msc", "ma", "post matric"],
  phd: ["phd", "ph d", "doctoral", "doctorate", "research"],
};

function getClassAliases(value) {
  const text = normalizeText(value);
  if (!text) return [];

  if (text.includes("10")) return CLASS_ALIASES[10];
  if (text.includes("12")) return CLASS_ALIASES[12];
  if (text.includes("ug") || text.includes("undergrad") || text.includes("bachelor")) return CLASS_ALIASES.ug;
  if (text.includes("pg") || text.includes("master") || text.includes("postgrad")) return CLASS_ALIASES.pg;
  if (text.includes("phd") || text.includes("ph d") || text.includes("doctor")) return CLASS_ALIASES.phd;

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

  const ok = classes.some((itemClass) => aliases.some((alias) => itemClass.includes(alias) || alias.includes(itemClass)));
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
      scope: state.label || "All India",
    },
  };
}

function findMatches(filters) {
  const scholarships = getAll();
  const seen = new Set();

  const matches = scholarships
    .map((item) => buildMatch(item, filters))
    .filter(Boolean)
    .filter((item) => {
      const key = normalizeText(getApplyLink(item) || item.scholarship_name);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  matches.sort((a, b) => {
    if (b._match.score !== a._match.score) return b._match.score - a._match.score;
    return parseDeadline(a.application_deadline) - parseDeadline(b.application_deadline);
  });

  return matches;
}

function paginateMatches(matches, { offset = 0, limit = config.defaultPageSize, showAll = false } = {}) {
  const effectiveLimit = showAll
    ? Math.max(0, matches.length - offset)
    : Math.min(config.maxPageSize, limit);

  const results = matches.slice(offset, offset + effectiveLimit);
  const nextOffset = offset + results.length;

  return {
    results,
    total: matches.length,
    offset,
    limit: effectiveLimit,
    nextOffset,
    hasMore: nextOffset < matches.length,
  };
}

module.exports = { findMatches, paginateMatches };
