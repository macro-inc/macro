import { blockDone, createStream } from '@core/component/AI/util/stream';
import { mockMessages } from './mockData';
import { StreamDebugger } from './stream';
import { Item } from './util';

export default function DebugTools() {
  return (
    <div class="h-full w-full overflow-auto py-2">
      <div class="flex flex-1 justify-center w-full ">
        <div class="w-4/5 grid grid-cols-2 border border-accent divide-accent divide-y divide-x">
          <ToolCall />
          <ToolResponse />
          <ToolResponsStreamEnd />
        </div>
      </div>
    </div>
  );
}

function ToolCall() {
  const messages = mockMessages([
    { type: 'user', text: 'what is weather now' },
  ]);
  const stream = createStream([
    {
      type: 'toolCall',
      tool: {
        name: 'web_search',
        data: {
          query: 'Weather in nyc now',
        },
      },
    },
  ]);
  const neverDone = blockDone(stream);
  return (
    <Item label="Tool Call">
      <StreamDebugger stream={neverDone} messages={messages} />
    </Item>
  );
}

function ToolResponse() {
  const messages = mockMessages([
    { type: 'user', text: 'what is weather now' },
  ]);
  const stream = createStream([
    {
      type: 'toolCall',
      tool: {
        name: 'web_search',
        data: {
          query: 'Weather in nyc now',
        },
      },
    },
    {
      type: 'toolResponse',
      tool: {
        data: {
          tool_use_id: 'hehexd',
          content: [
            {
              title: 'its sunny',
              type: 'web_search_result',
              url: 'https://weather.com',
            },
          ],
        },
        name: 'web_search',
      },
    },
    {
      type: 'text',
      text: 'the tool call is complete and I (the ai) would tell you about the weather here',
    },
  ]);
  const neverDone = blockDone(stream);
  return (
    <Item label="Tool Response">
      <StreamDebugger stream={neverDone} messages={messages} />
    </Item>
  );
}

function ToolResponsStreamEnd() {
  const messages = mockMessages([
    { type: 'user', text: 'what is weather now' },
  ]);
  const stream = createStream([
    {
      type: 'toolCall',
      tool: {
        name: 'web_search',
        data: {
          query: 'Weather in nyc now',
        },
      },
    },
    {
      type: 'toolResponse',
      tool: {
        data: {
          tool_use_id: 'hehexd',
          content: [
            {
              title: 'its sunny',
              type: 'web_search_result',
              url: 'https://weather.com',
            },
          ],
        },
        name: 'web_search',
      },
    },
    {
      type: 'text',
      text: 'the tool call is complete and I (the ai) would tell you about the weather here',
    },
  ]);
  return (
    <Item label="Tool Response Stream Done">
      <StreamDebugger stream={stream} messages={messages} />
    </Item>
  );
}
