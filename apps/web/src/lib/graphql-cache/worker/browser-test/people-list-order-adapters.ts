// Stand-ins for the directory reader's sync and server modules: the people
// harnesses read a cache they hydrated themselves, and read the server only
// when a harness answers those reads, as a tab without the cache makes them.
import type * as server from '@service-storage/graphql-contacts';

type ServerReads = Pick<
  typeof server,
  | 'fetchContactDirectoryPage'
  | 'fetchContactDirectoryByIds'
  | 'fetchContactNamedPeople'
  | 'fetchContactReferencePage'
>;
let answers: ServerReads | undefined;

export function answerServerReads(reads: ServerReads) {
  answers = reads;
}
export function loadContactCheckpoint() {
  return { pages: 1, completedAt: 1 };
}
function serverReads(): ServerReads {
  if (!answers)
    throw new Error('The list order harness must read the local cache only');
  return answers;
}
export const fetchContactDirectoryPage: ServerReads['fetchContactDirectoryPage'] =
  (...args) => serverReads().fetchContactDirectoryPage(...args);
export const fetchContactDirectoryByIds: ServerReads['fetchContactDirectoryByIds'] =
  (...args) => serverReads().fetchContactDirectoryByIds(...args);
export const fetchContactReferencePage: ServerReads['fetchContactReferencePage'] =
  (...args) => serverReads().fetchContactReferencePage(...args);
export const fetchContactNamedPeople: ServerReads['fetchContactNamedPeople'] = (
  ...args
) => serverReads().fetchContactNamedPeople(...args);
