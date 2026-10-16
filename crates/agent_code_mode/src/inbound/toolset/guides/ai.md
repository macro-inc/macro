macro.ai.decide({input,questions}) calls the shared Jev endpoint. Ask up to 32 named yes/no questions about supplied JSON/text in one request, within 64 KiB total. It returns {probabilities:{name:number}}. Values estimate yes from 0 to 1; questions need not be exclusive. Classification is not authorization or factual verification.

```javascript
export async function main({macro}) {
  const threads = [];
  for await (const thread of macro.email.inbox({pageSize:4})) {
    threads.push(thread);
    if (threads.length === 4) break;
  }
  const outcomes = await Promise.allSettled(threads.map(async thread => ({
    id:thread.id,
    ...(await macro.ai.decide({input:{subject:await thread.subject()},questions:{urgent:'Does this subject suggest an urgent request?'}}))
  })));
  return {data:outcomes.map((item,index) => item.status === 'fulfilled' ? item.value : {id:threads[index].id,error:String(item.reason)}), reviews:[]};
}
```
For richer classification, fetch the relevant message text first; a subject-only estimate is limited. macro.ai.structuredCompletion uses the existing generic cognition endpoint. Request its complete types via DescribeCodeTools({names:['ai']}); provide model, prompt, output_schema and toolset:{type:'none'} for supplied-context-only generation. Inspect outcome and toolActivity: other toolsets can perform actions. Preserve source IDs and verify extracted facts.
