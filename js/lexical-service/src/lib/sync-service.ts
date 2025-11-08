import type { SerializedEditorState } from "lexical";

type Result<T, E = Error> =
  | { success: true; data: T }
  | { success: false; error: E, status?: number };

export interface SyncServiceConfig {
  baseUrl: string;
  internalAuthKey: string;
  timeout?: number;
  serviceFetcher?: Fetcher;
}

export class SyncServiceClient {
  private config: SyncServiceConfig;

  constructor(config: SyncServiceConfig) {
    this.config = config;
  }

  async raw<T = SerializedEditorState>(docId: string): Promise<Result<T>> {
    if (!docId?.trim()) {
      return { success: false, error: new Error('Document ID is required') };
    }

    try {
      const path = `/document/${docId}/raw`;

      let response: Response;

      if (this.config.serviceFetcher) {
        response = await this.config.serviceFetcher.fetch(`https://sync-service${path}`, {
          method: 'GET',
          headers: {
            'x-internal-auth-key': this.config.internalAuthKey,
            'content-type': 'application/json'
          }
        });
      } else {
        // Fallback to HTTP fetch for cross-zone or local development
        const url = `${this.config.baseUrl}${path}`;
        response = await fetch(url, {
          method: 'GET',
          headers: {
            'x-internal-auth-key': this.config.internalAuthKey,
            'content-type': 'application/json'
          },
          signal: AbortSignal.timeout(5000),
        });
      }


      if (!response.ok) {
        const responseText = await response.text();
        console.log('Sync client - error response body:', responseText);
        return {
          success: false,
          error: new Error(`Sync service error: ${response.status} - ${responseText}`),
          status: response.status
        };
      }
      const result = await response.json() as T;
      return {
        success: true,
        data: result
      };

    } catch (error) {
      if (error instanceof Error) {
        return {
          success: false,
          error: new Error(`Sync client error:${error.message}`),
          status: 500
        };
      }
      return {
        success: false,
        error: new Error(`Sync client error:${error}`),
        status: 500
      };
    }
  }
}

export function createSyncClient(config: SyncServiceConfig): SyncServiceClient {
  return new SyncServiceClient(config);
}
