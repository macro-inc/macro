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


async function generateOpenApiFromCrate(crateName: string, rustCloudStorageDir = getRustCloudStorageDir()): Promise<string> {
  const result = await $`cd ${rustCloudStorageDir} && SQLX_OFFLINE=true cargo run -p ${crateName} --bin ${crateName}_openapi`.text();
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


// Process all services in parallel
const processService = async (service: Service, { serviceClientsDir }: { serviceClientsDir: string }) => {
  const crateName = serviceToCrate[service.name];
  if (!crateName) {
    console.error(`[${service.name}] No crate mapping found, skipping`);
    return { service: service.name, status: 'skipped' };
  }

  try {
    const outputDir = path.resolve(import.meta.dirname, service.output);
    const generatedDir = path.resolve(outputDir, 'generated');
    const openApiPath = path.join(outputDir, 'openapi.json');

    console.log(`[${service.name}] Generating OpenAPI spec from ${crateName}...`);

    // Generate OpenAPI JSON from Rust binary
    let openApiJson = await generateOpenApiFromCrate(crateName);


    // Remove existing generated dir
    console.log(`[${service.name}] Removing existing generated dir`, generatedDir);
    await $`rm -rf ${generatedDir}`;

    // Write the OpenAPI JSON
    await write(openApiPath, openApiJson);
    console.log(`[${service.name}] Saved OpenAPI spec to ${openApiPath}`);

    // Run orval to generate types
    await $`cd ${serviceClientsDir} && bun run orval --config orval.config.ts --project ${service.orvalKey}`;

    // Organize imports in generated files to ensure deterministic ordering
    await $`bunx biome check --write --unsafe ${outputDir}`;

    // Special handling for document-cognition
    if (service.name === 'document-cognition') {
      await $`cd ${path.resolve(import.meta.dirname, '..')} && bun scripts/generate-dcs-types.ts`;
    }

    console.log(`[${service.name}] Successfully processed`);
    return { service: service.name, status: 'success' };
  } catch (error) {
    console.error(`[${service.name}] Failed to process:`, error);
    return { service: service.name, status: 'failed', error };
  }
};


// Process services sequentially to avoid cargo lock contention
async function main() {
  const serviceClientsDir = getServiceClientsDir();
  const checkMode = process.argv.includes('--check');
  const targetServices = getTargetServices();
  const servicesToProcess = getServicesToProcess(targetServices);
  console.log(
    `\nProcessing ${servicesToProcess.length} service(s)...\n`
  );

  const results = [];
  for (const service of servicesToProcess) {
    const result = await processService(service, { serviceClientsDir } );
    results.push(result);
  }

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
  await $`bunx biome check --write --unsafe packages/service-clients/`;

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
