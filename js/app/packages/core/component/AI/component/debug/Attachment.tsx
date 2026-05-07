import type { Attachment, Model } from '@core/component/AI/types';
import { isErr } from '@core/util/maybeResult';
import { cognitionApiServiceClient } from '@service-cognition/client';
import type { ChatMessageStream } from '@service-connection/stream';
import { subscribe } from '@service-connection/stream';
import { Button } from '@ui';
import type { Accessor, JSXElement } from 'solid-js';
import { createEffect, createSignal, For, Match, Show, Switch } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { DEFAULT_MODEL } from '../../constant';
import { AttachmentList } from '../input/Attachment';
import * as ATTACHMENTS from './attachments';
import { StreamDebugger } from './stream';
import { Item } from './util';

type AttachmentTest = {
  name: string;
  request: SimpleRequest;
};

const requests: (model: Model) => AttachmentTest[] = (model) => [
  {
    name: 'Summarize Neuromancer',
    request: {
      model,
      userRequest: 'Summarize this document',
      attachments: [ATTACHMENTS.NUEROMANCER],
    },
  },
  {
    name: 'Paper compare',
    request: {
      model,
      userRequest: 'Compare these two papers',
      attachments: [ATTACHMENTS.LOST_IN_THE_MIDDLE, ATTACHMENTS.NSW],
    },
  },
  {
    name: 'Code understand',
    request: {
      model,
      userRequest: 'Help me understand these 2 code files',
      attachments: [ATTACHMENTS.CHAT_RS, ATTACHMENTS.CLIENT_RS],
    },
  },
  {
    name: 'Md Read',
    request: {
      model,
      userRequest: 'please summarize this for me',
      attachments: [ATTACHMENTS.PRD_PROPERTIES_V0],
    },
  },
  {
    name: 'multi markdown',
    request: {
      model,
      userRequest:
        'List the name of each fiel then summarize in a single sentence',
      attachments: [
        ATTACHMENTS.PRD_PROPERTIES_V0,
        ATTACHMENTS.RFD_DEMETERS_BROTH,
        ATTACHMENTS.RFD_SOUND,
      ],
    },
  },
  {
    name: 'Lots of attachments',
    request: {
      model,
      userRequest:
        'List the name of each attachment then summarize it in a single sentence',
      attachments: [
        ATTACHMENTS.PRD_PROPERTIES_V0,
        ATTACHMENTS.CHAT_RS,
        ATTACHMENTS.CLIENT_RS,
        ATTACHMENTS.IHAVENOMOUTHANDIMUSTSCREAM,
        ATTACHMENTS.LOST_IN_THE_MIDDLE,
        ATTACHMENTS.NSW,
        ATTACHMENTS.NUEROMANCER,
        ATTACHMENTS.REQUEST_BUILDER_RS,
        ATTACHMENTS.RFD_DEMETERS_BROTH,
        ATTACHMENTS.RFD_SOUND,
      ],
    },
  },
];

const MODEL: Model = DEFAULT_MODEL;

export default function DebugAttachments() {
  const sends: any = [];
  const components: any = [];

  for (const request of requests(MODEL)) {
    const { Debugger, sendRequest } = useDebugChatRequest({
      label: request.name,
      request: request.request,
    });
    sends.push(sendRequest);
    components.push(Debugger);
  }

  const sendAll = () => {
    sends.forEach((send: () => void) => {
      send();
    });
  };

  return (
    <div class="size-full overflow-auto py-2">
      <div class="flex flex-1 justify-center w-full">
        <div class="w-4/5 grid grid-cols-2 border border-accent divide-accent divide-y divide-x">
          <Item>
            <Button variant="active" onClick={sendAll}>
              Send All
            </Button>
          </Item>
          <For each={components}>
            {(component) => <Dynamic component={component} />}
          </For>
        </div>
      </div>
    </div>
  );
}

type SimpleRequest = {
  userRequest: string;
  attachments: Attachment[];
  model: Model;
};

type SendResult = { type: 'ok'; stream: ChatMessageStream } | { type: 'error' };

async function sendRequest(simple: SimpleRequest): Promise<SendResult> {
  const response = await cognitionApiServiceClient.sendStreamChatMessage({
    content: simple.userRequest,
    model: simple.model,
    attachments: simple.attachments.length > 0 ? simple.attachments : undefined,
  });
  if (isErr(response)) {
    return { type: 'error' };
  }
  const [, { stream_id, chat_id }] = response;
  const connectionStream = subscribe('chat', chat_id, stream_id);
  if (!connectionStream) {
    return { type: 'error' };
  }
  return {
    type: 'ok',
    stream: {
      data: connectionStream.data,
      isDone: connectionStream.isDone,
      id: () => ({
        stream_id,
        entity_id: chat_id,
        entity_type: 'chat',
      }),
    },
  };
}

function useDebugChatRequest(args: { request: SimpleRequest; label: string }): {
  sendRequest: () => void;
  Debugger: () => JSXElement;
} {
  const [send, setSend] = createSignal(0);
  const component = () => (
    <RequestDebugger
      label={args.label}
      simpleRequest={args.request}
      go={send}
    />
  );
  return {
    sendRequest: () => setSend((p) => p + 1),
    Debugger: component,
  };
}

function RequestDebugger(props: {
  label: string;
  simpleRequest: SimpleRequest;
  go: Accessor<number>;
}) {
  const [chatCreated, setCreated] = createSignal(false);
  const [stream, setStream] = createSignal<ChatMessageStream>();

  const makeRequest = async () => {
    setCreated(false);
    setStream();

    const result = await sendRequest(props.simpleRequest);
    if (result.type === 'error') {
      return;
    }

    setCreated(true);
    setStream(result.stream);
  };

  createEffect(() => {
    if (props.go() > 0) makeRequest();
  });

  return (
    <Item label={props.label} col class="max-h-150 overflow-y-auto">
      <Button
        variant="active"
        onClick={() => {
          makeRequest();
        }}
      >
        Send
      </Button>
      <div class="border border-edge font-mono p-2">
        <div class="text-accent italic">{props.simpleRequest.userRequest}</div>
        <div>
          <div class="border border-edge">
            <AttachmentList
              attached={() => props.simpleRequest.attachments}
              removeAttachment={() => {}}
              uploading={() => []}
            />
          </div>
        </div>
      </div>

      <Switch>
        <Match when={chatCreated()}> Chat Created</Match>
        <Match when={!chatCreated}> Chat Not Created</Match>
      </Switch>
      <Show when={stream()}>
        {(stream) => <StreamDebugger stream={stream()} />}
      </Show>
    </Item>
  );
}
