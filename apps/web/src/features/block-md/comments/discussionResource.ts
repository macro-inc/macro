import { createBlockMemo } from '@core/block';
import { documentMessageThreads } from './commentsResource';

export const discussionThreads = createBlockMemo(() =>
  documentMessageThreads().filter((thread) => !thread.state.anchor)
);
