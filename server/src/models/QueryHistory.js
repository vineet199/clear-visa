import mongoose from "mongoose";

const queryHistorySchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    profileId: { type: mongoose.Schema.Types.ObjectId, ref: "Profile" },
    type: { type: String, enum: ["analysis", "chat"], required: true },
    prompt: { type: String, required: true },
    response: { type: String, required: true },
    confidence: { type: String, enum: ["low", "medium", "high"], default: "medium" },
  },
  { timestamps: true }
);

export const QueryHistory = mongoose.model("QueryHistory", queryHistorySchema);
