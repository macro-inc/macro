import { traceHeaders } from '../telemetry.ts';
import { encodeWav } from './audio.ts';
import type { Rescue } from './ear.ts';
/** Agent-key speech access. Provider credentials stay at the computer gateway. */
export class SpeechGateway {
  readonly baseUrl: string;
  private readonly apiKey: string;
  readonly name: string;
  private readonly send: typeof fetch;
  constructor(
    baseUrl: string,
    apiKey: string,
    name: string,
    send: typeof fetch = fetch
  ) {
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
    this.name = name;
    this.send = send;
  }
  forName(name: string): SpeechGateway {
    return new SpeechGateway(this.baseUrl, this.apiKey, name, this.send);
  }
  headers(): Record<string, string> {
    return { Authorization: `Bearer ${this.apiKey}`, ...traceHeaders() };
  }
  socket(
    operation: 'listen' | 'speak',
    params: Record<string, string>
  ): string {
    const url = new URL(`${this.baseUrl}/v1/${operation}`);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.search = new URLSearchParams(params).toString();
    return url.href;
  }
  readonly rescue: Rescue = async (samples) => {
    const url = new URL(`${this.baseUrl}/v1/listen`);
    url.search = new URLSearchParams({
      model: 'nova-3',
      smart_format: 'true',
      keyterm: this.name,
    }).toString();
    const response = await this.send(url, {
      method: 'POST',
      headers: { ...this.headers(), 'Content-Type': 'audio/wav' },
      body: encodeWav({ rate: 16000, samples }),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error(`speech rescue: ${response.status}`);
    const result: {
      results?: {
        channels?: {
          alternatives?: {
            transcript?: string;
          }[];
        }[];
      };
    } = await response.json();
    return result.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? '';
  };
}
