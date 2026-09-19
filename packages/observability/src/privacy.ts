import { type Context, createContextKey } from "@opentelemetry/api";

const SUPPRESS_USER_ID_KEY = createContextKey(
	"@macro-inc/observability/suppress-user-id",
);

/** Marks telemetry whose contract forbids user identity enrichment. */
export function suppressUserId(context: Context): Context {
	return context.setValue(SUPPRESS_USER_ID_KEY, true);
}

/** Returns whether a span/log context forbids user identity enrichment. */
export function userIdSuppressed(context: Context): boolean {
	return context.getValue(SUPPRESS_USER_ID_KEY) === true;
}
