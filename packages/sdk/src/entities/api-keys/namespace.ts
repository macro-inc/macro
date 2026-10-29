import { unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import { UserApiKey } from './api-key';

/** User API key management. */
export class ApiKeyNamespace {
  constructor(private readonly client: MacroClient) {}

  /** Construct a lazy key handle. */
  byId(id: string): UserApiKey {
    return UserApiKey.byId(this.client, id);
  }

  /** List metadata for the caller's API keys. */
  async list(): Promise<UserApiKey[]> {
    return unwrap(await this.client.storage.listUserApiKeys()).keys.map((k) =>
      UserApiKey.from(this.client, k),
    );
  }

  /** Create a key. Save the secret now; it cannot be retrieved later. */
  async create(name: string): Promise<{ key: UserApiKey; secret: string }> {
    const record = unwrap(
      await this.client.storage.createUserApiKey({ body: { name } }),
    );
    return { key: UserApiKey.from(this.client, record), secret: record.key };
  }

  /** Exchange an email address for a Macro API token, subject to server authorization. */
  async tokenForEmail(email: string) {
    return unwrap(await this.client.auth.macroApiToken({ query: { email } }));
  }
}
