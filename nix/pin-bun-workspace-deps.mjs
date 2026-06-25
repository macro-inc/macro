#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const root = process.argv[2] ? path.resolve(process.argv[2]) : process.cwd();
const lockPath = path.join(root, "bun.lock");
const lock = vm.runInNewContext(`(${fs.readFileSync(lockPath, "utf8")})`);

function parsePackageSpec(spec) {
  const at = spec.lastIndexOf("@");
  if (at <= 0) return null;
  return { name: spec.slice(0, at), version: spec.slice(at + 1) };
}

const resolutions = new Map();
for (const [key, value] of Object.entries(lock.packages ?? {})) {
  const spec = value[0];
  if (typeof spec !== "string" || spec.includes("@workspace:")) continue;

  if (value.length === 4 && value[1] === "") {
    const parsed = parsePackageSpec(spec);
    if (parsed && key === parsed.name) {
      resolutions.set(parsed.name, parsed.version);
    }
  }
}

const dependencyFields = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
];

function shouldKeepSpecifier(spec) {
  return (
    spec.startsWith("workspace:") ||
    spec.startsWith("file:") ||
    spec.startsWith("link:") ||
    spec.startsWith("github:") ||
    spec.startsWith("git+") ||
    spec.startsWith("http:") ||
    spec.startsWith("https:") ||
    spec.startsWith("catalog:") ||
    spec === "catalog"
  );
}

let changedLock = false;
for (const value of Object.values(lock.packages ?? {})) {
  for (const maybeMetadata of value) {
    if (!maybeMetadata || typeof maybeMetadata !== "object" || Array.isArray(maybeMetadata)) continue;

    for (const field of dependencyFields) {
      const deps = maybeMetadata[field];
      if (!deps) continue;

      for (const [name, spec] of Object.entries(deps)) {
        if (typeof spec !== "string" || shouldKeepSpecifier(spec)) continue;
        const version = resolutions.get(name);
        if (version && spec !== version) {
          deps[name] = version;
          changedLock = true;
        }
      }
    }
  }
}

for (const workspace of Object.values(lock.workspaces ?? {})) {
  for (const field of dependencyFields) {
    const deps = workspace[field];
    if (!deps) continue;

    for (const [name, spec] of Object.entries(deps)) {
      if (typeof spec !== "string" || shouldKeepSpecifier(spec)) continue;
      const version = resolutions.get(name);
      if (version && spec !== version) {
        deps[name] = version;
        changedLock = true;
      }
    }
  }
}

if (changedLock) {
  fs.writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
}

let changedFiles = 0;
for (const workspacePath of Object.keys(lock.workspaces ?? {})) {
  const packageJsonPath = path.join(root, workspacePath, "package.json");
  if (!fs.existsSync(packageJsonPath)) continue;

  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
  let changed = false;

  for (const field of dependencyFields) {
    const deps = packageJson[field];
    if (!deps) continue;

    for (const [name, spec] of Object.entries(deps)) {
      if (typeof spec !== "string" || shouldKeepSpecifier(spec)) continue;
      const version = resolutions.get(name);
      if (version && spec !== version) {
        deps[name] = version;
        changed = true;
      }
    }
  }

  if (changed) {
    fs.writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);
    changedFiles += 1;
  }
}

console.error(`Pinned Bun workspace dependency ranges in ${changedFiles} package.json files${changedLock ? " and bun.lock" : ""}`);
