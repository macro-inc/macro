import { resourceFromAttributes } from "@opentelemetry/resources";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import {
	type LogAttributes,
	type TelemetryInitConfig,
	TelemetryRuntimeConfig,
} from "./config";
import { ATTR_DEPLOYMENT_ENVIRONMENT, CONSOLE_PREFIX } from "./constants";
import { Logging } from "./logging";
import type { Span } from "./span";
import { Tracing } from "./tracing";

type SpanOperation<T> = (span: Span) => Promise<T>;

export class Telemetry {
	static readonly #tracing = new Tracing();
	static readonly #logging = new Logging();
	static #initialization: Promise<void> | undefined;

	private constructor() {}

	static readonly config = new TelemetryRuntimeConfig();

	/** Initialize providers once, after the optional async enablement decision. */
	static init(config: TelemetryInitConfig): Promise<void> {
		Telemetry.#initialization ??= Telemetry.#initialize(config);
		return Telemetry.#initialization;
	}

	static span<T>(name: string, operation: SpanOperation<T>): Promise<T>;
	static span(name: string): Span;
	static span<T>(
		name: string,
		operation?: SpanOperation<T>,
	): Span | Promise<T> {
		return Telemetry.#runSpan(Telemetry.#tracing.span(name), operation);
	}

	/**
	 * Start telemetry whose complete span tree is forbidden from receiving the
	 * runtime user-id enrichment. Use this for privacy-aggregated subsystem
	 * metrics whose schema does not permit identity.
	 */
	static anonymousSpan<T>(
		name: string,
		operation: SpanOperation<T>,
	): Promise<T>;
	static anonymousSpan(name: string): Span;
	static anonymousSpan<T>(
		name: string,
		operation?: SpanOperation<T>,
	): Span | Promise<T> {
		return Telemetry.#runSpan(
			Telemetry.#tracing.anonymousSpan(name),
			operation,
		);
	}

	/** Start an HTTP client span. Callers must end the returned span. */
	static clientSpan(name: string): Span {
		return Telemetry.#tracing.clientSpan(name);
	}

	static debug(message: string, attributes?: LogAttributes): void {
		Telemetry.#logging.debug(message, attributes);
	}

	static info(message: string, attributes?: LogAttributes): void {
		Telemetry.#logging.info(message, attributes);
	}

	static warn(message: string, attributes?: LogAttributes): void {
		Telemetry.#logging.warn(message, attributes);
	}

	static error(error: unknown, attributes?: LogAttributes): void {
		Telemetry.#logging.error(error, attributes);
	}

	static async flush(): Promise<void> {
		await Promise.all([Telemetry.#tracing.flush(), Telemetry.#logging.flush()]);
	}

	static async shutdown(): Promise<void> {
		await Promise.all([
			Telemetry.#tracing.shutdown(),
			Telemetry.#logging.shutdown(),
		]);
	}

	static #runSpan<T>(
		span: Span,
		operation?: SpanOperation<T>,
	): Span | Promise<T> {
		if (!operation) return span;

		return span.run(async () => {
			try {
				return await operation(span);
			} finally {
				span.end();
			}
		});
	}

	static async #initialize(config: TelemetryInitConfig): Promise<void> {
		try {
			if (!(await config.enabled())) return;
		} catch (error) {
			console.warn(`${CONSOLE_PREFIX} Failed to resolve enablement`, error);
			return;
		}

		const resource = resourceFromAttributes({
			[ATTR_SERVICE_NAME]: config.serviceName,
			[ATTR_DEPLOYMENT_ENVIRONMENT]: config.environment,
		});
		const getUserId = () => Telemetry.config.userId;
		Telemetry.#tracing.init(config, resource, getUserId);
		Telemetry.#logging.init(config, resource, getUserId);
	}
}
