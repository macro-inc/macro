import { createContext, useContext } from 'solid-js';
import type { ReplyWindowState } from './primitives/reply-window-state';

const ReplyWindowContext = createContext<ReplyWindowState>();

export const ReplyWindowProvider = ReplyWindowContext.Provider;

/** The app's reply window, where the app shell provides one. */
export const useEmailReplyWindow = () => useContext(ReplyWindowContext);
