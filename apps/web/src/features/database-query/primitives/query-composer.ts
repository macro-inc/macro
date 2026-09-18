import { createSignal, onCleanup } from 'solid-js';
import type { QueryComposerOptions } from '../context/query-context';
import { looksLikeReadQuery, queryErrorMessage, type QueryAnswer, type QueryProposal } from '../core/query';

/** Owns the propose → review → preview workflow; generation never runs a query. */
export function createQueryComposer(options: QueryComposerOptions) {
  const [prompt, setPromptSignal] = createSignal(options.initial.prompt);
  const [sql, setSqlSignal] = createSignal(options.initial.sql);
  const [proposal, setProposal] = createSignal<QueryProposal>();
  const [phase, setPhase] = createSignal<'idle' | 'generating' | 'running'>('idle');
  const [error, setError] = createSignal<string>();
  const [preview, setPreview] = createSignal<{ sql: string; answer: QueryAnswer }>();
  let revision = 0;
  onCleanup(() => revision++);

  const edit = () => { revision++; setPhase('idle'); setProposal(undefined); setError(undefined); };
  const setPrompt = (value: string) => { edit(); setPromptSignal(value); };
  const setSql = (value: string) => { edit(); setSqlSignal(value); };

  const generate = async () => {
    if (!prompt().trim() || phase() !== 'idle') return;
    const generation = ++revision;
    setPhase('generating'); setError(undefined); setProposal(undefined);
    try {
      const next = await options.generate({ prompt: prompt().trim(), sql: sql(), schema: options.schema() });
      if (generation === revision) setProposal(next);
    } catch (caught) {
      if (generation === revision) setError(queryErrorMessage(caught));
    } finally {
      if (generation === revision) setPhase('idle');
    }
  };

  const run = async () => {
    const statement = sql().trim();
    if (!statement || phase() !== 'idle') return;
    if (!looksLikeReadQuery(statement)) {
      setError('Questions only read your data. Start with SELECT, or ask a question above.');
      return;
    }
    const execution = ++revision;
    setPhase('running'); setError(undefined);
    try {
      const answer = await options.read(statement);
      if (execution === revision) setPreview({ sql: statement, answer });
    } catch (caught) {
      if (execution === revision) { setPreview(undefined); setError(queryErrorMessage(caught)); }
    } finally {
      if (execution === revision) setPhase('idle');
    }
  };

  return {
    prompt, sql, proposal, phase, error, preview, setPrompt, setSql, generate, run,
    isCurrentPreview: () => preview()?.sql === sql().trim(),
    discardProposal: () => setProposal(undefined),
    acceptProposal: async () => {
      const next = proposal();
      if (!next) return;
      setSql(next.sql);
      await run();
    },
    useStarter: async (starter: { prompt: string; sql: string }) => {
      setPrompt(starter.prompt); setSql(starter.sql); await run();
    },
  };
}
