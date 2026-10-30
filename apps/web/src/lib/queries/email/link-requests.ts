import { emailClient } from '@service-email/client';

export const fetchEmailLabels: typeof emailClient.getUserLabels = (...args) =>
  emailClient.getUserLabels(...args);

export const initializeEmailLink: typeof emailClient.init = (...args) =>
  emailClient.init(...args);

export const stopEmailSync: typeof emailClient.stopSync = (...args) =>
  emailClient.stopSync(...args);

export const resyncEmailLink: typeof emailClient.resyncLink = (...args) =>
  emailClient.resyncLink(...args);
