import Color from 'colorjs.io';

const testColorDiv = document.createElement('canvas');
testColorDiv.style.display = 'none';
testColorDiv.style.height = '1px';
testColorDiv.style.width = '1px';
document.body.appendChild(testColorDiv);
const ctx = testColorDiv.getContext('2d')!;
testColorDiv.height = 1;
testColorDiv.width = 1;

export function computeToken(token: string) {
  ctx.clearRect(0, 0, 1, 1);
  ctx.fillStyle = token;
  ctx.fillRect(0, 0, 1, 1);
  let imageData = ctx?.getImageData(0, 0, 1, 1);
  const color = new Color(
    'srgb',
    [imageData.data[0] / 255, imageData.data[1] / 255, imageData.data[2] / 255],
    imageData.data[3] / 255
  );
  return color.toString({ format: 'hex' }).substring(0, 7);
}

export function validateColor(color: string): boolean {
  return CSS.supports('color', color);
}

export function getOklch(cssColor: string) {
  const color = new Color(cssColor);
  const convert = color.to('oklch');
  return { l: convert.coords[0], c: convert.coords[1], h: convert.coords[2] };
}
