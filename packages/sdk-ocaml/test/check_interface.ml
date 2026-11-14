(* Walk the compiled interface of [Macro] and check it against
   operations.json: every value carries exactly one of [@@macro.op] and
   [@@macro.pure], and the [@@macro.op] values are exactly the listed
   operations, each at its listed OCaml path. *)

let attribute_payload (attribute : Parsetree.attribute) =
  match attribute.attr_payload with
  | PStr
      [
        {
          pstr_desc =
            Pstr_eval ({ pexp_desc = Pexp_constant { pconst_desc = Pconst_string (s, _, _); _ }; _ }, _);
          _;
        };
      ] ->
      Some s
  | _ -> None

let () =
  let cmi_path = Sys.argv.(1) and operations_path = Sys.argv.(2) in
  let cmi = Cmi_format.read_cmi cmi_path in
  let ops = Hashtbl.create 1024 in
  let pure = ref 0 and errors = ref [] in
  let error message = errors := message :: !errors in
  let rec walk path (signature : Types.signature) =
    List.iter
      (function
        | Types.Sig_value (id, description, _) -> (
            let name = String.concat "." (List.rev (Ident.name id :: path)) in
            let op =
              List.filter_map
                (fun (a : Parsetree.attribute) ->
                  if a.attr_name.txt = "macro.op" then Some (attribute_payload a) else None)
                description.val_attributes
            in
            let is_pure =
              List.exists
                (fun (a : Parsetree.attribute) -> a.attr_name.txt = "macro.pure")
                description.val_attributes
            in
            match (op, is_pure) with
            | [ Some operation ], false ->
                if Hashtbl.mem ops operation then error ("two bindings for " ^ operation);
                Hashtbl.replace ops operation name
            | [], true -> incr pure
            | _ -> error (name ^ ": needs exactly one of [@@macro.op \"...\"] and [@@macro.pure]"))
        | Types.Sig_module (id, _, { md_type = Mty_signature inner; _ }, _, _) ->
            walk (Ident.name id :: path) inner
        (* An alias, named module type or functor would hide its values from
           this walk, so the generated interface must not contain one. *)
        | Types.Sig_module (id, _, _, _, _) ->
            error
              (String.concat "." (List.rev (Ident.name id :: path))
              ^ ": submodule type is not a literal signature")
        | _ -> ())
      signature
  in
  walk [ "Macro" ] cmi.cmi_sign;
  let listed =
    Yojson.Safe.from_file operations_path
    |> Yojson.Safe.Util.member "operations" |> Yojson.Safe.Util.to_list
  in
  List.iter
    (fun entry ->
      let field name = Yojson.Safe.Util.(member name entry |> to_string) in
      let operation = field "name" and ocaml = field "ocaml" in
      match Hashtbl.find_opt ops operation with
      | None -> error ("no [@@macro.op] binding for " ^ operation)
      | Some path when path <> ocaml -> error (Printf.sprintf "%s: bound at %s, listed at %s" operation path ocaml)
      | Some _ -> ())
    listed;
  if Hashtbl.length ops <> List.length listed then
    error
      (Printf.sprintf "%d [@@macro.op] bindings for %d operations in operations.json" (Hashtbl.length ops)
         (List.length listed));
  match !errors with
  | [] -> Printf.printf "%d [@@macro.op] bindings, one per operation; %d [@@macro.pure] values\n" (Hashtbl.length ops) !pure
  | errors ->
      List.iter prerr_endline (List.rev errors);
      exit 1
