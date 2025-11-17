require('dotenv').config();

import { Client } from '@opensearch-project/opensearch';

const IS_LOCAL = process.env.ENVIRONMENT === 'local' ? true : false;
const OPENSEARCH_URL = process.env.OPENSEARCH_URL;
const USERNAME = process.env.OPENSEARCH_USERNAME;
const PASSWORD = process.env.OPENSEARCH_PASSWORD;

let _client: Client | null = null;

export function client(): Client {
  if (_client) {
    return _client;
  }

  if (!OPENSEARCH_URL || !USERNAME || !PASSWORD) {
    throw new Error(
      'OPENSEARCH_URL, OPENSEARCH_USERNAME, and OPENSEARCH_PASSWORD must be set'
    );
  }

  _client = new Client({
    node: OPENSEARCH_URL,
    auth: {
      username: USERNAME,
      password: PASSWORD,
    },
    ssl: {
      rejectUnauthorized: !IS_LOCAL,
    },
  });

  return _client;
}
