import { defineConfig } from "vite";
import { resolve } from "node:path";

// Built into ../v2 (served by GitHub Pages at /Wolf-Strike/v2/). Shared v1 assets are read from ../assets at runtime.
export default defineConfig({
    base: "./",
    build: {
        outDir: resolve(__dirname, "../v2"),
        emptyOutDir: true,
        assetsDir: "js",
        target: "es2020",
        chunkSizeWarningLimit: 6000,
        rollupOptions: {
            // dev tools (model viewer, animation check, navmesh builder) only with TOOLS=1
            input: {
                main: resolve(__dirname, "index.html"),
                ...(process.env.TOOLS
                    ? {
                          viewer: resolve(__dirname, "viewer.html"),
                          animtest: resolve(__dirname, "animtest.html"),
                          navbuild: resolve(__dirname, "navbuild.html"),
                      }
                    : {}),
            },
        },
    },
});
