// Usage:
// bun run scripts/generate-api-schema.ts <service-name> // to run only for a specific service
// bun run scripts/generate-api-schema.ts // to run only for all services

import * as path from 'node:path';
import { $, write } from 'bun';
import { type Service, services, serviceUrl } from './services';

// Get biome executable path (prefer system install over node_modules)
const findBiomeScript = `
IFS=':'
for dir in $PATH; do
  if [ -f "$dir/biome" ] && [ -x "$dir/biome" ]; then
    realpath "$dir/biome"
  fi
done
`;
const allBiomePaths = (await $`bash -c ${findBiomeScript}`.text()).trim().split('\n').filter(p => p);
let biomePath = allBiomePaths.find(p => !p.includes('node_modules'));

// Fallback to node_modules/.bin/biome if system biome not found
if (!biomePath) {
  const nodeModulesBiome = path.resolve(import.meta.dirname, '../node_modules/.bin/biome');
  try {
    await $`test -x ${nodeModulesBiome}`;
    biomePath = nodeModulesBiome;
  } catch {
    console.error('Error: biome executable not found in PATH or node_modules');
    process.exit(1);
  }
}

async function downloadJson(url: string, outputFile: string): Promise<void> {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const jsonData = await response.text();
    await write(outputFile, jsonData);
    console.log(
      `Successfully downloaded and saved JSON from ${url} to ${outputFile}`
    );
  } catch (error) {
    console.error('An error occurred:', error);
  }
}

// Get all arguments after "scripts/generate-api-schema.ts"
// e.g., ["auth-service", "notification-service"]
const targetServices = process.argv.slice(2);

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

// Process all services in parallel
const processService = async (service: Service) => {
  try {
    let schemaUrl = serviceUrl(service);
    const outputDir = path.resolve(import.meta.dirname, service.output);
    const generatedDir = path.resolve(outputDir, 'generated');
    console.log(
      `[${service.name}] removing existing generated dir`,
      generatedDir
    );
    console.log(`[${service.name}] output dir`, outputDir);
    await $`rm -rf ${generatedDir}`;
    await downloadJson(schemaUrl, path.join(outputDir, 'openapi.json'));
    await $`cd ${outputDir} && ${biomePath} format --fix openapi.json && bun run orval`;
    if (service.name === 'document-cognition')
      await $`bun scripts/generate-dcs-types.ts`;
    console.log(`[${service.name}] ✅ Successfully processed`);
    return { service: service.name, status: 'success' };
  } catch (error) {
    console.error(`[${service.name}] ❌ Failed to process:`, error);
    return { service: service.name, status: 'failed', error };
  }
};

console.log(
  `\n🚀 Processing ${servicesToProcess.length} service(s) in parallel...\n`
);

const results = await Promise.allSettled(
  servicesToProcess.map((service) => processService(service))
);

// Summary report
console.log('\n📊 Processing Summary:');
const succeeded = results.filter(
  (r) => r.status === 'fulfilled' && r.value.status === 'success'
);
const failed = results.filter(
  (r) =>
    r.status === 'rejected' ||
    (r.status === 'fulfilled' && r.value.status === 'failed')
);

console.log(`✅ Succeeded: ${succeeded.length}/${servicesToProcess.length}`);
if (failed.length > 0) {
  console.log(`❌ Failed: ${failed.length}/${servicesToProcess.length}`);
  failed.forEach((result) => {
    if (result.status === 'rejected') {
      console.error(`  - Unknown service failed:`, result.reason);
    } else if (
      result.status === 'fulfilled' &&
      result.value.status === 'failed'
    ) {
      console.error(`  - ${result.value.service}:`, result.value.error);
    }
  });
  process.exit(1);
}
