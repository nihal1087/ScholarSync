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
  return (
    !text ||
    [
      "all",
      "all india",
      "india",
      "national",
      "pan india",
      "all states",
      "any",
    ].includes(text) ||
    text.includes("all india") ||
    text.includes("pan india")
  );
}

function getApplyLink(item) {
  return hasValue(item.apply_link) ? item.apply_link : item.url;
}

function isValidItem(item) {
  return item && hasValue(item.scholarship_name) && hasValue(getApplyLink(item));
}

function stemWord(word) {
  return String(word || "")
    .toLowerCase()
    .replace(/(?:ing|ies|es|s|ed|tion|tions)$/, "")
    .trim();
}

function cleanTokenStr(str) {
  return String(str || "")
    .toLowerCase()
    .replace(/(\d{4}[-\s]\d{2,4}|\d{4})/g, "")
    .replace(/\b(scholarship|fellowship|internship|scheme|program|programme|yojna|yojana|for|the|and|of|in|to|by|portal|online|apply|awards?)\b/gi, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function getStemmedTokens(str) {
  return cleanTokenStr(str)
    .split(/\s+/)
    .filter((w) => w.length > 2)
    .map(stemWord)
    .filter(Boolean);
}

function overlapSimilarity(titleA, titleB) {
  const setA = new Set(getStemmedTokens(titleA));
  const setB = new Set(getStemmedTokens(titleB));
  if (setA.size === 0 || setB.size === 0) return 0;

  let intersection = 0;
  for (const token of setA) {
    if (setB.has(token)) intersection += 1;
  }
  const minSize = Math.min(setA.size, setB.size);
  return intersection / minSize;
}

function isDuplicateRecord(itemA, itemB) {
  if (!itemA || !itemB) return false;
  const urlA = (itemA.url || itemA.apply_link || "").toLowerCase().trim();
  const urlB = (itemB.url || itemB.apply_link || "").toLowerCase().trim();
  if (urlA && urlB && urlA === urlB) return true;

  const overlap = overlapSimilarity(itemA.scholarship_name, itemB.scholarship_name);
  if (overlap >= 0.75) {
    const catA = (itemA.category || "Scholarship").toLowerCase();
    const catB = (itemB.category || "Scholarship").toLowerCase();
    if (catA === catB) return true;
  }

  return false;
}

module.exports = {
  normalizeText,
  hasValue,
  toNumber,
  isOpenScope,
  getApplyLink,
  isValidItem,
  stemWord,
  cleanTokenStr,
  getStemmedTokens,
  overlapSimilarity,
  isDuplicateRecord,
};
