import { SERVER_HOSTS } from '@core/constant/servers';
import { fetchWithToken } from '@core/util/fetchWithToken';

export const contactsClient = {
  async addContact(userId: string) {
    return fetchWithToken(`${SERVER_HOSTS.contacts}/contacts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId }),
    });
  },
};
