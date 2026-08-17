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

module.exports = {
  normalizeText,
  hasValue,
  toNumber,
  isOpenScope,
  getApplyLink,
  isValidItem,
};
