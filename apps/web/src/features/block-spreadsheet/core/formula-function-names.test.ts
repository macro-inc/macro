import { expect, it } from 'vitest';
import { CALCULATED_FUNCTIONS } from './formula-function-names';
import catalog from './formula-functions.json';

it('lists every catalog function and only the documented additions', () => {
  const additions = ['FORECAST.ETS', 'HYPERLINK'];
  expect([...CALCULATED_FUNCTIONS].sort()).toEqual(
    [...Object.keys(catalog), ...additions].sort()
  );
});
