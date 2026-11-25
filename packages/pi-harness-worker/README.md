# Offline Pi headless session proof

Run from this directory.

```sh
bun install --frozen-lockfile --ignore-scripts
bun run check
```

The install uses the registry. The tests run with a synthetic home and
project, an empty environment except for fixture settings, no dotenv
loading, and the Pi native in-process fake provider. The test-only TypeScript
paths resolve the starter-agent composer and its Muppet source from the
checkout. The Bun versions tested print a directory-mismatch diagnostic for
`--tsconfig-override` while resolving these paths successfully.

The successful case asserts that Pi sends the real pinned composition in
the system preamble, the request and event in user content, and the lone
allowed tool to the fake provider. The parent stand-in validates the attempt
and record, derives a fake action ID independently of the provider call ID,
and returns a synthetic tool result. The two provider responses make one
turn with one tool call and one streamed reply. The fixture records a
normalized token count, synthetic receipt, and in-memory checkpoint.

The cancellation case waits for one fixture child to start, invalidates the
attempt at the parent, then calls `session.abort()`. The tool's Pi signal
kills the child and the test waits for reaping and checks for `ESRCH`. The
parent rejects the wrong epoch before cancel and the previously active
attempt after cancel. The final state records cancellation, unknown usage,
and an unresolved synthetic receipt. Pi finishes the tool-call response
before executing the tool, so cancellation happens during tool execution.

## Artifact and runtime evidence

The npm tarballs' computed SHA-512 SRI values match the registry and this
package's Bun lockfile.

| Artifact | SHA-512 SRI |
| --- | --- |
| `@earendil-works/pi-coding-agent@1.6.1` | `sha512-+VSb95N4PB+G7TLceg7wkbJT31BEeIBnUT9500g9a1rOsCx78CUw1YFGtLcRhS6jj8pdfm0fFwrakrMLu6lVAQ==` |
| `@earendil-works/pi-ai@1.6.1` | `sha512-EyorgVyA2s4MxNl7YOapzOpdxrc8HUgxHEIOo8QRMK35P7PCOsSiWzMLf6ixKl3/obkg7I3wGJWHq+FdbUz43g==` |
| `@earendil-works/pi-agent-core@1.6.1` | `sha512-1pkZKTaO1sSY0xVw/W45ULLQRg0rOOt6oJdeTG06upAeIq1UGHA0o+MR9UN6efPi7yW48uVinlFId7fwQilxvg==` |

The release tag is `ef4a1cfcca62b77ad3558337ff3e1c7f6beeadfe`. The diff
against the inspected source `d3f8d7545b9fb039c26be7e3edb05297c83548a6`
covers 40 files across the three upstream packages, including OpenAI
Completions and CLI changes outside the exercised path. The shipped source
maps for the SDK, session, model runtime, extension and resource loaders,
fake provider, in-memory credential store, event stream, agent, and loop
match both revisions. The pinned API takes `noTools: 'all'` with an explicit
`tools` allowlist. An empty custom resource loader bypasses discovery.
`ModelRuntime.create` takes in-memory credentials and `modelsPath: null`,
and the fixture disables initial and network catalog refresh. After session
creation, fake-provider registration schedules a local availability refresh
of built-in providers. This makes an existence check for Google application
default credentials under the synthetic home. The file is absent and the
proof uses no live credentials.

On Linux with user namespaces and `strace`, rerun cold import through
teardown with network isolation and trace the test and child.

```sh
unshare -Urn strace -f -s 300 -e trace=%file,%network,%process \
  -o /tmp/pi-harness-offline.trace bash run-offline.sh
unshare -Urn strace -f -s 300 -e trace=%file,%network,%process \
  -o /tmp/pi-harness-cold.trace bash run-offline.sh -t cold-loads
```

Bun 1.3.13 and 1.4.2 both passed. Between the test Bun's `execve` and exit,
the traces show no home or project Pi config probes, no project instructions
or MCP config opens, and no network socket or connection calls. The fixture
runner writes and removes the synthetic config files outside that interval.
The cold-only trace stops before fake-provider registration and shows no
default credential file probe either. The full trace shows the direct tool
child killed and reaped on both versions.

This checks two host Bun binaries with the installed dependency graph.
Pi declares Node >=22.19.0 and ships a dependency graph that includes
provider and MCP packages, native TUI addons, Photon WASM, and QuickJS WASI.
Guest packaging, general module and tool compatibility, cold start and RSS,
and any production filesystem or process-tree sandbox still need evidence.
The transport and parent stand-in are in-process. Provider wire parsing,
live credentials, real authorization, durable checkpoint/recovery,
and teardown of arbitrary descendant trees are outside this proof.
