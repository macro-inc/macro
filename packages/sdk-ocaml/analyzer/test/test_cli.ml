(* The CLI's output formats and exit codes. *)

let exe = Sys.argv.(1)
let failures = ref 0

let check name ok =
  Printf.printf "%s %s\n" (if ok then "ok  " else "FAIL") name;
  if not ok then incr failures

let run arguments =
  let output = Filename.temp_file "macro_sdk_calls" ".out" in
  let code =
    Sys.command
      (Filename.quote_command exe arguments ~stdout:output ~stderr:Filename.null)
  in
  let text = In_channel.with_open_bin output In_channel.input_all in
  Sys.remove output;
  (code, text)

let cmt name = Printf.sprintf "corpus/.corpus.objs/byte/%s.cmt" name
let root = [ "--root"; "../.." ]

let member name = function
  | `Assoc fields -> List.assoc name fields
  | _ -> failwith ("not an object, looking for " ^ name)

let () =
  (let code, text = run ([ "--json" ] @ root @ [ cmt "probe" ]) in
   let json = Yojson.Safe.from_string text in
   check "json: exit 0" (code = 0);
   check "json: status ok" (member "status" json = `String "ok");
   match member "operations" json with
   | `List [ contacts; storage ] ->
       check "json: sorted by service"
         (member "service" contacts = `String "contacts"
         && member "service" storage = `String "storage");
       check "json: operation and path"
         (member "operation" storage = `String "create_task_handler"
         && member "path" storage
            = `String "Macro_sdk.Storage.create_task_handler");
       check "json: method and route"
         (member "method" storage = `String "POST"
         && member "route" storage = `String "/documents/create_task");
       check "json: location"
         (match member "locations" storage with
         | `List [ location ] ->
             member "file" location = `String "analyzer/test/corpus/probe.ml"
             && member "line" location = `Int 11
             && member "via" location = `String "reference"
         | _ -> false)
   | _ -> check "json: two operations" false);
  (let code, text = run ([ "--json" ] @ root @ [ cmt "code_mode_task" ]) in
   let json = Yojson.Safe.from_string text in
   check "json: a parameter is {} in the route"
     (code = 0
     &&
     match member "operations" json with
     | `List [ _; markdown ] ->
         member "operation" markdown = `String "get_document_markdown"
         && member "route" markdown = `String "/documents/{}/markdown"
     | _ -> false));
  (let code, text = run ([ "--json" ] @ root @ [ cmt "functor_parameter" ]) in
   let json = Yojson.Safe.from_string text in
   check "json: a module use is marked"
     (code = 0
     &&
     match member "operations" json with
     | `List [ operation ] -> (
         match member "locations" operation with
         | `List [ location ] -> member "via" location = `String "module"
         | _ -> false)
     | _ -> false));
  (let code, text = run (root @ [ cmt "direct" ]) in
   check "text: exit 0" (code = 0);
   check "text: one operation"
     (text
    = "contacts get_contacts (Macro_sdk.Contacts.get_contacts)\n\
      \  analyzer/test/corpus/direct.ml:2:14\n"));
  (let code, text = run ([ "--json" ] @ root @ [ cmt "sneaky2" ]) in
   let json = Yojson.Safe.from_string text in
   check "refused: exit 1" (code = 1);
   check "refused: status and no operations"
     (member "status" json = `String "cannot_analyze"
     &&
     match json with
     | `Assoc fields -> not (List.mem_assoc "operations" fields)
     | _ -> false));
  (let code, text = run (root @ [ cmt "sneaky2" ]) in
   check "refused: text"
     (code = 1 && String.starts_with ~prefix:"cannot analyze:\n" text));
  (let code, _ = run [ "missing.cmt" ] in
   check "missing file: exit 2" (code = 2));
  (let code, _ = run [] in
   check "no file: exit 2" (code = 2));
  (let code, _ = run ([ "-I"; "/nonexistent" ] @ [ cmt "direct" ]) in
   check "SDK not on the load path: exit 2" (code = 2));
  if !failures > 0 then exit 1
