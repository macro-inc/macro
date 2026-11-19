OCaml programs (language: "ocaml"). Everything above describes JavaScript, the default; pass language "ocaml" to run an OCaml program written against the OCaml SDK instead. Source is one file, main.ml, compiled to WebAssembly and run in the same sandbox with the same limits and acting_as account. Call Code_mode.run exactly once, at top level, with a function from the run's context ({macro; session_id; execution_id; web_app_url}) to a Yojson.Safe.t; return `Assoc [("data", <JSON>)], the same {data} result as JavaScript (no reviews or views). Send each request with Macro_sdk_fetch.call_exn macro (a request from Macro_sdk.<Service>.<operation> ...) for its reply, or Macro_sdk_fetch.call for a result; an exception ends the run with its message. Available modules: Stdlib, Macro_sdk, Macro_sdk_runtime, Macro_sdk_fetch, Code_mode and Yojson; no external, Obj, Marshal, input_value/output_value, Camlinternal*, Unix or Sys.command, and Sys or Stdlib only by name (Sys.time), opened or renamed (module S = Sys), never behind a signature, functor argument or first-class module. A compile error names main.ml:<line>:<column>.

```ocaml
open Macro_sdk

let () =
  Code_mode.run @@ fun { macro; _ } ->
  let task =
    Macro_sdk_fetch.call_exn macro
      (Storage.create_task_handler ~task_name:"Fix login redirect loop"
         ~markdown:"Signing in from a deep link returns to the login page." ())
  in
  let body =
    Macro_sdk_fetch.call_exn macro
      (Storage.get_document_markdown ~document_id:task.document_id ())
  in
  `Assoc
    [ ("data", `Assoc [ ("taskId", `String task.document_id); ("markdown", `String body.markdown) ]) ]
```
