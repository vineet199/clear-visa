import mongoose from "mongoose";

const profileSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    countryOfOrigin: String,
    destinationCountry: String,
    purpose: String,
    educationLevel: String,
    yearsExperience: Number,
    budgetUsd: Number,
    englishLevel: String,
    notes: String,
  },
  { timestamps: true }
);

export const Profile = mongoose.model("Profile", profileSchema);
