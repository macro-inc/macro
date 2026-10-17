#!/usr/bin/env bun
/**
 * Rejects a built Tauri frontend that would break at runtime:
 * - Every package in wasm-packages.json must be in dist. The loaders import
 *   them with `@vite-ignore`, so a missing one builds cleanly and fails only
 *   in the app.
 * - The version must name the commit the bundle was built from, not `unknown`.
 * - Vite must have inlined the build-time env: build-env.json's values for the
 *   mode, and VITE_POSTHOG_API_KEY when the build was given one. Without them
 *   the app silently sends no telemetry or has every feature flag off.
 *
 * usage: bun scripts/verify-tauri-bundle.ts --dist <directory> --mode <mode>
 */
import { readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import buildEnv from '../build-env.json' with { type: 'json' };
import packageJson from '../package.json' with { type: 'json' };
import { wasmPackages } from './wasm-packages';

function walkFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walkFiles(path) : [path];
  });
}

function quoted(value: string): RegExp {
  return new RegExp(`["'\`]${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["'\`]`);
}

/** Everything wrong with the bundle in `distPath`; empty when it can ship. */
export function bundleProblems(
  distPath: string,
  mode: keyof typeof buildEnv,
  env: Record<string, string | undefined>
): string[] {
  const files = walkFiles(distPath);
  const names = files.map((path) => basename(path));
  const scripts = files
    .filter((path) => path.endsWith('.js'))
    .map((path) => readFileSync(path, 'utf8'));
  const inlines = (value: string) => {
    const literal = quoted(value);
    return scripts.some((script) => literal.test(script));
  };
  const problems: string[] = [];

  for (const { name } of wasmPackages) {
    for (const [stem, extension] of [
      [name, 'js'],
      [`${name}_bg`, 'wasm'],
    ]) {
      const emitted = new RegExp(`^${stem}(?:-[\\w-]+)?\\.${extension}$`);
      if (!names.some((file) => emitted.test(file))) {
        problems.push(
          `missing ${stem}.${extension}: build the WASM packages first (just build-wasm)`
        );
      }
    }
  }

  for (const [name, value] of Object.entries(buildEnv[mode])) {
    if (!inlines(value)) {
      problems.push(`no script inlines ${name} ${JSON.stringify(value)}`);
    }
  }
  if (env.VITE_POSTHOG_API_KEY && !inlines(env.VITE_POSTHOG_API_KEY)) {
    problems.push('VITE_POSTHOG_API_KEY was set but no script inlines it');
  }

  const version = packageJson.version;
  const semver = readFileSync(join(distPath, 'semver.txt'), 'utf8').trim();
  const commit = new RegExp(
    `^${version.replaceAll('.', '\\.')}\\+([0-9a-f]{7,40}(?:-dirty)?)$`
  ).exec(semver)?.[1];
  if (!commit) {
    problems.push(
      `semver.txt is ${JSON.stringify(semver)}, expected ${version}+<commit>; set MACRO_GIT_SHA where the build has no git checkout`
    );
    return problems;
  }

  const manifest = JSON.parse(
    readFileSync(join(distPath, 'bundle-manifest.json'), 'utf8')
  );
  if (manifest.gitSha !== commit) {
    problems.push(
      `bundle-manifest.json gitSha is ${JSON.stringify(manifest.gitSha)}, expected ${JSON.stringify(commit)}`
    );
  }
  if (!inlines(`${version}+${commit}`)) {
    problems.push(`no script inlines the app version ${version}+${commit}`);
  }
  return problems;
}

if (import.meta.main) {
  const argument = (name: string) => {
    const index = process.argv.indexOf(name);
    return index >= 0 ? process.argv[index + 1] : undefined;
  };
  const distPath = argument('--dist');
  const mode = argument('--mode');
  if (!distPath || (mode !== 'production' && mode !== 'development')) {
    throw new Error(
      'usage: verify-tauri-bundle.ts --dist <dir> --mode <production|development>'
    );
  }
  const problems = bundleProblems(distPath, mode, process.env);
  if (problems.length > 0) {
    for (const problem of problems) console.error(`${distPath}: ${problem}`);
    process.exit(1);
  }
  console.log(
    `${distPath}: every WASM package, the build env and the app version are in place`
  );
}
