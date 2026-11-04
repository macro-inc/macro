export type BookingValueUnit = {
  id: string;
  label: string;
  short: string;
  factor: number;
  /** Units without decimal places use whole amounts. */
  decimalPlaces?: number;
};

export const MINUTE_UNITS: readonly BookingValueUnit[] = [
  { id: 'minutes', label: 'Minutes', short: 'min', factor: 1 },
  { id: 'hours', label: 'Hours', short: 'hours', factor: 60, decimalPlaces: 2 },
];
export const NOTICE_UNITS: readonly BookingValueUnit[] = [
  ...MINUTE_UNITS,
  { id: 'days', label: 'Days', short: 'days', factor: 1440 },
];
export const DAY_UNITS: readonly BookingValueUnit[] = [
  { id: 'days', label: 'Days', short: 'days', factor: 1 },
  { id: 'weeks', label: 'Weeks', short: 'wk', factor: 7 },
];

/** Upgrade at thresholds only when the unit can preserve the stored amount. */
export function automaticBookingUnit(
  value: number,
  units: readonly BookingValueUnit[]
): BookingValueUnit {
  if (!units.length)
    throw new Error('Booking value controls require at least one unit');
  return (
    [...units]
      .reverse()
      .find(
        (unit) =>
          Number.isFinite(value) &&
          value >= unit.factor &&
          ((unit.decimalPlaces ?? 0) > 0 ||
            Number.isInteger(value / unit.factor))
      ) ?? units[0]
  );
}

export function displayBookingValue(
  value: number,
  unit: BookingValueUnit
): number | '' {
  return Number.isFinite(value)
    ? Number((value / unit.factor).toFixed(unit.decimalPlaces ?? 0))
    : '';
}

/** Round to unit precision, then store whole minutes or days. */
export function storedBookingValue(
  value: number,
  unit: BookingValueUnit
): number {
  const scale = 10 ** (unit.decimalPlaces ?? 0);
  return Math.round((Math.round(value * scale) / scale) * unit.factor);
}

/** Fractional bounds round outward; whole-unit ranges round inward. */
export function bookingValueBounds(
  min: number,
  max: number,
  unit: BookingValueUnit
): { min: number; max: number } {
  const scale = 10 ** (unit.decimalPlaces ?? 0);
  return (unit.decimalPlaces ?? 0) > 0
    ? {
        min: Math.floor((min / unit.factor) * scale) / scale,
        max: Math.ceil((max / unit.factor) * scale) / scale,
      }
    : {
        min: Math.ceil(min / unit.factor),
        max: Math.floor(max / unit.factor),
      };
}

/** Convert within field limits using the chosen unit's precision. */
export function convertBookingValue(
  value: number,
  unit: BookingValueUnit,
  min: number,
  max: number
): number {
  const bounds = bookingValueBounds(min, max, unit);
  if (bounds.min > bounds.max)
    throw new Error('Booking unit has no value within the field limits');
  const amount = Math.min(
    bounds.max,
    Math.max(bounds.min, value / unit.factor)
  );
  return Math.min(max, Math.max(min, storedBookingValue(amount, unit)));
}

export function describeBookingValue(
  value: number,
  units: readonly BookingValueUnit[]
): string {
  const unit = automaticBookingUnit(value, units);
  const amount = displayBookingValue(value, unit);
  const name = amount === 1 ? unit.label.replace(/s$/, '') : unit.label;
  return `${amount} ${name.toLowerCase()}`;
}
