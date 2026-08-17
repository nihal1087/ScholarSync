const express = require("express");
const { AppError } = require("../middleware/errorHandler");
const validateChat = require("../middleware/validateChat");
const { findMatches, paginateMatches } = require("../services/matching");

const router = express.Router();

router.post("/", validateChat, (req, res, next) => {
  try {
    const { category, state, gender, education, percentage, income } = req.body;
    const offset = Math.max(0, Number.parseInt(req.body.offset, 10) || 0);
    const requestedLimit = Math.max(1, Number.parseInt(req.body.limit, 10) || 5);
    const showAll = req.body.showAll === true || req.body.showAll === "true";

    const filters = {
      category,
      state,
      gender,
      education,
      score: parseFloat(percentage) || 0,
      income: parseInt(income, 10) || 999999999,
    };

    const matches = findMatches(filters);
    const { results, total, nextOffset, hasMore } = paginateMatches(matches, {
      offset,
      limit: requestedLimit,
      showAll,
    });

    res.json({
      reply:
        total > 0
          ? `Found <strong>${total}</strong> opportunities matching your profile.`
          : "No exact matches found for your criteria.",
      total,
      offset,
      limit: results.length,
      nextOffset,
      hasMore,
      results,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
