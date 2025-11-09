import type { StreamItem } from '@service-cognition/websocket';

export type NetworkDelay = (index: number) => number;
export type Splitter = (items: StreamItem[]) => StreamItem[];
