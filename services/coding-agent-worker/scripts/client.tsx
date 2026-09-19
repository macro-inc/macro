import type { PromptRequest } from '@agentclientprotocol/sdk';
import type { ServerWebSocket } from 'bun';
import { Box, render, Static, Text } from 'ink';
import TextInput from 'ink-text-input';
import { useEffect, useRef, useState } from 'react';
import type {
  ToRuntimeMessage,
  ToServerMessage,
} from '../src/protocol/generated';

const port = Number(process.env.UPSTREAM_PORT ?? 4001);

function timestamp() {
  return new Date().toISOString().slice(11, 23); // HH:MM:SS.mmm
}

type AcpFrame = {
  id?: string | number;
  result?: { sessionId?: string };
  method?: string;
  params?: {
    update?: {
      sessionUpdate?: string;
      content?: { type?: string; text?: string };
    };
  };
};

function handleAcp(
  frame: AcpFrame,
  acpSessionId: React.MutableRefObject<string | null>
) {
  if (frame.result?.sessionId) acpSessionId.current = frame.result.sessionId;
}

// Color raw log lines by what kind of ACP update they carry, if any.
function colorFor(frame: AcpFrame): string | undefined {
  const kind =
    frame.method === 'session/update'
      ? frame.params?.update?.sessionUpdate
      : undefined;
  if (kind === 'agent_message_chunk') return 'green';
  if (kind === 'agent_thought_chunk') return 'gray';
  return undefined;
}

type Line = { text: string; color?: string };

function App() {
  const [lines, setLines] = useState<Line[]>([]);
  const [response, setResponse] = useState('');
  const [input, setInput] = useState('');
  const sock = useRef<ServerWebSocket<{ sessionId: string }> | null>(null);
  const acpSessionId = useRef<string | null>(null);
  const nextId = useRef(1);

  const log = (line: string, color?: string) =>
    setLines((prev) => [...prev, { text: `${timestamp()} ${line}`, color }]);

  useEffect(() => {
    const server = Bun.serve<{ sessionId: string }>({
      port,
      fetch(req, srv) {
        const sessionId = new URL(req.url).searchParams.get('id');
        if (!sessionId)
          return new Response('missing id query parameter', { status: 400 });
        if (srv.upgrade(req, { data: { sessionId } })) return undefined;
        return new Response('mock upstream: websocket only', { status: 426 });
      },
      websocket: {
        open(ws) {
          sock.current = ws;
          log(`[upstream] worker connected: ${ws.data.sessionId}`);
        },
        message(_ws, data) {
          const text = String(data);
          let payload: ToServerMessage;
          try {
            const parsed: unknown = JSON.parse(text);
            if (!isServerMessage(parsed))
              throw new Error('invalid worker message');
            payload = parsed;
          } catch {
            log(text);
            return;
          }
          if (payload.type !== 'acp') {
            log(text);
            return;
          }
          const acpFrame = acpPayload(payload) as AcpFrame;
          log(text, colorFor(acpFrame));
          handleAcp(acpFrame, acpSessionId);

          if (
            acpFrame?.method === 'session/update' &&
            acpFrame.params?.update?.sessionUpdate === 'agent_message_chunk'
          ) {
            const chunkText = acpFrame.params.update.content?.text;
            if (chunkText) setResponse((prev) => prev + chunkText);
          }
        },
        close() {
          sock.current = null;
          log('[upstream] worker disconnected');
        },
      },
    });
    log(
      `[upstream] listening on ws://localhost:${port} — waiting for the worker to dial in`
    );

    return () => {
      server.stop();
    };
  }, []);

  const submit = (text: string) => {
    setInput('');
    const trimmed = text.trim();
    if (!trimmed) return;
    if (!sock.current) return log('[upstream] no worker connected');
    if (!acpSessionId.current) return log('[upstream] no ACP session yet');
    setResponse('');
    const params: PromptRequest = {
      sessionId: acpSessionId.current,
      prompt: [{ type: 'text', text: trimmed }],
    };
    const message: ToRuntimeMessage = {
      type: 'acp',
      jsonrpc: '2.0',
      id: `up:${nextId.current++}`,
      method: 'session/prompt',
      params,
    } as unknown as ToRuntimeMessage;
    sock.current.send(JSON.stringify(message));
  };

  return (
    <Box flexDirection="column">
      <Static items={lines}>
        {(line, i) => (
          <Text key={i} color={line.color}>
            {line.text}
          </Text>
        )}
      </Static>
      {response && (
        <Box
          flexDirection="column"
          borderStyle="round"
          borderColor="green"
          paddingX={1}
          marginTop={1}
        >
          <Text bold color="green">
            agent
          </Text>
          <Text>{response}</Text>
        </Box>
      )}
      <Box>
        <Text>{'> '}</Text>
        <TextInput value={input} onChange={setInput} onSubmit={submit} />
      </Box>
    </Box>
  );
}

render(<App />);

function isServerMessage(value: unknown): value is ToServerMessage {
  if (typeof value !== 'object' || value === null) return false;
  const type = (value as { type?: unknown }).type;
  return type === 'acp' || type === 'event';
}

/** Recover the raw ACP frame from an `acp`-tagged message: `AcpMessage` flattens
 * the frame's own JSON-RPC fields directly alongside the `type` tag on the wire. */
function acpPayload(message: { type: 'acp' }): unknown {
  const { type: _type, ...frame } = message as { type: 'acp' } & Record<
    string,
    unknown
  >;
  return frame;
}
