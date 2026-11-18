/**
 * The part of `@macro-inc/observability` that wake telemetry uses, as types
 * of muppet's own: the library sits outside Macro's workspace and can't
 * import that package, so the agent passes its `Telemetry` in.
 *
 * This file imports nothing, so that `packages/observability` can import it:
 * `src/muppet.test.ts` there fails to type-check when its `Telemetry` class
 * stops fitting `MacroTelemetry`. Change the two together.
 */

export type Attribute = string | number | boolean | string[];
export type Attributes = Readonly<Record<string, Attribute | undefined>>;

/** The part of a span of `@macro-inc/observability` this uses. */
export type MacroSpan = {
	readonly run: <T>(operation: () => T) => T;
	readonly setAttr: (name: string, value: Attribute) => void;
	readonly error: (error: unknown) => void;
	readonly traceparent: () => string | undefined;
	/** `timestamp` is Unix time in milliseconds. */
	readonly end: (timestamp?: number) => void;
};

/** The part of `Telemetry` from `@macro-inc/observability` this uses. The class itself fits. */
export type MacroTelemetry = {
	/** `startTime` is Unix time in milliseconds. */
	readonly span: (
		name: string,
		options?: { readonly startTime?: number },
	) => MacroSpan;
	readonly remoteContext: (traceparent: string) => {
		readonly run: <T>(operation: () => T) => T;
	};
	readonly info: (message: string, attributes?: Attributes) => void;
	readonly warn: (message: string, attributes?: Attributes) => void;
	readonly error: (error: unknown, attributes?: Attributes) => void;
	readonly flush: () => Promise<void>;
};
