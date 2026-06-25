#!/usr/bin/env node
import fs from "node:fs";
import http from "node:http";
import path from "node:path";

const packagesDir = process.argv[2];
if (!packagesDir) {
  console.error("usage: local-bun-registry.mjs <bunDeps/share/bun-packages>");
  process.exit(64);
}

const packages = new Map();

function addPackage(dir) {
  const packageJsonPath = path.join(dir, "package.json");
  if (!fs.existsSync(packageJsonPath)) return;
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
  const { name, version } = packageJson;
  if (!name || !version) return;

  if (!packages.has(name)) {
    packages.set(name, { _id: name, name, "dist-tags": { latest: version }, versions: {} });
  }
  const metadata = packages.get(name);
  metadata.versions[version] = {
    ...packageJson,
    dist: {
      ...(packageJson.dist || {}),
      tarball: `https://registry.npmjs.org/${name}/-/${name.startsWith("@") ? name.split("/")[1] : name}-${version}.tgz`,
    },
  };
  if (version.localeCompare(metadata["dist-tags"].latest, undefined, { numeric: true }) > 0) {
    metadata["dist-tags"].latest = version;
  }
}

for (const entry of fs.readdirSync(packagesDir)) {
  const entryPath = path.join(packagesDir, entry);
  if (!fs.statSync(entryPath).isDirectory()) continue;
  if (entry.startsWith("@")) {
    for (const scopedEntry of fs.readdirSync(entryPath)) {
      const scopedPath = path.join(entryPath, scopedEntry);
      if (fs.statSync(scopedPath).isDirectory()) addPackage(scopedPath);
    }
  } else {
    addPackage(entryPath);
  }
}

const server = http.createServer((req, res) => {
  const packageName = decodeURIComponent(new URL(req.url, "http://127.0.0.1").pathname.slice(1));
  const metadata = packages.get(packageName);
  if (!metadata) {
    res.writeHead(404);
    res.end(`missing package metadata: ${packageName}\n`);
    return;
  }
  res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(metadata));
});

server.listen(0, "127.0.0.1", () => {
  console.log(server.address().port);
});
