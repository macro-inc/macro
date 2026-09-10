import type { JSX } from 'solid-js';
import {
  type EmailRenderingContextValue,
  EmailRenderingProvider,
} from '../../email-message/context/email-rendering-context';
import { EmailThreadStateProvider } from '../context/email-thread-state-context';
import {
  type EmailThreadViewContext,
  EmailThreadViewProvider,
} from '../context/email-thread-view-context';
import { createEmailThreadState } from '../primitives/email-thread-state';
import { EmailThreadView, type EmailThreadViewProps } from './email-thread';

export interface EmailThreadSurfaceProps extends EmailThreadViewProps {
  context: EmailThreadViewContext;
  emailRendering: EmailRenderingContextValue;
  frame?: (content: () => JSX.Element) => JSX.Element;
}

/** Mounts thread state and views with the caller's contexts. */
export function EmailThreadSurface(props: EmailThreadSurfaceProps) {
  const state = createEmailThreadState(props.context.thread, props.host);
  const content = () => <EmailThreadView {...props} />;
  return (
    <EmailThreadViewProvider value={props.context}>
      <EmailRenderingProvider value={props.emailRendering}>
        <EmailThreadStateProvider value={state}>
          {props.frame ? props.frame(content) : content()}
        </EmailThreadStateProvider>
      </EmailRenderingProvider>
    </EmailThreadViewProvider>
  );
}
