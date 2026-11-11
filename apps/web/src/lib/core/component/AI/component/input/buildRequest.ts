import type { Attachment, Model, ToolSet } from '@core/component/AI/types';
import type { ModelSpeed } from '../../constant/speed';

export type ChatSendInput = {
  content: string;
  model: Model;
  speed?: ModelSpeed;
  attachments: Attachment[];
  toolset: ToolSet;
  metaKey?: boolean;
};
