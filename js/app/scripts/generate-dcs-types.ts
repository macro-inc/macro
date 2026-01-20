import { $ } from "bun";
import { write } from "bun";
import * as path from "node:path";

const rustCloudStorageDir = path.resolve(import.meta.dirname, "../../../rust/cloud-storage");
const toolsJsonPath = path.resolve(rustCloudStorageDir, "document_cognition_service/schemas/tools.json");

// Generate tools.json from Rust binary
console.log("Generating tools.json from Rust...");
const toolsSchema = await $`cd ${rustCloudStorageDir} && SQLX_OFFLINE=true cargo run -p document_cognition_service --bin document_cognition_service_tools_schema`.text();
await write(toolsJsonPath, toolsSchema);
console.log(`Saved tools.json to ${toolsJsonPath}`);

console.log("\nGenerating DCS tools");
await $`bun run scripts/generate-dcs-tools.ts`;
console.log("\n\nGenerating DCS models");
await $`bun run scripts/generate-dcs-models.ts`;
console.log("Generated models");
