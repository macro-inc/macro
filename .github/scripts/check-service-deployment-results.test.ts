import { describe, expect, test } from "bun:test";
import { checkDeploymentResults } from "./check-service-deployment-results";

function needs(empty = false) {
	const outputs = Object.fromEntries(
		["matrix", "binaries", "lambdas"].map((key) => [
			key,
			JSON.stringify(empty ? [] : [key]),
		]),
	);
	return {
		setup: { result: "success", outputs },
		...Object.fromEntries(
			[
				"warm-binaries",
				"warm-lambdas",
				"build-service-binaries",
				"build-lambda-artifacts",
				"migrate-db",
				"deploy-services",
			].map((job) => [job, { result: empty ? "skipped" : "success" }]),
		),
	} as Record<string, { result: string; outputs?: Record<string, string> }> & {
		setup: { result: string; outputs: Record<string, string> };
	};
}

describe("deployment summary", () => {
	test("full success and intentionally empty no-op succeed", () => {
		expect(() => checkDeploymentResults(needs())).not.toThrow();
		expect(() => checkDeploymentResults(needs(true))).not.toThrow();
	});
	test.each(["failure", "cancelled", "skipped"])(
		"required %s outcome cannot become success",
		(result) => {
			for (const job of Object.keys(needs())) {
				const state = needs();
				state[job].result = result;
				expect(() => checkDeploymentResults(state)).toThrow();
			}
		},
	);
});
