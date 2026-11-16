(* Code mode's policy check for an OCaml program, run on the typed tree
   ocamlc -bin-annot leaves in its .cmt. Defense in depth only: the
   boundary is Deno's permissions around the program's WebAssembly.

     code_mode_policy main.cmt

   Prints one line per finding, <file>:<line>:<column>: <message>, and
   exits 1 when there is any, 0 when there is none, 2 when the file is not
   an implementation's .cmt.

   A program may not declare an external, use Obj, Marshal, Sys.command,
   the JavaScript interop (Js_of_ocaml, Jsoo_runtime) or Unix, or bind
   Stdlib itself to a module (which would hide those names from the path
   checks; opening it is fine). Every check is a rule below, applied to the
   paths and declarations the iterator visits, so a fuller analyzer can
   replace this one without changing its callers. *)

open Typedtree

(* The compilation unit a path starts in, and the names after it: Stdlib's
   aliases count as the units they stand for (Stdlib.Obj is Stdlib__Obj). *)
let unit_of_path path =
  match Path.flatten path with
  | `Ok (head, rest) when Ident.persistent head -> (
      match (Ident.name head, rest) with
      | "Stdlib", name :: rest -> Some ("Stdlib__" ^ name, rest)
      | name, rest -> Some (name, rest))
  | `Ok _ | `Contains_apply -> None

(* The rules. Each names what it forbids, by compilation unit and the names
   after it. *)
let forbidden_unit unit =
  let starts_with prefix = String.starts_with ~prefix unit in
  match unit with
  | "Stdlib__Obj" -> Some "Obj"
  | "Stdlib__Marshal" -> Some "Marshal"
  | "Unix" | "UnixLabels" -> Some "Unix"
  | _ when starts_with "Js_of_ocaml" || starts_with "Jsoo_runtime" ->
      Some "the JavaScript interop (Js_of_ocaml)"
  | _ -> None

let forbidden_value unit names =
  match (unit, names) with
  | "Stdlib__Sys", [ "command" ] -> Some "Sys.command"
  | _ -> forbidden_unit unit

let not_allowed what = what ^ " is not allowed in code-mode programs"
let findings = ref []

let report (loc : Location.t) message =
  let position = loc.loc_start in
  let finding =
    ( Filename.basename position.pos_fname,
      position.pos_lnum,
      position.pos_cnum - position.pos_bol + 1,
      message )
  in
  if not (List.mem finding !findings) then findings := finding :: !findings

let check_module_path loc path =
  match unit_of_path path with
  | Some (unit, _) -> (
      match forbidden_unit unit with
      | Some what -> report loc (not_allowed what)
      | None -> ())
  | None -> ()

let check_value_path loc path (value : Types.value_description) =
  (match unit_of_path path with
  | Some (unit, names) -> (
      match forbidden_value unit names with
      | Some what -> report loc (not_allowed what)
      | None -> ())
  | None -> ());
  (* Where the value was declared, whatever local alias reached it. *)
  match value.val_uid with
  | Item { comp_unit; _ } | Compilation_unit comp_unit -> (
      match forbidden_value comp_unit [ Path.last path ] with
      | Some what -> report loc (not_allowed what)
      | None -> ())
  | Internal | Predef _ -> ()

let binds_stdlib path =
  match unit_of_path path with
  | Some ("Stdlib", []) -> true
  | Some _ | None -> false

let iterator =
  let open Tast_iterator in
  let expr it e =
    (match e.exp_desc with
    | Texp_ident (path, _, value) -> check_value_path e.exp_loc path value
    | Texp_new (path, _, _) -> check_module_path e.exp_loc path
    | _ -> ());
    default_iterator.expr it e
  in
  let module_expr it m =
    (match m.mod_desc with
    | Tmod_ident (path, _) ->
        check_module_path m.mod_loc path;
        if binds_stdlib path then
          report m.mod_loc (not_allowed "Binding Stdlib to a module")
    | _ -> ());
    default_iterator.module_expr it m
  in
  (* Opening Stdlib is fine; its module is not visited as a binding. *)
  let open_declaration it (o : open_declaration) =
    match o.open_expr.mod_desc with
    | Tmod_ident (path, _) -> check_module_path o.open_expr.mod_loc path
    | _ -> default_iterator.open_declaration it o
  in
  let open_description _ (o : open_description) =
    check_module_path o.open_loc (fst o.open_expr)
  in
  let module_type it m =
    (match m.mty_desc with
    | Tmty_ident (path, _) | Tmty_alias (path, _) ->
        check_module_path m.mty_loc path
    | _ -> ());
    default_iterator.module_type it m
  in
  let module_substitution it (m : module_substitution) =
    check_module_path m.ms_loc m.ms_manifest;
    default_iterator.module_substitution it m
  in
  let typ it t =
    (match t.ctyp_desc with
    | Ttyp_constr (path, _, _) | Ttyp_class (path, _, _) ->
        check_module_path t.ctyp_loc path
    | _ -> ());
    default_iterator.typ it t
  in
  let pat : type k. iterator -> k general_pattern -> unit =
   fun it p ->
    List.iter
      (fun (extra, loc, _) ->
        match extra with
        | Tpat_open (path, _, _) -> check_module_path loc path
        | _ -> ())
      p.pat_extra;
    default_iterator.pat it p
  in
  let class_expr it c =
    (match c.cl_desc with
    | Tcl_ident (path, _, _) -> check_module_path c.cl_loc path
    | _ -> ());
    default_iterator.class_expr it c
  in
  let class_type it c =
    (match c.cltyp_desc with
    | Tcty_constr (path, _, _) -> check_module_path c.cltyp_loc path
    | _ -> ());
    default_iterator.class_type it c
  in
  let value_description it v =
    if v.val_prim <> [] then
      report v.val_loc (not_allowed "An external declaration");
    default_iterator.value_description it v
  in
  {
    default_iterator with
    expr;
    module_expr;
    open_declaration;
    open_description;
    module_type;
    module_substitution;
    typ;
    pat;
    class_expr;
    class_type;
    value_description;
  }

let () =
  match Sys.argv with
  | [| _; file |] -> (
      match (Cmt_format.read_cmt file).cmt_annots with
      | Implementation structure ->
          iterator.structure iterator structure;
          let sorted =
            List.sort
              (fun (_, l1, c1, _) (_, l2, c2, _) -> compare (l1, c1) (l2, c2))
              !findings
          in
          List.iter
            (fun (file, line, column, message) ->
              Printf.printf "%s:%d:%d: %s\n" file line column message)
            sorted;
          exit (if sorted = [] then 0 else 1)
      | _ ->
          prerr_endline "code_mode_policy: not an implementation's .cmt";
          exit 2)
  | _ ->
      prerr_endline "usage: code_mode_policy <file.cmt>";
      exit 2
