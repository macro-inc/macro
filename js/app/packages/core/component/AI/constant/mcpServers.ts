import IconDatadog from '@macro-icons/mcp-datadog.svg';
import IconGrafana from '@macro-icons/mcp-grafana.svg';
import IconLinear from '@macro-icons/mcp-linear.svg';
import IconPostHog from '@macro-icons/mcp-posthog.svg';
import IconSlack from '@macro-icons/mcp-slack.svg';
import type { Component, JSX } from 'solid-js';

export type SvgIcon = Component<JSX.SvgSVGAttributes<SVGSVGElement>>;

export const QUICK_CONNECT_SERVERS = [
  {
    server_name: 'Linear',
    url: 'https://mcp.linear.app/mcp',
    icon: IconLinear as SvgIcon,
  },
  {
    server_name: 'PostHog',
    url: 'https://mcp.posthog.com/mcp',
    icon: IconPostHog as SvgIcon,
  },
  {
    server_name: 'Datadog',
    url: 'https://mcp.datadoghq.com/mcp',
    icon: IconDatadog as SvgIcon,
  },
  {
    server_name: 'Grafana',
    url: 'https://mcp.grafana.com/mcp',
    icon: IconGrafana as SvgIcon,
  },
  {
    server_name: 'Slack',
    url: 'https://mcp.slack.com/mcp',
    icon: IconSlack as SvgIcon,
  },
] as const;

export const QUICK_CONNECT_ICON_MAP: Map<string, SvgIcon> = new Map(
  QUICK_CONNECT_SERVERS.map((s) => [s.url, s.icon])
);

const SERVER_NAME_ICON_MAP: Map<string, SvgIcon> = new Map(
  QUICK_CONNECT_SERVERS.map((s) => [s.server_name.toLowerCase(), s.icon])
);

export function getMcpServerIcon(serverName: string): SvgIcon | undefined {
  return SERVER_NAME_ICON_MAP.get(serverName.toLowerCase());
}
