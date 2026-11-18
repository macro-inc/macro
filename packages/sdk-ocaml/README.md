# Macro OCaml SDK

A typed OCaml client for every Macro API operation (913 operations across 14
services), generated from the same OpenAPI specs as the TypeScript SDK
(`packages/sdk/specs`).

- `macro_sdk`: request builders, types and JSON codecs. It does no I/O: each
  operation returns a `Request.t` describing the call.
- `macro_sdk_eio`: sends those requests over HTTP(S) with cohttp-eio
  (OCaml 5, direct style, no monad in your code).
- `macro_sdk_fetch` (`fetch/`): sends them through JavaScript's `fetch`
  from a program compiled to WebAssembly, for code mode. See
  [WebAssembly transport](#webassembly-transport).
- `code_mode` (`code_mode/`): the program contract for code mode's OCaml
  programs, and the prebuilt bundle they compile against. See
  [Code mode](#code-mode).

## Install

With Nix, from the repository root:

```sh
nix-shell packages/sdk-ocaml/shell.nix --run "cd packages/sdk-ocaml && dune build && dune test"
```

With opam, pin the two packages from a checkout:

```sh
opam pin add macro_sdk packages/sdk-ocaml
opam pin add macro_sdk_eio packages/sdk-ocaml
```

Then depend on `macro_sdk` and `macro_sdk_eio` (and `eio_main`) in your dune
file.

## Example: find similar tasks, or create one

Condensed from `examples/similar_tasks.ml`:

```ocaml
open Macro_sdk

let () =
  Eio_main.run @@ fun env ->
  let macro = Macro_sdk_eio.create (Eio.Stdenv.net env) in
  match Macro_sdk_eio.call macro (Storage.task_similarity_search_handler ~task_name:"Fix login redirect" ()) with
  | Error error -> prerr_endline (Error.to_string error)
  | Ok { results = _ :: _ as similar } ->
      List.iter (fun (task : Storage.task_similarity_result) -> print_endline task.task_name) similar
  | Ok { results = [] } ->
      let created =
        Macro_sdk_eio.call_exn macro
          (Storage.create_task_handler ~task_name:"Fix login redirect" ~markdown:"Users land on a 404 page." ())
      in
      print_endline created.document_id
```

Operation functions are named after the spec's `operationId`
(`create_task_handler` is `POST /documents/create_task`); each one's doc
comment in the `.mli` gives its method and path. When a request body is a
plain record, its fields are the function's labelled arguments: required
fields are `~name`, everything else is an optional `?name` you can leave out.
Other records have a `make_<type> ~required ?optional ()` function.

## Configuration

`Macro_sdk_eio.create` takes an optional `Config.t`; without one it uses
`Config.create ()`, which reads the environment the way the TypeScript SDK
does:

| Setting | Argument | Fallback |
| --- | --- | --- |
| Environment | `~env:Dev \| Prod \| Local` | `MACRO_ENV` (`dev`, `prod`, `local`), then `Prod` |
| Credential | `~auth` | `MACRO_API_KEY` (user key or bearer token) or `MACRO_BOT_TOKEN`; both set is an error |
| Service hosts | `~hosts:[ ("storage", "http://localhost:8086") ]` | the per-environment table in `runtime/config.ml` (the TypeScript SDK's `HOSTS`) |
| Acting user (bots) | `~requested_as` | none |

```ocaml
let config =
  Config.create ~env:Dev
    ~auth:(Config.Auth.user_token "mak_...")   (* or Config.Auth.bot "mbot_..." *)
    ()
```

Auth headers follow `packages/sdk/src/utils/client.ts`: a `mak_` key goes in
`x-macro-user-api-key`, any other user token as `Authorization: Bearer`, and a
bot token as `x-macro-bot-token` with `x-macro-bot-scope` (`user` when acting
for someone, otherwise `team`). With no credential at all, sending a request
raises.

With `Local`, the TypeScript SDK also overlays the local stack's generated
port map (`infra/local/generated/*/portmap.json`); this SDK does not. On a
stack with remapped ports, pass the hosts with `~hosts`.

### HTTPS

`macro_sdk_eio` checks server certificates against the system trust store
(or the `?authenticator` you pass to `create`) and against the host the
request goes to: a DNS name through its certificate names, an IP address
through its IP entries. A host that is neither is refused
(`Unverifiable_host`, reported as a `Transport` error). `test/test_tls.ml`
exercises all of this against a local HTTPS server with a throwaway CA.

Against the dev gateway, with a made-up key (2026-11-14):

```sh
$ MACRO_ENV=dev MACRO_API_KEY=mak_bogus_not_a_real_key \
    ./_build/default/examples/similar_tasks.exe "Fix login redirect"
HTTP 401: {"message":"unauthorized"}
```

That is TLS to `dev-gateway.macro.com`, the `/dss` base path, the
`x-macro-user-api-key` header and the typed `Error.Http` reply working
together; nothing was created.

## Errors

`Macro_sdk_eio.call` (and `Macro_sdk_fetch.call`) returns `('reply, 'error Error.t) result`:

- `Api { status; error; body }`: a status the operation declares, with its
  JSON error body decoded into `'error`. Operations that declare one error
  shape use that type; operations with different shapes per status get a
  variant (`Conflict of ...`, `Not_found of ...`); operations that declare none
  use the empty type `Request.no_error`.
- `Http { status; body }`: any other non-2xx reply.
- `Decode { status; message; body }`: a 2xx body that does not match the spec.
- `Transport exn`: connection, TLS or protocol failure.

`call_exn` raises `Error.Macro_error` instead.

## WebAssembly transport

`macro_sdk_fetch` has the same surface as `macro_sdk_eio` (`create`, `call`,
`call_exn`, the same `Error.t`) for programs compiled with `wasm_of_ocaml`
and run under Deno, as code mode will run OCaml programs. Each call is
`Request.prepare`, one `globalThis.fetch`, then `Request.interpret`: a
rejected `fetch` is a `Transport` error. The call stays direct style: with
`--effects=jspi` a primitive (`fetch/await.wat`, `fetch/await.js`) suspends
the WebAssembly stack until the promise settles, so call it from the
program's own code, never from a JavaScript callback. `fetch/bigstringaf.wat`
supplies the bigstringaf stubs `uri` needs, which the package ships only for
js_of_ocaml.

It builds only in the `wasm` profile, so plain `dune build` never needs
js_of_ocaml or wasm_of_ocaml. Its own build directory keeps the native one
warm:

```sh
nix-shell shell.nix --run "dune build --profile wasm --build-dir _build_wasm @fetch/runtest"
```

The tests (`fetch/test/`) run under Deno 2.9.6, the version code mode runs;
`run.mjs` loads the program, serves a stand-in API and plays code mode's
bootstrap.

### What `fetch` is told

Code mode's bootstrap wraps `globalThis.fetch` to gate a dry run's writes
and add the `x-macro-sdk-verb` header; for OCaml programs it reads the
field below (and gates, marks and reports with it, but sends no verb
header yet). The TypeScript SDK gives it each
call's `{service, operation}` through `gateRequests` and `sendVerbHeaders`
(`packages/sdk/src/utils/activity.ts`). This transport passes the same pair
on the `fetch` call itself, as an extra `init` field a plain `fetch`
ignores:

```js
fetch(url, {
  method, headers: [[name, value], ...], body, // body: Uint8Array, if any
  macroSdkOperation: { service: "contacts", operation: "getContacts" },
});
```

`service` is the spec name and `operation` the TypeScript SDK's method name
(`Macro_sdk_fetch.sdk_method`: the operationId in camelCase), so
`` `${service}.${operation}` `` is the key of `sdkVerbs` and the code-mode
operation catalog. The wrapper may answer with its own `Response` (a skip;
it is decoded as the reply), reject (a refusal; `Error (Transport _)`), or
send the request with headers added. One known gap: cognition declares
`get_state_handler` twice (both reads); both map to `getStateHandler`, where
the TypeScript SDK names the second `getStateHandler2`.

## Code mode

### Program contract

A code-mode OCaml program is one `main.ml` that calls `Code_mode.run` once,
the counterpart of a JavaScript program's `main({macro, session, execution})`:

```ocaml
open Macro_sdk

let () =
  Code_mode.run @@ fun { macro; session_id; execution_id = _; web_app_url = _ } ->
  let reply = Macro_sdk_fetch.call_exn macro (Contacts.get_contacts ()) in
  `Assoc [ ("contacts", `Int (List.length reply.contacts));
           ("session", match session_id with Some id -> `String id | None -> `Null) ]
```

`macro` is a ready `Macro_sdk_fetch.t` with the run's token and every
service host. The value `main` returns becomes the final frame
`{"type":"result","value":...}`; an exception becomes
`{"type":"error","message":...}`, the same frames JavaScript programs end
with. The bootstrap's side (`globalThis.__macroCodeMode`: the context as
JSON, and `finish(frame)`) is specified in `code_mode/code_mode.mli`; code
mode's bootstrap (`crates/code_execution`) implements it. Like `fetch/`, `code_mode`
builds only in the `wasm` profile; its Deno tests (`code_mode/test/`,
`run.mjs` plays the bootstrap with code mode's Deno flags) run with:

```sh
nix-shell shell.nix --run "dune build --profile wasm --build-dir _build_wasm @code_mode/runtest"
```

Programs must not print to stdout: it carries the bootstrap's frames.

### Code mode bundle

Code mode compiles each program against a bundle built once per image, the
`code-mode-ocaml` flake package (`nix/cloud-storage.nix`;
`code_mode/bundle/build.sh` does the work). A build of `code_mode_assets`
with `CODE_MODE_OCAML_DIR` set to it (`code_mode_assets::OCAML_BUNDLE`)
runs OCaml programs: the agent harness's deploy build merges
`codeModeOcamlEnv`, so its image ships the bundle, and CI's Deno suite sets
it too:

| Path | Contents |
| --- | --- |
| `lib/` | wasm_of_ocaml archives (`--effects=jspi`): `runtime.wasma` (with `fetch/`'s `.wat`/`.js`), stdlib, yojson, uri and its dependencies, js_of_ocaml, `macro_sdk_runtime`, `macro_sdk`, `macro_sdk_fetch`, `code_mode`, `std_exit.wasmo`; `link.txt` (link order) and `shapes.txt` (`--load-shape` list) |
| `cmi/` | the interfaces a program may use: the SDK, its runtime, yojson, uri, `Macro_sdk_fetch`, `Code_mode` (not js_of_ocaml) |
| `stdlib/` | the standard library's `.cmi` files (`ocamlc -nostdlib -I stdlib`) |
| `assets/` | the library modules as `wasm_of_ocaml link` names them (`<library>-<content hash>.wasm`, the same for every program), served to every program's loader |
| `bin/` | `ocamlc`, `wasm_of_ocaml`, `wasm-opt`, `wasm-merge`, `wasm-metadce`, and `code_mode_policy` (below) |
| `findlib/` | the one findlib package (`stdlib`) wasm_of_ocaml looks up at start (`OCAMLFIND_CONF`) |
| `compile.sh` | the reference per-program compile |
| `fingerprint` | `<SDK version>+<12 hex of sha256 over cmi/>`, e.g. `0.1.0+65d27fd120f3` |

The fingerprint is the counterpart of the TypeScript SDK's: source that
compiled against one fingerprint compiles against any bundle with the same
one. Compiled Wasm belongs to the bundle (store path) that linked it. The
SDK version is `(version ...)` in `dune-project`.

Per program, `compile.sh <dir>` runs three fixed commands in `<dir>` (no
dune, no ocamlfind), with `PATH` = `bin/` plus coreutils, `TMPDIR` = `<dir>`,
and `/bin/sh` present (wasm_of_ocaml runs binaryen through it):

```sh
ocamlc -nostdlib -I $B/stdlib -I $B/cmi -c main.ml
wasm_of_ocaml compile --effects=jspi --no-sourcemap -o main.wasmo main.cmo --load-shape $B/lib/<each of shapes.txt>
wasm_of_ocaml link --no-sourcemap -o main.js $B/lib/<each of link.txt> main.wasmo $B/lib/std_exit.wasmo
```

then deletes the copies of `assets/` from `main.assets/`, leaving `main.js`,
`main.assets/main-*.wasm`, `start-*.wasm` and `_link_info.wasm`. The loader
reads the rest from `assets/` (see `code_mode/test/run.mjs`, which loads it
without CommonJS or env access).

Code mode (`crates/code_execution`) runs the same commands, with
`-bin-annot` added to `ocamlc`, and between the first two runs
`bin/code_mode_policy main.cmt`: a policy check on the typed tree
(`code_mode/policy/`) that refuses `external` declarations and uses of
`Obj`, `Marshal`, `Sys.command`, `input_value`/`output_value`,
`Camlinternal*`, `Unix` and the JavaScript interop. It guarantees that no
value the program names is one of those, by path or by the unit that
declared it (so aliases and opens still name them). Since only a coercion
to a signature the program writes (constraint, functor argument,
first-class module, `include`) changes a value's declaring unit, it
refuses every coercion whose source module's type, expanded in the
program's own environment through aliases, named module types, submodules
and functor results, holds a forbidden value or `Sys`/`Stdlib` as a
submodule, and every one it cannot expand. `Sys` and `Stdlib` may be used
as a path prefix, opened, or renamed (`module S = Sys`), but not otherwise
as a module, and binding `Stdlib` itself to a module is refused (opening it
is fine). It does not look inside the bundle's libraries, and it refuses
some safe programs (a coerced module holding `Sys` that the signature
hides). It prints `<file>:<line>:<column>: <message>` per finding and exits
1 when there is any. It is defense in depth; Deno's permissions are the
boundary. `dune test` runs its tests (`code_mode/policy/test/`).

`nix build .#checks.x86_64-linux.code-mode-ocaml-sample` (CI: `OCaml SDK
Check`) compiles `code_mode/test/sample.ml` that way and runs it under Deno
2.9.6 with code mode's flags against a stand-in API
(`code_mode/bundle/check.sh`, which prints the timings). On big-pickle,
2026-11-16, median of 11 cold runs: compile 82 ms, spawn to `Code_mode.run`
97 ms, whole run with one call 115 ms. The bundle's closure is 162 MiB
(binaryen 50, glibc 34, the bundle itself 64: `ocamlc`, `wasm_of_ocaml` and
`code_mode_policy` (13 MiB) copied, with their references to the OCaml
installation removed, which would otherwise add 640 MiB).

## How the spec maps to OCaml

- Objects are records; `make_<type>` builds one with optional fields left out.
- A required field the spec allows to be null is `t option` and is sent as
  `null` when `None`. A field that is not required is `t option` and is left
  out when `None`. On the way in, absent and null both decode to `None`, as
  serde does.
- **Limit:** a field that is both optional and nullable is sent as absent for
  `None`; it cannot be sent as an explicit `null`. Most server fields treat
  the two alike, but some update endpoints use "absent" to mean "leave as is"
  and `null` to mean "clear" (`Option<Option<T>>` in the Rust service). From
  this SDK such a field can be set or left alone, not cleared; use the
  TypeScript SDK or a raw request for those clears.
- `oneOf` with a tag property (any name: `type`, `kind`, `action`, ...,
  including the `allOf: [$ref, {tag}]` form and `discriminator` mappings) is a
  variant whose constructors carry inline records or the referenced type.
  Externally tagged unions (`"stop"` or `{"start": {...}}`) and untagged ones
  (a string or an object, say) are variants too; untagged members are tried in
  spec order.
- Every enum and every union kind (tagged, externally tagged, untagged) is
  open: a value this SDK version does not know decodes to `Unknown`, so a
  newer server does not break decoding. Set `Json.strict := true` to make
  those values decode errors instead (the operation tests do).
- `allOf` merges into one record; a union inside it becomes a flattened field.
- Maps (`additionalProperties`) are `(string * t) list`.
- Integers: `format: int64` (including unsigned u64 fields) is `int64`; every
  other integer is `int` (63 bits). A value outside that range, such as a u64
  above 2^63-1 or an unformatted integer above 2^62, is a `Decode` error
  naming the field, never a silently wrong number.
- Operations with several 2xx shapes reply with a variant by status
  (`Ok_ of ...`, `Accepted`, ...). Raw request bodies are `~body:string`
  (sent with the spec's content type). In a multipart body, a binary part takes
  a `Request.file` (`filename`, `content_type`, `data`) and a text part a
  string; each request gets a random boundary that appears in no part, and
  filenames are sent as UTF-8 with only `"` and CR/LF escaped (RFC 7578).
  Non-JSON replies are returned as `string`.

### What stays untyped, and why

`Yojson.Safe.t` appears only where the spec allows any JSON: 100 places,
listed with their JSON pointers in `generated/untyped.txt`. 65 are values the
spec gives no type at all (`serde_json::Value` on the Rust side), 34 are
free-form objects (no properties), and 1 is an object with no properties.
Typing them needs a schema in the Rust service, not a generator change.

## Which operations does a program call?

`analyzer/` is a static analysis tool for programs written against this SDK.
Given one program's typed tree (compile it with `-bin-annot` and pass the
`.cmt`), it lists every operation the program *may* call, keyed by service
and operationId, or says it cannot analyze the program. It evaluates
nothing: a reference anywhere counts, including code that never runs.

```sh
ocamlfind ocamlc -bin-annot -package macro_sdk -c main.ml
dune exec analyzer/bin/macro_sdk_calls.exe -- --json main.cmt
```

```json
{ "status": "ok",
  "operations": [
    { "service": "storage", "operation": "create_task_handler",
      "path": "Macro_sdk.Storage.create_task_handler",
      "locations": [ { "file": "main.ml", "line": 4, "column": 10, "via": "reference" } ] } ] }
```

Without `--json` it prints the same as text. Exit codes: 0 analyzed, 1
cannot analyze (`"status": "cannot_analyze"` with a `reasons` list of
messages and locations, and no operations), 2 usage error. It reads the SDK's
`.cmi` files from the load path recorded in the `.cmt` (relative entries
from `--root DIR`, default the recorded build directory, else the current
directory) or from `-I DIR`; they must be the ones the program was compiled
against.

How it finds operations:

- An operation is a value in a service module whose result is a
  `Request.t`. A build rule reads `generated/*.ml` and records which
  service and operationId each one sends (the OCaml name can differ from the
  operationId).
- Every value the program names is identified by the uid of its
  declaration, so `open`, `let open`, `M.(...)`, module aliases and a
  toplevel `include` all resolve to the SDK value. Partial application,
  passing functions around, helpers and closures are covered because the
  operation is named somewhere.
- A module used as a value (functor argument, first-class module,
  signature constraint, `module rec`, an alias or `include` inside another
  module) counts every operation visible through the signature it is used
  at, or the whole module.

It refuses (cannot analyze) what can reach an operation without naming it:
`external` declarations, `Obj`, `Marshal`, `input_value`, `Camlinternal*`,
`unsafe_*` functions and primitives, `%identity` externals outside the
standard library, programs compiled with `-unsafe`, a `Request.t` built or
updated by hand, and any value outside the table whose type can hand out a
request. It also refuses any reference to a unit outside the standard
library, the SDK, its transports (`Macro_sdk_eio`, code mode's
`Macro_sdk_fetch`), `Code_mode` and the libraries their interfaces expose
(`Analyze.default_libraries`; add more with `--allow-library UNIT`): another
unit of the program, `Dynlink`, `Js_of_ocaml` or a third-party library could
call the SDK where the analysis cannot see. Those libraries are trusted, not
analyzed; `test_trusted` checks that code mode's runtime never names the
generated SDK or builds a request, so a code-mode program's list is exactly
what the program itself names.

The list is the SDK operations the program may call, not a permission
boundary: a program holds its credential (`Config.t` is readable) and can
send raw HTTP through another client, which this tool does not report.

`analyzer/test/corpus/` holds the programs it is tested on, each stating its
expected answer on its first line; `test_coverage` checks that the table
matches the specs and the compiled interfaces, and that a program naming
all 913 operations is analyzed to all of them.
Code-mode programs in the corpus (`code_mode_*.ml`) type-check against
copies of `fetch/` and `code_mode/`'s interfaces
(`analyzer/test/code_mode_interfaces`), since those libraries build only in
the wasm profile.

### Permission classification

Agent permissions classify every operation by a group (Email, Documents &
projects, ...) and an action (create, read, update, destroy, send) in
`crates/agent_permission_registry/registry.json`, keyed by service and
operationId like the analyzer's output. `analyzer/test/test_registry.ml`
fails `dune test` (CI: `OCaml SDK Check`) when an operation in `generated/`
is not classified or the registry names one that no longer exists: after
`just generate` adds an operation, classify it there (that crate's
`AGENTS.md` says how).

## Regenerate

The generator is OCaml in `gen/`: it lowers each spec to a small IR, builds
the OCaml Parsetree with ppxlib (`Ast_builder` and metaquot), prints it with
`Pprintast` and formats it with ocamlformat. It stops with the JSON pointer of
any schema or operation it cannot emit.

After `packages/sdk/specs` changes (see `packages/sdk/AGENTS.md`):

```sh
nix-shell shell.nix --run "just generate && dune test"
```

and commit `generated/`. CI runs `dune build && dune test` in this shell
(`OCaml SDK Check`), then the WebAssembly transport's tests, whenever
`packages/sdk/specs`, the TypeScript SDK's generated methods or this
package changes.
`dune test` includes a drift check that regenerates
into a temporary directory and fails if `generated/` differs, and a test that
calls every operation with sample arguments and checks the request and every
declared reply against the spec.
