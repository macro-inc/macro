import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Plugins that the generated Xcode project (src-tauri/gen/apple/project.yml)
// references directly as SwiftPM packages. Xcode resolves those packages
// before its "Build Rust Code" phase runs cargo, so the `.tauri/tauri-api`
// dependency in the plugin's Package.swift must already exist on a clean
// checkout. The other local plugins use `tauri_plugin::Builder::ios_path`,
// which copies the API and links the Swift package inside the cargo build,
// so they need no preparation.
//
// If a new plugin is added to project.yml `packages:` and Xcode fails to
// resolve with "Missing package product 'Tauri'", add it here.
const XCODE_SPM_PLUGINS = ["callkit_plugin"];

// Keep in sync with the excludes in tauri-plugin's `copy_folder` and in
// `prepare_ios_swift_package` (callkit_plugin/build.rs), which later
// refreshes this copy — identical filters keep the contents identical.
const COPY_IGNORE = new Set([".build", "Package.resolved", "Tests"]);

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tauriWorkspaceDir = path.join(appDir, "tauri");
const tauriCargoManifest = path.join(tauriWorkspaceDir, "Cargo.toml");

const metadata = JSON.parse(
  execFileSync(
    "cargo",
    [
      "metadata",
      "--locked",
      "--format-version",
      "1",
      "--manifest-path",
      tauriCargoManifest,
    ],
    {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "inherit"],
    },
  ),
);

const tauriPackage = metadata.packages.find((pkg) => pkg.name === "tauri");
if (!tauriPackage?.manifest_path) {
  console.error("Unable to find the resolved tauri package in Cargo metadata.");
  process.exit(1);
}

// The same path the tauri crate's build script exposes to plugin builds via
// `cargo:ios_library_path` (DEP_TAURI_IOS_LIBRARY_PATH).
const tauriIosApiDir = path.join(
  path.dirname(tauriPackage.manifest_path),
  "mobile",
  "ios-api",
);

if (!existsSync(path.join(tauriIosApiDir, "Package.swift"))) {
  console.error(`Resolved Tauri iOS API is missing: ${tauriIosApiDir}`);
  process.exit(1);
}

for (const plugin of XCODE_SPM_PLUGINS) {
  const pluginDir = path.join(tauriWorkspaceDir, plugin);
  if (!existsSync(path.join(pluginDir, "ios", "Package.swift"))) {
    console.error(`Expected an iOS Swift package at ${pluginDir}/ios`);
    process.exit(1);
  }

  const generatedDir = path.join(pluginDir, ".tauri");
  const targetDir = path.join(generatedDir, "tauri-api");

  mkdirSync(generatedDir, { recursive: true });
  rmSync(targetDir, { recursive: true, force: true });
  cpSync(tauriIosApiDir, targetDir, {
    recursive: true,
    filter: (source) => !COPY_IGNORE.has(path.basename(source)),
  });

  console.log(
    `Prepared ${path.relative(appDir, targetDir)} from ${tauriIosApiDir}`,
  );
}
