/**
 * The live controls for a question the agent is waiting on, shared by the
 * session's card and the channel's Magic Chip: the form with its Submit, the
 * URL consent, and the refusal of a request this client cannot display.
 *
 * A Macro user tool under review is each surface's own - the session opens
 * the tool's composer, the chip a read-only summary - so it is not here; a
 * surface that cannot show the tool falls back to `LiveForm` over the flat
 * schema the agent also sent.
 */

import type { ElicitationRequest } from '@service-agent-fold/generated/types';
import type { ElicitationAnswer } from '@service-agent-harness/generated/schemas';
import { Button } from '@ui';
import {
  createMemo,
  createSignal,
  type JSX,
  Match,
  Show,
  Switch,
} from 'solid-js';
import { createStore } from 'solid-js/store';
import {
  type FieldValue,
  initialValues,
  toContent,
  validate,
} from '../../state/elicitation-form';
import { ElicitationForm } from '../../ui';

export type RespondToElicitation = (
  answer: ElicitationAnswer
) => Promise<boolean>;

/** Every request the shared controls answer; a user tool is the surface's. */
export type LiveQuestionRequest = Exclude<
  ElicitationRequest,
  { kind: 'user_tool' }
>;

type LiveProps = {
  locked: boolean;
  onRespond: RespondToElicitation;
  /** Right-aligned in the action row, after the decisions. */
  trailing?: JSX.Element;
};

function form(request: LiveQuestionRequest) {
  return request.kind === 'form' ? request : undefined;
}

function url(request: LiveQuestionRequest) {
  return request.kind === 'url' ? request : undefined;
}

function unrecognized(request: LiveQuestionRequest) {
  return request.kind === 'unrecognized' ? request : undefined;
}

export function LiveQuestion(
  props: LiveProps & { request: LiveQuestionRequest }
) {
  return (
    <Switch>
      <Match when={form(props.request)}>
        {(request) => (
          <LiveForm
            schema={request().schema}
            locked={props.locked}
            onRespond={props.onRespond}
            trailing={props.trailing}
          />
        )}
      </Match>
      <Match when={url(props.request)}>
        {(request) => (
          <LiveUrl
            url={request().url}
            locked={props.locked}
            onRespond={props.onRespond}
            trailing={props.trailing}
          />
        )}
      </Match>
      <Match when={unrecognized(props.request)}>
        {(request) => (
          <div class="flex flex-col gap-2">
            <div class="text-xs text-ink-extra-muted italic">
              This client cannot display a "{request().mode}" request.
            </div>
            <Actions
              locked={props.locked}
              onRespond={props.onRespond}
              trailing={props.trailing}
            />
          </div>
        )}
      </Match>
    </Switch>
  );
}

/** Decline and Cancel, after an optional primary, with the trailing slot. */
function Actions(props: LiveProps & { children?: JSX.Element }) {
  return (
    <div class="flex flex-wrap items-center gap-2">
      {props.children}
      <Button
        variant="outline"
        size="xs"
        disabled={props.locked}
        onClick={() => void props.onRespond({ action: 'decline' })}
      >
        Decline
      </Button>
      <Button
        variant="ghost"
        size="xs"
        disabled={props.locked}
        onClick={() => void props.onRespond({ action: 'cancel' })}
      >
        Cancel
      </Button>
      <Show when={props.trailing}>
        <span class="ml-auto">{props.trailing}</span>
      </Show>
    </div>
  );
}

export function LiveForm(
  props: LiveProps & {
    schema: Extract<ElicitationRequest, { kind: 'form' }>['schema'];
  }
) {
  const [values, setValues] = createStore(initialValues(props.schema));
  const [touched, setTouched] = createSignal(false);
  const errors = createMemo(() => validate(props.schema, values));
  const shownErrors = () => (touched() ? errors() : {});

  const submit = () => {
    if (props.locked) return;
    setTouched(true);
    if (Object.keys(errors()).length > 0) return;
    void props.onRespond({
      action: 'accept',
      content: toContent(props.schema, values),
    });
  };

  return (
    <div class="flex flex-col gap-3">
      <ElicitationForm
        schema={props.schema}
        values={values}
        errors={shownErrors()}
        disabled={props.locked}
        onChange={(name: string, value: FieldValue) => setValues(name, value)}
      />
      <Actions
        locked={props.locked}
        onRespond={props.onRespond}
        trailing={props.trailing}
      >
        <Button
          variant="cta"
          size="xs"
          disabled={props.locked}
          onClick={submit}
        >
          Submit
        </Button>
      </Actions>
    </div>
  );
}

/**
 * URL mode never opens anything on its own. The card shows the full URL and
 * its host, and only after the user presses Open does it send the consent and
 * open a new tab - never an iframe, never a prefetch.
 */
function LiveUrl(props: LiveProps & { url: string }) {
  const host = () => urlHost(props.url);
  const open = async () => {
    if (props.locked) return;
    // Consent goes to the agent first so it learns the user agreed even if
    // the popup is blocked; the link below stays as the fallback.
    const accepted = await props.onRespond({ action: 'accept' });
    if (!accepted) return;
    window.open(props.url, '_blank', 'noopener,noreferrer');
  };
  return (
    <div class="flex flex-col gap-2">
      <div class="text-xs text-ink-muted">
        Opens <span class="font-medium text-ink">{host()}</span> in a new tab.
      </div>
      <div class="rounded-md border border-edge-muted bg-surface px-2 py-1 font-mono text-xs text-ink-muted break-all">
        {props.url}
      </div>
      <Actions
        locked={props.locked}
        onRespond={props.onRespond}
        trailing={props.trailing}
      >
        <Button variant="cta" size="xs" disabled={props.locked} onClick={open}>
          Open
        </Button>
      </Actions>
    </div>
  );
}

/** The host of a URL-mode request, for the consent card, or the raw text. */
function urlHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
