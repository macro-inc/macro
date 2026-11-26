export async function main({ macro, run, trigger }: StepContext) {
  if (trigger.kind !== 'event' || !trigger.item.call) return { document: null };
  const call = trigger.item.call;
  let transcript: unknown[] = call.transcript ?? [];
  if (transcript.length === 0) return { document: null };
  if (run.dryRun) return { document: null, wouldWrite: true };
  if (call.transcript_omitted) {
    // The event holds only the start of a long call: read the rest.
    const segments = (await macro.calls.byId(trigger.item.entity_id).transcript()) ?? [];
    let room = 120_000;
    transcript = [];
    for (const segment of segments) {
      if ((room -= segment.content.length) < 0) break;
      transcript.push({ speaker: segment.speakerId, text: segment.content });
    }
    if (transcript.length === 0) return { document: null };
    // Say where it stops, so the cut transcript is not read as the whole call.
    if (transcript.length < segments.length) {
      transcript.push({ speaker: 'Macro', text: 'The rest of this call is too long to include.' });
    }
  }
  const { outcome } = await macro.ai.structuredCompletion({
    model: 'google/gemini-3.8-flash',
    thinking: 'low',
    toolset: { type: 'none' },
    prompt: JSON.stringify({
      me: (await macro.users.me()).email(),
      title: call.title,
      participants: call.participants,
      transcript,
    }),
    additional_instructions:
      'Recap this call from its transcript: what was decided, what is still open, and each action item with who owns it and when it is due. Give a due date only when one was said, and an empty string otherwise. Put anything the transcript leaves unclear under "open" instead of guessing. Decisions and commitments only, not a play-by-play.',
    output_schema: {
      name: 'Recap',
      schema: {
        type: 'object',
        properties: {
          decisions: { type: 'array', items: { type: 'string' } },
          open: { type: 'array', items: { type: 'string' } },
          actions: {
            type: 'array',
            items: {
              type: 'object',
              properties: { owner: { type: 'string' }, action: { type: 'string' }, due: { type: 'string' } },
              required: ['owner', 'action', 'due'],
            },
          },
        },
        required: ['decisions', 'open', 'actions'],
      },
    },
  });
  if (outcome.status !== 'completed') throw new Error(`The recap couldn't be written: ${outcome.reason}`);
  const recap = outcome.result as {
    decisions?: string[];
    open?: string[];
    actions?: { owner: string; action: string; due: string }[];
  };
  const list = (items: string[]) => (items.length > 0 ? items.map((item) => `- ${item}`).join('\n') : '- None');
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: run.timezone }).format(new Date(run.at));
  const document = await macro.documents.create({
    name: `Recap: ${call.title ?? 'Call'} (${day})`,
    markdown: [
      '## Decided',
      list(recap.decisions ?? []),
      '## Still open',
      list(recap.open ?? []),
      '## Who does what',
      list((recap.actions ?? []).map(({ owner, action, due }) => `${owner}: ${action}${due ? ` (due ${due})` : ''}`)),
    ].join('\n\n'),
  });
  return { document: document.id };
}
