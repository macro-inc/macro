import ArrowUpIcon from '@phosphor/arrow-up.svg';
import CodeIcon from '@phosphor/code.svg';
import SparkleIcon from '@phosphor/sparkle.svg';
import PlayIcon from '@phosphor/play.svg';
import { Button } from '@ui';
import { createSignal, For, Show } from 'solid-js';
import type { QueryCapabilities } from '../context/query-context';
import { isScalarAnswer, queryStarters, type QueryAnswer, type QueryDefinition, type QuerySchema } from '../core/query';
import { createQueryComposer } from '../primitives/query-composer';
import { QueryResults } from '../components/query-results';
import { SqlEditor } from '../components/sql-editor';

export function QueryEditor(props: {
  schema: QuerySchema;
  initial: QueryDefinition;
  capabilities: QueryCapabilities;
  onSave?: (definition: QueryDefinition, answer: QueryAnswer) => void;
  saveLabel?: string;
}) {
  const composer = createQueryComposer({ ...props.capabilities, initial: props.initial, schema: () => props.schema });
  const [sqlOpen, setSqlOpen] = createSignal(false);
  const [proposalSqlOpen, setProposalSqlOpen] = createSignal(false);
  const [displayMode, setDisplayMode] = createSignal<'scalar' | 'table'>(props.initial.displayMode);
  const answer = () => composer.isCurrentPreview() ? composer.preview()?.answer : undefined;
  const busy = () => composer.phase() !== 'idle';

  return <div class="flex min-h-0 flex-col gap-4 p-4" data-database-query-editor>
    <form onSubmit={(event) => { event.preventDefault(); void composer.generate(); }}>
      <label class="mb-2 block text-sm font-medium text-ink" for="database-question">What would you like to know?</label>
      <div class="rounded-lg border border-edge bg-input p-3 transition-colors focus-within:border-accent/60 focus-within:ring-2 focus-within:ring-accent/10">
        <textarea id="database-question" aria-label="Ask your database" class="min-h-12 w-full resize-none bg-transparent text-sm text-ink outline-none placeholder:text-ink-placeholder" placeholder="e.g. How many projects are still in progress?" value={composer.prompt()} onInput={(event) => composer.setPrompt(event.currentTarget.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void composer.generate(); } }} />
        <div class="flex items-center justify-between gap-2">
          <span class="flex items-center gap-1.5 text-[11px] text-ink-muted"><SparkleIcon class="size-3.5" /> Ask in your own words</span>
          <Button type="submit" size="sm" disabled={!composer.prompt().trim() || busy()}><Show when={composer.phase() === 'generating'} fallback={<>Draft answer <ArrowUpIcon class="size-3.5" /></>}>Thinking…</Show></Button>
        </div>
      </div>
    </form>
    <Show when={!composer.preview() && !composer.proposal()}>
      <div class="flex flex-wrap gap-1.5"><For each={queryStarters(props.schema)}>{(starter) => <button type="button" class="rounded-md border border-edge-muted px-2.5 py-1.5 text-xs text-ink-muted transition-colors hover:bg-hover hover:text-ink disabled:opacity-50" disabled={busy()} onClick={() => void composer.useStarter(starter)}>{starter.label}</button>}</For></div>
    </Show>
    <Show when={composer.proposal()}>{(proposal) => <div class="rounded-lg border border-accent/25 bg-accent/5 p-3">
      <div class="mb-1 flex items-center gap-1.5 text-xs font-medium text-accent"><SparkleIcon class="size-3.5" /> Proposed answer</div>
      <p class="text-sm leading-relaxed text-ink">{proposal().explanation}</p>
      <button type="button" class="mt-2 text-xs text-ink-muted hover:text-ink" onClick={() => setProposalSqlOpen(!proposalSqlOpen())}>{proposalSqlOpen() ? 'Hide SQL' : 'Inspect SQL'}</button>
      <Show when={proposalSqlOpen()}><pre class="mt-2 max-h-32 overflow-auto whitespace-pre-wrap rounded bg-input p-2 text-xs text-ink">{proposal().sql}</pre></Show>
      <div class="mt-3 flex items-center gap-2"><Button size="sm" onClick={() => void composer.acceptProposal()} disabled={busy()}>Use this answer</Button><Button variant="ghost" size="sm" onClick={composer.discardProposal} disabled={busy()}>Discard</Button></div>
    </div>}</Show>
    <div class="flex items-center justify-between">
      <button type="button" class="flex items-center gap-1.5 text-xs text-ink-muted hover:text-ink" aria-expanded={sqlOpen()} onClick={() => setSqlOpen(!sqlOpen())}><CodeIcon class="size-3.5" /> {sqlOpen() ? 'Hide SQL' : 'Write or edit SQL'}</button>
      <Show when={composer.sql().trim() && !composer.proposal()}><Button variant="ghost" size="sm" disabled={busy()} onClick={() => void composer.run()}><PlayIcon class="size-3.5" />{composer.phase() === 'running' ? 'Running…' : 'Run query'}</Button></Show>
    </div>
    <Show when={sqlOpen()}><div><SqlEditor value={composer.sql()} schema={props.schema} onChange={composer.setSql} onRun={() => void composer.run()} /><p class="mt-1.5 text-[11px] text-ink-muted">Read-only SQLite · ⌘ / Ctrl + Enter to run</p></div></Show>
    <Show when={composer.error()}>{(message) => <p role="alert" class="rounded-md border border-failure-ink/20 bg-failure-ink/5 px-3 py-2 text-sm text-failure-ink">{message()}</p>}</Show>
    <Show when={composer.phase() === 'running'}><p role="status" class="text-xs text-ink-muted">Finding your answer…</p></Show>
    <Show when={composer.preview()}>{(preview) => <div class="space-y-3">
      <div class="flex items-center justify-between text-xs"><span class="font-medium text-ink">Answer preview</span><span class="text-ink-muted">{composer.isCurrentPreview() ? 'Up to date' : 'SQL changed · run again'}</span></div>
      <div classList={{ 'opacity-50': !composer.isCurrentPreview() }}><QueryResults answer={preview().answer} /></div>
      <Show when={answer() && props.onSave}>
        <div class="flex flex-wrap items-center justify-between gap-2 border-t border-edge-muted pt-3">
          <div class="flex gap-1 rounded-md bg-hover p-0.5" aria-label="Display answer as">
            <Show when={isScalarAnswer(preview().answer)}><button class="rounded px-2 py-1 text-xs" classList={{ 'bg-panel text-ink shadow-sm': displayMode() === 'scalar', 'text-ink-muted': displayMode() !== 'scalar' }} onClick={() => setDisplayMode('scalar')}>Number chip</button></Show>
            <button class="rounded px-2 py-1 text-xs" classList={{ 'bg-panel text-ink shadow-sm': displayMode() === 'table' || !isScalarAnswer(preview().answer), 'text-ink-muted': displayMode() !== 'table' && isScalarAnswer(preview().answer) }} onClick={() => setDisplayMode('table')}>Result table</button>
          </div>
          <Button size="sm" onClick={() => props.onSave?.({ databaseId: props.schema.databaseId, sql: composer.sql().trim(), prompt: composer.prompt().trim(), displayMode: isScalarAnswer(preview().answer) ? displayMode() : 'table' }, preview().answer)}>{props.saveLabel ?? 'Save question'}</Button>
        </div>
      </Show>
    </div>}</Show>
  </div>;
}
