const serverHostLocal: Servers = {
  'auth-service': 'http://localhost:8080',
  'pdf-service': 'http://localhost:4567',
  'document-storage-service': 'http://localhost:8086',
  'websocket-service': 'ws://localhost:6969',
  'cognition-service': 'http://localhost:8085',
  'connection-gateway': 'ws://localhost:8082',
  'notification-service': 'http://localhost:8089',
  'static-file': 'http://localhost:8100',
  'unfurl-service': 'http://localhost:8095',
  contacts: 'http://localhost:8083',
  'email-service': 'http://localhost:8094',
  'image-proxy-service': 'http://localhost:8097',
} as const;

const devServerSuffix = import.meta.env.MODE === 'development' ? '-dev' : '';

const serverHostRemote = {
  'auth-service': `https://auth-service${devServerSuffix}.macro.com`,
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

  const servers = selectedLocalServers
    .split(',')
    .filter((name) => name in serverHostRemote)
    .reduce((acc: Servers, key: keyof Servers) => {
      acc[key] = serverHostLocal[key];
      console.log(`Using local server ${key}: ${acc}`);
      return acc;
    }, serverHostRemote);
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

/** Creates endpoint URL for accessing a static file by its ID */
export function staticFileIdEndpoint(id: string): string {
  return `${SERVER_HOSTS['static-file']}/file/${id}`;
}
