exception Error of { code : string; message : string }

let call request body =
  try Mini_transport.call request body
  with Mini_transport.Call_failed (code, message) -> raise (Error { code; message })

let optional name = function Some text -> [ (name, `String text) ] | None -> []

module Json = struct
  type t = Yojson.Safe.t

  let member name = function
    | `Assoc fields -> Option.value (List.assoc_opt name fields) ~default:`Null
    | _ -> `Null

  let to_list = function `List items -> items | _ -> []

  let to_number = function `Int value -> float_of_int value | `Float value -> value | _ -> nan

  let to_text = function `String text -> text | other -> Yojson.Safe.to_string other
end

module Tasks = struct
  let find_similar ~title ?body () =
    call "POST /storage/documents/similarity_search" (`Assoc (("taskName", `String title) :: optional "markdown" body))

  let create ~name ?markdown () =
    call "POST /storage/documents/create_task" (`Assoc (("taskName", `String name) :: optional "markdown" markdown))
end

module Document = struct
  let path document = "/storage/documents/" ^ Json.to_text document
  let content document = call ("GET " ^ path document) `Null
  let delete document = call ("DELETE " ^ path document) `Null
end
