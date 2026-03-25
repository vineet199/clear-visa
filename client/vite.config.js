import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const base = env.VITE_PUBLIC_BASE_PATH || (mode === "production" ? "/clear-visa/" : "/");

  return {
    base,
    plugins: [react()],
    server: {
      port: 5173,
    },
  };
});
