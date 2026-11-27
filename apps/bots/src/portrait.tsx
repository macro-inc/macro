import { createMemo } from 'solid-js';
import atlasSvg from './assets/atlas.svg?raw';
import echoSvg from './assets/echo.svg?raw';
import ledgerSvg from './assets/ledger.svg?raw';
import patchSvg from './assets/patch.svg?raw';
import overlaySvg from './assets/portrait-overlay.svg?raw';
import scoutSvg from './assets/scout.svg?raw';
import {
  portraitFilter,
  portraitLighting,
  portraitTransform,
  updatePortraitOverlay,
} from './portrait-art';
import { type Look, type PresetId, presets } from './presets';

const baseMarkup = {
  atlas: atlasSvg,
  echo: echoSvg,
  ledger: ledgerSvg,
  patch: patchSvg,
  scout: scoutSvg,
};
const serializer = new XMLSerializer();

function overlay(preset: PresetId, look: Look) {
  const svg = new DOMParser().parseFromString(
    overlaySvg,
    'image/svg+xml'
  ).documentElement;
  updatePortraitOverlay(svg, look, preset);
  return serializer.serializeToString(svg);
}

function svgImage(markup: string) {
  return `data:image/svg+xml,${encodeURIComponent(markup)}`;
}

export function snapshotPortrait(preset: PresetId, look: Look) {
  // The UI and receipt use identical artwork with no external SVG resources.
  return svgImage(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 120" width="96" height="120">
      <foreignObject width="96" height="120">
        <div xmlns="http://www.w3.org/1999/xhtml" style="position:relative;width:100%;height:100%;overflow:hidden;background:#020202;">
          <div style="position:absolute;inset:0;transform-origin:50% 42%;transform:${portraitTransform(look, preset)};filter:${portraitFilter(look, preset)}">
            ${baseMarkup[presets[preset].base].replace('<svg ', '<svg style="display:block;width:100%;height:100%;" ')}
            ${overlay(preset, look).replace('<svg ', '<svg style="position:absolute;inset:0;width:100%;height:100%;" ')}
          </div>
          <div style="position:absolute;inset:0;background:${portraitLighting(look.light)}"></div>
        </div>
      </foreignObject>
    </svg>`
  );
}

export function Portrait(props: {
  preset: PresetId;
  look: Look;
  pose?: number;
}) {
  const artwork = createMemo(() => snapshotPortrait(props.preset, props.look));

  return (
    <span class="creator-portrait" aria-hidden="true">
      <img
        src={artwork()}
        alt=""
        draggable={false}
        style={{
          transform: props.pose
            ? `perspective(580px) translateX(${props.pose * 2.5}px) rotateY(${props.pose * 4.5}deg)`
            : undefined,
        }}
      />
    </span>
  );
}
