import Color from 'colorjs.io';

export function validateColor(color: string): boolean{
  return CSS.supports('color', color);
}

export function getOklch(cssColor: string){
  const color = new Color(cssColor);
  const convert = color.to('oklch');

  let l = convert.coords[0] ? convert.coords[0] : 0;
  let c = convert.coords[1] ? convert.coords[1] : 0;
  let h = convert.coords[2] ? convert.coords[2] : 0;

  let returnColor = { l: l, c: c, h: h };
  return returnColor;
}

export function convertOklchTo(l: number, c: number, h: number, type: string){
  // console.log(`oklch values: L=${l}, C=${c}, H=${h} | type: ${type}`);
  try{
    const lightness = Math.max(0, Math.min(1, l));
    const chroma = Math.max(0, c < 1e-10 ? 0 : c);
    const hue = h;

    const color = new Color('oklch', [lightness, chroma, hue]);

    switch (type) {
      case 'hex'  : return color.to('srgb' ).toString({ precision: 4, format: 'hex'});
      case 'rgb'  : return color.to('srgb' ).toString({ precision: 4, format: 'rgb'});
      case 'oklab': return color.to('oklab').toString({ precision: 4               });
      case 'hsl'  : return color.to('hsl'  ).toString({ precision: 4               });
      case 'oklch': return color.toString({ precision: 4 });
      default: return color.to('srgb').toString({ format: 'hex' });
    }
  }
  catch(error){
    console.error(error);
    return '#000000';
  }
}
