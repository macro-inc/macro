(* The duplicate-check example as an OCaml program against the generated
   client: create the task only when no existing task is a likely
   duplicate. It calls the endpoints behind the TypeScript SDK's
   [Task.findSimilar] and [tasks.create] (packages/sdk/src/entities/tasks/task.ts):
   - storage.task_similarity_search_handler, POST /documents/similarity_search
   - storage.create_task_handler, POST /documents/create_task *)

open Macro.Storage

let main () : Macro.Json.t =
  let title = "Fix login redirect loop" in
  let body = "Signing in from a deep link returns to the login page." in
  let similar =
    task_similarity_search_handler ~body:(Types.make_task_similarity_search_request ~task_name:title ~markdown:body ()) ()
  in
  let duplicates = List.filter (fun (r : Types.task_similarity_result) -> r.vector_score >= 0.85) similar.results in
  match duplicates with
  | _ :: _ ->
      Macro.Json.obj
        [
          ("created", Macro.Json.null);
          ( "duplicates",
            Macro.Json.list
              (List.map
                 (fun (r : Types.task_similarity_result) ->
                   Macro.Json.obj
                     [
                       ("id", Macro.Json.string r.task_id);
                       ("name", Macro.Json.string r.task_name);
                       ("similarity", Macro.Json.float r.vector_score);
                     ])
                 duplicates) );
        ]
  | [] ->
      let created = create_task_handler ~body:(Types.make_create_task_request ~task_name:title ~markdown:body ()) () in
      Macro.Json.obj
        [
          ("created", Macro.Json.obj [ ("id", Macro.Json.string created.document_id); ("name", Macro.Json.string title) ]);
          ("duplicates", Macro.Json.list []);
        ]
