import plugin from 'tailwindcss/plugin';
import * as stackingContext from '../packages/core/constant/stackingContext';

// Compute the key names once, at the top level
const zIndexKeys = Object.keys(stackingContext).map((key) =>
  key
    .slice(1)
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .toLowerCase()
);

// Create a mapping of computed keys to their original values
const zIndexValues = Object.fromEntries(
  zIndexKeys.map((key, index) => [key, Object.values(stackingContext)[index]])
);

export default plugin(function ({ addUtilities }) {
  const zIndexUtilities = Object.fromEntries(
    zIndexKeys.map((key) => [
      `.z-${key}`,
      { zIndex: zIndexValues[key].toString() },
    ])
  );

  addUtilities(zIndexUtilities);
});
