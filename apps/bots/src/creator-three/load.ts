import head from '../assets/creator/head.glb?url';
import color from '../assets/creator/skin-color.jpg?url';
import normal from '../assets/creator/skin-normal.jpg?url';
import spec from '../assets/creator/skin-spec.jpg?url';
import { mount } from './stage';

export function loadPortraitScene(
  canvas: HTMLCanvasElement,
  signal: AbortSignal
) {
  return mount(canvas, { head, color, normal, spec }, signal);
}
