import { resolve } from "node:path";
import importMetaUrlPlugin from "@codingame/esbuild-import-meta-url-plugin";
import tailwind from "@tailwindcss/vite";
import { Features } from "lightningcss";
import type { UserConfigFn } from "vite";
import solid from "vite-plugin-solid";
import solidSvg from "vite-plugin-solid-svg";
import wasm from "vite-plugin-wasm";
import tsconfigpaths from "vite-tsconfig-paths";
// @ts-ignore
import { version } from "./package.json";

const PLATFORMS = ["web", "desktop", "ios", "android"] as const;

export type AppPlatform = (typeof PLATFORMS)[number];

export interface CreateAppViteConfigOptions {
  platform: AppPlatform;
}

export const createAppViteConfig = ({
  platform,
}: CreateAppViteConfigOptions): UserConfigFn => {
  return ({ command, mode }) => {
    const ENV_MODE = process.env.MODE ?? mode;
    const NO_MINIFY = process.env.NO_MINIFY === "true";
    const isLegacyTauriBuild = process.env.VITE_TAURI === "true";
    const isTauriPlatform = platform !== "web" || isLegacyTauriBuild;

    return {
      base: command === "serve" || isTauriPlatform ? "/" : "/app",
      assetsInclude: ["**/*.glb"],
      css: {
        preprocessorMaxWorkers: true,
        transformer: "lightningcss",
        lightningcss: {
          include: Features.VendorPrefixes,
        },
      },
      plugins: [
        // solidDevtools({ autoname: true }),
        solid(),
        wasm(),
        tailwind(),
        solidSvg({ defaultAsComponent: true }),
        tsconfigpaths({
          root: "../../",
        }),
      ],
      define: defineEnv(ENV_MODE, command, platform),
      clearScreen: false,
      worker: {
        format: "es",
        plugins: () => [
          tsconfigpaths({
            root: "../../",
          }),
        ],
        rollupOptions: {
          output: {
            format: "es",
            chunkFileNames: "[name]-[hash].js",
            entryFileNames: "[name]-[hash].js",
          },
        },
      },
      mode: ENV_MODE,
      build: {
        cssMinify: "lightningcss",
        // target older safari to avoid lightningcss using text-decoration shorthand:
        // https://developer.mozilla.org/en-US/docs/Web/CSS/text-decoration#browser_compatibility
        cssTarget: ["esnext", "safari15"],
        target: "esnext",
        outDir: "dist",
        emptyOutDir: true,
        minify: !NO_MINIFY,
        rollupOptions: {
          input: {
            app: resolve(__dirname, "index.html"),
          },
          output: NO_MINIFY
            ? {
                // remove hashes from output paths
                // https://github.com/vitejs/vite/issues/378
                entryFileNames: `assets/[name].js`,
                chunkFileNames: `assets/[name].js`,
                assetFileNames: `assets/[name].[ext]`,
              }
            : {
                format: "es",
                chunkFileNames: "[name]-[hash].js",
                entryFileNames: "[name]-[hash].js",
              },
        },
        assetsInlineLimit: (filePath) => {
          if (filePath.includes(".wasm")) return false;
          if (filePath.includes("/lok/")) return false;
        },
        sourcemap: true,
      },
      esbuild: {
        supported: {
          "top-level-await": true,
        },
        jsx: "automatic",
        jsxImportSource: "solid-js",
      },
      optimizeDeps: {
        include: [
          "vscode-textmate",
          "vscode-oniguruma",
          // 'solid-devtools/setup',
          "libheif-js/wasm-bundle",
        ],
        esbuildOptions: {
          target: "esnext",
          plugins: [importMetaUrlPlugin],
        },
      },
      resolve: {
        dedupe: [
          "@codingame/monaco-vscode-api",
          "@codingame/monaco-vscode-*-common",
        ],
      },
      server: {
        port: 3000,
        host: "0.0.0.0",
        strictPort: true,
        hmr: {
          protocol: "ws",
          host: process.env.TAURI_DEV_HOST || "localhost",
          port: 3000,
        },
        cors: true,
        watch: {
          usePolling: true,
          interval: 100,
        },
        fs: {
          allow: [
            // Allow serving files from the workspace root
            resolve(__dirname, "../../"),
          ],
        },
      },
    };
  };
};

function getAssetsPath(mode: string, command: string): string {
  switch (mode) {
    case "development":
      return command === "serve" ? "/local" : "/dev";
    case "staging":
      return "/staging";
    default:
      return "/";
  }
}

function getGqlService(mode: string): string {
  if (process.env.LOCAL_GQL_SERVER === "true") {
    console.log("Using Local GQL server");
    return "http://localhost:8080/graphql/";
  }

  if (mode === "development") {
    console.log("Using Dev GQL server");
    return "https://api-dev.macro.com/graphql/";
  }

  console.log("Using Prod GQL server");
  return "https://api.macro.com/graphql/";
}

function defineEnv(mode: string, command: string, platform: AppPlatform) {
  return {
    "import.meta.env.__APP_VERSION__": JSON.stringify(
      process.env.WEB_APP_VERSION || version,
    ),
    "import.meta.env.VITE_PLATFORM": JSON.stringify(platform),
    "import.meta.env.ASSETS_PATH": JSON.stringify(getAssetsPath(mode, command)),
    "import.meta.env.__LOCAL_GQL_SERVER__":
      process.env.LOCAL_GQL_SERVER === "true",
    "import.meta.env.__MACRO_GQL_SERVICE__": JSON.stringify(
      getGqlService(mode),
    ),
    "import.meta.env.__LOCAL_DOCKER__": process.env.LOCAL_DOCKER === "true",
    "import.meta.env.__LOCAL_JWT__": JSON.stringify(process.env.LOCAL_JWT),
  };
}
