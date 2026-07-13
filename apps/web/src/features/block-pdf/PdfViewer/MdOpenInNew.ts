export function MdOpenInNewIcon(
  size: string,
  optionalProps?: Record<string, string>
) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const props = {
    stroke: 'currentColor',
    fill: 'currentColor',
    'stroke-width': '0',
    viewBox: '0 0 24 24',
    height: size,
    width: size,
    ...optionalProps,
  };
  Object.entries(props).forEach(([key, value]) => svg.setAttribute(key, value));
  svg.innerHTML = `
  <path fill="none" d="M0 0h24v24H0z"></path>
  <path d="M19 19H5V5h7V3H5a2 2 0 00-2 2v14a2 2 0 002 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z"></path>
  `;

  return svg;
}
