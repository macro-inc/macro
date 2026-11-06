import { authorizeGithub } from '@core/auth/authorize-github';
import { QUICK_CONNECT_SERVERS } from '@core/component/AI/constant/mcpServers';
import { toast } from '@core/component/Toast/Toast';
import { createPipedreamCatalogConnect } from '@core/pipedream/catalog';
import {
  canonicalPipedreamSlug,
  connectSlugForPipedreamApp,
} from '@core/pipedream/slugs';
import {
  useInitGithubLinkMutation,
  useReauthenticateGithubMutation,
} from '@queries/auth';
import { githubLinkStatusQueryOptions } from '@queries/auth/github-link';
import { queryClient } from '@queries/client';
import {
  mcpServersQueryOptions,
  useUpdateMcpServerMutation,
} from '@queries/mcp-servers';
import {
  pipedreamConnectionsQueryOptions,
  useUpdatePipedreamConnectionMutation,
} from '@queries/pipedream-connectors';
import type { Tool } from '../context/onboarding-context';
import { nativeToolSlug } from './connected-tools';

/** GitHub uses Macro's account integration; it must never fall through to MCP. */
export function createOnboardingToolConnect() {
  const updateNative = useUpdateMcpServerMutation();
  const updatePipedream = useUpdatePipedreamConnectionMutation();
  const init = useInitGithubLinkMutation();
  const reauthenticate = useReauthenticateGithubMutation();

  return async (tool: Tool): Promise<void> => {
    try {
      if (tool.slug !== 'github') {
        // Re-check on click so another tab cannot cause a duplicate connection.
        const native = QUICK_CONNECT_SERVERS.some(
          (server) => server.app_slug === canonicalPipedreamSlug(tool.slug)
        )
          ? await queryClient.fetchQuery({
              ...mcpServersQueryOptions(),
              staleTime: 0,
            })
          : [];
        const slug = canonicalPipedreamSlug(tool.slug);
        const nativeMatches = native.filter(
          (server) => server.authenticated && nativeToolSlug(server) === slug
        );
        const existingNative =
          nativeMatches.find((server) => server.enabled) ?? nativeMatches[0];
        if (existingNative) {
          if (!existingNative.enabled)
            await updateNative.mutateAsync({
              url: existingNative.url,
              enabled: true,
            });
          return;
        }
        const pipedream = await queryClient.fetchQuery({
          ...pipedreamConnectionsQueryOptions(),
          staleTime: 0,
        });
        const matches = pipedream.filter(
          (server) => canonicalPipedreamSlug(server.app_slug) === slug
        );
        const existing = matches.find((server) => server.enabled) ?? matches[0];
        if (existing) {
          if (!existing.enabled)
            await updatePipedream.mutateAsync({
              app_slug: existing.app_slug,
              enabled: true,
            });
          return;
        }
        await createPipedreamCatalogConnect({
          entry: () => ({
            app_slug: connectSlugForPipedreamApp(tool.slug),
            display_name: tool.name,
          }),
        }).connect();
        return;
      }

      const github = await queryClient.fetchQuery({
        ...githubLinkStatusQueryOptions(),
        staleTime: 0,
      });
      if (github.status === 'linked') return;
      const mutation =
        github.status === 'reauthentication_required' ? reauthenticate : init;
      await authorizeGithub(
        (callbackUrl) => mutation.mutateAsync(callbackUrl),
        'Failed to connect GitHub'
      );
    } catch {
      toast.failure(`Failed to connect ${tool.name}`);
    }
  };
}
