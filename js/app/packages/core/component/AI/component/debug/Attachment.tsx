import type {
  Attachment,
  CreateAndSend,
  MessageStream,
  Model,
  Send,
} from '@core/component/AI/types';
import { TextButton } from '@core/component/TextButton';
import { isErr } from '@core/util/maybeResult';
import { getMacroApiToken } from '@service-auth/fetch';
import {
  cognitionApiServiceClient,
  cognitionWebsocketServiceClient,
} from '@service-cognition/client';
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
    sends.forEach((send: () => void) => send());
  };

  return (
    <div class="h-full w-full overflow-auto py-2">
      <div class="flex flex-1 justify-center w-full ">
        <div class="w-4/5 grid grid-cols-2 border border-accent divide-accent divide-y divide-x">
          <Item>
            <TextButton theme="accent" text="Send All" onClick={sendAll} />
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

async function request(simple: SimpleRequest): Promise<CreateAndSend> {
  const token = await getMacroApiToken();
  return {
    type: 'createAndSend',
    request: {},
    call: async () => {
      const createResponse = await cognitionApiServiceClient.createChat({});
      if (isErr(createResponse)) {
        return { type: 'error' };
      }
      const [, { id: chatId }] = createResponse;
      const request: Send['request'] = {
        chat_id: chatId,
        content: simple.userRequest,
        model: simple.model,
        token: token,
        attachments: simple.attachments,
      };
      const send: Send = {
        type: 'send',
        chat_id: chatId,
        request: request,
        call: (): MessageStream =>
          cognitionWebsocketServiceClient.sendStreamChatMessage(request),
      };
      return send;
    },
  };
}

function useDebugChatRequest(args: { request: SimpleRequest; label: string }): {
  sendRequest: () => void;
  Debugger: () => JSXElement;
} {
  const r = () => {
    return request(args.request);
  };
  const [send, setSend] = createSignal(0);
  const component = () => (
    <RequestDebugger
      label={args.label}
      request={r}
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
  request: () => Promise<CreateAndSend>;
  simpleRequest: SimpleRequest;
  go: Accessor<number>;
}) {
  const [chatCreated, setCreated] = createSignal(false);
  const [stream, setStream] = createSignal<MessageStream>();

  const makeRequest = async () => {
    setCreated(false);
    setStream();

    const request = await props.request();
    const sendRequest = await request.call();
    if ('type' in sendRequest && sendRequest.type === 'error') {
      return;
    }

    const stream = sendRequest.call();
    setCreated(true);
    setStream(stream);
  };

  createEffect(() => {
    if (props.go() > 0) makeRequest();
  });

  return (
    <Item label={props.label} col class="max-h-[600px] overflow-y-auto">
      <TextButton
        text="Send"
        theme="accent"
        onClick={() => {
          makeRequest();
        }}
      />
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
