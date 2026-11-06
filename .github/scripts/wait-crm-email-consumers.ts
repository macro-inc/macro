import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";

export type ExpectedConsumer = {
	cluster: string;
	service: string;
	taskDefinition: string;
	image: string;
	container: string;
};
type Deployment = {
	status?: string;
	taskDefinition?: string;
	rolloutState?: string;
	runningCount?: number;
	pendingCount?: number;
};
export type Service = {
	status?: string;
	taskDefinition?: string;
	desiredCount?: number;
	runningCount?: number;
	pendingCount?: number;
	deployments?: Deployment[];
};
export type Task = {
	taskArn?: string;
	taskDefinitionArn?: string;
	lastStatus?: string;
	desiredStatus?: string;
	healthStatus?: string;
	containers?: {
		name?: string;
		image?: string;
		imageDigest?: string;
		lastStatus?: string;
	}[];
};
export type Snapshot = {
	services?: Service[];
	tasks: Task[];
	failures?: unknown[];
};

export function expectedConsumer(value: unknown): ExpectedConsumer {
	if (!value || typeof value !== "object")
		throw new Error("Missing expected consumer metadata");
	for (const field of [
		"cluster",
		"service",
		"taskDefinition",
		"image",
		"container",
	] as const) {
		if (
			!(field in value) ||
			typeof value[field] !== "string" ||
			!value[field]
		) {
			throw new Error(`Missing expected consumer ${field}`);
		}
	}
	const expected = value as ExpectedConsumer;
	if (
		!expected.taskDefinition.includes(":task-definition/") ||
		!/@sha256:[a-f0-9]{64}$/.test(expected.image)
	) {
		throw new Error(
			"Expected consumer must name a task definition and immutable image digest",
		);
	}
	return expected;
}

/** A stable rollback or an old task that is still STOPPING must not expose consent. */
export function consumersReady(
	expected: ExpectedConsumer,
	snapshot: Snapshot,
): boolean {
	return readinessBlockers(expected, snapshot).length === 0;
}

function readinessBlockers(
	expected: ExpectedConsumer,
	snapshot: Snapshot,
): string[] {
	if (snapshot.failures?.length || snapshot.services?.length !== 1) {
		throw new Error("Email consumer service/tasks could not be described");
	}
	const service = snapshot.services[0];
	const deployments = service.deployments ?? [];
	if (deployments.some((deployment) => deployment.rolloutState === "FAILED")) {
		throw new Error("Email consumer rollout failed");
	}
	if (service.taskDefinition !== expected.taskDefinition) {
		throw new Error(
			"Email consumer task definition differs from this deployment (possible rollback)",
		);
	}
	const primary = deployments.find(
		(deployment) => deployment.status === "PRIMARY",
	);
	if (primary?.taskDefinition !== expected.taskDefinition) {
		throw new Error("Expected email consumer deployment is not primary");
	}
	const desired = service.desiredCount;
	const blockers = new Set<string>();
	if (service.status !== "ACTIVE") blockers.add("service-not-active");
	if (!desired || desired < 1) blockers.add("nonpositive-desired-count");
	if (deployments.length !== 1) blockers.add("multiple-deployments");
	if (primary.rolloutState !== "COMPLETED")
		blockers.add("primary-rollout-incomplete");
	if (service.pendingCount !== 0 || primary.pendingCount !== 0)
		blockers.add("pending-tasks");
	if (service.runningCount !== desired || primary.runningCount !== desired)
		blockers.add("running-count-mismatch");
	const active = snapshot.tasks.filter((task) => task.lastStatus !== "STOPPED");
	if (active.length !== desired) blockers.add("active-task-count-mismatch");
	for (const task of active) {
		const container = task.containers?.find(
			(item) => item.name === expected.container,
		);
		if (task.taskDefinitionArn !== expected.taskDefinition)
			blockers.add("unexpected-task-revision");
		if (task.lastStatus !== "RUNNING" || task.desiredStatus !== "RUNNING")
			blockers.add("task-not-running");
		if (task.healthStatus === "UNHEALTHY") blockers.add("unhealthy-task");
		if (!container) {
			blockers.add("expected-container-missing");
			continue;
		}
		if (container.lastStatus !== "RUNNING")
			blockers.add("container-not-running");
		// The pinned URI may identify an OCI index while ECS reports its
		// selected platform manifest in imageDigest. Compare the immutable
		// input URI, not those different digest types.
		if (container.image !== expected.image) blockers.add("image-uri-mismatch");
		if (!/^sha256:[a-f0-9]{64}$/.test(container.imageDigest ?? ""))
			blockers.add("image-digest-missing-or-invalid");
	}
	return [...blockers];
}

// Project only readiness inputs, never arbitrary AWS response fields (which may
// contain environment, overrides or failure messages). Bound both rows and text.
function readinessObservation(expected: ExpectedConsumer, state: Snapshot) {
	const text = (value: string | undefined) => value?.slice(0, 256);
	const active = state.tasks.filter((task) => task.lastStatus !== "STOPPED");
	return {
		expected: {
			cluster: text(expected.cluster),
			service: text(expected.service),
			taskDefinition: text(expected.taskDefinition),
			image: text(expected.image),
			container: text(expected.container),
		},
		services: state.services?.slice(0, 1).map((service) => ({
			status: text(service.status),
			taskDefinition: text(service.taskDefinition),
			desiredCount: service.desiredCount,
			runningCount: service.runningCount,
			pendingCount: service.pendingCount,
			deploymentCount: service.deployments?.length,
			deployments: service.deployments?.slice(0, 10).map((deployment) => ({
				status: text(deployment.status),
				taskDefinition: text(deployment.taskDefinition),
				rolloutState: text(deployment.rolloutState),
				runningCount: deployment.runningCount,
				pendingCount: deployment.pendingCount,
			})),
		})),
		activeTaskCount: active.length,
		stoppedTaskCount: state.tasks.length - active.length,
		tasksTruncated: active.length > 20,
		tasks: active.slice(0, 20).map((task) => ({
			taskArn: text(task.taskArn),
			taskDefinition: text(task.taskDefinitionArn),
			lastStatus: text(task.lastStatus),
			desiredStatus: text(task.desiredStatus),
			healthStatus: text(task.healthStatus),
			containerCount: task.containers?.length,
			containers: task.containers?.slice(0, 10).map((container) => ({
				name: text(container.name),
				image: text(container.image),
				imageDigest: text(container.imageDigest),
				lastStatus: text(container.lastStatus),
			})),
		})),
	};
}

/** Incomplete observations require a fresh read; they never prove readiness. */
export class TransientSnapshotError extends Error {}

export function isCliTimeout(error: unknown): boolean {
	if (!error || typeof error !== "object") return false;
	if ("code" in error && error.code === "ETIMEDOUT") return true;
	const stderr = "stderr" in error ? error.stderr : undefined;
	const text =
		typeof stderr === "string"
			? stderr
			: Buffer.isBuffer(stderr)
				? stderr.toString("utf8")
				: "";
	return /^(?:Read|Connect) timeout on endpoint URL:/m.test(text);
}

/** Only one recognized ECS diagnostic is retryable; mixed/unknown failures are fatal. */
export function isRetryableAwsFailure(error: unknown): boolean {
	if (!error || typeof error !== "object") return false;
	const stderr = "stderr" in error ? error.stderr : undefined;
	const text = (
		typeof stderr === "string"
			? stderr
			: Buffer.isBuffer(stderr)
				? stderr.toString("utf8")
				: ""
	).trim();
	if (!text) return isCliTimeout(error);
	if (/^(?:Read|Connect) timeout on endpoint URL:[^\r\n]*$/.test(text))
		return isCliTimeout(error);
	const diagnostic = text.match(
		/^An error occurred \(([^)]+)\) when calling the (?:DescribeServices|ListTasks|DescribeTasks) operation(?: \(reached max retries: \d+\))?:[^\r\n]*$/,
	);
	if (!diagnostic) return false;
	return new Set([
		"Throttling",
		"ThrottlingException",
		"ThrottledException",
		"RequestThrottledException",
		"RequestThrottled",
		"RequestLimitExceeded",
		"TooManyRequestsException",
		"ServerException",
		"InternalFailure",
		"InternalError",
		"ServiceUnavailable",
		"ServiceUnavailableException",
		"500",
		"502",
		"503",
		"504",
	]).has(diagnostic[1]);
}

export function rethrowAwsFailure(error: unknown): never {
	if (isRetryableAwsFailure(error))
		throw new TransientSnapshotError("Temporary AWS CLI snapshot failure");
	throw error;
}

export function snapshotTasks(
	requested: string[],
	described: { tasks?: Task[]; failures?: { reason?: string }[] },
): Task[] {
	const failures = described.failures ?? [];
	if (failures.some((failure) => failure.reason !== "MISSING"))
		throw new Error("Email consumer task describe failed permanently");
	const tasks = described.tasks;
	if (
		failures.length ||
		!Array.isArray(tasks) ||
		tasks.length !== requested.length ||
		new Set(tasks.map((task) => task.taskArn)).size !== requested.length ||
		tasks.some((task) => !task.taskArn || !requested.includes(task.taskArn))
	)
		throw new TransientSnapshotError("Incomplete email consumer task snapshot");
	return tasks;
}

function aws<T>(args: string[]): T {
	try {
		return JSON.parse(
			execFileSync(
				"aws",
				[
					"ecs",
					...args,
					"--output",
					"json",
					"--no-cli-pager",
					"--cli-connect-timeout",
					"10",
					"--cli-read-timeout",
					"30",
				],
				{
					encoding: "utf8",
					timeout: 45_000,
					maxBuffer: 16 * 1024 * 1024,
				},
			),
		);
	} catch (error) {
		rethrowAwsFailure(error);
	}
}

function snapshot(expected: ExpectedConsumer): Snapshot {
	const service = aws<{ services?: Service[]; failures?: unknown[] }>([
		"describe-services",
		"--cluster",
		expected.cluster,
		"--services",
		expected.service,
	]);
	// A missing task must not delay a known failed/rolled-back service result.
	consumersReady(expected, { ...service, tasks: [] });
	// RUNNING alone omits tasks whose desired state is STOPPED but whose process
	// still executes. AWS CLI pagination stays enabled for both lists.
	const arns = new Set<string>();
	for (const status of ["RUNNING", "STOPPED"]) {
		const listed = aws<{ taskArns?: string[] }>([
			"list-tasks",
			"--cluster",
			expected.cluster,
			"--service-name",
			expected.service,
			"--desired-status",
			status,
		]);
		if (!Array.isArray(listed.taskArns))
			throw new Error("Missing email consumer task list");
		for (const arn of listed.taskArns) arns.add(arn);
	}
	const tasks: Task[] = [];
	const failures = [...(service.failures ?? [])];
	const all = [...arns];
	for (let offset = 0; offset < all.length; offset += 100) {
		const chunk = all.slice(offset, offset + 100);
		const described = aws<{ tasks?: Task[]; failures?: { reason?: string }[] }>(
			["describe-tasks", "--cluster", expected.cluster, "--tasks", ...chunk],
		);
		tasks.push(...snapshotTasks(chunk, described));
	}
	return { ...service, tasks, failures };
}

export async function waitForConsumers(
	expected: ExpectedConsumer,
	read: () => Snapshot,
	now: () => number = Date.now,
	pause: () => Promise<unknown> = () => sleep(10_000),
	timeoutMs = 15 * 60_000,
	report: (observation: object) => void = (observation) =>
		console.error(JSON.stringify(observation)),
): Promise<void> {
	const deadline = now() + timeoutMs;
	let nextReport = now();
	let lastObservation: object = { blockers: ["no-complete-snapshot"] };
	while (now() < deadline) {
		try {
			const state = read();
			const blockers = readinessBlockers(expected, state);
			lastObservation = { blockers, ...readinessObservation(expected, state) };
			if (now() >= deadline) break;
			if (blockers.length === 0) return;
		} catch (error) {
			if (!(error instanceof TransientSnapshotError)) throw error;
			lastObservation = { blockers: ["transient-incomplete-snapshot"] };
		}
		if (now() >= nextReport) {
			report({ consumerReadiness: "waiting", ...lastObservation });
			nextReport = now() + 60_000;
		}
		if (now() >= deadline) break;
		await pause();
	}
	report({ consumerReadiness: "timed-out", ...lastObservation });
	throw new Error(
		"Timed out waiting for exact email consumers and old-task termination",
	);
}

if (import.meta.main) {
	const expected = expectedConsumer(
		JSON.parse(readFileSync(process.argv[2], "utf8")),
	);
	await waitForConsumers(expected, () => snapshot(expected));
	console.log(JSON.stringify({ consumerReadiness: "passed", ...expected }));
}
