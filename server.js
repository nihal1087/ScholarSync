const express = require("express");
const cors = require("cors");
const path = require("path");
const config = require("./src/config");
const chatRoutes = require("./src/routes/chat");
const { AppError, errorHandler } = require("./src/middleware/errorHandler");

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.use("/chat", chatRoutes);

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.all("*path", (req, _res, next) => {
  next(new AppError(`Cannot ${req.method} ${req.originalUrl}`, 404));
});

app.use(errorHandler);

app.listen(config.port, () => {
  console.log(`Server running at http://localhost:${config.port}`);
});
