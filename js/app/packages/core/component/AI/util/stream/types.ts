import type { ChatMessageStream } from '@service-connection/stream';
export type StreamItem = ReturnType<ChatMessageStream['data']>[number];
export type NetworkDelay = (index: number) => number;
export type Splitter = (items: StreamItem[]) => StreamItem[];
