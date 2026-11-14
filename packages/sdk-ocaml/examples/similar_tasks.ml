(* Look for tasks like a draft, and create it if there are none.
   MACRO_API_KEY=mak_... MACRO_ENV=dev dune exec ./examples/similar_tasks.exe "Fix login redirect" *)

open Macro_sdk

let () =
  let title =
    if Array.length Sys.argv > 1 then Sys.argv.(1) else "Fix login redirect"
  in
  Eio_main.run @@ fun env ->
  let macro = Macro_sdk_eio.create (Eio.Stdenv.net env) in
  match
    Macro_sdk_eio.call macro
      (Storage.task_similarity_search_handler ~task_name:title ())
  with
  | Error error -> prerr_endline (Error.to_string error)
  | Ok { results = _ :: _ as similar } ->
      List.iter
        (fun (task : Storage.task_similarity_result) ->
          Printf.printf "%.2f  %s\n" task.vector_score task.task_name)
        similar
  | Ok { results = [] } ->
      let created =
        Macro_sdk_eio.call_exn macro
          (Storage.create_task_handler ~task_name:title
             ~markdown:"Users land on a 404 page after signing in." ())
      in
      Printf.printf "created %s\n" created.document_id
