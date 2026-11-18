(* expect: storage.create_task_handler storage.get_document_markdown *)
(* The OCaml example in ExecuteCode's tool text
   (crates/agent_code_mode/src/inbound/toolset/session/ocaml.md). *)
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
    [
      ( "data",
        `Assoc
          [
            ("taskId", `String task.document_id);
            ("markdown", `String body.markdown);
          ] );
    ]
