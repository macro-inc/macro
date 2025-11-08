// Log commits since <HASH> that affect this crate or upstream crates
// Usage:
// bun scripts/changes_since.js <HASH>

import ps from 'node:child_process';
import fs from 'node:fs';

/**
 *
 * @param {string} path
 * @returns {undefined | [string, string[]]}
 */
function get_local_dependencies(path) {
  let manifest = fs.readFileSync(`${path}/Cargo.toml`, 'utf-8');
  const match = manifest.match(/name = "(.*?)"/);
  const name = match ? match[1] : null;
  if (!name) return;
  let dependencies = manifest
    .split('\n')
    .map((line) => line.match(/path\s*=\s*"([^"]+)"/))
    .filter((path) => path !== null)
    .map((match) => match[1])
    .filter((path) => fs.existsSync(`${path}/Cargo.toml`));
  return [name, dependencies];
}

const allCommits = {};
const processed = new Set();
/**
 *
 * @param {string} path
 * @param {string} sinceCommit
 * @returns {[string, string[]]}
 */
function log_dependencies(path, sinceCommit) {
  if (processed.has(path)) return;
  processed.add(path);
  let maybeDeps = get_local_dependencies(path);
  if (!maybeDeps) throw new Error('expected dependencies');
  let [name, deps] = maybeDeps;
  const stdout = ps.execSync(
    `git log ${sinceCommit}.. --pretty=format:"%h %s [%an]" ${path}`,
    null,
    {
      stdio: 'pipe',
    }
  );

  const commits = stdout.toString('utf-8').split('\n');
  if (stdout.length) {
    for (const commit of commits) {
      if (allCommits[commit]) {
        allCommits[commit].push(name);
      } else {
        allCommits[commit] = [name];
      }
    }
  }
  deps.forEach((dep) => log_dependencies(dep, sinceCommit));
}

log_dependencies('.', process.argv[2]);
Object.entries(allCommits).forEach(([commit, crates]) => {
  console.log(commit);
  crates.forEach((crate) => {
    console.log(`  - ${crate}`);
  });
});
