interface FlagReading {
  enabled: boolean;
  variant?: string;
}

/** An experiment caches only for its `test` variant; a plain flag when on. */
export function cacheEnabledFor(reading: FlagReading): boolean {
  return reading.variant ? reading.variant === 'test' : reading.enabled;
}

/** The arm telemetry reports, or undefined for a viewer outside the rollout. */
export function cacheArmFor(reading: FlagReading): string | undefined {
  return reading.variant ?? (reading.enabled ? 'enabled' : undefined);
}
