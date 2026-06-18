import { DEV_MODE_ENV } from '@core/constant/featureFlags';
import IconDatadog from '@icon/mcp-datadog.svg';
import IconGithub from '@icon/mcp-github.svg';
import IconGrafana from '@icon/mcp-grafana.svg';
import IconLinear from '@icon/mcp-linear.svg';
import IconNotion from '@icon/mcp-notion.svg';
import IconPostHog from '@icon/mcp-posthog.svg';
import IconSlack from '@icon/mcp-slack.svg';
import type { Component, JSX } from 'solid-js';

export type SvgIcon = Component<JSX.SvgSVGAttributes<SVGSVGElement>>;

export const QUICK_CONNECT_SERVERS = [
  {
    server_name: 'GitHub',
    url: 'https://api.githubcopilot.com/mcp',
    icon: IconGithub as SvgIcon,
  },
  {
    server_name: 'Linear',
    url: 'https://mcp.linear.app/mcp',
    icon: IconLinear as SvgIcon,
  },
  // Slack is dev-only until the integration is ready for production.
  ...(DEV_MODE_ENV
    ? ([
        {
          server_name: 'Slack',
          url: 'https://mcp.slack.com/mcp',
          icon: IconSlack as SvgIcon,
        },
      ] as const)
    : []),
  {
    server_name: 'Notion',
    url: 'https://mcp.notion.com/mcp',
    icon: IconNotion as SvgIcon,
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
