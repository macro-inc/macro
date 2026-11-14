open Typedtree

type error = { message : string; line : int }

(* What a referenced path resolves to, after module aliases are expanded. *)
type origin =
  | Local  (** defined in the program: its own contents are checked where written *)
  | Sdk
  | Stdlib_toplevel
  | Stdlib_module of string
  | Other_unit of string

type state = {
  sdk : Sdk.t;
  mutable errors : error list;
  mutable operations : (string * int) list;  (** operation name, line *)
  mutable exempt : module_expr list;
      (** module identifiers in a position that only names a module (open,
          toplevel alias, module type of); compared physically *)
}

let line_of (location : Location.t) = location.loc_start.pos_lnum

(* Names main's expected type; a program may not declare it. *)
let main_result_type_name = "__macro_sdk_main_result"

let refuse state location message =
  state.errors <- { message; line = line_of location } :: state.errors

let prefix = "Stdlib__"

let origin_of state path =
  let head = Path.head path in
  if not (Ident.persistent head) then Local
  else
    let name = Ident.name head in
    if List.mem name state.sdk.units then Sdk
    else if name = "Stdlib" then Stdlib_toplevel
    else if String.length name > String.length prefix
            && String.sub name 0 (String.length prefix) = prefix
    then Stdlib_module (String.sub name (String.length prefix) (String.length name - String.length prefix))
    else Other_unit name

(* The components after the compilation unit: Stdlib__Float.Array.get gives
   ["Array"; "get"]. *)
let rec components = function
  | Path.Pident _ -> []
  | Path.Pdot (parent, name) -> components parent @ [ name ]
  | Path.Papply (functor_path, _) -> components functor_path
  | Path.Pextra_ty (parent, _) -> components parent

let display_name = function
  | Stdlib_module name -> name
  | Other_unit name -> name
  | Stdlib_toplevel -> "Stdlib"
  | Sdk -> "the SDK"
  | Local -> "the program"

let attribute_named name (attributes : Parsetree.attributes) =
  List.find_opt (fun (attribute : Parsetree.attribute) -> attribute.attr_name.txt = name) attributes

(* [@@macro.op "tasks.create"]: Some (Ok name); a malformed payload is an
   error, never silently ignored. *)
let operation_attribute attributes =
  match attribute_named "macro.op" attributes with
  | None -> None
  | Some { attr_payload; _ } -> (
      match attr_payload with
      | PStr
          [
            {
              pstr_desc =
                Pstr_eval ({ pexp_desc = Pexp_constant { pconst_desc = Pconst_string (name, _, _); _ }; _ }, _);
              _;
            };
          ] ->
          Some (Ok name)
      | _ -> Some (Error ()))

let is_pure attributes = Option.is_some (attribute_named "macro.pure" attributes)

type value_verdict = Pure | Operation of string | Refused of string

(* Decides one value, given its alias-free path and declaration. *)
let judge_value state path (description : Types.value_description) =
  let attributes = description.val_attributes in
  match (origin_of state path, operation_attribute attributes) with
  | _, Some (Error ()) -> Refused "has a malformed [@@macro.op] attribute"
  | _, Some (Ok name) -> Operation name
  | Local, None -> Pure
  | Sdk, None ->
      if is_pure attributes then Pure
      else Refused "is SDK internals (neither [@@macro.op] nor [@@macro.pure])"
  | Stdlib_toplevel, None -> (
      match Policy.stdlib_value (Path.last path) with
      | Policy.Allowed -> Pure
      | Policy.Refused reason -> Refused reason)
  | Stdlib_module module_name, None -> (
      match Policy.stdlib_module_value module_name (components path) with
      | Policy.Allowed -> Pure
      | Policy.Refused reason -> Refused reason)
  | (Other_unit _ as origin), None ->
      Refused (Printf.sprintf "belongs to %s, which programs may not use" (display_name origin))

let record_operation state location name = state.operations <- (name, line_of location) :: state.operations

let longident_name (lid : Longident.t Location.loc) = String.concat "." (Longident.flatten lid.txt)

let check_value state env location written path description =
  let path = try Env.normalize_value_path (Some location) env path with Not_found -> path in
  match judge_value state path description with
  | Pure -> ()
  | Operation name -> record_operation state location name
  | Refused reason -> refuse state location (Printf.sprintf "`%s` %s" written reason)

(* A module used as a value (functor argument, include, first-class module,
   constraint, nested alias) gives access to its contents without naming
   them. [view] is the signature it is seen through: walk it, look each value
   up in the real module, and judge it as if it were named here. Operations
   found are recorded; the first refused value is reported. *)
let rec check_module_contents state env location written source view =
  let source = try Env.normalize_module_path None env source with Not_found -> source in
  let origin = origin_of state source in
  match origin with
  | Local -> Ok ()
  | Sdk | Stdlib_toplevel | Stdlib_module _ | Other_unit _ -> (
      match Env.scrape_alias env (Mtype.scrape env view) with
      | Types.Mty_signature items -> check_items state env location written source items
      | Types.Mty_functor _ -> (
          match origin with
          | Stdlib_module name when Policy.stdlib_functor_allowed name -> Ok ()
          | _ -> Error (Printf.sprintf "functor `%s` from %s cannot be used here" (Path.name source) (display_name origin)))
      | Types.Mty_ident _ | Types.Mty_alias _ -> Ok ())

and check_items state env location written source items =
  match items with
  | [] -> Ok ()
  | Types.Sig_value (id, _, _) :: rest -> (
      let path = Path.Pdot (source, Ident.name id) in
      let verdict =
        match Env.find_value path env with
        | description -> judge_value state path description
        | exception Not_found -> Pure
      in
      match verdict with
      | Pure -> check_items state env location written source rest
      | Operation name ->
          record_operation state location name;
          check_items state env location written source rest
      | Refused reason ->
          Error (Printf.sprintf "it exposes `%s`, which %s" (Path.name path) reason))
  | Types.Sig_module (id, _, declaration, _, _) :: rest -> (
      match check_module_contents state env location written (Path.Pdot (source, Ident.name id)) declaration.md_type with
      | Ok () -> check_items state env location written source rest
      | Error message -> Error message)
  | Types.Sig_class (id, _, _, _) :: _ ->
      Error (Printf.sprintf "it exposes class `%s`" (Ident.name id))
  | (Types.Sig_type _ | Types.Sig_typext _ | Types.Sig_modtype _ | Types.Sig_class_type _) :: rest ->
      check_items state env location written source rest

let check_module_use state env location written path view =
  match check_module_contents state env location written path view with
  | Ok () -> ()
  | Error message -> refuse state location (Printf.sprintf "`%s` cannot be used as a module here: %s" written message)

(* In a naming-only position (open, toplevel alias) uses are checked where
   they happen; still refuse naming a module programs may not use at all. *)
let check_module_name state env location written path =
  let path = try Env.normalize_module_path None env path with Not_found -> path in
  match origin_of state path with
  | Local | Sdk | Stdlib_toplevel -> ()
  | Stdlib_module name when Policy.stdlib_module_allowed name -> ()
  | (Stdlib_module _ | Other_unit _) as origin ->
      refuse state location (Printf.sprintf "`%s`: %s may not be used by programs" written (display_name origin))

let check_class_path state location written path =
  match origin_of state path with
  | Local -> ()
  | origin -> refuse state location (Printf.sprintf "class `%s` from %s may not be used" written (display_name origin))

let functor_parameter env (functor_expression : module_expr) =
  match Mtype.scrape env (Env.scrape_alias env functor_expression.mod_type) with
  | Types.Mty_functor (Types.Named (_, parameter), _) -> Some parameter
  | _ -> None

let iterator state =
  let default = Tast_iterator.default_iterator in
  let exempt expression = state.exempt <- expression :: state.exempt in
  let is_alias (expression : module_expr) =
    match (expression.mod_desc, expression.mod_type) with
    | Tmod_ident _, Types.Mty_alias _ -> true
    | _ -> false
  in
  (* The type checker wraps functor arguments in an implicit constraint. *)
  let rec module_identifier (expression : module_expr) =
    match expression.mod_desc with
    | Tmod_ident (path, lid) -> Some (expression, path, lid)
    | Tmod_constraint (inner, _, Tmodtype_implicit, _) ->
        exempt expression;
        module_identifier inner
    | _ -> None
  in
  let module_expr sub (expression : module_expr) =
    let handled = List.memq expression state.exempt in
    (match expression.mod_desc with
    | Tmod_ident (path, lid) ->
        if handled then
          check_module_name state expression.mod_env expression.mod_loc (longident_name lid) path
        else
          check_module_use state expression.mod_env expression.mod_loc (longident_name lid) path
            expression.mod_type
    (* An identifier given to a functor, or constrained by a signature, is
       seen only through that signature: check just what it lets through. *)
    | Tmod_apply (functor_expression, argument, _) -> (
        match module_identifier argument with
        | None -> ()
        | Some (identifier, path, lid) -> (
            exempt identifier;
            let view =
              match functor_parameter expression.mod_env functor_expression with
              | Some parameter -> parameter
              | None -> identifier.mod_type
            in
            check_module_use state identifier.mod_env identifier.mod_loc (longident_name lid) path view))
    | Tmod_constraint (inner, view, _, _) when not handled -> (
        match module_identifier inner with
        | None -> ()
        | Some (identifier, path, lid) ->
            exempt identifier;
            check_module_use state identifier.mod_env identifier.mod_loc (longident_name lid) path view)
    | _ -> ());
    default.module_expr sub expression
  in
  let open_declaration sub (declaration : open_declaration) =
    (match declaration.open_expr.mod_desc with Tmod_ident _ -> exempt declaration.open_expr | _ -> ());
    default.open_declaration sub declaration
  in
  let module_type sub (module_type : module_type) =
    match module_type.mty_desc with
    (* module type of M only reads types *)
    | Tmty_typeof _ -> ()
    | _ -> default.module_type sub module_type
  in
  let expr sub (expression : expression) =
    (match expression.exp_desc with
    | Texp_ident (path, lid, description) ->
        check_value state expression.exp_env expression.exp_loc (longident_name lid) path description
    | Texp_letmodule (_, _, _, module_expression, _) when is_alias module_expression -> exempt module_expression
    | Texp_letop { let_; ands; _ } ->
        List.iter
          (fun (operator : binding_op) ->
            check_value state expression.exp_env operator.bop_loc operator.bop_op_name.txt operator.bop_op_path
              operator.bop_op_val)
          (let_ :: ands)
    | Texp_new (path, lid, _) -> check_class_path state expression.exp_loc (longident_name lid) path
    | _ -> ());
    default.expr sub expression
  in
  let class_expr sub (expression : class_expr) =
    (match expression.cl_desc with
    | Tcl_ident (path, lid, _) -> check_class_path state expression.cl_loc (longident_name lid) path
    | _ -> ());
    default.class_expr sub expression
  in
  let class_type sub (class_type : class_type) =
    (match class_type.cltyp_desc with
    | Tcty_constr (path, lid, _) -> check_class_path state class_type.cltyp_loc (longident_name lid) path
    | _ -> ());
    default.class_type sub class_type
  in
  let value_description sub (description : value_description) =
    if description.val_prim <> [] then
      refuse state description.val_loc "external declarations are not allowed";
    default.value_description sub description
  in
  { default with module_expr; open_declaration; module_type; expr; class_expr; class_type; value_description }

(* A toplevel `module X = M` cannot be captured by a bigger module (nothing
   can reference the program's own unit), so uses of X are checked through
   the alias instead. *)
let exempt_toplevel_aliases state (structure : structure) =
  List.iter
    (fun item ->
      match item.str_desc with
      | Tstr_module { mb_expr = { mod_desc = Tmod_ident _; mod_type = Types.Mty_alias _; _ } as expression; _ } ->
          state.exempt <- expression :: state.exempt
      | _ -> ())
    structure.str_items

(* Attributes and extension nodes live in the parse tree; any a ppx or the
   compiler would give meaning to beyond the allowed list is refused. *)
let check_parse_tree state structure =
  let default = Ast_iterator.default_iterator in
  let attribute sub (attribute : Parsetree.attribute) =
    if not (Policy.attribute_allowed attribute.attr_name.txt) then
      refuse state attribute.attr_loc (Printf.sprintf "attribute [@%s] is not allowed" attribute.attr_name.txt);
    default.attribute sub attribute
  in
  let type_declaration sub (declaration : Parsetree.type_declaration) =
    if declaration.ptype_name.txt = main_result_type_name then
      refuse state declaration.ptype_loc
        (Printf.sprintf "the type name %s is reserved for checking main" main_result_type_name);
    default.type_declaration sub declaration
  in
  let extension sub ((name, _) as extension : Parsetree.extension) =
    refuse state name.loc (Printf.sprintf "extension node [%%%s] is not allowed" name.txt);
    default.extension sub extension
  in
  let iterator = { default with attribute; type_declaration; extension } in
  iterator.structure iterator structure

let main_check_file = "<main check>"

(* Put around the program so the type checker proves main's type. The type
   is named before the program runs, so a local module called Macro cannot
   change what it means. *)
let main_check source =
  let lexbuf = Lexing.from_string source in
  Location.init lexbuf main_check_file;
  Parse.implementation lexbuf

let main_result_type = main_check "type __macro_sdk_main_result = Macro.Json.t"
let main_type_check = main_check "let _ : unit -> __macro_sdk_main_result = main"

let error_of_exception exception_ =
  match Location.error_of_exn exception_ with
  | Some (`Ok report) ->
      let location = report.main.loc in
      if location.loc_start.pos_fname = main_check_file then
        { message = "the program must define `let main () : Macro.Json.t = ...`"; line = 1 }
      else { message = Format.asprintf "%a" Format_doc.Doc.format report.main.txt; line = line_of location }
  | Some `Already_displayed | None -> { message = Printexc.to_string exception_; line = 1 }

let silent = Format.make_formatter (fun _ _ _ -> ()) ignore

let setup (sdk : Sdk.t) ~filename =
  Clflags.include_dirs := [ sdk.directory ];
  Clflags.hidden_include_dirs := sdk.dependency_directories;
  Clflags.no_std_include := false;
  (* The caller's directory is not on the search path: a stray .cmi there
     must not stand in for the SDK or the standard library. *)
  Clflags.no_cwd := true;
  Clflags.open_modules := [];
  Clflags.all_ppx := [];
  Clflags.unsafe := false;
  Clflags.recursive_types := false;
  ignore (Warnings.parse_options false "-a");
  Location.formatter_for_warnings := silent;
  (* Without this the compiler adds +unix, +dynlink and +threads on demand. *)
  Compmisc.init_path ~auto_include:Load_path.no_auto_include ();
  Env.set_current_unit (Unit_info.make ~check_modname:false ~source_file:filename Unit_info.Impl "user_program");
  Compmisc.initial_env ()

let sorted_errors errors =
  List.sort_uniq (fun a b -> compare (a.line, a.message) (b.line, b.message)) errors

let program (sdk : Sdk.t) ~filename source =
  let state = { sdk; errors = []; operations = []; exempt = [] } in
  match
    let env = setup sdk ~filename in
    let lexbuf = Lexing.from_string source in
    Location.init lexbuf filename;
    let structure = Parse.implementation lexbuf in
    check_parse_tree state structure;
    let typed, _, _, _, _ = Typemod.type_structure env (main_result_type @ structure @ main_type_check) in
    typed
  with
  | exception exception_ -> Error (sorted_errors (error_of_exception exception_ :: state.errors))
  | typed -> (
      exempt_toplevel_aliases state typed;
      let walker = iterator state in
      walker.structure walker typed;
      let operations =
        List.sort_uniq compare (List.map fst state.operations)
        |> List.filter_map (fun name ->
               match Sdk.find_operation sdk name with
               | Some operation -> Some operation
               | None ->
                   let line = List.assoc name state.operations in
                   refuse state Location.none (Printf.sprintf "operation %s is not in operations.json" name);
                   state.errors <-
                     (match state.errors with
                     | error :: rest -> { error with line } :: rest
                     | [] -> []);
                   None)
      in
      match state.errors with [] -> Ok operations | errors -> Error (sorted_errors errors))

let to_json result =
  match result with
  | Ok operations ->
      `Assoc
        [
          ("ok", `Bool true);
          ( "operations",
            `List
              (List.map
                 (fun (operation : Sdk.operation) ->
                   `Assoc
                     [
                       ("name", `String operation.name);
                       ("group", `String operation.group);
                       ("action", `String operation.action);
                     ])
                 operations) );
        ]
  | Error errors ->
      `Assoc
        [
          ("ok", `Bool false);
          ( "errors",
            `List
              (List.map
                 (fun error -> `Assoc [ ("message", `String error.message); ("line", `Int error.line) ])
                 errors) );
        ]
