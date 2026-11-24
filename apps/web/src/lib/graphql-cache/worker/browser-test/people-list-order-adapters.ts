// Stand-ins for the directory reader's sync and server modules: the list
// order harness reads a cache it hydrated itself and never the server.
export function loadContactCheckpoint() {
  return { pages: 1, completedAt: 1 };
}
function noServer(): never {
  throw new Error('The list order harness must read the local cache only');
}
export const fetchContactDirectoryPage = noServer;
export const fetchContactDirectoryByIds = noServer;
export const fetchContactReferencePage = noServer;
export const fetchContactNamedPeople = noServer;
