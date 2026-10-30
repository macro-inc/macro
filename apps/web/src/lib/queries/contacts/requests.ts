import { contactsClient } from '@service-contacts/client';

export const addContact: typeof contactsClient.addContact = (...args) =>
  contactsClient.addContact(...args);
