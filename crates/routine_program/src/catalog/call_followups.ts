export async function main({ macro, run, trigger, knobs }: StepContext) {
  if (trigger.kind !== 'event' || !trigger.item.call) return { draft: null };
  const call = trigger.item.call;
  let transcript: unknown[] = call.transcript ?? [];
  if (transcript.length === 0) return { draft: null };
  if (run.dryRun) return { draft: null, wouldWrite: true };
  if (call.transcript_omitted) {
    // The event holds only the start of a long call: read the rest.
    const segments = (await macro.calls.byId(trigger.item.entity_id).transcript()) ?? [];
    let room = 120_000;
    transcript = [];
    for (const segment of segments) {
      if ((room -= segment.content.length) < 0) break;
      transcript.push({ speaker: segment.speakerId, text: segment.content });
    }
    if (transcript.length === 0) return { draft: null };
    // Say where it stops, so the cut transcript is not read as the whole call.
    if (transcript.length < segments.length) {
      transcript.push({ speaker: 'Macro', text: 'The rest of this call is too long to include.' });
    }
  }
  const me = await macro.users.me();
  const { outcome } = await macro.ai.structuredCompletion({
    model: 'google/gemini-3.8-flash',
    thinking: 'low',
    toolset: { type: 'none' },
    prompt: JSON.stringify({ me: me.email(), title: call.title, participants: call.participants, transcript }),
    additional_instructions: `Decide whether this call needs a follow-up email from me: ${knobs.needsFollowup} If it does, write it as me, to the other people on the call: what we agreed, what I will do and by when, and what I need from them. ${knobs.style} Quote numbers and dates exactly as they were said. Plain text only, no signature. Use only what the transcript says.`,
    output_schema: {
      name: 'Followup',
      schema: {
        type: 'object',
        properties: { needed: { type: 'boolean' }, subject: { type: 'string' }, body: { type: 'string' } },
        required: ['needed', 'subject', 'body'],
      },
    },
  });
  if (outcome.status !== 'completed') throw new Error(`The follow-up couldn't be written: ${outcome.reason}`);
  const followup = outcome.result as { needed?: boolean; subject?: string; body?: string };
  if (!followup.needed || !followup.body?.trim()) return { draft: null };
  // People who joined with a Macro account have an address; guests don't,
  // and the owner adds them before sending.
  const to = [];
  for (const participant of (await macro.calls.byId(trigger.item.entity_id).historicParticipants()) ?? []) {
    const address = macro.users.byId(participant.userId).email();
    if (address && participant.userId !== me.id) to.push({ email: address });
  }
  const draft = await macro.email.createDraft({
    subject: followup.subject?.trim() || `Following up: ${call.title ?? 'our call'}`,
    to,
    bodyText: followup.body.trim(),
  });
  return { draft: draft.id };
}
