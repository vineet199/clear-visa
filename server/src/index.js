import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import rateLimit from "express-rate-limit";
import { connectDB } from "./lib/db.js";
import authRoutes from "./routes/auth.routes.js";
import visaRoutes from "./routes/visa.routes.js";
import chatRoutes from "./routes/chat.routes.js";
import { startCrawlerScheduler } from "./services/crawler.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.use(
  "/api",
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 100,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

app.get("/api/health", (_req, res) => res.json({ ok: true }));
app.use("/api/auth", authRoutes);
app.use("/api/visa", visaRoutes);
app.use("/api/chat", chatRoutes);

connectDB().then(() => {
  app.listen(PORT, () => {
    console.log(`Server listening on http://localhost:${PORT}`);
    startCrawlerScheduler();
  });
});
