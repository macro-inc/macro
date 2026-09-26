export const isTouchDevice = () =>
  typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
export const isModality = (kind: string) => kind === 'touch' && isTouchDevice();
