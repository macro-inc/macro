export async function main({ macro, run, trigger, knobs }: StepContext) {
  if (trigger.kind !== 'event' || !trigger.item.email?.from?.email || !trigger.item.message_id) {
    return { draft: null };
  }
  const email = trigger.item.email;
  const thread = macro.email.byId(trigger.item.entity_id);
  // A new reply draft would replace one already on the thread: that one is the owner's.
  if ((await thread.drafts()).length > 0) return { draft: null };
  const { probabilities } = await macro.ai.decide({
    input: { subject: email.subject, from: email.from, to: email.to, body: email.body },
    questions: { needsReply: knobs.needsReply },
  });
  if ((probabilities.needsReply ?? 0) < 0.5) return { draft: null };
  if (run.dryRun) return { draft: null, wouldDraft: true };
  const earlier = [];
  for (const message of await thread.messages({ limit: 8 })) {
    earlier.push({ from: await message.from(), sentAt: await message.sentAt(), body: String((await message.body()) ?? '').slice(0, 4000) });
  }
  const { outcome } = await macro.ai.structuredCompletion({
    model: 'google/gemini-3.8-flash',
    thinking: 'low',
    toolset: { type: 'none' },
    prompt: JSON.stringify({
      me: (await macro.users.me()).email(),
      thread: earlier,
      replyTo: { subject: email.subject, from: email.from, body: email.body },
    }),
    additional_instructions: `Write the body of my reply to "replyTo", as me. ${knobs.style} Plain text only: no subject line and no signature. Use only what the thread says. Where the reply needs a fact the thread does not give, write [fill in: what is missing] instead of inventing it.`,
    output_schema: {
      name: 'Reply',
      schema: { type: 'object', properties: { body: { type: 'string' } }, required: ['body'] },
    },
  });
  if (outcome.status !== 'completed') throw new Error(`The reply couldn't be written: ${outcome.reason}`);
  const body = (outcome.result as { body?: string }).body?.trim();
  if (!body) return { draft: null };
  // Making a reply draft replaces one already there: look again, now that AI has taken its time,
  // through a new handle, since `thread` keeps the detail it read first.
  if ((await macro.email.byId(trigger.item.entity_id).drafts()).length > 0) return { draft: null };
  const subject = String(email.subject ?? '');
  const draft = await macro.email.createDraft(
    {
      subject: /^re:/i.test(subject) ? subject : `Re: ${subject}`,
      to: [{ email: email.from.email, name: email.from.name }],
      bodyText: body,
      thread,
      replyingTo: macro.email.message(trigger.item.message_id),
    },
    await thread.link(),
  );
  return { draft: draft.id };
}
