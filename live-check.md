# Live check of #11068 / #11069 on a local full stack

- #11069 head: `c6da999d8cc7c4437c5baa9203edf696ba2d5deb` (#11068 head `2d16c1d417a011c9fb5a6887e8c9a2e1527da12e`).
- Stack build: integration `97e32ba9d31`, which carries #11069 at the older head `3d43c2140ed` (the `egress_for`/Job hook of the current head arrives through #10477) on a base with the realm-hardening work; local data only, real model calls (Sonnet 5.5, about $0.35 in total).
- Stand-ins: the feature-flag service is a local stand-in (no real flag was touched): users whose id contains `proof` get the egress proxy and enforce flags on, users containing `shadow` get the proxy only. TLS trust uses the local dev CA. Test users are fresh local accounts.

All three runs are the Macro agent's `ExecuteCode` tool running a program the prompt supplies verbatim.

## 1. Enforce: a request that is no SDK operation is refused (`enforce-chat-run.png`)

```ts
export async function main({ hosts }: any) {
  const r = await fetch(hosts.cognition + "/not-an-operation", { method: "DELETE" });
  return { status: r.status, body: (await r.text()).slice(0, 300) };
}
```
Result returned by the program:
```
{"status":403,"body":"DELETE /cognition/not-an-operation isn't an operation of Macro's SDK, so this run can't send it. Use the macro SDK's methods instead of building requests by hand; DescribeCodeTools and ReadCodeDocs list them."}
```

## 2. Shadow: the same program is only recorded and still forwarded (`shadow-chat-run.png`)

Same program, user with the proxy flag on and enforce off. The host answered:
```
{"status":404,"body":""}
```
(The host's own answer: the request was forwarded.)

## 3. A channel-mention run (enforce on)

The user mentions the agent in their channel with the same kind of program.

- `POST {hosts.calendar}/scheduling/public/proof/intro/book` returned 403: `POST /scheduling/public/proof/intro/book isn't an operation of Macro's SDK, so this run can't send it. ...`
- `GET {hosts.unfurl}/unfurl?url=https://example.com` returned 403: `GET /unfurl was sent without the run's credential, so this run can't send it. Call the macro SDK, which adds it.`

Both are refused, but as `unknown_operation` and `no_credential`, not `anonymous_outward`: a scoped run is refused those routes as `anonymous_outward` before anything else, and the unfurl host was present in the run's hosts. So on this stack the mention run was not scoped in the forwarder; reported to the owner of the mention work.

## Not observed

- The forwarder's span fields (`would_refuse`, `outcome`): the stack has no trace backend and the harness logs only events, so the shadow run's recorded `would_refuse` is covered by the unit tests, not seen here.
- A Job or other scoped run's `anonymous_outward` refusal: no run on the stack was scoped (see 3).
- No video was recorded for this check.
