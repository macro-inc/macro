const CHAT_INDEX = 'chats';
const DOCUMENT_INDEX = 'documents';
const EMAIL_INDEX = 'emails';
const CHANNEL_INDEX = 'channels';
const PROJECT_INDEX = 'projects';
const NAMES_INDEX = 'names';

export {
  CHAT_INDEX,
  DOCUMENT_INDEX,
  EMAIL_INDEX,
  CHANNEL_INDEX,
  PROJECT_INDEX,
  NAMES_INDEX,
};

export const SHARD_SETTINGS =
  process.env.ENVIRONMENT === 'prod'
    ? {
        number_of_shards: 6,
        number_of_replicas: 2,
        refresh_interval: '30s', // Default is 1s
      }
    : {
        number_of_shards: 3,
        number_of_replicas: 0,
        refresh_interval: '30s', // Default is 1s
      };

export const IS_DRY_RUN = process.env.DRY_RUN !== 'false';
