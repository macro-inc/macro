import { execFileSync } from "node:child_process";

// Wrangler lists names and types only; secret values never enter this process.
const environment = process.argv[2];
if (!["dev", "prod", "playground"].includes(environment)) {
	throw new Error("Expected environment: dev, prod, or playground");
}
const secrets = JSON.parse(
	execFileSync("npx", ["wrangler", "secret", "list", "--env", environment], {
		encoding: "utf8",
	}),
);
if (
	!Array.isArray(secrets) ||
	!secrets.some((secret) => secret.name === "LEXICAL_SERVICE_AUTH_KEY")
) {
	throw new Error(
		`Missing LEXICAL_SERVICE_AUTH_KEY in ${environment}. Provision the matching lexical-service INTERNAL_AUTH_KEY before deploying.`,
	);
}
console.log(`Required comment validation secret is present in ${environment}.`);
