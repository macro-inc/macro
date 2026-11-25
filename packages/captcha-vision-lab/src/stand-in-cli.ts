/**
 * `bun run lab:kimi-stand-in -- --port 47840 --choice A --log <file>`:
 * the loopback chat completions stand-in as a process. Each request is
 * appended to the log as one JSON line (the image is reduced to its size), so
 * a proof run can show how many planner calls reached it.
 */
import { appendFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { fixedChoiceReply, startStandIn } from './stand-in.ts';

const { values } = parseArgs({
  options: {
    port: { type: 'string', default: '47840' },
    choice: { type: 'string', default: 'A' },
    log: { type: 'string' },
  },
});

const summarize = (request: unknown): string =>
  JSON.stringify(request, (_key, value: unknown) =>
    typeof value === 'string' && value.startsWith('data:image/')
      ? `<image ${value.length} chars>`
      : value
  );

const standIn = startStandIn(
  () => fixedChoiceReply(values.choice),
  (request) => {
    if (values.log !== undefined) {
      appendFileSync(values.log, `${summarize(request)}\n`);
    }
  },
  Number(values.port)
);
console.log(`kimi stand-in listening at ${standIn.baseUrl}`);
