import { Module, type ModuleLogo, type ModuleState } from '../Module';
import { MODULE_LOGOS } from '../moduleLogos';
import '../SetupGraphic.css';

/**
 * Frames a single {@link Module} with room for its click-burst (the body
 * thrust down-right and the jet trail streaking up-left).
 */
const MODULE_VIEWBOX = '210 -40 310 310';

/**
 * A single hovering module as a connection step's hero: the isometric tile
 * carrying a brand logo, dropped into a bare SVG host (the root just needs the
 * `setup-graphic` class for styling and `currentColor` for the ink linework).
 *
 * `state` reflects the connection: `idle` before, `linked` (logo held accent)
 * once connected. Clicking the module plays its acceleration burst.
 */
export function StepModule(props: {
  logo: ModuleLogo;
  state?: ModuleState;
  class?: string;
}) {
  return (
    <svg
      viewBox={MODULE_VIEWBOX}
      fill="currentColor"
      class={`setup-graphic text-ink ${props.class ?? ''}`}
      aria-hidden="true"
    >
      <Module logo={props.logo} state={props.state} />
    </svg>
  );
}

/**
 * The module logo for a featured connector, keyed by its `server_name`
 * (`Linear` / `Notion` / `Slack` / `GitHub`). Returns undefined for a name
 * without a brand mark.
 */
export function connectorLogo(serverName: string): ModuleLogo | undefined {
  return (MODULE_LOGOS as Record<string, ModuleLogo>)[serverName];
}
