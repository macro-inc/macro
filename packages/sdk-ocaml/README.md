# Macro OCaml SDK

A typed OCaml client for every Macro API operation (913 operations across 14
services), generated from the same OpenAPI specs as the TypeScript SDK
(`packages/sdk/specs`).

- `macro_sdk`: request builders, types and JSON codecs. It does no I/O: each
  operation returns a `Request.t` describing the call.
- `macro_sdk_eio`: sends those requests over HTTP(S) with cohttp-eio
  (OCaml 5, direct style, no monad in your code).

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
| Service hosts | `~hosts:[ ("storage", "http://localhost:8086") ]` | the per-environment table in `runtime/config.ml` |
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

## Errors

`Macro_sdk_eio.call` returns `('reply, 'error Error.t) result`:

- `Api { status; error; body }`: a status the operation declares, with its
  JSON error body decoded into `'error`. Operations that declare one error
  shape use that type; operations with different shapes per status get a
  variant (`Conflict of ...`, `Not_found of ...`); operations that declare none
  use the empty type `Request.no_error`.
- `Http { status; body }`: any other non-2xx reply.
- `Decode { status; message; body }`: a 2xx body that does not match the spec.
- `Transport exn`: connection, TLS or protocol failure.

`call_exn` raises `Error.Macro_error` instead.

## How the spec maps to OCaml

- Objects are records; `make_<type>` builds one with optional fields left out.
- A required field the spec allows to be null is `t option` and is sent as
  `null` when `None`. A field that is not required is `t option` and is left
  out when `None`. On the way in, absent and null both decode to `None`, as
  serde does.
- `oneOf` with a tag property (any name: `type`, `kind`, `action`, ...,
  including the `allOf: [$ref, {tag}]` form and `discriminator` mappings) is a
  variant whose constructors carry inline records or the referenced type.
  Externally tagged unions (`"stop"` or `{"start": {...}}`) and untagged ones
  (a string or an object, say) are variants too; untagged members are tried in
  spec order.
- String enums and tagged unions are open: a value this SDK version does not
  know decodes to `Unknown`, so a newer server does not break decoding.
- `allOf` merges into one record; a union inside it becomes a flattened field.
- Maps (`additionalProperties`) are `(string * t) list`; `int64` fields are
  `int64`; other integers are `int`.
- Operations with several 2xx shapes reply with a variant by status
  (`Ok_ of ...`, `Accepted`, ...). Raw request bodies are `~body:string`
  (sent with the spec's content type), multipart parts are labelled string
  arguments, and non-JSON replies are returned as `string`.

### What stays untyped, and why

`Yojson.Safe.t` appears only where the spec allows any JSON: 100 places,
listed with their JSON pointers in `generated/untyped.txt`. 65 are values the
spec gives no type at all (`serde_json::Value` on the Rust side), 34 are
free-form objects (no properties), and 1 is an object with no properties.
Typing them needs a schema in the Rust service, not a generator change.

## Regenerate

The generator is OCaml in `gen/`: it lowers each spec to a small IR, builds
the OCaml Parsetree with ppxlib (`Ast_builder` and metaquot), prints it with
`Pprintast` and formats it with ocamlformat. It stops with the JSON pointer of
any schema or operation it cannot emit.

After `packages/sdk/specs` changes (see `packages/sdk/AGENTS.md`):

```sh
nix-shell shell.nix --run "just generate && dune test"
```

and commit `generated/`. `dune test` includes a drift check that regenerates
into a temporary directory and fails if `generated/` differs, and a test that
calls every operation with sample arguments and checks the request and every
declared reply against the spec.
