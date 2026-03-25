import type { InputAttachmentData } from '../types';

type InputContent = {
  value?: string;
  attachments?: readonly InputAttachmentData[];
};

export function hasSendableInputContent(input: InputContent): boolean {
  return (
    input.value?.trim().length !== 0 || (input.attachments?.length ?? 0) > 0
  );
}
