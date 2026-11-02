import { cognitionApiServiceClient } from '@service-cognition/client';

export async function createInputChat() {
  const response = await cognitionApiServiceClient.createChat({});
  if (response.isErr())
    throw new Error('Could not start the chat. Your draft is saved.');
  return response.value.id;
}
