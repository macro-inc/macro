import type {
	ContextManager,
	AttributeValue as OtelAttributeValue,
} from "@opentelemetry/api";
import type { TelemetryTracingProviderFactory } from "./provider";

export type Attribute = OtelAttributeValue;
export type Attributes = Record<string, Attribute | undefined>;
export type LogAttributes = Attributes;

export interface TelemetryInitConfig {
	serviceName: string;
	environment: string;
	tracesUrl?: string;
	logsUrl?: string;
	contextManager?: ContextManager;
	tracingProvider?: TelemetryTracingProviderFactory;
	enabled: () => Promise<boolean>;
}

/** Mutable attributes applied to telemetry created after they change. */
export class TelemetryRuntimeConfig {
	#userId: string | undefined;

	get userId(): string | undefined {
		return this.#userId;
	}

	setUser(userId: string | undefined): void {
		this.#userId = userId;
	}
}
