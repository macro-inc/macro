import { listMacroReleases } from '@app/lib/service-clients/service-github-public/client';
import { throwOnErr } from '@core/util/result';
import { queryOptions, useQuery } from '@tanstack/solid-query';
import { releaseDownloadUrls } from '../core/desktop-downloads';
import { settingsKeys } from './keys';

const desktopInstallersQueryOptions = queryOptions({
  queryKey: settingsKeys.desktopInstallers.queryKey,
  queryFn: ({ signal }) => throwOnErr(() => listMacroReleases(signal)),
  select: releaseDownloadUrls,
  // Unauthenticated GitHub API calls are rate limited per address; releases
  // change a few times a week.
  staleTime: 60 * 60 * 1000,
  gcTime: 24 * 60 * 60 * 1000,
  retry: 1,
  throwOnError: false,
});

/** The newest desktop installer URLs; read `data` only once it has settled. */
export function useDesktopInstallersQuery() {
  return useQuery(() => desktopInstallersQueryOptions);
}
