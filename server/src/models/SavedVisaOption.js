import mongoose from "mongoose";

const savedVisaOptionSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    profileId: { type: mongoose.Schema.Types.ObjectId, ref: "Profile" },
    visaCode: { type: String, required: true },
    title: { type: String, required: true },
    destinationCountry: { type: String, required: true },
    notes: String,
  },
  { timestamps: true }
);

export const SavedVisaOption = mongoose.model("SavedVisaOption", savedVisaOptionSchema);
