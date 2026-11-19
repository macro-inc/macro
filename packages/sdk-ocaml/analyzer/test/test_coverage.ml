(* No SDK operation can be invisible to the analyzer:
   1. the operation table holds exactly the operationIds in ../sdk/specs;
   2. in the SDK's compiled interfaces, the values that can hand out a
      request are exactly the table's operations;
   3. a program naming every operation is analyzed to all of them. *)

module Analyze = Macro_sdk_analyzer.Analyze

let failures = ref 0

let fail fmt =
  Printf.ksprintf
    (fun message ->
      incr failures;
      print_endline ("FAIL " ^ message))
    fmt

let methods =
  [ "get"; "put"; "post"; "delete"; "patch"; "head"; "options"; "trace" ]

let spec_operations () =
  let dir = Filename.concat (Sys.getenv "DUNE_SOURCEROOT") "../sdk/specs" in
  Sys.readdir dir |> Array.to_list
  |> List.filter (fun file -> Filename.check_suffix file ".json")
  |> List.concat_map (fun file ->
      let service = Filename.remove_extension file in
      let member name = function
        | `Assoc fields -> List.assoc_opt name fields
        | _ -> None
      in
      match
        member "paths" (Yojson.Safe.from_file (Filename.concat dir file))
      with
      | Some (`Assoc paths) ->
          List.concat_map
            (fun (_, item) ->
              List.filter_map
                (fun meth ->
                  match
                    Option.bind (member meth item) (member "operationId")
                  with
                  | Some (`String id) -> Some (service, id)
                  | _ -> None)
                methods)
            paths
      | _ -> [])
  |> List.sort_uniq compare

let check_specs () =
  let specs = spec_operations () in
  let table =
    List.sort_uniq compare
      (List.map
         (fun (o : Analyze.operation) -> (o.service, o.operation))
         Analyze.operations)
  in
  List.iter
    (fun (service, id) ->
      if not (List.mem (service, id) table) then
        fail "%s %s: in the specs, not in the table" service id)
    specs;
  List.iter
    (fun (service, id) ->
      if not (List.mem (service, id) specs) then
        fail "%s %s: in the table, not in the specs" service id)
    table;
  Printf.printf
    "%d operationIds in the specs, %d OCaml operations in the table\n"
    (List.length specs)
    (List.length Analyze.operations)

let cmi_files dir =
  Sys.readdir dir |> Array.to_list
  |> List.filter (fun file -> Filename.check_suffix file ".cmi")
  |> List.sort compare
  |> List.map (Filename.concat dir)

(* Values are read through an environment, so their types name other
   units properly and abbreviations expand; submodules are walked too. *)
let check_interfaces () =
  let root = "../.." in
  let dirs =
    List.map (Filename.concat root)
      [
        "generated/.macro_sdk.objs/byte";
        "runtime/.macro_sdk_runtime.objs/byte";
        "eio/.macro_sdk_eio.objs/byte";
      ]
  in
  Clflags.include_dirs := dirs;
  Compmisc.init_path ();
  let env = Compmisc.initial_env () in
  let files = List.concat_map cmi_files dirs in
  let seen = ref [] in
  let rec check_items unit parent items =
    List.iter
      (function
        | Types.Sig_value (id, _, _) -> (
            let name = Ident.name id in
            let path = Path.Pdot (parent, name) in
            let type_ = (Env.find_value path env).val_type in
            let env = lazy env in
            match
              if
                Path.Pdot (Path.Pident (Ident.create_persistent unit), name)
                = path
              then Analyze.operation_of ~unit name
              else None
            with
            | Some operation ->
                seen := operation.path :: !seen;
                if not (Analyze.returns_request ~env type_) then
                  fail "%s is in the table but does not return a request"
                    (Path.name path)
            | None ->
                if Analyze.yields_request ~env type_ then
                  fail "%s can hand out a request but is not in the table"
                    (Path.name path))
        | Types.Sig_module (id, _, { md_type = Mty_signature items; _ }, _, _)
          ->
            check_items unit (Path.Pdot (parent, Ident.name id)) items
        | _ -> ())
      items
  in
  List.iter
    (fun file ->
      let cmi = Cmi_format.read_cmi file in
      check_items cmi.cmi_name
        (Path.Pident (Ident.create_persistent cmi.cmi_name))
        cmi.cmi_sign)
    files;
  List.iter
    (fun (operation : Analyze.operation) ->
      if not (List.mem operation.path !seen) then
        fail "%s: in the table, not in the interfaces" operation.path)
    Analyze.operations;
  Printf.printf "%d interfaces checked\n" (List.length files)

let check_all_operations_program () =
  let root = Filename.concat (Sys.getcwd ()) "../.." in
  match
    Analyze.cmt ~root "all/.all_operations.objs/byte/all_operations.cmt"
  with
  | Error message -> fail "all_operations: %s" message
  | Ok (Cannot_analyze _) -> fail "all_operations: cannot analyze"
  | Ok (Analyzed found) ->
      let paths =
        List.map (fun (f : Analyze.found) -> f.operation.path) found
      in
      List.iter
        (fun (operation : Analyze.operation) ->
          if not (List.mem operation.path paths) then
            fail "%s: named but not found" operation.path)
        Analyze.operations;
      if List.length found <> List.length Analyze.operations then
        fail "all_operations: found %d of %d" (List.length found)
          (List.length Analyze.operations);
      Printf.printf "a program naming all %d operations: %d found\n"
        (List.length Analyze.operations)
        (List.length found)

(* A parameter can reach a sibling literal route; its rivals name it, and
   a more specific route's rivals still list the parameter route it shares
   paths with. *)
let check_rivals () =
  let find service operation =
    List.find
      (fun (o : Analyze.operation) ->
        o.service = service && o.operation = operation)
      Analyze.operations
  in
  let get_document = find "storage" "get_document" in
  if
    not
      (List.mem
         ("storage", "/documents/system_skills")
         (Analyze.rivals get_document))
  then fail "rivals: get_document does not list /documents/system_skills";
  if List.mem ("storage", get_document.route) (Analyze.rivals get_document) then
    fail "rivals: get_document lists its own route";
  List.iter
    (fun (service, route) ->
      if String.split_on_char '/' route |> List.length <> 3 then
        fail "rivals: get_document lists %s %s, of another length" service route)
    (Analyze.rivals get_document)

let () =
  check_specs ();
  check_rivals ();
  check_interfaces ();
  check_all_operations_program ();
  if !failures > 0 then (
    Printf.printf "%d failures\n" !failures;
    exit 1)
