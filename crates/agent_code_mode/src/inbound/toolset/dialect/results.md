# What a program returns

A program's return value is the result's `data`. To show the person drafts or images, return code mode's result shape instead, `{data, reviews, images}`, with no other keys; any other object is all data.

- Reviews are editable email or calendar drafts the person sends from a card. Create one with `tools.agent_harness.create_session_review({path: {session_id: context.sessionId}, body: {kind, title, drafts, executionId: context.executionId}})`: `kind` is `email` or `calendar`, and each draft has the SendEmail or CreateCalendarEvent arguments (an email: `to: [{email, name}]`, `subject`, a Markdown `body`, optional `cc`, `bcc`, `replyingToId` and `from`). Return `reviews: [{kind, id}]` with the id it returns. Creating a review sends nothing; the person acts on the card later.
- Images: render a canvas with `tools.storage.render_canvas({path: {document_id}, body: {}})` and return `images: [{id: rendered.fileId}]`, at most two; you see their pixels with the result.
- Views show the person what the program made, changed or found: `tools.agent_harness.present_session_view({path: {session_id: context.sessionId}, body: {view, executionId: context.executionId}})`, with `view` in the PresentView schema of ExecuteCode's description. It is drawn at once and returns nothing to act on.

```js
// Draft a follow-up email for the person to review and send.
const review = await tools.agent_harness.create_session_review({
  path: { session_id: context.sessionId },
  body: {
    kind: "email",
    title: "Follow-up",
    executionId: context.executionId,
    drafts: [{ to: [{ email: "dana@example.com" }], subject: "Next steps", body: "Thanks for today. Here is what we agreed." }],
  },
});
return { data: { reviewId: review.id }, reviews: [{ kind: "email", id: review.id }] };
```
