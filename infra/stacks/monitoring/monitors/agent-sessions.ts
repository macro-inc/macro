// Agent session turns: latency, model round-trips, prompt cache, context size
// and tool failures.
//
// New resources, not adopted from the UI, so they are not `protect`ed.
//
// The harness's spans are custom spans, which produce no trace metrics, and
// span queries read only the indexed (sampled) spans. Span-based metrics are
// computed from every ingested span, so the dashboard reads those. The span
// fields are described in crates/agent_session/README.md.
import * as datadog from '@pulumi/datadog';
import { graphGroup, prodMonitor, thresholdGraph } from '../prod-monitor';

const HARNESS = 'service:agent-harness-service';
const TURN = `${HARNESS} resource_name:agent.turn`;
const PROMPT = `${HARNESS} resource_name:agent.acp.prompt`;
const CHAT = `${HARNESS} resource_name:chat_streaming`;
// One span per session tool call: the agent loop's own, or the ACP harness's.
// A tool reached through MCP opens a second `execute_tool` span inside it,
// without the conversation id, and other agents' tools have none either.
const TOOL = `${HARNESS} @gen_ai.operation.name:execute_tool @gen_ai.conversation.id:*`;

const byEnv = { path: 'env', tagName: 'env' };
const byModel = { path: '@agent.model', tagName: 'model' };
const byProvider = { path: '@gen_ai.provider.name', tagName: 'provider' };

function distribution(
  name: string,
  query: string,
  path: string,
  groupBies: datadog.types.input.SpansMetricGroupBy[]
) {
  return new datadog.SpansMetric(name, {
    name,
    compute: {
      aggregationType: 'distribution',
      path,
      includePercentiles: true,
    },
    filter: { query },
    groupBies: [byEnv, ...groupBies],
  });
}

function count(
  name: string,
  query: string,
  groupBies: datadog.types.input.SpansMetricGroupBy[]
) {
  return new datadog.SpansMetric(name, {
    name,
    compute: { aggregationType: 'count' },
    filter: { query },
    groupBies: [byEnv, ...groupBies],
  });
}

// The agent loop's run of one turn: model calls and tools, from the first
// request to the last chunk.
distribution('macro.agent.turn.duration', TURN, '@duration', [byModel]);
distribution(
  'macro.agent.turn.model_calls',
  TURN,
  '@agent.stream.model_calls',
  [byModel]
);

// Token usage per model call. Providers count differently: Anthropic's input
// excludes cache reads and writes, OpenAI's and Gemini's include cache reads.
for (const [metric, path] of [
  ['macro.agent.chat.input_tokens', '@gen_ai.usage.input_tokens'],
  [
    'macro.agent.chat.cache_read_tokens',
    '@gen_ai.usage.cache_read.input_tokens',
  ],
  [
    'macro.agent.chat.cache_write_tokens',
    '@gen_ai.usage.cache_creation.input_tokens',
  ],
]) {
  distribution(metric, CHAT, path, [byProvider]);
}

// What each model call sent, by part (`macro.genai.prompt.*`).
const PROMPT_PARTS = [
  'preamble',
  'macro_prompt',
  'identity',
  'session_instructions',
  'session_note',
  'opener_note',
  'memory',
  'model_id',
  'connected_integrations',
  'sdk_docs',
  'tools.eager',
  'tools.loaded',
  'history',
  'tool_results',
];
for (const part of PROMPT_PARTS) {
  distribution(
    `macro.agent.chat.prompt.${part}.bytes`,
    CHAT,
    `@macro.genai.prompt.${part}.bytes`,
    [byProvider]
  );
}

const byTool = { path: '@gen_ai.tool.name', tagName: 'tool' };
count('macro.agent.tool.calls', TOOL, [byTool]);
count('macro.agent.tool.errors', `${TOOL} status:error`, [byTool]);
// How large results are, and how often the model reads only the beginning.
distribution(
  'macro.agent.tool.result_bytes',
  TOOL,
  '@macro.genai.tool.result_bytes',
  [byTool]
);
count(
  'macro.agent.tool.results_cut',
  `${TOOL} @macro.genai.tool.result_cut:true`,
  [byTool]
);

// ExecuteCode programs that fail come back as results, so only the turn
// counts them.
distribution(
  'macro.agent.turn.code_executions',
  PROMPT,
  '@agent.turn.code_executions',
  []
);
distribution(
  'macro.agent.turn.code_failures',
  PROMPT,
  '@agent.turn.code_failures',
  []
);
// Time a turn waited on a conversation summary before it could run.
distribution(
  'macro.agent.turn.compaction_wait_ms',
  PROMPT,
  '@agent.turn.compaction_wait_ms',
  []
);

const ENV = 'env:prod';
const TOOL_FAILURES_TITLE = 'Agent session tool calls failing (%)';
const TOOL_FAILURES_CRITICAL = '20';
const TOOL_FAILURES_WARNING = '14';

function timeseries(
  title: string,
  queries: { name: string; query: string }[],
  formula: string
) {
  return {
    timeseriesDefinition: {
      title,
      requests: [
        {
          displayType: 'line',
          queries: queries.map(({ name, query }) => ({
            metricQuery: { name, query, dataSource: 'metrics' },
          })),
          formulas: [{ formulaExpression: formula }],
        },
      ],
    },
  };
}

export const agentSessionsDashboard = new datadog.Dashboard('agent-sessions', {
  title: 'Agent sessions: turns, cache, context',
  description:
    'Where agent turn time and tokens go. Fields: crates/agent_session/README.md. One session in detail: the agent-session-analysis skill.',
  layoutType: 'ordered',
  widgets: [
    graphGroup('Turns', [
      timeseries(
        'Turn latency p50 by model (s)',
        [
          {
            name: 'p50',
            query: `p50:macro.agent.turn.duration{${ENV}} by {model}`,
          },
        ],
        'p50 / 1000000000'
      ),
      timeseries(
        'Turn latency p90 by model (s)',
        [
          {
            name: 'p90',
            query: `p90:macro.agent.turn.duration{${ENV}} by {model}`,
          },
        ],
        'p90 / 1000000000'
      ),
      timeseries(
        'Model round-trips per turn, average by model',
        [
          {
            name: 'calls',
            query: `avg:macro.agent.turn.model_calls{${ENV}} by {model}`,
          },
        ],
        'calls'
      ),
      timeseries(
        'Wait for a conversation summary before a turn, p90 (s)',
        [
          {
            name: 'wait',
            query: `p90:macro.agent.turn.compaction_wait_ms{${ENV}}`,
          },
        ],
        'wait / 1000'
      ),
    ]),
    graphGroup('Prompt cache and context', [
      timeseries(
        'Cache hit rate, Anthropic (cache reads / all input)',
        [
          {
            name: 'read',
            query: `sum:macro.agent.chat.cache_read_tokens{${ENV},provider:anthropic}.as_count()`,
          },
          {
            name: 'write',
            query: `sum:macro.agent.chat.cache_write_tokens{${ENV},provider:anthropic}.as_count()`,
          },
          {
            name: 'input',
            query: `sum:macro.agent.chat.input_tokens{${ENV},provider:anthropic}.as_count()`,
          },
        ],
        '100 * read / (read + write + input)'
      ),
      timeseries(
        'Cache hit rate, OpenAI and Gemini (cache reads / input)',
        [
          {
            name: 'read',
            query: `sum:macro.agent.chat.cache_read_tokens{${ENV},!provider:anthropic} by {provider}.as_count()`,
          },
          {
            name: 'input',
            query: `sum:macro.agent.chat.input_tokens{${ENV},!provider:anthropic} by {provider}.as_count()`,
          },
        ],
        '100 * read / input'
      ),
      {
        timeseriesDefinition: {
          title: 'Average bytes per model call, by prompt part',
          requests: [
            {
              displayType: 'area',
              queries: PROMPT_PARTS.map((part, index) => ({
                metricQuery: {
                  name: `part${index}`,
                  query: `avg:macro.agent.chat.prompt.${part}.bytes{${ENV}}`,
                  dataSource: 'metrics',
                },
              })),
              formulas: PROMPT_PARTS.map((part, index) => ({
                formulaExpression: `part${index}`,
                alias: part,
              })),
            },
          ],
        },
      },
    ]),
    graphGroup('Tools', [
      thresholdGraph({
        // Hourly sums, as the monitor evaluates them.
        title: TOOL_FAILURES_TITLE,
        query: `100 * sum:macro.agent.tool.errors{${ENV}}.as_count().rollup(sum, 3600) / sum:macro.agent.tool.calls{${ENV}}.as_count().rollup(sum, 3600)`,
        critical: TOOL_FAILURES_CRITICAL,
        warning: TOOL_FAILURES_WARNING,
      }),
      {
        toplistDefinition: {
          title: 'Tool failure rate by tool, last window (%)',
          requests: [
            {
              queries: [
                {
                  metricQuery: {
                    name: 'errors',
                    query: `sum:macro.agent.tool.errors{${ENV}} by {tool}.as_count()`,
                    dataSource: 'metrics',
                    aggregator: 'sum',
                  },
                },
                {
                  metricQuery: {
                    name: 'calls',
                    query: `sum:macro.agent.tool.calls{${ENV}} by {tool}.as_count()`,
                    dataSource: 'metrics',
                    aggregator: 'sum',
                  },
                },
              ],
              formulas: [
                {
                  formulaExpression: '100 * errors / calls',
                  limit: { count: 25, order: 'desc' },
                },
              ],
            },
          ],
        },
      },
      {
        toplistDefinition: {
          title: 'Tool result size p90 by tool (KB)',
          requests: [
            {
              queries: [
                {
                  metricQuery: {
                    name: 'bytes',
                    query: `p90:macro.agent.tool.result_bytes{${ENV}} by {tool}`,
                    dataSource: 'metrics',
                    aggregator: 'avg',
                  },
                },
              ],
              formulas: [
                {
                  formulaExpression: 'bytes / 1000',
                  limit: { count: 25, order: 'desc' },
                },
              ],
            },
          ],
        },
      },
      timeseries(
        'Tool results cut for the model, by tool',
        [
          {
            name: 'cut',
            query: `sum:macro.agent.tool.results_cut{${ENV}} by {tool}.as_count()`,
          },
        ],
        'cut'
      ),
      timeseries(
        'Code-mode failure rate (failed programs / programs, %)',
        [
          {
            name: 'failures',
            query: `sum:macro.agent.turn.code_failures{${ENV}}.as_count()`,
          },
          {
            name: 'runs',
            query: `sum:macro.agent.turn.code_executions{${ENV}}.as_count()`,
          },
        ],
        '100 * failures / runs'
      ),
    ]),
  ],
});

// Indexed execute_tool spans in the week to 2026-10-26 failed 6-8% a day, so
// a fifth of all calls failing for an hour is well outside normal.
prodMonitor('agent-tool-failures', {
  title: TOOL_FAILURES_TITLE,
  service: 'agent-harness-service',
  query: `sum(last_1h):100 * sum:macro.agent.tool.errors{${ENV}}.as_count() / sum:macro.agent.tool.calls{${ENV}}.as_count() > ${TOOL_FAILURES_CRITICAL}`,
  monitorThresholds: {
    critical: TOOL_FAILURES_CRITICAL,
    warning: TOOL_FAILURES_WARNING,
  },
  pages: false,
  description:
    'More agent session tool calls failed in the last hour than usual. Find the tools in the "Tool failure rate by tool" widget.',
  dashboard: agentSessionsDashboard.url,
  runbook: 'docs/runbooks/agent-sessions.md#tool-failures',
  alertDetail: '{{value}}% of tool calls failed (threshold {{threshold}}%)',
  warningDetail:
    '{{value}}% of tool calls failed (warning threshold {{warn_threshold}}%)',
  recoveryDetail: '{{value}}% of tool calls failed',
});
