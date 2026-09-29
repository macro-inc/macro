import IconDatadog from '@icon/mcp-datadog.svg';
import IconGithub from '@icon/mcp-github.svg';
import IconGrafana from '@icon/mcp-grafana.svg';
import IconLinear from '@icon/mcp-linear.svg';
import IconNotion from '@icon/mcp-notion.svg';
import IconPostHog from '@icon/mcp-posthog.svg';
import IconSlack from '@icon/mcp-slack.svg';

/** Frozen website examples. No workspace flags, connector APIs, or credentials. */
export const FEATURED_MCP_SERVERS = [
  { app_slug: 'linear', server_name: 'Linear', icon: IconLinear },
  { app_slug: 'slack', server_name: 'Slack', icon: IconSlack },
  { app_slug: 'notion', server_name: 'Notion', icon: IconNotion },
  { app_slug: 'posthog', server_name: 'PostHog', icon: IconPostHog },
  { app_slug: 'github', server_name: 'GitHub', icon: IconGithub },
  { app_slug: 'datadog', server_name: 'Datadog', icon: IconDatadog },
  { app_slug: 'grafana', server_name: 'Grafana', icon: IconGrafana },
] as const;
