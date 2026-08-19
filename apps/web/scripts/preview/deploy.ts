#!/usr/bin/env bun
/**
 * Preview Deployment Script
 *
 * Usage:
 *   bun scripts/preview/deploy.ts --preview-id <id>
 *   bun scripts/preview/deploy.ts --preview-id my-feature-abc123
 *
 * Environment:
 *   AWS credentials must be configured (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, or AWS profile)
 */

import { execFileSync, execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIRECTORY = fileURLToPath(new URL('.', import.meta.url));
const PREVIEW_BUCKET = 'macro-preview-assets-dev';
const DIST_PATH = resolve(SCRIPT_DIRECTORY, '../../dist');
const CACHE_WASM_UPLOAD_SCRIPT = resolve(
  SCRIPT_DIRECTORY,
  '../cache-wasm/upload-brotli-to-s3.sh'
);
const CACHE_WASM_PRUNE_SCRIPT = resolve(
  SCRIPT_DIRECTORY,
  '../cache-wasm/prune-old-brotli-from-s3.sh'
);

export function previewSyncArguments(
  previewId: string,
  distPath = DIST_PATH
): string[] {
  return [
    's3',
    'sync',
    `${distPath}/`,
    `s3://${PREVIEW_BUCKET}/${previewId}/app/`,
    '--delete',
    '--cache-control',
    'public, max-age=31536000, immutable',
    '--exclude',
    'index.html',
    '--exclude',
    '*cache_wasm_bg*.wasm',
    '--exclude',
    '*cache_wasm_bg*.wasm.br',
  ];
}

function parseArgs(): { previewId: string; skipBuild: boolean } {
  const args = process.argv.slice(2);
  let previewId = '';
  let skipBuild = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--preview-id' && args[i + 1]) {
      previewId = args[i + 1];
      i++;
    }
    if (args[i] === '--skip-build') {
      skipBuild = true;
    }
  }

  if (!previewId) {
    // Generate a random preview ID for local testing
    const branch = execSync('git branch --show-current', { encoding: 'utf-8' })
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 30);

    const nanoid = Math.random().toString(36).slice(2, 8);
    previewId = `${branch}-${nanoid}`;
    console.log(`Generated preview ID: ${previewId}`);
  }

  return { previewId, skipBuild };
}

function validateBucket(bucket: string): void {
  if (bucket !== 'macro-preview-assets-dev') {
    console.error('ERROR: Can only deploy to macro-preview-assets-dev');
    process.exit(1);
  }
}

function build(): void {
  console.log('\nBuilding app (same as dev.macro.com)...\n');
  execSync('bun run build:dev', {
    cwd: resolve(import.meta.dir, '../..'),
    stdio: 'inherit',
  });
}

type PreviewCommandRunner = (
  executable: string,
  argumentsList: readonly string[]
) => void;

export function publishPreviewAssets(
  previewId: string,
  distPath = DIST_PATH,
  run: PreviewCommandRunner = (executable, argumentsList) => {
    execFileSync(executable, [...argumentsList], { stdio: 'inherit' });
  }
): void {
  const s3Prefix = `s3://${PREVIEW_BUCKET}/${previewId}/app`;
  run('bash', [CACHE_WASM_UPLOAD_SCRIPT, distPath, s3Prefix]);
  run('aws', previewSyncArguments(previewId, distPath));
  run('aws', [
    's3',
    'cp',
    `${distPath}/index.html`,
    `${s3Prefix}/index.html`,
    '--cache-control',
    'no-cache, no-store, must-revalidate',
  ]);
  run('bash', [CACHE_WASM_PRUNE_SCRIPT, distPath, s3Prefix]);
}

function deploy(previewId: string): void {
  validateBucket(PREVIEW_BUCKET);

  if (!existsSync(DIST_PATH)) {
    console.error(`ERROR: Build output not found at ${DIST_PATH}`);
    console.error(
      'Run with --skip-build=false or build first with: bun run build:dev'
    );
    process.exit(1);
  }

  console.log(`\nDeploying to s3://${PREVIEW_BUCKET}/${previewId}/app/\n`);

  // Upload current bytes, publish assets/index, and only then prune old keys.
  publishPreviewAssets(previewId);

  const previewUrl = `https://${previewId}.preview.macro.com`;
  console.log(`\nPreview deployed: ${previewUrl}\n`);
}

function cleanup(previewId: string): void {
  validateBucket(PREVIEW_BUCKET);

  console.log(`\nCleaning up s3://${PREVIEW_BUCKET}/${previewId}/\n`);

  execSync(`aws s3 rm s3://${PREVIEW_BUCKET}/${previewId}/ --recursive`, {
    stdio: 'inherit',
  });

  console.log('\nCleanup complete\n');
}

if (import.meta.main) {
  const { previewId, skipBuild } = parseArgs();

  if (process.argv.includes('--cleanup')) {
    cleanup(previewId);
  } else {
    if (!skipBuild) build();
    deploy(previewId);
  }
}
