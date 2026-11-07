import { match } from 'ts-pattern';
import { z } from 'zod';

/** Arriving at a place or leaving it, the one crossing a location trigger runs on. */
export const placeTransitionSchema = z.enum(['arrive', 'leave']);
export type PlaceTransition = z.infer<typeof placeTransitionSchema>;

/** A place the owner's phone watches, as the editor holds it. */
export const locationTriggerSchema = z.object({
  id: z.string(),
  kind: z.literal('location'),
  name: z.string(),
  /** Unset until typed, pasted or read from the device. */
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
  radiusMeters: z.number(),
  on: placeTransitionSchema,
});
export type LocationTriggerDraft = z.infer<typeof locationTriggerSchema>;

export const MAX_PLACE_NAME_CHARS = 100;
export const MIN_RADIUS_METERS = 100;
export const MAX_RADIUS_METERS = 5000;

/** The radii the editor offers; phones place a fence reliably only from 100 m. */
export const PLACE_RADII: { meters: number; label: string }[] = [
  { meters: 100, label: '100 m' },
  { meters: 200, label: '200 m' },
  { meters: 500, label: '500 m' },
  { meters: 1000, label: '1 km' },
  { meters: 5000, label: '5 km' },
];

/** A radius as the editor offers it, such as "200 m" or "1 km". */
export function placeRadiusLabel(meters: number): string {
  return (
    PLACE_RADII.find((radius) => radius.meters === meters)?.label ??
    `${meters} m`
  );
}

export function newLocationTrigger(on: PlaceTransition): LocationTriggerDraft {
  return {
    id: crypto.randomUUID(),
    kind: 'location',
    name: '',
    latitude: null,
    longitude: null,
    radiusMeters: 200,
    on,
  };
}

export function validateLocationTrigger(
  trigger: LocationTriggerDraft
): string | null {
  const name = trigger.name.trim();
  if (!name) return 'Name the place, such as Office.';
  if ([...name].length > MAX_PLACE_NAME_CHARS)
    return `Keep the place name under ${MAX_PLACE_NAME_CHARS} characters.`;
  if (trigger.latitude === null || trigger.longitude === null)
    return 'Set where the place is, or use your current location.';
  if (!Number.isFinite(trigger.latitude) || Math.abs(trigger.latitude) > 90)
    return 'Use a latitude between -90 and 90.';
  if (!Number.isFinite(trigger.longitude) || Math.abs(trigger.longitude) > 180)
    return 'Use a longitude between -180 and 180.';
  if (
    !Number.isInteger(trigger.radiusMeters) ||
    trigger.radiusMeters < MIN_RADIUS_METERS ||
    trigger.radiusMeters > MAX_RADIUS_METERS
  )
    return `Choose a radius between ${MIN_RADIUS_METERS} and ${MAX_RADIUS_METERS} meters.`;
  return null;
}

/** A place trigger in a line, such as "Arrive at Office" or "Leave Office". */
export function describeLocationTrigger(trigger: {
  name: string;
  on: PlaceTransition;
}): string {
  const name = trigger.name.trim() || 'a place';
  return match(trigger.on)
    .with('arrive', () => `Arrive at ${name}`)
    .with('leave', () => `Leave ${name}`)
    .exhaustive();
}

/** A run a crossing started, such as "Arrived at Office" or "Left Office". */
export function describePlaceCrossing(
  name: string,
  on: PlaceTransition
): string {
  return match(on)
    .with('arrive', () => `Arrived at ${name}`)
    .with('leave', () => `Left ${name}`)
    .exhaustive();
}

/** Coordinates as typed or pasted: "40.7128, -74.006" or "40.7128 -74.006". */
export function parseCoordinatePair(
  text: string
): { latitude: number; longitude: number } | undefined {
  const parts = text
    .trim()
    .split(/[\s,]+/)
    .filter(Boolean);
  if (parts.length !== 2) return undefined;
  const [latitude, longitude] = parts.map(Number);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude))
    return undefined;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return undefined;
  return { latitude, longitude };
}

/** One typed coordinate, or null when the field holds no number. */
export function parseCoordinate(text: string): number | null {
  const value = text.trim();
  if (!/^[-+]?(\d+\.?\d*|\.\d+)$/.test(value)) return null;
  return Number(value);
}
