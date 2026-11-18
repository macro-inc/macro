// Only the transport origin is synthetic; the production auth client, name
// cache, account gate, display-name getters and participant adapter run unchanged.
export const SERVER_HOSTS = { 'auth-service': location.origin };
