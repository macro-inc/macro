// Usage:
// bun run scripts/generate-api-schema.ts <service-name> // generate for specific service
// bun run scripts/generate-api-schema.ts               // generate for all services
// bun run scripts/generate-api-schema.ts --check       // verify types are up to date (for CI)
//
// This script generates OpenAPI schemas by running the local Rust binaries
// instead of fetching from deployed services.

import * as path from 'node:path';
import { $, write } from 'bun';
import { type Service, services } from './services';

// Map service names to Rust crate names
const serviceToCrate: Record<string, string> = {
  'cloud-storage': 'document_storage_service',
  'document-cognition': 'document_cognition_service',
  'auth-service': 'authentication_service',
  'comms-service': 'comms_service',
  'notification-service': 'notification_service',
  'static-files': 'static_file_service',
  'connection-gateway': 'connection_gateway',
  'contacts-service': 'contacts_service',
  'unfurl-service': 'unfurl_service',
  'email-service': 'email_service',
  'search-service': 'search_service',
  'properties-service': 'properties_service',
  'organization-service': 'organization_service',
};

const getRustCloudStorageDir = () => path.resolve(import.meta.dirname, '../../../rust/cloud-storage');
const getServiceClientsDir = () => path.resolve(import.meta.dirname, '../packages/service-clients');
// Parse arguments
const getTargetServices = () => process.argv.slice(2).filter(arg => arg !== '--check');

// Build all OpenAPI binaries in a single cargo invocation (parallelized internally by cargo)
async function buildOpenApiBinaries(crateNames: string[], rustCloudStorageDir = getRustCloudStorageDir()): Promise<void> {
  if (crateNames.length === 0) return;

  const packageArgs = crateNames.flatMap(crate => ['-p', crate]);
  const binArgs = crateNames.flatMap(crate => ['--bin', `${crate}_openapi`]);

  console.log(`Building ${crateNames.length} OpenAPI binaries in parallel...`);
  await $`cd ${rustCloudStorageDir} && SQLX_OFFLINE=true cargo build --release ${packageArgs} ${binArgs}`;
  console.log('Build complete.\n');
}

// Run pre-built binary directly (no cargo lock needed)
async function runOpenApiBinary(crateName: string, rustCloudStorageDir = getRustCloudStorageDir()): Promise<string> {
  const binaryPath = path.join(rustCloudStorageDir, 'target', 'release', `${crateName}_openapi`);
  const result = await $`${binaryPath}`.text();
  return result;
}

// Recursively sort all object keys in JSON to ensure deterministic output
function sortJsonKeys(obj: unknown): unknown {
  if (Array.isArray(obj)) {
    return obj.map(sortJsonKeys);
  }
  if (obj !== null && typeof obj === 'object') {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
      sorted[key] = sortJsonKeys((obj as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return obj;
}

const getServicesToProcess = (targetServices: string[]) => {
  // Figure out which services to process
  let servicesToProcess: Service[];
  if (targetServices.length > 0) {
    // Filter only those whose names match the arguments
    servicesToProcess = services.filter((service) =>
      targetServices.includes(service.name)
    );

    // If none matched, bail out
    if (servicesToProcess.length === 0) {
      console.error(
        `Error: No matching services found for [${targetServices.join(', ')}].
         Valid options are: ${services.map((s) => s.name).join(', ')}`
      );
      process.exit(1);
    }
  } else {
    // If no arguments, process all
    servicesToProcess = services;
  }

  return servicesToProcess
}


// Process a single service (assumes binary is already built)
const processService = async (service: Service, { serviceClientsDir }: { serviceClientsDir: string }) => {
  const crateName = serviceToCrate[service.name];
  if (!crateName) {
    console.error(`[${service.name}] No crate mapping found, skipping`);
    return { service: service.name, status: 'skipped' as const };
  }

  try {
    const outputDir = path.resolve(import.meta.dirname, service.output);
    const generatedDir = path.resolve(outputDir, 'generated');
    const openApiPath = path.join(outputDir, 'openapi.json');

    console.log(`[${service.name}] Running OpenAPI binary...`);

    // Run pre-built binary directly
    const openApiJson = await runOpenApiBinary(crateName);

    // Remove existing generated dir
    await $`rm -rf ${generatedDir}`.quiet();

    // Write the OpenAPI JSON
    await write(openApiPath, openApiJson);
    console.log(`[${service.name}] Saved OpenAPI spec`);

    // Run orval to generate types
    await $`cd ${serviceClientsDir} && bun run orval --config orval.config.ts --project ${service.orvalKey}`.quiet();

    // Special handling for document-cognition
    if (service.name === 'document-cognition') {
      await $`cd ${path.resolve(import.meta.dirname, '..')} && bun scripts/generate-dcs-types.ts`.quiet();
    }

    console.log(`[${service.name}] ✓ Done`);
    return { service: service.name, status: 'success' as const };
  } catch (error) {
    console.error(`[${service.name}] Failed:`, error);
    return { service: service.name, status: 'failed' as const, error };
  }
};


async function main() {
  const serviceClientsDir = getServiceClientsDir();
  const checkMode = process.argv.includes('--check');
  const targetServices = getTargetServices();
  const servicesToProcess = getServicesToProcess(targetServices);

  // Get crate names for services that have mappings
  const crateNames = servicesToProcess
    .map(s => serviceToCrate[s.name])
    .filter((crate): crate is string => !!crate);

  console.log(`\nProcessing ${servicesToProcess.length} service(s)...\n`);

  // Phase 1: Build all binaries in a single cargo invocation (parallelized by cargo)
  await buildOpenApiBinaries(crateNames);

  // Phase 2: Run binaries and generate TypeScript in parallel
  console.log('Generating TypeScript clients in parallel...\n');
  const results = await Promise.all(
    servicesToProcess.map(service => processService(service, { serviceClientsDir }))
  );

  // Summary report
  console.log('\nProcessing Summary:');
  const succeeded = results.filter((r) => r.status === 'success');
  const failed = results.filter((r) => r.status === 'failed');
  const skipped = results.filter((r) => r.status === 'skipped');


  console.log(`Succeeded: ${succeeded.length}/${servicesToProcess.length}`);
  if (skipped.length > 0) {
    console.log(`Skipped: ${skipped.length}/${servicesToProcess.length}`);
  }
  if (failed.length > 0) {
    console.log(`Failed: ${failed.length}/${servicesToProcess.length}`);
    failed.forEach((result) => {
      console.error(`  - ${result.service}:`, result.error);
    });
    process.exit(1);
  }
  // On NixOS, the npm-installed biome binary doesn't work due to dynamic linking issues.
  // We detect NixOS and use the system biome instead.
  const isNixOS = process.env.NIX_PATH !== undefined || (await Bun.file("/etc/os-release").exists() && (await Bun.file("/etc/os-release").text()).includes("NixOS"));
  if (isNixOS) {
    const systemBiomePath = await $`bash -c 'PATH=$(echo "$PATH" | tr ":" "\n" | grep -v node_modules | tr "\n" ":") which biome'`.text();
    await $`${systemBiomePath.trim()} check --write --unsafe packages/service-clients/`;
  } else {
    await $`biome check --write --unsafe packages/service-clients/`;
  }

  // In check mode, verify no uncommitted changes
  if (checkMode) {
    const diff = await $`git diff --ignore-blank-lines ${serviceClientsDir}`.text();
    const untrackedFiles = await $`git ls-files --others --exclude-standard ${serviceClientsDir}`.text();

    if (diff.trim() || untrackedFiles.trim()) {
      console.error('\n❌ Generated types are out of sync with Rust API definitions!');
      console.error('The following files have changed:');
      if (diff.trim()) console.error(diff);
      if (untrackedFiles.trim()) console.error('Untracked:\n' + untrackedFiles);
      const gitStatus = await $`git status`.text();
      console.error('`git status` output:')
      console.error(gitStatus.trim());
      console.error('\nPlease run: bun run scripts/generate-api-schema.ts');
      console.error('Then commit the changes.');
      process.exit(1);
    }

    console.log('\n✓ Generated types are up to date');
  }
}

await main();
