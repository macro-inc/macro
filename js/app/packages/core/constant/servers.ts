const serverHostLocal: Servers = {
  'auth-service': 'http://localhost:8084',
  'docx-service': 'http://localhost:34512',
  'pdf-service': 'http://localhost:4567',
  'document-storage-service': 'http://localhost:8083',
  'organization-service': 'todo',
  // TODO: make these work locally or shim
  'websocket-service': 'wss://services-dev.macro.com',
  'cognition-service': `http://localhost:8088`,
  'cognition-websocket-service': `ws://localhost:8088`,
  'connection-gateway': `ws://localhost:8080`,
  'comms-service': `wss://comms-service.macro.com`,
  'notification-service': `https://notifications.macro.com`,
  'static-file': `https://static-file-service.macro.com`,
  'unfurl-service': 'http://localhost:8080',
  contacts: 'http://localhost:8092',
  'email-service': 'http://localhost:8094',
  'insight-service': `http://localhost:8080`,
  'search-service': 'http://localhost:8091',
  'properties-service': `http://localhost:8095`,
} as const;

const devServerSuffix = import.meta.env.MODE === 'development' ? '-dev' : '';

const serverHostRemote = {
  'auth-service': `https://auth-service${devServerSuffix}.macro.com`,
  'docx-service': `https://docx-service${devServerSuffix}.macro.com`,
  'pdf-service': `https://pdf-service${devServerSuffix}.macro.com`,
  'document-storage-service': `https://cloud-storage${devServerSuffix}.macro.com`,
  'websocket-service': `wss://services${devServerSuffix}.macro.com`,
  'cognition-service': `https://document-cognition${devServerSuffix}.macro.com`,
  'cognition-websocket-service': `wss://document-cognition${devServerSuffix}.macro.com`,
  'organization-service': `https://organization-service${devServerSuffix}.macro.com`,
  'connection-gateway': `wss://connection-gateway${devServerSuffix}.macro.com`,
  'comms-service': `https://comms-service${devServerSuffix}.macro.com`,
  'notification-service': `https://notifications${devServerSuffix}.macro.com`,
  'static-file': `https://static-file-service${devServerSuffix}.macro.com`,
  'unfurl-service': `https://unfurl-service${devServerSuffix}.macro.com`,
  contacts: `https://contacts${devServerSuffix}.macro.com`,
  'email-service': `https://email-service${devServerSuffix}.macro.com`,
  'insight-service': `https://insight-service${devServerSuffix}.macro.com`,
  'search-service': `https://search-service${devServerSuffix}.macro.com`,
  'properties-service': `https://properties-service${devServerSuffix}.macro.com`,
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
  import.meta.env.MODE === 'development' ? '-dev' : '-prod';

export const SYNC_SERVICE_HOSTS = {
  worker: `https://sync-service${syncServiceSuffix}.macroverse.workers.dev`,
  ws: `wss://sync-service${syncServiceSuffix}.macroverse.workers.dev`,
} as const;

/** Creates endpoint URL for accessing a static file by its ID */
export function staticFileIdEndpoint(id: string): string {
  return `${SERVER_HOSTS['static-file']}/file/${id}`;
}
