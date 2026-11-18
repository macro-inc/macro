export async function main({ macro, run, trigger, knobs }: StepContext) {
  if (trigger.kind !== 'event' || !trigger.item.call) return { added: 0 };
  const call = trigger.item.call;
  const transcript: string[] = call.transcript ?? [];
  if (transcript.length === 0) return { added: 0 };
  const { outcome } = await macro.ai.structuredCompletion({
    model: 'google/gemini-3.8-flash',
    thinking: 'low',
    toolset: { type: 'none' },
    prompt: JSON.stringify({ title: call.title, participants: call.participants, transcript }),
    additional_instructions:
      'List the decisions made on this call: what was decided, who owns it, and its due date if one was said. A decision is something the group settled, not a topic discussed or an idea raised. Answer with an empty list when nothing was decided.',
    output_schema: {
      name: 'Decisions',
      schema: {
        type: 'object',
        properties: {
          decisions: {
            type: 'array',
            items: {
              type: 'object',
              properties: { decision: { type: 'string' }, owner: { type: 'string' }, due: { type: 'string' } },
              required: ['decision'],
            },
          },
        },
        required: ['decisions'],
      },
    },
  });
  if (outcome.status !== 'completed') throw new Error(`The call couldn't be read: ${outcome.reason}`);
  const { decisions = [] } = outcome.result as {
    decisions?: { decision: string; owner?: string; due?: string }[];
  };
  if (decisions.length === 0) return { added: 0 };
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: run.timezone }).format(new Date(run.at));
  const entry = [
    `## ${day} · ${call.title ?? 'Call'}`,
    decisions
      .map(({ decision, owner, due }) => `- ${decision}${owner ? ` (${owner}${due ? `, due ${due}` : ''})` : ''}`)
      .join('\n'),
  ].join('\n\n');
  let log;
  let seen = 0;
  for await (const document of macro.documents.search(knobs.log, { searchOn: 'name' })) {
    if ((await document.name()) === knobs.log) {
      log = document;
      break;
    }
    if (++seen === 20) break;
  }
  if (!log) {
    await macro.documents.create({ name: knobs.log, markdown: entry });
    return { added: decisions.length };
  }
  // Newest first, without overwriting an edit made while this ran.
  for (let attempt = 0; attempt < 3; attempt++) {
    const { markdown, revision } = await log.contentWithRevision();
    try {
      await log.setContent(`${entry}\n\n${markdown}`, { expectedRevision: revision });
      return { added: decisions.length };
    } catch (error) {
      if (!(error instanceof Error) || error.name !== 'DocumentChangedError') throw error;
    }
  }
  throw new Error(`"${knobs.log}" kept changing while this ran. Run the routine again.`);
}
