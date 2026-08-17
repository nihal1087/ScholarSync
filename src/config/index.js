const path = require("path");

const config = {
  port: parseInt(process.env.PORT, 10) || 4002,
  dataPath: path.join(__dirname, "..", "..", "data", "scholarships.json"),
  defaultPageSize: 5,
  maxPageSize: 10,
};

module.exports = config;
