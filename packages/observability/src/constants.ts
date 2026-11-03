export const INSTRUMENTATION_SCOPE_NAME = '@macro-inc/observability';
export const ATTR_USER_ID = 'usr.id';
export const ATTR_DEPLOYMENT_ENVIRONMENT = 'deployment.environment';
export const CONSOLE_PREFIX = '[observability]';
/** The sampling class that exported a span, on every span in a classed trace. */
export const ATTR_SAMPLING_CLASS = 'macro.sampling.class';
/** That class's rate, 0 to 1: weight a span by its inverse to count all sessions. */
export const ATTR_SAMPLING_RATE = 'macro.sampling.rate';
