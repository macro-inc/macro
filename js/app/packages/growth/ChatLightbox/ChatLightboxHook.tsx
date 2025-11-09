//@ts-nocheck
import { addAttachmentToChat } from '@block-chat/signal/attachment';
import { chatBlockData } from '@block-chat/signal/chatBlockData';
import { chatInputValueSignal } from '@block-chat/signal/input';
import type { ChatAttachmentWithName } from '@service-cognition/generated/schemas/chatAttachmentWithName';
import { createCallback } from '@solid-primitives/rootless';
import { createEffect, createSignal } from 'solid-js';

const [fileAttached, setFileAttached] = createSignal(false);

export const ChatLightboxHook = () => {
  const setPrompt = chatInputValueSignal.set;
  const blockData = chatBlockData.get;
  const addAttachment = createCallback(addAttachmentToChat);

  const init = async () => {
    const prompt =
      "I'm new to Macro. Can you explain what Macro is, what features it offers, and how it can help me with my work? Please provide an overview of its main capabilities and benefits.";
    setPrompt(prompt);
    const chatInput = document.getElementById(
      'chat-input-text-area'
    ) as HTMLDivElement;
    if (chatInput) {
      chatInput.innerHTML = prompt;
    }

    const attachment = blockData()?.availableAttachments.find(
      // @ts-ignore
      (f) => f.metadata?.document_name === 'Why use Macro?'
    );
    if (attachment) {
      await addAttachment(attachment as ChatAttachmentWithName);
    }
  };

  createEffect(() => {
    if (!blockData() || fileAttached()) return;
    // Need to check if there is a file already attached to the chat
    const availableAttachments = blockData()?.availableAttachments;
    if (availableAttachments && availableAttachments.length > 0) {
      init();
      setFileAttached(true);
    }
  });
  return '';
};
