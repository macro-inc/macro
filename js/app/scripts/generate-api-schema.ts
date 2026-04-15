// Usage:
// bun run scripts/generate-api-schema.ts <service-name> // generate for specific service
// bun run scripts/generate-api-schema.ts               // generate for all services
// bun run scripts/generate-api-schema.ts --check       // verify types are up to date (for CI)
//
// This script generates OpenAPI schemas by running the local Rust binaries
// instead of fetching from deployed services.

import * as path from "node:path";
import { $, write } from "bun";
import { type Service, services } from "./services";

const elapsed = (start: number) =>
	`${((performance.now() - start) / 1000).toFixed(1)}s`;

// Map service names to Rust crate names
const serviceToCrate: Record<string, string> = {
	"cloud-storage": "document_storage_service",
	"comms-service": "comms_service",
	"properties-service": "properties_service",
	"document-cognition": "document_cognition_service",
	"auth-service": "authentication_service",
	"notification-service": "notification_service",
	"static-files": "static_file_service",
	"connection-gateway": "connection_gateway",
	"contacts-service": "contacts_service",
	"unfurl-service": "unfurl_service",
	"email-service": "email_service",
	"search-service": "search_service",
};

const getRustCloudStorageDir = () =>
	path.resolve(import.meta.dirname, "../../../rust/cloud-storage");
const getServiceClientsDir = () =>
	path.resolve(import.meta.dirname, "../packages/service-clients");
// Parse arguments
const getTargetServices = () =>
	process.argv.slice(2).filter((arg) => arg !== "--check");

// Build all OpenAPI binaries in a single cargo invocation (cargo parallelizes internally).
async function buildOpenApiBinaries(
	crateNames: string[],
	{ rustCloudStorageDir = getRustCloudStorageDir() } = {},
): Promise<void> {
	if (crateNames.length === 0) return;

	const binArgs = crateNames.flatMap((crate) => ["--bin", `${crate}_openapi`]);

	// Also build the DCS models + tools binaries if document_cognition_service is included
	if (crateNames.includes("document_cognition_service")) {
		binArgs.push("--bin", "document_cognition_service_models");
		binArgs.push("--bin", "gen_tool_schemas");
	}

	console.log(`Building ${crateNames.length} OpenAPI binaries...`);
	console.log(`cargo build args: ${binArgs.join(" ")}`);
	await $`cd ${rustCloudStorageDir} && SQLX_OFFLINE=true cargo build ${binArgs}`;
	console.log("Build complete.\n");
}

// Run a named binary from the debug directory with a timeout and stderr capture.
// Throws with stderr content on non-zero exit or timeout so CI failures aren't silent.
const BINARY_TIMEOUT_MS = 120_000;

async function runBinary(
	binaryName: string,
	rustCloudStorageDir = getRustCloudStorageDir(),
): Promise<string> {
	const binaryPath = path.join(
		rustCloudStorageDir,
		"target",
		"debug",
		binaryName,
	);
	const proc = Bun.spawn([binaryPath], { stdout: "pipe", stderr: "pipe" });
	const TIMEOUT_SENTINEL = Symbol("timeout");
	let timeout: ReturnType<typeof setTimeout> | undefined;
	const timeoutPromise = new Promise<typeof TIMEOUT_SENTINEL>((resolve) => {
		timeout = setTimeout(() => {
			proc.kill();
			resolve(TIMEOUT_SENTINEL);
		}, BINARY_TIMEOUT_MS);
	});
	const completionPromise = Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	const result = await Promise.race([completionPromise, timeoutPromise]);
	clearTimeout(timeout);
	if (result === TIMEOUT_SENTINEL) {
		// After the kill, the in-flight stream reads should complete quickly — grab
		// whatever stderr was buffered, but don't wait forever if they don't.
		const drained = await Promise.race([
			completionPromise.catch(() => null),
			new Promise<null>((resolve) => setTimeout(() => resolve(null), 1_000)),
		]);
		const stderr = drained ? drained[1] : "";
		throw new Error(
			`${binaryName} timed out after ${BINARY_TIMEOUT_MS}ms\nstderr:\n${stderr}`,
		);
	}
	const [stdout, stderr, exitCode] = result;
	if (exitCode !== 0) {
		throw new Error(
			`${binaryName} exited with code ${exitCode}\nstderr:\n${stderr}`,
		);
	}
	return stdout;
}

const runOpenApiBinary = (
	crateName: string,
	rustCloudStorageDir = getRustCloudStorageDir(),
) => runBinary(`${crateName}_openapi`, rustCloudStorageDir);

const getServicesToProcess = (targetServices: string[]) => {
	// Figure out which services to process
	let servicesToProcess: Service[];
	if (targetServices.length > 0) {
		// Filter only those whose names match the arguments
		servicesToProcess = services.filter((service) =>
			targetServices.includes(service.name),
		);

		// If none matched, bail out
		if (servicesToProcess.length === 0) {
			console.error(
				`Error: No matching services found for [${targetServices.join(", ")}].
         Valid options are: ${services.map((s) => s.name).join(", ")}`,
			);
			process.exit(1);
		}
	} else {
		// If no arguments, process all
		servicesToProcess = services;
	}

	return servicesToProcess;
};

// Process a single service (assumes binary is already built)
const processService = async (
	service: Service,
	{ serviceClientsDir }: { serviceClientsDir: string },
) => {
	const crateName = serviceToCrate[service.name];
	if (!crateName) {
		console.error(`[${service.name}] No crate mapping found, skipping`);
		return { service: service.name, status: "skipped" as const };
	}

	try {
		const outputDir = path.resolve(import.meta.dirname, service.output);
		const generatedDir = path.resolve(outputDir, "generated");
		const openApiPath = path.join(outputDir, "openapi.json");

		const serviceStart = performance.now();

		console.log(`[${service.name}] Running OpenAPI binary...`);
		let stepStart = performance.now();
		const openApiJson = await runOpenApiBinary(crateName);
		console.log(
			`[${service.name}] OpenAPI binary finished (${elapsed(stepStart)})`,
		);

		// Remove existing generated dir
		await $`rm -rf ${generatedDir}`.quiet();

		// Write the OpenAPI JSON
		await write(openApiPath, openApiJson);
		console.log(`[${service.name}] Saved OpenAPI spec`);

		// Run orval to generate types
		stepStart = performance.now();
		await $`cd ${serviceClientsDir} && bun run orval --config orval.config.ts --project ${service.orvalKey}`;
		console.log(`[${service.name}] Orval finished (${elapsed(stepStart)})`);

		// Special handling for document-cognition
		if (service.name === "document-cognition") {
			stepStart = performance.now();
			const rustCloudStorageDir = getRustCloudStorageDir();
			const modelsJson = await runBinary(
				"document_cognition_service_models",
				rustCloudStorageDir,
			);
			console.log(
				`[${service.name}] Models binary finished (${elapsed(stepStart)})`,
			);
			const modelsJsonPath = path.join(import.meta.dirname, ".models.json");
			await write(modelsJsonPath, modelsJson);

			stepStart = performance.now();
			const appDir = path.resolve(import.meta.dirname, "..");
			try {
				await $`cd ${appDir} && MODELS_JSON=${modelsJsonPath} bun scripts/generate-dcs-types.ts`.quiet();
			} finally {
				await $`rm -f ${modelsJsonPath}`.quiet();
			}
			console.log(
				`[${service.name}] DCS types generation finished (${elapsed(stepStart)})`,
			);
		}

		console.log(`[${service.name}] ✓ Done (total: ${elapsed(serviceStart)})`);
		return { service: service.name, status: "success" as const };
	} catch (error) {
		console.error(`[${service.name}] Failed:`, error);
		return { service: service.name, status: "failed" as const, error };
	}
};

async function main() {
	const serviceClientsDir = getServiceClientsDir();
	const checkMode = process.argv.includes("--check");
	const targetServices = getTargetServices();
	const servicesToProcess = getServicesToProcess(targetServices);

	// Get crate names for services that have mappings
	const crateNames = servicesToProcess
		.map((s) => serviceToCrate[s.name])
		.filter((crate): crate is string => !!crate);

	console.log(`\nProcessing ${servicesToProcess.length} service(s)...\n`);

	// Phase 1: Build all binaries in a single cargo invocation (parallelized by cargo)
	const buildStart = performance.now();
	await buildOpenApiBinaries(crateNames);
	console.log(`Phase 1 (cargo build) total: ${elapsed(buildStart)}`);

	// Phase 2: Run binaries and generate TypeScript in parallel
	console.log("\nGenerating TypeScript clients...\n");
	const results = await Promise.all(
		servicesToProcess.map((service) =>
			processService(service, { serviceClientsDir }),
		),
	);

	// Summary report
	console.log("\nProcessing Summary:");
	const succeeded = results.filter((r) => r.status === "success");
	const failed = results.filter((r) => r.status === "failed");
	const skipped = results.filter((r) => r.status === "skipped");

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
	const isNixOS =
		process.env.NIX_PATH !== undefined ||
		((await Bun.file("/etc/os-release").exists()) &&
			(await Bun.file("/etc/os-release").text()).includes("NixOS"));
	const biomeStart = performance.now();
	console.log("\nRunning biome check...");
	if (isNixOS) {
		const systemBiomePath =
			await $`bash -c 'PATH=$(echo "$PATH" | tr ":" "\n" | grep -v node_modules | tr "\n" ":") which biome'`.text();
		await $`${systemBiomePath.trim()} check --write --unsafe packages/service-clients/`;
	} else {
		await $`biome check --write --unsafe packages/service-clients/`;
	}
	console.log(`Biome check finished (${elapsed(biomeStart)})`);

	// In check mode, verify no uncommitted changes
	if (checkMode) {
		const diff =
			await $`git diff --ignore-blank-lines ${serviceClientsDir}`.text();
		const untrackedFiles =
			await $`git ls-files --others --exclude-standard ${serviceClientsDir}`.text();

		if (diff.trim() || untrackedFiles.trim()) {
			console.error(
				"\n❌ Generated types are out of sync with Rust API definitions!",
			);
			console.error("The following files have changed:");
			if (diff.trim()) console.error(diff);
			if (untrackedFiles.trim()) console.error("Untracked:\n" + untrackedFiles);
			const gitStatus = await $`git status`.text();
			console.error("`git status` output:");
			console.error(gitStatus.trim());
			console.error("\nPlease run: bun run scripts/generate-api-schema.ts");
			console.error("Then commit the changes.");
			process.exit(1);
		}

		console.log("\n✓ Generated types are up to date");
	}
}

await main();
