import type { Attributes as OtelAttributes } from "@opentelemetry/api";
import { type Logger, logs, SeverityNumber } from "@opentelemetry/api-logs";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import type { Resource } from "@opentelemetry/resources";
import {
	BatchLogRecordProcessor,
	LoggerProvider,
} from "@opentelemetry/sdk-logs";
import {
	ATTR_EXCEPTION_MESSAGE,
	ATTR_EXCEPTION_STACKTRACE,
	ATTR_EXCEPTION_TYPE,
} from "@opentelemetry/semantic-conventions";
import type { LogAttributes, TelemetryInitConfig } from "./config";
import {
	ATTR_USER_ID,
	CONSOLE_PREFIX,
	INSTRUMENTATION_SCOPE_NAME,
} from "./constants";

type LogLevel = "debug" | "info" | "warn" | "error";

export class Logging {
	#provider: LoggerProvider | undefined;
	readonly #logger: Logger = logs.getLogger(INSTRUMENTATION_SCOPE_NAME);

	init(
		config: TelemetryInitConfig,
		resource: Resource,
		getUserId: () => string | undefined,
	): void {
		if (!config.logsUrl) return;
		this.#provider = new LoggerProvider({
			resource,
			processors: [
				{
					onEmit: (record) => {
						const userId = getUserId();
						if (userId !== undefined) record.setAttribute(ATTR_USER_ID, userId);
					},
					forceFlush: () => Promise.resolve(),
					shutdown: () => Promise.resolve(),
				},
				new BatchLogRecordProcessor({
					exporter: new OTLPLogExporter({ url: config.logsUrl }),
				}),
			],
		});
		logs.setGlobalLoggerProvider(this.#provider);
	}

	debug(message: string, attributes?: LogAttributes): void {
		this.#emit("debug", message, attributes);
	}

	info(message: string, attributes?: LogAttributes): void {
		this.#emit("info", message, attributes);
	}

	warn(message: string, attributes?: LogAttributes): void {
		this.#emit("warn", message, attributes);
	}

	error(error: unknown, attributes?: LogAttributes): void {
		const normalized = Logging.#normalizeError(error);
		this.#emit(
			"error",
			typeof normalized === "string"
				? normalized
				: normalized.message || normalized.name,
			{
				...attributes,
				...(normalized instanceof Error && {
					[ATTR_EXCEPTION_TYPE]: normalized.name,
					[ATTR_EXCEPTION_MESSAGE]: normalized.message,
					[ATTR_EXCEPTION_STACKTRACE]: normalized.stack,
				}),
			},
		);
	}

	async flush(): Promise<void> {
		await this.#provider?.forceFlush();
	}

	async shutdown(): Promise<void> {
		await this.#provider?.shutdown();
		this.#provider = undefined;
	}

	#emit(level: LogLevel, message: string, attributes?: LogAttributes): void {
		const severity = {
			debug: SeverityNumber.DEBUG,
			info: SeverityNumber.INFO,
			warn: SeverityNumber.WARN,
			error: SeverityNumber.ERROR,
		}[level];
		this.#logger.emit({
			severityNumber: severity,
			severityText: level,
			body: message,
			attributes: attributes as OtelAttributes,
		});
		const consoleMethod = level === "info" ? "log" : level;
		console[consoleMethod](CONSOLE_PREFIX, message, attributes ?? {});
	}

	static #normalizeError(error: unknown): Error | string {
		return error instanceof Error ||
			typeof error === "string" ||
			(typeof error === "object" && error !== null && "message" in error)
			? (error as Error | string)
			: String(error);
	}
}
