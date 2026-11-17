(* Code mode's policy check for an OCaml program, run on the typed tree
   ocamlc -bin-annot leaves in its .cmt. Defense in depth only: the
   boundary is Deno's permissions around the program's WebAssembly.

     code_mode_policy main.cmt

   Prints one line per finding, <file>:<line>:<column>: <message>, and
   exits 1 when there is any, 0 when there is none, 2 when the file is not
   an implementation's .cmt.

   A program may not declare an external, use Obj, Marshal, Sys.command,
   input_value or output_value (unmarshalling by another name), the
   compiler's internal Camlinternal modules, the JavaScript interop
   (Js_of_ocaml, Jsoo_runtime) or Unix. Values are matched by path and by
   the unit that declared them, so local aliases and opens still name
   them. A module that declares a forbidden value (Sys, Stdlib) may be
   used only as a path prefix (Sys.time), opened, or given another name
   (module S = Sys); any other use of it as a module (a signature
   constraint, a functor argument, a first-class module, an include)
   could rename the value behind a signature the program writes, so it is
   refused, and so is any coerced module whose type still holds such a
   value. Binding Stdlib itself to a module is refused too. Every check
   is a rule below, applied to the paths and declarations the iterator
   visits, so a fuller analyzer can replace this one without changing its
   callers. *)

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
  | _ when starts_with "Camlinternal" || starts_with "Stdlib__Camlinternal" ->
      Some "Camlinternal* (the compiler's internals)"
  | _ when starts_with "Js_of_ocaml" || starts_with "Jsoo_runtime" ->
      Some "the JavaScript interop (Js_of_ocaml)"
  | _ -> None

let forbidden_value unit names =
  match (unit, names) with
  | "Stdlib__Sys", [ "command" ] -> Some "Sys.command"
  | "Stdlib", [ "input_value" ] -> Some "input_value (unmarshalling)"
  | "Stdlib", [ "output_value" ] -> Some "output_value (marshalling)"
  | _ -> forbidden_unit unit

(* The units that declare a forbidden value, by the name a program knows
   them by. *)
let holds_forbidden_value = function
  | "Stdlib__Sys" -> Some "Sys"
  | "Stdlib" -> Some "Stdlib"
  | _ -> None

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
  (* One finding per position: the first rule that matched there. *)
  let same_position (file, line, column, _) =
    let f, l, c, _ = finding in
    file = f && line = l && column = c
  in
  if not (List.exists same_position !findings) then
    findings := finding :: !findings

let check_module_path loc path =
  match unit_of_path path with
  | Some (unit, _) -> (
      match forbidden_unit unit with
      | Some what -> report loc (not_allowed what)
      | None -> ())
  | None -> ()

(* A value's path as its unit and the names after it (Stdlib.Sys.command
   is Stdlib__Sys, [command]; input_value, with Stdlib open, is Stdlib,
   [input_value]). *)
let value_site path =
  match path with
  | Path.Pdot (prefix, name) -> (
      match unit_of_path prefix with
      | Some (unit, names) -> Some (unit, names @ [ name ])
      | None -> None)
  | _ -> None

(* The rule a value breaks, judged by where it was declared, whatever
   local alias or signature reached it. *)
let forbidden_declaration name (value : Types.value_description) =
  match value.val_uid with
  | Item { comp_unit; _ } | Compilation_unit comp_unit ->
      forbidden_value comp_unit [ name ]
  | Internal | Predef _ -> None

let check_value_path loc path (value : Types.value_description) =
  (match value_site path with
  | Some (unit, names) -> (
      match forbidden_value unit names with
      | Some what -> report loc (not_allowed what)
      | None -> ())
  | None -> ());
  match forbidden_declaration (Path.last path) value with
  | Some what -> report loc (not_allowed what)
  | None -> ()

let binds_stdlib path =
  match unit_of_path path with
  | Some ("Stdlib", []) -> true
  | Some _ | None -> false

(* Local modules that are other names for a unit holding a forbidden
   value (module S = Sys), with that unit's name. *)
let aliases : (Ident.t * string) list ref = ref []

(* The unit holding a forbidden value that a module path names, if any:
   Sys, Stdlib.Sys, Stdlib, or a local alias of one. Sys.Immediate64 is
   not Sys. *)
let holder_of_path path =
  match path with
  | Path.Pident id when not (Ident.persistent id) -> List.assoc_opt id !aliases
  | _ -> (
      match unit_of_path path with
      | Some (unit, []) -> holds_forbidden_value unit
      | Some _ | None -> None)

(* A forbidden value a module's type still holds, looking through its
   submodules and aliases: what a signature written over it could
   rename. *)
let rec forbidden_in_type depth (mty : Types.module_type) =
  if depth > 16 then None
  else
    match mty with
    | Mty_alias path -> (
        match holder_of_path path with
        | Some holder -> Some (holder ^ " as a submodule")
        | None -> None)
    | Mty_signature items ->
        List.find_map
          (function
            | Types.Sig_value (id, value, _) ->
                forbidden_declaration (Ident.name id) value
            | Sig_module (_, _, md, _, _) ->
                forbidden_in_type (depth + 1) md.md_type
            | _ -> None)
          items
    | Mty_ident _ | Mty_functor _ -> None

(* A module expression whose result the compiler coerces to another
   signature (a constraint, a functor argument, a first-class module):
   refused when its own type holds a forbidden value. *)
let check_coerced (m : module_expr) =
  match m.mod_desc with
  | Tmod_ident (path, _) when Option.is_some (holder_of_path path) ->
      () (* refused where the iterator visits it *)
  | _ -> (
      match forbidden_in_type 0 m.mod_type with
      | Some what ->
          report m.mod_loc (not_allowed (what ^ " behind a signature"))
      | None -> ())

let holder_not_allowed holder =
  not_allowed
    (Printf.sprintf "Using %s as a module (other than %s.name or open %s)"
       holder holder holder)

let iterator =
  let open Tast_iterator in
  let expr it e =
    (match e.exp_desc with
    | Texp_ident (path, _, value) -> check_value_path e.exp_loc path value
    | Texp_new (path, _, _) -> check_module_path e.exp_loc path
    | Texp_pack m -> check_coerced m
    | _ -> ());
    default_iterator.expr it e
  in
  let module_expr it m =
    (match m.mod_desc with
    | Tmod_ident (path, _) -> (
        check_module_path m.mod_loc path;
        if binds_stdlib path then
          report m.mod_loc (not_allowed "Binding Stdlib to a module")
        else
          match holder_of_path path with
          | Some holder -> report m.mod_loc (holder_not_allowed holder)
          | None -> ())
    | Tmod_constraint (inner, _, _, _) -> check_coerced inner
    | Tmod_apply (_, argument, _) -> check_coerced argument
    | _ -> ());
    default_iterator.module_expr it m
  in
  (* module S = Sys gives Sys another name, which the rules then follow;
     module S = Stdlib is refused like any other binding of Stdlib. *)
  let module_binding it (mb : module_binding) =
    match (mb.mb_id, mb.mb_expr.mod_desc) with
    | Some id, Tmod_ident (path, _) when not (binds_stdlib path) -> (
        check_module_path mb.mb_expr.mod_loc path;
        match holder_of_path path with
        | Some holder -> aliases := (id, holder) :: !aliases
        | None -> default_iterator.module_binding it mb)
    | _ -> default_iterator.module_binding it mb
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
    module_binding;
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
