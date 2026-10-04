import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { loadEnv } from "vite";

export default defineConfig(({ command, mode }) => {
  if (command === "build") {
    const base = loadEnv(mode, process.cwd(), "VITE_").VITE_API_BASE_URL?.trim();
    let origin: URL | undefined;
    try {
      origin = base ? new URL(base) : undefined;
    } catch {
      // Report configuration instructions without echoing the supplied value.
    }
    const local =
      origin && ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname);
    if (
      !origin ||
      (origin.protocol !== "https:" && !(local && origin.protocol === "http:")) ||
      origin.username ||
      origin.password ||
      origin.pathname !== "/" ||
      origin.search ||
      origin.hash
    )
      throw new Error(
        "Set VITE_API_BASE_URL to the deployed HTTPS API origin before building (no /api path). Local HTTP origins are allowed for preview checks.",
      );
  }
  return {
    plugins: [react(), tailwindcss()],
    // Prebundle lazy export dependencies before the first download, so Vite does
    // not reload the page and discard a trip when these modules are first opened.
    optimizeDeps: { include: ["html-to-image", "jspdf", "react-dom/server"] },
    resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
    server: {
      proxy: { "/api": { target: "http://127.0.0.1:8000", changeOrigin: true } },
    },
    test: {
      environment: "jsdom",
      setupFiles: ["./src/test/setup.ts"],
      clearMocks: true,
      restoreMocks: true,
    },
  };
});
