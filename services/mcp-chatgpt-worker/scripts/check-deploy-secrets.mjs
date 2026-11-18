import { execFileSync } from "node:child_process";

// Secrets every dev and prod deploy must already have: the person-token key
// that src/config.ts requires outside local (see wrangler.jsonc).
// Wrangler lists names and types only; secret values never enter this process.
const REQUIRED = ["PERSON_TOKEN_KEY"];

const environment = process.argv[2];
if (!["dev", "prod"].includes(environment)) {
	throw new Error("Expected environment: dev or prod");
}
const secrets = JSON.parse(
	execFileSync("bunx", ["wrangler", "secret", "list", "--env", environment], {
		encoding: "utf8",
	}),
);
if (!Array.isArray(secrets)) {
	throw new Error("wrangler secret list did not return a list");
}
const names = new Set(secrets.map((secret) => secret.name));
const missing = REQUIRED.filter((name) => !names.has(name));
if (missing.length > 0) {
	throw new Error(
		`Missing ${missing.join(", ")} in ${environment}. Set it with \`bunx wrangler secret put <NAME> --env ${environment}\` (see wrangler.jsonc) before deploying.`,
	);
}
console.log(`Required secrets are present in ${environment}.`);
