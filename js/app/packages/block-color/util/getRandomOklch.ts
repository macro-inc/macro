export function getRandomOklch(
  minL = 0,
  maxL = 100,
  minC = 0,
  maxC = 0.4,
  minH = 0,
  maxH = 360,
  minA = 1,
  maxA = 1
) {
  const lightness = Math.random() * (maxL - minL) + minL;
  const chroma = Math.random() * (maxC - minC) + minC;
  const hue = Math.random() * (maxH - minH) + minH;
  const alpha = Math.random() * (maxA - minA) + minA;

  // Format the output string for CSS
  if (alpha === 1) {
    return `oklch(${lightness.toFixed(2)}% ${chroma.toFixed(3)} ${hue.toFixed(2)}deg)`;
  } else {
    return `oklch(${lightness.toFixed(2)}% ${chroma.toFixed(3)} ${hue.toFixed(2)}deg / ${alpha.toFixed(2)})`;
  }
}
