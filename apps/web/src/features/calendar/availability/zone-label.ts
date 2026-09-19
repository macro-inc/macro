/**
 * Timezone labeling for shared availability text. Lives apart from the
 * slot math so the label logic can be exercised against explicit zones.
 */

function timeZonePart(
  formatter: Intl.DateTimeFormat,
  instant: Date
): string | undefined {
  return formatter
    .formatToParts(instant)
    .find((part) => part.type === 'timeZoneName')?.value;
}

/**
 * A timezone label valid for every given instant: the specific abbreviation
 * (e.g. "EDT") when it is constant across them, otherwise a DST-agnostic
 * label — the generic short name ("ET") where supported, the IANA
 * identifier as a last resort — so a range spanning a daylight-saving
 * transition never claims a single offset for all of its times.
 * `timeZone` overrides the environment zone (used by tests).
 */
export function rangeTimeZoneLabel(
  instants: Date[],
  timeZone?: string
): string | undefined {
  if (instants.length === 0) return undefined;
  const specific = new Intl.DateTimeFormat(undefined, {
    timeZoneName: 'short',
    timeZone,
  });
  const labels = new Set(
    instants.map((instant) => timeZonePart(specific, instant))
  );
  const [firstLabel] = labels;
  if (labels.size === 1) return firstLabel;

  try {
    const generic = new Intl.DateTimeFormat(undefined, {
      timeZoneName: 'shortGeneric',
      timeZone,
    });
    return (
      timeZonePart(generic, instants[0]) ?? specific.resolvedOptions().timeZone
    );
  } catch {
    // Environments without 'shortGeneric' support still get a stable label.
    return specific.resolvedOptions().timeZone;
  }
}
