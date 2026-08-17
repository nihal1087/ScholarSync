const { AppError } = require("./errorHandler");

function validateChat(req, _res, next) {
  const { category, state, gender, education, percentage, income } = req.body;

  if (!category || typeof category !== "string") {
    return next(new AppError("Missing or invalid 'category' field", 400));
  }

  if (!state || typeof state !== "string") {
    return next(new AppError("Missing or invalid 'state' field", 400));
  }

  if (!gender || typeof gender !== "string") {
    return next(new AppError("Missing or invalid 'gender' field", 400));
  }

  if (!education || typeof education !== "string") {
    return next(new AppError("Missing or invalid 'education' field", 400));
  }

  if (percentage !== undefined && percentage !== null && isNaN(parseFloat(percentage))) {
    return next(new AppError("'percentage' must be a number", 400));
  }

  if (income !== undefined && income !== null && isNaN(parseInt(income, 10))) {
    return next(new AppError("'income' must be a number", 400));
  }

  next();
}

module.exports = validateChat;
