import { $ } from "bun"

console.log("Generating DCS tools");
await $`bun run scripts/generate-dcs-tools.ts`;
console.log("\n\nGenerating DCS models");
await $`bun run scripts/generate-dcs-models.ts`;
console.log("Generated models");
