export async function main({ macro, run, trigger, knobs }: StepContext) {
  if (trigger.kind !== 'event' || !trigger.item.email?.from?.email || !trigger.item.message_id) {
    return { draft: null };
  }
  const email = trigger.item.email;
  const thread = macro.email.byId(trigger.item.entity_id);
  // Someone the owner has answered in this thread is not a stranger, and a
  // reply draft already there is the owner's own.
  if ((await thread.latestOutboundAt()) || (await thread.drafts()).length > 0) return { draft: null };
  const { probabilities } = await macro.ai.decide({
    input: { subject: email.subject, from: email.from, body: email.body },
    questions: { cold: knobs.isColdOutreach },
  });
  if ((probabilities.cold ?? 0) < 0.5) return { draft: null };
  if (run.dryRun) return { draft: null, wouldDraft: true };
  // Making a reply draft replaces one already there: look again, now that AI has taken its time,
  // through a new handle, since `thread` keeps the detail it read first.
  if ((await macro.email.byId(trigger.item.entity_id).drafts()).length > 0) return { draft: null };
  const subject = String(email.subject ?? '');
  const draft = await macro.email.createDraft(
    {
      subject: /^re:/i.test(subject) ? subject : `Re: ${subject}`,
      to: [{ email: email.from.email, name: email.from.name }],
      bodyText: knobs.reply,
      thread,
      replyingTo: macro.email.message(trigger.item.message_id),
    },
    await thread.link(),
  );
  return { draft: draft.id };
}
