import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { Profile } from "../models/Profile.js";
import { QueryHistory } from "../models/QueryHistory.js";
import { runLLM } from "../lib/llm.js";

const router = Router();

router.post("/", requireAuth, async (req, res) => {
  const { profileId, message } = req.body;
  if (!message) return res.status(400).json({ error: "message required" });

  const profile = profileId
    ? await Profile.findOne({ _id: profileId, userId: req.user.sub })
    : null;

  const reply = await runLLM({
    system:
      "You are a migration and visa assistant. Use simple language, avoid guarantees, include uncertainty if relevant, and always include: This is not legal advice.",
    user: `Profile: ${profile ? JSON.stringify(profile.toObject()) : "Not provided"}\nUser question: ${message}`,
    fallback:
      "I couldn't fully process that right now. Please review official immigration sources and consult a licensed professional. This is not legal advice.",
  });

  await QueryHistory.create({
    userId: req.user.sub,
    profileId: profile?._id,
    type: "chat",
    prompt: message,
    response: reply,
    confidence: "medium",
  });

  res.json({ reply, disclaimer: "This is not legal advice." });
});

export default router;
