const serverHostLocal: Servers = {
  'auth-service': 'http://localhost:8080',
  'auth-logout': 'http://localhost:3000', // TODO: make work with local fusionauth later
  'pdf-service': 'http://localhost:4567',
  'document-storage-service': 'http://localhost:8086',
  'websocket-service': 'ws://localhost:6969',
  'cognition-service': 'http://localhost:8085',
  'connection-gateway': 'ws://localhost:8082',
  'notification-service': 'http://localhost:8089',
  'static-file': 'http://localhost:8100',
  'unfurl-service': 'http://localhost:8095',
  contacts: 'http://localhost:8083',
  'email-service': 'http://localhost:8087',
  'image-proxy-service': 'http://localhost:8097',
  'scheduled-action': 'http://localhost:8098',
} as const;

const devServerSuffix = import.meta.env.MODE === 'development' ? '-dev' : '';

const authLogoutUrl =
  import.meta.env.MODE === 'development'
    ? 'https://fusionauth-dev.macro.com/oauth2/logout?client_id=eb75fe7a-0ef1-4186-96d9-cc62cfb1d10c&tenantId=5e13f524-8d32-0454-81f8-061936256aa4'
    : 'https://auth.macro.com/oauth2/logout?client_id=75409999-7dc4-4241-b73b-a51818c3a71c&tenantId=a3e53c3d-8d6a-3e92-d64c-fa3bf30a60be';

const serverHostRemote = {
  'auth-service': `https://auth-service${devServerSuffix}.macro.com`,
  'auth-logout': authLogoutUrl,
  'pdf-service': `https://pdf-service${devServerSuffix}.macro.com`,
  'document-storage-service': `https://cloud-storage${devServerSuffix}.macro.com`,
  'websocket-service': `wss://services${devServerSuffix}.macro.com`,
  'cognition-service': `https://document-cognition${devServerSuffix}.macro.com`,
  'connection-gateway': `wss://connection-gateway${devServerSuffix}.macro.com`,
  'notification-service': `https://notifications${devServerSuffix}.macro.com`,
  'static-file': `https://static-file-service${devServerSuffix}.macro.com`,
  'unfurl-service': `https://unfurl-service${devServerSuffix}.macro.com`,
  contacts: `https://contacts${devServerSuffix}.macro.com`,
  'email-service': `https://email-service${devServerSuffix}.macro.com`,
  'image-proxy-service': `https://image-proxy${devServerSuffix}.macro.com`,
  'scheduled-action': `https://agent-schedule${devServerSuffix}.macro.com`,
} as const;

type Servers = Record<keyof typeof serverHostRemote, string>;

export const SERVER_HOSTS: Servers =
  import.meta.env.MODE === 'development'
    ? selectLocalServers()
    : serverHostRemote;

function selectLocalServers(): Servers {
  const selectedLocalServers: string = import.meta.env.VITE_LOCAL_SERVERS;
  if (!selectedLocalServers || selectedLocalServers.length === 0) {
    return serverHostRemote;
  }

  // Keyword to make running everything locally easier
  if (selectedLocalServers === 'ALL') {
    return serverHostLocal;
  }

  function assertValidName(name: string): name is keyof Servers {
    if (!(name in serverHostRemote))
      throw new Error(`unknown server name ${name}`);
    return true;
  }
  const servers = selectedLocalServers.split(',').reduce(
    (acc: Servers, entry: string) => {
      // Support "service-name:port" to override the default local port
      const [name, portOverride] = entry.split(':') as [
        string,
        string | undefined,
      ];
      if (!assertValidName(name)) return acc;
      if (portOverride) {
        const url = new URL(serverHostLocal[name]);
        url.port = portOverride;
        acc[name] = url.toString().replace(/\/$/, '');
      } else {
        acc[name] = serverHostLocal[name];
      }
      console.log(`Using local server ${name}: ${acc[name]}`);
      return acc;
    },
    { ...serverHostRemote }
  );
  return servers;
}

const syncServiceSuffix =
  import.meta.env.MODE === 'development' ? '-dev3' : '-prod2';

const syncServiceHostLocal = {
  worker: 'http://localhost:8787',
  ws: 'ws://localhost:8787',
} as const;

const syncServiceHostRemote = {
  worker: `https://sync-service${syncServiceSuffix}.macroverse.workers.dev`,
  ws: `wss://sync-service${syncServiceSuffix}.macroverse.workers.dev`,
} as const;

function selectSyncServiceHost():
  | typeof syncServiceHostRemote
  | typeof syncServiceHostLocal {
  if (import.meta.env.MODE !== 'development') {
    return syncServiceHostRemote;
  }
  const selectedLocalServers: string = import.meta.env.VITE_LOCAL_SERVERS;
  if (
    selectedLocalServers === 'ALL' ||
    selectedLocalServers?.includes('sync-service')
  ) {
    return syncServiceHostLocal;
  }
  return syncServiceHostRemote;
}

export const SYNC_SERVICE_HOSTS = selectSyncServiceHost();

/**
 * The DSS host to use for sync-service permission tokens.
 * When the sync service is remote, permission tokens must come from the remote DSS
 * because they need to be signed with the matching JWT secret.
 */
export const SYNC_PERMISSION_TOKEN_DSS_HOST =
  SYNC_SERVICE_HOSTS === syncServiceHostRemote
    ? serverHostRemote['document-storage-service']
    : SERVER_HOSTS['document-storage-service'];

/** Creates endpoint URL for accessing a static file by its ID */
export function staticFileIdEndpoint(id: string): string {
  return `${SERVER_HOSTS['static-file']}/file/${id}`;
}

type StaticFileSize = 'small' | 'medium';

const staticFileSizes: Record<StaticFileSize, number> = {
  small: 320,
  medium: 1080,
};

export function staticFileSizedEndpoint(
  id: string,
  size: StaticFileSize
): string {
  return `${staticFileIdEndpoint(id)}?size=${staticFileSizes[size]}`;
}

export function staticFileSizedUrl(url: string, size: StaticFileSize): string {
  return `${url}?size=${staticFileSizes[size]}`;
}
