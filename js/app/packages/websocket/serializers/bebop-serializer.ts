import type { WebsocketSerializer } from '@websocket/websocket-serializer';

type Encoder<I, O> = { encode(data: I): O };
type Decoder<I, O> = { decode(data: I): O };

export class BebopSerializer<Send, Receive>
  implements WebsocketSerializer<Send, Receive> {
  private readonly encoder: Encoder<Send, Uint8Array>;
  private readonly decoder: Decoder<Uint8Array, Receive>;

  constructor(
    encoder: Encoder<Send, Uint8Array>,
    decoder: Decoder<Uint8Array, Receive>
  ) {
    this.encoder = encoder;
    this.decoder = decoder;
  }

  serialize(data: Send): Uint8Array {
    return this.encoder.encode(data);
  }
  deserialize(data: ArrayBuffer): Receive {
    console.log('data', data);
    return this.decoder.decode(new Uint8Array(data));
  }

  get binaryType(): BinaryType {
    return 'arraybuffer';
  }
}
