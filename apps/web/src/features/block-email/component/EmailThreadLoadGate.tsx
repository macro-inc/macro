import {
  EntityLoadGate,
  type EntityLoadResult,
} from '@core/component/EntityLoadGate';
import { EmailDebouncedReadMarker } from '@notifications';
import type { ComponentProps, ParentProps } from 'solid-js';
import { Suspense } from 'solid-js';

export type EmailThreadLoadGateProps<Data> = ParentProps<{
  result: EntityLoadResult<Data>;
  notificationSource: ComponentProps<
    typeof EmailDebouncedReadMarker
  >['notificationSource'];
  threadId: string;
  linkId?: string;
  debounceTime?: number;
  onRetry: () => void;
}>;

/** Shared load and read-state policy for every mounted email detail host. */
export function EmailThreadLoadGate<Data>(
  props: EmailThreadLoadGateProps<Data>
) {
  return (
    <Suspense>
      <EntityLoadGate
        result={props.result}
        loadErrorTitle="Unable to load this email"
        onRetry={props.onRetry}
      >
        <EmailDebouncedReadMarker
          notificationSource={props.notificationSource}
          threadId={props.threadId}
          linkId={props.linkId}
          debounceTime={props.debounceTime}
        />
        {props.children}
      </EntityLoadGate>
    </Suspense>
  );
}
