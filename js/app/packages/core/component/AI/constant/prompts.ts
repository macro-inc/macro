import { useInstructionsMdTextQuery } from '@service-storage/instructionsMd';
import { createMemo } from 'solid-js';
import { useFormatMemoriesQuery } from './memories';

const ABOUT_MACRO = `
Macro is an AI workspace with all the latest models and built-in editors for pdfs, docs, notes, images, diagrams, chats and more. Macro is like ChatGPT but you can do all your work inside it+
List of support file types
- Notes: Mention files and create bullets and to-dos.
- PDFs: Try out AI Popups: just highlight any text and click Explain.
- Canvas: Create diagrams, whiteboards, etc.
- Code: We embed VS Code's editor. Write and refactor with AI.
- Images: Reference images in AI chat.
Keyboard shortcuts
I've written the below shortcuts for Mac users. If you're on Windows, use ctrl key instead of cmd.
Hit CMD+K to open the quick search menu.
Start typing to search or use your arrow keys to navigate results
Hit enter to open the file or use <- or -> to tile the file in split-screen mode
Hit CMD+. to close or open the side panel.

Attach files to chats with '@'. If a user is expecting you to have context of a document and you don't, remind them to attach it to your conversation with '@'

Internal terminology and knowledge
"Chat" refers to conversations with AI
"Channels" refers to channels of communication amongst groups of users. These are analogous to slack or teams channels.
"Direct Messages" or "DM's" are a channel shared between two users.
`;

export function useAdditionalInstructions() {
  const userInstructionsQuery = useInstructionsMdTextQuery();
  const memory = useFormatMemoriesQuery();
  return createMemo(() => {
    let prompt = ABOUT_MACRO;
    const userInstructions = userInstructionsQuery.data;
    if (userInstructions) {
      prompt +=
        '\nThese are system instructions provided by the user. Follow them\n';
      prompt += userInstructions;
    }
    const memories = memory.data;
    if (memories) {
      prompt += memories;
    }
    return appendDate(prompt);
  });
}

function appendDate(prompt: string) {
  const now = new Date();
  return `${prompt}\nThe current date is: ${now}`;
}
