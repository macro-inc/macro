import { fireAndForget } from '@core/util/fireAndForget';
import CrosshairIcon from '@icon/system/regular/crosshair.svg';
import { Button, cn, Input, Tabs } from '@ui';
import { createSignal, type JSX, Show } from 'solid-js';
import { match } from 'ts-pattern';
import {
  type LocationTriggerDraft,
  PLACE_RADII,
  type PlaceTransition,
  parseCoordinate,
  parseCoordinatePair,
} from '../core/location-trigger';

/** A labelled field of a trigger panel. */
function Field(props: {
  label: string;
  children: JSX.Element;
  class?: string;
}) {
  return (
    <div class={cn('grid min-w-0 gap-1.5', props.class)}>
      <span class="text-xs font-medium text-ink-muted">{props.label}</span>
      {props.children}
    </div>
  );
}

const TRANSITIONS: { value: PlaceTransition; label: string }[] = [
  { value: 'arrive', label: 'Arrive' },
  { value: 'leave', label: 'Leave' },
];

/** Six decimals is about 10 cm, finer than any phone's fix. */
function roundDegrees(value: number) {
  return Math.round(value * 1e6) / 1e6;
}

function geolocationError(error: GeolocationPositionError): string {
  return match(error.code)
    .with(
      error.PERMISSION_DENIED,
      () =>
        'Location access is blocked for Macro. Allow it, or enter the coordinates.'
    )
    .with(
      error.TIMEOUT,
      () => 'Finding your location took too long. Try again.'
    )
    .otherwise(() => 'Your location is unavailable right now. Try again.');
}

/** The device's position, or why it could not be read. */
function currentPosition(): Promise<
  { latitude: number; longitude: number } | { error: string }
> {
  if (!('geolocation' in navigator))
    return Promise.resolve({ error: 'This device can’t share its location.' });
  return new Promise((resolve) =>
    navigator.geolocation.getCurrentPosition(
      (position) =>
        resolve({
          latitude: roundDegrees(position.coords.latitude),
          longitude: roundDegrees(position.coords.longitude),
        }),
      (error) => resolve({ error: geolocationError(error) }),
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000 }
    )
  );
}

/** A place trigger's settings: where the place is, how big, and which crossing. */
export function RoutineLocationSettings(props: {
  trigger: LocationTriggerDraft;
  onChange: (patch: Partial<LocationTriggerDraft>) => void;
  /** This device's location access, on the phone apps. */
  access?: JSX.Element;
}) {
  const [latitudeText, setLatitudeText] = createSignal(
    props.trigger.latitude === null ? '' : String(props.trigger.latitude)
  );
  const [longitudeText, setLongitudeText] = createSignal(
    props.trigger.longitude === null ? '' : String(props.trigger.longitude)
  );
  const [locating, setLocating] = createSignal(false);
  const [locationError, setLocationError] = createSignal<string>();

  const setCoordinates = (latitude: number, longitude: number) => {
    setLatitudeText(String(latitude));
    setLongitudeText(String(longitude));
    setLocationError(undefined);
    props.onChange({ latitude, longitude });
  };

  /** A pasted "lat, lng" pair fills both fields; one number fills its own. */
  const typeCoordinate = (field: 'latitude' | 'longitude', text: string) => {
    const pair = parseCoordinatePair(text);
    if (pair) {
      setCoordinates(pair.latitude, pair.longitude);
      return;
    }
    if (field === 'latitude') {
      setLatitudeText(text);
      props.onChange({ latitude: parseCoordinate(text) });
      return;
    }
    setLongitudeText(text);
    props.onChange({ longitude: parseCoordinate(text) });
  };

  async function fillCurrentLocation() {
    setLocating(true);
    setLocationError(undefined);
    const position = await currentPosition();
    setLocating(false);
    if ('error' in position) {
      setLocationError(position.error);
      return;
    }
    setCoordinates(position.latitude, position.longitude);
  }

  return (
    <div class="grid gap-3.5">
      <Field label="Place name">
        <Input
          aria-label="Place name"
          placeholder="Office"
          value={props.trigger.name}
          onInput={(e) => props.onChange({ name: e.currentTarget.value })}
        />
      </Field>
      <Field label="Location">
        <Button
          variant="secondary"
          size="sm"
          class="justify-self-start"
          disabled={locating()}
          onClick={() =>
            fireAndForget(fillCurrentLocation(), 'routines-location')
          }
        >
          <CrosshairIcon class="size-3.5 shrink-0" />
          {locating() ? 'Finding your location…' : 'Use my current location'}
        </Button>
        <Show when={locationError()}>
          {(message) => (
            <p role="alert" class="text-xs leading-4 text-failure">
              {message()}
            </p>
          )}
        </Show>
        <div class="grid grid-cols-2 gap-2.5">
          <Input
            aria-label="Latitude"
            placeholder="Latitude"
            inputMode="decimal"
            value={latitudeText()}
            onInput={(e) => typeCoordinate('latitude', e.currentTarget.value)}
          />
          <Input
            aria-label="Longitude"
            placeholder="Longitude"
            inputMode="decimal"
            value={longitudeText()}
            onInput={(e) => typeCoordinate('longitude', e.currentTarget.value)}
          />
        </div>
        <span class="text-xs leading-4 text-ink-muted">
          Or paste coordinates, like 40.7128, -74.006.
        </span>
      </Field>
      <Field label="Within">
        <Tabs
          aria-label="Radius"
          size="sm"
          fullWidth
          options={PLACE_RADII.map((radius) => ({
            value: String(radius.meters),
            label: radius.label,
          }))}
          value={String(props.trigger.radiusMeters)}
          onChange={(meters) =>
            props.onChange({ radiusMeters: Number(meters) })
          }
        />
      </Field>
      <Field label="Run when I">
        <Tabs
          aria-label="Run when I"
          size="sm"
          options={TRANSITIONS}
          value={props.trigger.on}
          onChange={(on) => props.onChange({ on })}
        />
      </Field>
      <p class="text-xs leading-4 text-ink-muted">
        Runs from the Macro app on your phone, which needs location access set
        to Always.
      </p>
      {props.access}
    </div>
  );
}
