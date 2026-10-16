Import Handlebars directly from "handlebars". Rendering is local and makes no API call. For Markdown email bodies, noEscape:true preserves Markdown; use the default escaping for HTML. Use data from the user's request or fetched sources, not invented recipients.

```javascript
import Handlebars from 'handlebars';
export async function main({execution}) {
  const render = Handlebars.compile('Hi {{name}},\n\nHere is the launch update.', {strict:true,noEscape:true});
  const review = await execution.reviews.create({
    kind:'email', title:'Launch updates',
    drafts:[{subject:'Launch update',body:render({name:'Alex'}),to:[{email:'alex@example.com',name:'Alex'}],cc:[],bcc:[],attachments:[]}]
  });
  return {data:{prepared:1},reviews:[await review.reference()]};
}
```
This creates an editable review, not a sent email. A stack accepts 1–100 drafts. Use real user-approved recipients when preparing actual messages. The UI can edit each item, send one, send all pending items or dismiss. Completed items cannot be submitted twice. Calendar reviews use the same saved-entity lifecycle; discover agentSessions for their contracts.
