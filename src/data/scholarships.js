const fs = require("fs");
const config = require("../config");

let scholarships = [];

function load() {
  try {
    const rawData = fs.readFileSync(config.dataPath);
    scholarships = JSON.parse(rawData);
    console.log(`Database loaded: ${scholarships.length} scholarships.`);
  } catch (error) {
    console.error(`Error: could not load ${config.dataPath}`);
    scholarships = [];
  }
}

function getAll() {
  return scholarships;
}

function getCount() {
  return scholarships.length;
}

load();

module.exports = { load, getAll, getCount };
