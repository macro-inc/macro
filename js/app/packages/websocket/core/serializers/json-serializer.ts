import type { WebsocketSerializer } from '../websocket-serializer';

export class JsonSerializer<Send, Receive>
  implements WebsocketSerializer<Send, Receive>
{
  serialize(data: Send): string {
    return JSON.stringify(data);
  }
  deserialize(data: string): Receive {
    return JSON.parse(data);
  }
}
