(* Every operation in packages/sdk/specs: its request matches the spec, and
   a sample of every declared reply and error body decodes and encodes back
   unchanged. *)

let () =
  (* An Unknown case in a reply built from the spec means a wrong tag or
     enum mapping. *)
  Macro_sdk.Json.strict := true;
  let dir = Filename.concat (Sys.getenv "DUNE_SOURCEROOT") "../sdk/specs" in
  let spec_names =
    Sys.readdir dir |> Array.to_list
    |> List.filter (fun f -> Filename.check_suffix f ".json")
    |> List.map Filename.remove_extension
    |> List.sort compare
  in
  let specs =
    List.map (fun name -> (name, Spec_check.load ~dir name)) spec_names
  in
  let declared =
    List.concat_map
      (fun (name, spec) ->
        List.concat_map
          (fun (path, item) ->
            List.filter_map
              (fun meth ->
                Option.map
                  (fun _ -> (name, meth, path))
                  (Spec_check.member meth item))
              Spec_check.methods)
          (Spec_check.assoc "paths" spec.Spec_check.document))
      specs
  in
  let wire_meth (c : Cases_support.t) =
    match c.wire.wire_meth with
    | `GET -> "get"
    | `POST -> "post"
    | `PUT -> "put"
    | `PATCH -> "patch"
    | `DELETE -> "delete"
  in
  let covered =
    List.map
      (fun (c : Cases_support.t) -> (c.spec, wire_meth c, c.path))
      Cases.all
  in
  let missing = List.filter (fun op -> not (List.mem op covered)) declared in
  List.iter
    (fun (spec, meth, path) ->
      Printf.printf "FAIL %s %s %s: no generated operation\n" spec meth path)
    missing;
  let failed =
    List.filter
      (fun (case : Cases_support.t) ->
        match Spec_check.check (List.assoc case.spec specs) case with
        | [] -> false
        | errors ->
            Printf.printf "FAIL %s %s\n" case.spec case.operation_id;
            List.iter (fun e -> Printf.printf "  %s\n" e) errors;
            true)
      Cases.all
  in
  Printf.printf "%d operations in %d specs: %d checked, %d failed, %d missing\n"
    (List.length declared) (List.length specs) (List.length Cases.all)
    (List.length failed) (List.length missing);
  if failed <> [] || missing <> [] then exit 1
