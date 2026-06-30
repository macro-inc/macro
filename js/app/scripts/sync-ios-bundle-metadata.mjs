import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcTauriDir = path.join(appDir, "tauri", "src-tauri");
const iosConfigPath = path.join(srcTauriDir, "tauri.ios.conf.json");
const generatedAppleDir = path.join(srcTauriDir, "gen", "apple");

const iosConfig = JSON.parse(readFileSync(iosConfigPath, "utf8"));
const marketingVersion = iosConfig.version;
const bundleVersion = iosConfig.bundle?.iOS?.bundleVersion;

if (typeof marketingVersion !== "string") {
  console.error(`${path.relative(appDir, iosConfigPath)} must define a string "version".`);
  process.exit(1);
}

if (!/^\d+\.\d+\.\d+$/.test(marketingVersion)) {
  console.error(
    `"${marketingVersion}" is not a valid iOS CFBundleShortVersionString. Use exactly three dot-separated integers, e.g. "2.0.6".`,
  );
  process.exit(1);
}

if (typeof bundleVersion !== "string") {
  console.error(
    `${path.relative(appDir, iosConfigPath)} must define a string "bundle.iOS.bundleVersion".`,
  );
  process.exit(1);
}

if (!/^\d+(?:\.\d+)*$/.test(bundleVersion)) {
  console.error(
    `"${bundleVersion}" is not a valid iOS CFBundleVersion. Use period-separated integers, e.g. "100" or "2.0.6.100".`,
  );
  process.exit(1);
}

const plistPaths = [
  path.join(generatedAppleDir, "app_iOS", "Info.plist"),
  path.join(generatedAppleDir, "ShareExtension", "Info.plist"),
  path.join(generatedAppleDir, "NotificationServiceExtension", "Info.plist"),
];

const plistValues = [
  ["CFBundleShortVersionString", marketingVersion],
  ["CFBundleVersion", bundleVersion],
];

for (const plistPath of plistPaths) {
  if (!existsSync(plistPath)) {
    continue;
  }

  for (const [key, value] of plistValues) {
    const currentValue = execFileSync(
      "/usr/libexec/PlistBuddy",
      ["-c", `Print :${key}`, plistPath],
      { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
    ).trim();

    if (currentValue === value) {
      continue;
    }

    execFileSync(
      "/usr/libexec/PlistBuddy",
      ["-c", `Set :${key} ${value}`, plistPath],
      { stdio: ["ignore", "ignore", "inherit"] },
    );
  }
}

const projectYmlPath = path.join(generatedAppleDir, "project.yml");
if (existsSync(projectYmlPath)) {
  const projectYml = readFileSync(projectYmlPath, "utf8");
  const updatedProjectYml = projectYml
    .replace(
      /^(\s*CFBundleShortVersionString:\s*).+$/gm,
      `$1${marketingVersion}`,
    )
    .replace(
      /^(\s*CFBundleVersion:\s*).+$/gm,
      `$1${JSON.stringify(bundleVersion)}`,
    );

  if (updatedProjectYml !== projectYml) {
    writeFileSync(projectYmlPath, updatedProjectYml);
  }
}

console.log(
  `Synced iOS bundle metadata to CFBundleShortVersionString=${marketingVersion}, CFBundleVersion=${bundleVersion}`,
);
