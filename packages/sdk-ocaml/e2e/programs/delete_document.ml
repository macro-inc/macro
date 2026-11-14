(* Deletes a document: the analysis lists storage.delete_document (action
   destroy), so rules that block destroy refuse this program before it runs. *)

let main () : Macro.Json.t =
  let deleted = Macro.Storage.delete_document ~document_id:"doc-1" () in
  Macro.Json.obj [ ("deleted", Macro.Json.bool deleted.success) ]
