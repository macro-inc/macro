const colorOptions = [
  'accent-30',
  'accent-60',
  'accent-90',
  'accent-120',
  'accent-150',
  'accent-180',
  'accent-210',
  'accent-240',
  'accent-270',
  'accent-300',
  'accent-330',
];

export const getRandomPaletteColor = () => {
  return colorOptions[Math.floor(Math.random() * colorOptions.length)];
};
