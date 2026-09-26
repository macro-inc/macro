import { Module, type ModuleLogo, type ModuleState } from './Module';
import './SetupGraphic.css';

/**
 * Frames a single {@link Module} with room for its click-burst (the body
 * thrust down-right and the jet trail streaking up-left).
 */
const MODULE_VIEWBOX = '210 -40 310 310';

/**
 * A single hovering module, standalone: the isometric tile carrying a brand
 * logo, dropped into a bare SVG host (the root just needs the `setup-graphic`
 * class, which brings both the styling and the `currentColor` ink).
 *
 * Ported from the Macro app's `StepModule` (features/setup/flow), where each
 * connection step uses one as its hero.
 *
 * `state` reflects the connection: `idle` before, `linked` (logo held accent)
 * once connected. Clicking the module plays its acceleration burst.
 */
export function ModuleGraphic(props: {
  logo: ModuleLogo;
  state?: ModuleState;
  class?: string;
}) {
  return (
    <svg
      viewBox={MODULE_VIEWBOX}
      fill="currentColor"
      class={`setup-graphic ${props.class ?? ''}`}
      aria-hidden="true"
    >
      <Module logo={props.logo} state={props.state} />
    </svg>
  );
}
