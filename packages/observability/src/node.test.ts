// @vitest-environment node
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, expect, test } from "vitest";
import { Telemetry } from "./index";
import { createNodeTracingProvider } from "./node";

const posts: { path: string; body: string }[] = [];
const collector = createServer((request, response) => {
	const chunks: Buffer[] = [];
	request.on("data", (chunk: Buffer) => chunks.push(chunk));
	request.on("end", () => {
		posts.push({
			path: request.url ?? "",
			body: Buffer.concat(chunks).toString(),
		});
		response.writeHead(200, { "content-type": "application/json" });
		response.end("{}");
	});
});

beforeAll(
	() =>
		new Promise<void>((resolve) => collector.listen(0, "127.0.0.1", resolve)),
);
afterAll(async () => {
	await Telemetry.shutdown();
	collector.close();
});

test("a Node process exports a span and its log, under a remote parent, across awaits", async () => {
	const { port } = collector.address() as AddressInfo;
	const config = {
		serviceName: "node-test",
		environment: "test",
		tracesUrl: `http://127.0.0.1:${port}/v1/traces`,
		logsUrl: `http://127.0.0.1:${port}/v1/logs`,
		resourceAttributes: { "service.namespace": "muppet" },
		enabled: async () => true,
	};
	await Telemetry.init({
		...config,
		tracingProvider: (resource, getUserId, sampling) =>
			createNodeTracingProvider(config, resource, getUserId, sampling),
	});
	// Trace context is handed on only once enablement has settled.
	await Telemetry.flush();

	const traceId = "cd".repeat(16);
	const parentSpanId = "ef".repeat(8);
	const span = Telemetry.remoteContext(`00-${traceId}-${parentSpanId}-01`).run(
		() =>
			Telemetry.span("invoke_agent node-test", { startTime: 1794387600000 }),
	);
	const traceparent = span.traceparent();
	await span.run(async () => {
		await new Promise((resolve) => setTimeout(resolve, 1));
		Telemetry.info("wake ended", { "muppet.wake.id": "wake-1" });
	});
	span.setAttr("muppet.outcome.name", "no_action");
	span.end(1794387690500);
	await Telemetry.flush();

	expect(traceparent).toMatch(new RegExp(`^00-${traceId}-[0-9a-f]{16}-01$`));
	const spanId = traceparent?.split("-")[2];
	const traces = posts.find(({ path }) => path === "/v1/traces");
	const logs = posts.find(({ path }) => path === "/v1/logs");
	const sent = JSON.parse(traces?.body ?? "{}").resourceSpans[0];
	expect(sent.resource.attributes).toContainEqual({
		key: "service.namespace",
		value: { stringValue: "muppet" },
	});
	expect(sent.scopeSpans[0].spans[0]).toMatchObject({
		name: "invoke_agent node-test",
		traceId,
		spanId,
		parentSpanId,
		startTimeUnixNano: "1794387600000000000",
		endTimeUnixNano: "1794387690500000000",
	});
	expect(
		JSON.parse(logs?.body ?? "{}").resourceLogs[0].scopeLogs[0].logRecords[0],
	).toMatchObject({ body: { stringValue: "wake ended" }, traceId, spanId });
});
