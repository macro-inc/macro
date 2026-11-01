Search within the user's requested entities. macro.documents.search returns document handles; macro.email.search returns email threads. SearchOpts selects searchOn: 'name', 'content', or 'name_content'. These SDK iterators auto-paginate when the backend returns a cursor. Explicitly bound work; record when you stop before exhaustion. Do not carry over the old tool response's {results} wrapper or its fixed no-cursor contract.

```javascript
export async function main({macro}) {
  const queries = ['launch decision', 'release readiness'];
  const outcomes = await Promise.allSettled(queries.map(async query => {
    const evidence = [];
    let stoppedEarly = false;
    for await (const document of macro.documents.search(query, {searchOn:'content'})) {
      if (evidence.length === 5) { stoppedEarly = true; break; }
      evidence.push({id:document.id, text:(await document.content()).slice(0,3000)});
    }
    return {query,evidence,stoppedEarly};
  }));
  return {data: outcomes.map((item,index) => item.status === 'fulfilled'
    ? item.value : {query:queries[index],error:String(item.reason)}), reviews:[]};
}
```
Preserve useful evidence from each query. A short sample cannot establish corpus-wide completeness or absence. Use precise terms, metadata and relevant reads before expanding breadth. Do not swallow rejected branches. Normal for/while/for-await with break and sequential dependent calls are supported.
