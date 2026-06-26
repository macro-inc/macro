#!/usr/bin/env node
import fs from "node:fs";

function updatePackageJson(path, update) {
  const packageJson = JSON.parse(fs.readFileSync(path, "utf8"));
  update(packageJson);
  fs.writeFileSync(path, `${JSON.stringify(packageJson, null, 2)}\n`);
}

// bun2nix fetches these Git dependencies, but Bun's install-time Git cache keys
// do not match the generated cache keys reliably. Remove them from the install
// graph and wire their fetched contents into node_modules in the Nix build.
updatePackageJson("app/package.json", packageJson => {
  delete packageJson.dependencies?.["@inkibra/tauri-plugins"];
});
updatePackageJson("app/packages/block-pdf/package.json", packageJson => {
  delete packageJson.dependencies?.["pdfjs-dist"];
});

// Vite can resolve imports from copied Git dependencies through /nix/store.
// Keep @tauri-apps/api anchored in the build tree so subpath imports such as
// @tauri-apps/api/core resolve consistently.
const viteConfigPath = "app/packages/app/vite.base.ts";
let viteConfig = fs.readFileSync(viteConfigPath, "utf8");
viteConfig = viteConfig.replace(
  "      resolve: {\n        dedupe:",
  "      resolve: {\n        alias: [\n          { find: /^@tauri-apps\\/api/, replacement: resolve(__dirname, '../../../node_modules/@tauri-apps/api') },\n        ],\n        dedupe:",
);
fs.writeFileSync(viteConfigPath, viteConfig);
