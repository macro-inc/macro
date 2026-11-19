(* Every operation of the generated SDK has a permission group and action in
   agent permissions' registry (crates/agent_permission_registry/
   registry.json), and the registry names no operation the SDK no longer
   has. The key is the analyzer's: service and operationId. The registry's
   README (its crate's AGENTS.md) says how to classify a new operation. *)

module Analyze = Macro_sdk_analyzer.Analyze

let registry_file = "../../crates/agent_permission_registry/registry.json"
let actions = [ "create"; "read"; "update"; "destroy"; "send" ]
let failures = ref 0

let fail fmt =
  Printf.ksprintf
    (fun message ->
      incr failures;
      print_endline ("FAIL " ^ message))
    fmt

let () =
  let file = Filename.concat (Sys.getenv "DUNE_SOURCEROOT") registry_file in
  let json = Yojson.Safe.from_file file in
  let open Yojson.Safe.Util in
  let groups =
    json |> member "groups" |> to_list
    |> List.map (fun group -> group |> member "id" |> to_string)
  in
  let registry =
    json |> member "operations" |> to_assoc
    |> List.concat_map (fun (service, operations) ->
        to_assoc operations
        |> List.map (fun (operation, entry) -> ((service, operation), entry)))
  in
  (* Yojson keeps a duplicated key twice; Rust's reader keeps the last one,
     so a second line would silently win there. *)
  let keys = List.map fst registry in
  List.iter
    (fun (service, operation) ->
      if List.length (List.filter (( = ) (service, operation)) keys) > 1 then
        fail "%s %s: classified more than once" service operation)
    (List.sort_uniq compare keys);
  let sdk =
    List.sort_uniq compare
      (List.map
         (fun (o : Analyze.operation) -> (o.service, o.operation))
         Analyze.operations)
  in
  List.iter
    (fun (service, operation) ->
      if not (List.mem_assoc (service, operation) registry) then
        fail
          "%s %s: not classified; add it to %s \
           (crates/agent_permission_registry/AGENTS.md)"
          service operation registry_file)
    sdk;
  List.iter
    (fun ((service, operation), entry) ->
      if not (List.mem (service, operation) sdk) then
        fail "%s %s: in the registry, but the SDK has no such operation" service
          operation;
      let group = entry |> member "group" |> to_string in
      let action = entry |> member "action" |> to_string in
      if not (List.mem group groups) then
        fail "%s %s: unknown group %S" service operation group;
      if not (List.mem action actions) then
        fail "%s %s: unknown action %S" service operation action)
    registry;
  Printf.printf "%d SDK operations, %d classified, %d failures\n"
    (List.length sdk) (List.length registry) !failures;
  if !failures > 0 then exit 1
