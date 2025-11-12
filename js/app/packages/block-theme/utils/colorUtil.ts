import Color from 'colorjs.io';

// const testColorDiv = document.createElement('canvas');
// testColorDiv.style.display = 'none';
// testColorDiv.style.height = '1px';
// testColorDiv.style.width = '1px';
// document.body.appendChild(testColorDiv);
// const ctx = testColorDiv.getContext('2d')!;
// testColorDiv.height = 1;
// testColorDiv.width = 1;

// export function computeToken(token: string) {
//   ctx.clearRect(0, 0, 1, 1);
//   ctx.fillStyle = token;
//   ctx.fillRect(0, 0, 1, 1);
//   let imageData = ctx?.getImageData(0, 0, 1, 1);
//   const color = new Color(
//     'srgb',
//     [imageData.data[0] / 255, imageData.data[1] / 255, imageData.data[2] / 255],
//     imageData.data[3] / 255
//   );
//   return color.toString({ format: 'hex' }).substring(0, 7);
// }

export function validateColor(color: string): boolean {
  return CSS.supports('color', color);
}

export function getOklch(cssColor: string) {
  const color = new Color(cssColor);
  const convert = color.to('oklch');
  console.log(convert.oklch);

  // Handle undefined values pure white/black/gray have undefined chroma and hue
  let l = convert.coords[0] ? convert.coords[0] : 0;
  let c = convert.coords[1] ? convert.coords[1] : 0;
  let h = convert.coords[2] ? convert.coords[2] : 0;

  let returnColor = { l: l, c: c, h: h }
  // console.log(returnColor);
  return returnColor;
}

export function convertOklchTo(oklch: string, type: string){
  console.log(oklch);

  try {
    const color = new Color(oklch);
    console.log(color);

    switch(type){
      case 'hex': return color.to('srgb').toString({ format: 'hex', precision: 4  });
      case 'rgb': return color.to('srgb').toString({ format: 'rgb', precision: 4 });
      case 'oklab': return color.to('oklab').toString({precision: 4 });
      case 'hsl': return color.to('hsl').toString({precision: 4 });
      case 'oklch': return color.toString({precision: 4 });
      default: return color.to('srgb').toString({ format: 'hex' });
    }
  }
  catch(error){
    console.error('Error converting color:', error);
    return '#000000';
  }
}
