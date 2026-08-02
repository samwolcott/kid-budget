import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  site: "https://samwolcott.github.io",
  base: "/kid-budget",
  vite: {
    plugins: [tailwindcss()],
  },
});