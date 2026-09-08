import type { JSX } from 'solid-js';
import {
  type EmailRenderingDependencies,
  EmailRenderingProvider,
} from '../../email-message/context/email-rendering-context';
import { EmailThreadStateProvider } from '../context/email-thread-state-context';
import {
  ThreadEnvironmentProvider,
  type ThreadViewEnvironment,
} from '../context/thread-environment';
import { createEmailThreadState } from '../primitives/email-thread-state';
import { EmailThreadView, type EmailThreadViewProps } from './email-thread';

export interface EmailThreadSurfaceProps extends EmailThreadViewProps {
  environment: ThreadViewEnvironment;
  emailRendering: EmailRenderingDependencies;
  frame?: (content: () => JSX.Element) => JSX.Element;
}

/** Reusable composition: all application dependencies are supplied by the caller. */
export function EmailThreadSurface(props: EmailThreadSurfaceProps) {
  const state = createEmailThreadState(
    props.environment.dependencies,
    props.host
  );
  const content = () => <EmailThreadView {...props} />;
  return (
    <ThreadEnvironmentProvider value={props.environment}>
      <EmailRenderingProvider value={props.emailRendering}>
        <EmailThreadStateProvider value={state}>
          {props.frame ? props.frame(content) : content()}
        </EmailThreadStateProvider>
      </EmailRenderingProvider>
    </ThreadEnvironmentProvider>
  );
}
