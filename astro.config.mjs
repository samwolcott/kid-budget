import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";

const isGitHubPages = process.env.GITHUB_ACTIONS === "true";

export default defineConfig({
  site: "https://samwolcott.github.io",
  base: isGitHubPages ? "/kid-budget/" : "/",
  vite: {
    plugins: [tailwindcss()],
  },
});
