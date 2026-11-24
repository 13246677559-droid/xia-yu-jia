import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const themeDir = fileURLToPath(new URL("../latex", import.meta.url));
const logoPath = fileURLToPath(new URL("../assets/whu-logo-white.png", import.meta.url));

function themePlugin(): Plugin {
  const virtualId = "virtual:xyj-theme";
  const resolvedId = `\0${virtualId}`;
  return {
    name: "xyj-theme",
    resolveId(id) {
      return id === virtualId ? resolvedId : undefined;
    },
    load(id) {
      if (id !== resolvedId) return undefined;
      const files: Record<string, string> = {};
      for (const name of readdirSync(themeDir).filter((file) => file.endsWith(".sty"))) {
        const path = resolve(themeDir, name);
        files[name] = readFileSync(path, "utf8");
        this.addWatchFile(path);
      }
      this.addWatchFile(logoPath);
      const logoBase64 = readFileSync(logoPath).toString("base64");
      return `export const themeFiles = ${JSON.stringify(files)};\nexport const logoBase64 = ${JSON.stringify(logoBase64)};\n`;
    },
  };
}

export default defineConfig({
  plugins: [react(), themePlugin()],
});
