export async function main({ macro, run, trigger, knobs }: StepContext) {
  if (trigger.kind !== 'event' || !trigger.item.call) return { added: 0 };
  const call = trigger.item.call;
  let transcript: unknown[] = call.transcript ?? [];
  if (transcript.length === 0) return { added: 0 };
  if (run.dryRun) return { added: 0, wouldWrite: true };
  if (call.transcript_omitted) {
    // The event holds only the start of a long call: read the rest.
    const segments = (await macro.calls.byId(trigger.item.entity_id).transcript()) ?? [];
    let room = 120_000;
    transcript = [];
    for (const segment of segments) {
      if ((room -= segment.content.length) < 0) break;
      transcript.push({ speaker: segment.speakerId, text: segment.content });
    }
    if (transcript.length === 0) return { added: 0 };
    // Say where it stops, so the cut transcript is not read as the whole call.
    if (transcript.length < segments.length) {
      transcript.push({ speaker: 'Macro', text: 'The rest of this call is too long to include.' });
    }
  }
  const { outcome } = await macro.ai.structuredCompletion({
    model: 'google/gemini-3.8-flash',
    thinking: 'low',
    toolset: { type: 'none' },
    prompt: JSON.stringify({ title: call.title, participants: call.participants, transcript }),
    additional_instructions:
      'List the decisions made on this call: what was decided, who owns it, and its due date if one was said. Use an empty string for an owner or a due date nobody named. A decision is something the group settled, not a topic discussed or an idea raised. Answer with an empty list when nothing was decided.',
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
              required: ['decision', 'owner', 'due'],
            },
          },
        },
        required: ['decisions'],
      },
    },
  });
  if (outcome.status !== 'completed') throw new Error(`The call couldn't be read: ${outcome.reason}`);
  const { decisions = [] } = outcome.result as {
    decisions?: { decision: string; owner: string; due: string }[];
  };
  if (decisions.length === 0) return { added: 0 };
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: run.timezone }).format(new Date(run.at));
  const entry = [
    `## ${day} · ${call.title ?? 'Call'}`,
    decisions
      .map(({ decision, owner, due }) => {
        const about = [owner, due && `due ${due}`].filter(Boolean).join(', ');
        return about ? `- ${decision} (${about})` : `- ${decision}`;
      })
      .join('\n'),
  ].join('\n\n');
  // Only a document of the owner's own: a teammate's log with the same name is theirs to keep.
  const me = await macro.users.me();
  const logs = [];
  // The search matches part of a name, most relevant first: other documents can rank above the log.
  let seen = 0;
  let exhausted = true;
  for await (const document of macro.documents.search(knobs.log, { searchOn: 'name' })) {
    if ((await document.name()) === knobs.log && (await document.owner())?.id === me.id) logs.push(document);
    if (++seen === 100) {
      exhausted = false;
      break;
    }
  }
  if (logs.length === 0 && !exhausted) {
    // A second log would split the history, so say so rather than make one, even on a first run.
    throw new Error(`Too many documents have "${knobs.log}" in their name to tell whether you already have that log. Give the log a more distinctive name.`);
  }
  if (logs.length > 1) {
    throw new Error(`You have ${logs.length} documents named "${knobs.log}". Rename all but one, or change the document this routine logs to.`);
  }
  const log = logs[0];
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
