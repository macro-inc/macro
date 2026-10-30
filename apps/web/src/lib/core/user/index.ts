export {
  emailToMacroId,
  type MacroId,
  macroIdToEmail,
  tryMacroId,
} from '../../identity/macro-id';
export {
  getDisplayName,
  getDisplayNameParts,
  getInitials,
  getInitialsFromName,
  seedMockDisplayNames,
  useDisplayName,
  useDisplayNameParts,
} from '../../queries/auth/display-name';
export {
  type CombinedRecipientItem,
  type CombinedRecipientKind,
  type CustomUserInput,
  type ExtractedContactInfo,
  recipientEntityMapper,
  type WithCustomUserInput,
} from './combinedRecipient';
export { useContacts } from './contactService';
export { useAugmentUserWithDmActivity } from './dmActivity';
export { useIsConnectedSecondaryInbox } from './inboxOnly';
export type * from './types';
export { emailToId, idToDisplayName, idToEmail } from './util';
