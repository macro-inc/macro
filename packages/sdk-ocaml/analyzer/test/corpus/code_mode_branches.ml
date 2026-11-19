(* expect: contacts.get_contacts storage.create_task_handler storage.task_similarity_search_handler *)
(* A code-mode program with a helper, a result match and a branch that may
   never run: every operation it names counts, taken or not. *)
open Macro_sdk

let similar macro title =
  match
    Macro_sdk_fetch.call macro
      (Storage.task_similarity_search_handler ~task_name:title ())
  with
  | Ok { results } ->
      List.map
        (fun (task : Storage.task_similarity_result) -> task.task_name)
        results
  | Error error -> failwith (Macro_sdk_runtime.Error.to_string error)

let () =
  Code_mode.run @@ fun { macro; session_id; _ } ->
  let title = "Fix login redirect" in
  let created =
    match similar macro title with
    | [] ->
        let task =
          Macro_sdk_fetch.call_exn macro
            (Storage.create_task_handler ~task_name:title ())
        in
        Some task.document_id
    | _ :: _ -> None
  in
  let contacts =
    (Macro_sdk_fetch.call_exn macro (Contacts.get_contacts ())).contacts
  in
  `Assoc
    [
      ( "data",
        `Assoc
          [
            ( "created",
              match created with Some id -> `String id | None -> `Null );
            ("contacts", `Int (List.length contacts));
            ( "session",
              match session_id with Some id -> `String id | None -> `Null );
          ] );
    ]
