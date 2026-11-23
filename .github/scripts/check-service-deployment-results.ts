type Need = { result: string; outputs?: Record<string, string> };

/** Required partitions may never turn a skip/cancellation into a successful rollout. */
export function checkDeploymentResults(needs: Record<string, Need>): void {
	if (needs.setup?.result !== "success")
		throw new Error("Deployment setup did not succeed");
	const outputs = needs.setup.outputs ?? {};
	for (const [job, partition] of [
		["warm-binaries", "binaries"],
		["warm-lambdas", "lambdas"],
		["build-service-binaries", "binaries"],
		["build-lambda-artifacts", "lambdas"],
		["migrate-db", "matrix"],
		["deploy-services", "matrix"],
	]) {
		const members: unknown = JSON.parse(outputs[partition] ?? "null");
		if (!Array.isArray(members))
			throw new Error(`Missing deployment partition: ${partition}`);
		const result = needs[job]?.result;
		const expected = members.length > 0 ? "success" : "skipped";
		if (result !== expected)
			throw new Error(`${job}: expected ${expected}, got ${result}`);
	}
	console.log("All required service deployments succeeded");
}

if (import.meta.main) {
	checkDeploymentResults(JSON.parse(process.env.DEPLOYMENT_NEEDS ?? "{}"));
}
