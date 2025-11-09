import { blockDataSignalAs } from '@core/block';
import type { ChatData } from '../definition';

export const chatBlockData = blockDataSignalAs<ChatData>('chat');
