import { describe, expect, test } from "bun:test";
import { checkDeploymentResults } from "./check-service-deployment-results";
import {
	consumersReady,
	isCliTimeout,
	snapshotTasks,
	TransientSnapshotError,
	type ExpectedConsumer,
	expectedConsumer,
	waitForConsumers,
} from "./wait-crm-email-consumers";

const expected: ExpectedConsumer = {
	cluster: "test-cluster",
	service: "test-workers",
	taskDefinition: "arn:aws:ecs:us-east-1:000000000000:task-definition/test:2",
	image: `registry.example.com/worker@sha256:${"a".repeat(64)}`,
	container: "worker",
};
function ready() {
	return {
		services: [
			{
				status: "ACTIVE",
				taskDefinition: expected.taskDefinition,
				desiredCount: 1,
				runningCount: 1,
				pendingCount: 0,
				deployments: [
					{
						status: "PRIMARY",
						taskDefinition: expected.taskDefinition,
						rolloutState: "COMPLETED",
						runningCount: 1,
						pendingCount: 0,
					},
				],
			},
		],
		tasks: [
			{
				taskArn: "current",
				taskDefinitionArn: expected.taskDefinition,
				lastStatus: "RUNNING",
				desiredStatus: "RUNNING",
				healthStatus: "HEALTHY",
				containers: [
					{
						name: "worker",
						image: expected.image,
						lastStatus: "RUNNING",
						imageDigest: `sha256:${"a".repeat(64)}`,
					},
				],
			},
		],
	};
}

describe("exact consumer readiness", () => {
	test("accepts completed matching rollout, including an unchanged expected revision", () => {
		expect(consumersReady(expectedConsumer(expected), ready())).toBe(true);
		const state = ready();
		state.tasks.push({
			...state.tasks[0],
			taskArn: "old",
			taskDefinitionArn: "old",
			lastStatus: "STOPPED",
			desiredStatus: "STOPPED",
		});
		expect(consumersReady(expected, state)).toBe(true);
	});
	test("an OCI index may resolve to a different leaf digest, but the immutable image URI must match", () => {
		const state = ready();
		state.tasks[0].containers[0].imageDigest = `sha256:${"b".repeat(64)}`;
		expect(consumersReady(expected, state)).toBe(true);
		state.tasks[0].containers[0].image = `registry.example.com/worker@sha256:${"c".repeat(64)}`;
		expect(consumersReady(expected, state)).toBe(false);
		state.tasks[0].containers[0].image = expected.image;
		state.tasks[0].containers[0].imageDigest = "";
		expect(consumersReady(expected, state)).toBe(false);
	});
	test("stable rollback and failed rollout fail rather than claiming steady success", () => {
		const rollback = ready();
		rollback.services[0].taskDefinition = "old";
		rollback.services[0].deployments[0].taskDefinition = "old";
		expect(() => consumersReady(expected, rollback)).toThrow("differs");
		const failed = ready();
		failed.services[0].deployments[0].rolloutState = "FAILED";
		expect(() => consumersReady(expected, failed)).toThrow("failed");
	});
	test.each(["RUNNING", "STOPPING", "DEACTIVATING", "PENDING"])(
		"does not admit an old %s task",
		(status) => {
			const state = ready();
			state.tasks.push({
				...state.tasks[0],
				taskArn: "old",
				taskDefinitionArn: "old",
				lastStatus: status,
				desiredStatus: "STOPPED",
			});
			expect(consumersReady(expected, state)).toBe(false);
		},
	);
	test("requires matching live image, nonzero capacity, no mixed deployments and complete task evidence", () => {
		for (const mutate of [
			(s: ReturnType<typeof ready>) => {
				s.tasks[0].containers[0].imageDigest = "sha256:old";
			},
			(s: ReturnType<typeof ready>) => {
				s.services[0].desiredCount = 0;
			},
			(s: ReturnType<typeof ready>) => {
				s.services[0].pendingCount = 1;
			},
			(s: ReturnType<typeof ready>) => {
				s.services[0].deployments.push({
					...s.services[0].deployments[0],
					status: "ACTIVE",
					taskDefinition: "old",
				});
			},
			(s: ReturnType<typeof ready>) => {
				s.tasks = [];
			},
			(s: ReturnType<typeof ready>) => {
				s.tasks[0].healthStatus = "UNHEALTHY";
			},
		]) {
			const state = ready();
			mutate(state);
			expect(consumersReady(expected, state)).toBe(false);
		}
		expect(() => consumersReady(expected, { tasks: [] })).toThrow();
		expect(() =>
			consumersReady(expected, { ...ready(), failures: [{}] }),
		).toThrow();
		expect(() =>
			expectedConsumer({
				...expected,
				image: "registry.example.com/worker:latest",
			}),
		).toThrow("immutable");
		expect(() => expectedConsumer({})).toThrow("Missing");
	});
	test("waits for termination and fails bounded timeout without sleeping in tests", async () => {
		let clock = 0;
		let reads = 0;
		await waitForConsumers(
			expected,
			() => {
				const state = ready();
				if (reads++ === 0)
					state.tasks.push({ ...state.tasks[0], lastStatus: "STOPPING" });
				return state;
			},
			() => clock,
			async () => {
				clock += 10;
			},
			30,
		);
		expect(reads).toBe(2);
		await expect(
			waitForConsumers(
				expected,
				() => {
					const state = ready();
					state.services[0].pendingCount = 1;
					return state;
				},
				() => clock,
				async () => {
					clock += 10;
				},
				20,
			),
		).rejects.toThrow("Timed out");
	});
});

function needs(empty = false) {
	const outputs = Object.fromEntries(
		["matrix", "binaries", "lambdas", "email", "dss", "others"].map((key) => [
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
				"deploy-email",
				"deploy-dss",
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
	test("empty email partition is only allowed if DSS is also empty", () => {
		const state = needs();
		state.setup.outputs.email = "[]";
		state["deploy-email"].result = "skipped";
		expect(() => checkDeploymentResults(state)).toThrow();
		state.setup.outputs.dss = "[]";
		state["deploy-dss"].result = "skipped";
		expect(() => checkDeploymentResults(state)).not.toThrow();
	});
});

describe("transient snapshot retry", () => {
	test.each(["missing", "incomplete", "timeout"])(
		"retries %s with a fresh complete snapshot",
		async (kind) => {
			let clock = 0;
			let reads = 0;
			await waitForConsumers(
				expected,
				() => {
					reads++;
					if (reads === 1) {
						if (kind === "timeout")
							throw new TransientSnapshotError(
								"AWS CLI snapshot request timed out",
							);
						snapshotTasks(
							["current"],
							kind === "missing"
								? { tasks: [], failures: [{ reason: "MISSING" }] }
								: { tasks: [] },
						);
					}
					const state = ready();
					return { ...state, tasks: snapshotTasks(["current"], state) };
				},
				() => clock,
				async () => {
					clock += 10;
				},
				30,
			);
			expect(reads).toBe(2);
		},
	);
	test("persistent missing proof reaches the same deadline and cannot pass late", async () => {
		let clock = 0;
		let reads = 0;
		await expect(
			waitForConsumers(
				expected,
				() => {
					reads++;
					snapshotTasks(["current"], { failures: [{ reason: "MISSING" }] });
					return ready();
				},
				() => clock,
				async () => {
					clock += 10;
				},
				30,
			),
		).rejects.toThrow("Timed out");
		expect(reads).toBe(3);
		clock = 0;
		await expect(
			waitForConsumers(
				expected,
				() => {
					clock = 31;
					return ready();
				},
				() => clock,
				async () => {},
				30,
			),
		).rejects.toThrow("Timed out");
	});
	test("only CLI timeouts are transient, never credentials or other command failures", () => {
		expect(isCliTimeout({ code: "ETIMEDOUT" })).toBe(true);
		expect(
			isCliTimeout({
				stderr: 'Read timeout on endpoint URL: "https://ecs.example.com"',
			}),
		).toBe(true);
		expect(
			isCliTimeout({
				stderr: Buffer.from(
					'Connect timeout on endpoint URL: "https://ecs.example.com"',
				),
			}),
		).toBe(true);
		expect(isCliTimeout({ stderr: "AccessDeniedException" })).toBe(false);
		expect(isCliTimeout({ code: "ENOENT" })).toBe(false);
		expect(isCliTimeout(new Error("Unexpected token"))).toBe(false);
	});
	test("permanent task failures, failed rollout and stable rollback stop immediately", async () => {
		const failed = ready();
		failed.services[0].deployments[0].rolloutState = "FAILED";
		const rollback = ready();
		rollback.services[0].taskDefinition = "old";
		for (const read of [
			() => {
				snapshotTasks(["current"], {
					tasks: [],
					failures: [{ reason: "MISSING" }, { reason: "ACCESS_DENIED" }],
				});
				return ready();
			},
			() => {
				throw new Error("AccessDeniedException");
			},
			() => {
				throw new Error("Missing expected consumer metadata");
			},
			() => failed,
			() => rollback,
		]) {
			let pauses = 0;
			await expect(
				waitForConsumers(
					expected,
					read,
					() => 0,
					async () => {
						pauses++;
					},
					30,
				),
			).rejects.toThrow();
			expect(pauses).toBe(0);
		}
	});
});
