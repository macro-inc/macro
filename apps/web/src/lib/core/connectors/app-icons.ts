import IconDatadog from '@icon/mcp-datadog.svg';
import IconGithub from '@icon/mcp-github.svg';
import IconGrafana from '@icon/mcp-grafana.svg';
import IconLinear from '@icon/mcp-linear.svg';
import IconNotion from '@icon/mcp-notion.svg';
import IconPostHog from '@icon/mcp-posthog.svg';
import IconSlack from '@icon/mcp-slack.svg';
import type { Component, JSX } from 'solid-js';

export type SvgIcon = Component<JSX.SvgSVGAttributes<SVGSVGElement>>;

/** Logos bundled with the app for a few apps, by catalog slug. */
const BUNDLED_APP_ICONS: ReadonlyMap<string, SvgIcon> = new Map([
  ['github', IconGithub as SvgIcon],
  ['linear', IconLinear as SvgIcon],
  ['slack', IconSlack as SvgIcon],
  ['notion', IconNotion as SvgIcon],
  ['posthog', IconPostHog as SvgIcon],
  ['datadog', IconDatadog as SvgIcon],
  ['grafana', IconGrafana as SvgIcon],
]);

/** The bundled logo for an app, by its catalog slug. */
export function bundledAppIcon(slug: string): SvgIcon | undefined {
  return BUNDLED_APP_ICONS.get(slug);
}

/**
 * The bundled logo for a tool call's server, by the name it was listed under.
 * Names are editable, so this is only a picture, never an identity.
 */
export function bundledServerIcon(serverName: string): SvgIcon | undefined {
  return BUNDLED_APP_ICONS.get(serverName.toLowerCase());
}
