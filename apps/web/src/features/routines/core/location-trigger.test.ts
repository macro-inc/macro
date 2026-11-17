import { describe, expect, it } from 'vitest';
import { parseCoordinate, parseCoordinatePair } from './location-trigger';

describe('typed and pasted coordinates', () => {
  it('reads a pasted pair, with a comma or a space between', () => {
    expect(parseCoordinatePair('40.7128, -74.006')).toEqual({
      latitude: 40.7128,
      longitude: -74.006,
    });
    expect(parseCoordinatePair(' -33.8688 151.2093 ')).toEqual({
      latitude: -33.8688,
      longitude: 151.2093,
    });
    expect(parseCoordinatePair('40.7128')).toBeUndefined();
    expect(parseCoordinatePair('40.7128, west')).toBeUndefined();
    // Swapped or out of range: not a place.
    expect(parseCoordinatePair('-122.4194, 37.7749')).toBeUndefined();
  });

  it('reads one coordinate while it is being typed', () => {
    expect(parseCoordinate('-74.006')).toBe(-74.006);
    expect(parseCoordinate('40.')).toBe(40);
    expect(parseCoordinate('-')).toBeNull();
    expect(parseCoordinate('')).toBeNull();
    expect(parseCoordinate('1e3')).toBeNull();
  });
});
