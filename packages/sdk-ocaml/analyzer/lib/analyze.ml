open Typedtree

type operation = { service : string; operation : string; path : string }
type location = { file : string; line : int; column : int }
type via = Reference | Module
type found = { operation : operation; locations : (location * via) list }

type result =
  | Analyzed of found list
  | Cannot_analyze of (string * location) list

(* ---------- the SDK's operations ---------- *)

let unit_prefix = "Macro_sdk__"

let public_path unit value =
  let service_module =
    String.sub unit
      (String.length unit_prefix)
      (String.length unit - String.length unit_prefix)
  in
  String.concat "." [ "Macro_sdk"; service_module; value ]

(* (compilation unit, value name) -> operation *)
let by_value =
  let table = Hashtbl.create 1024 in
  List.iter
    (fun (unit, value, service, operation) ->
      Hashtbl.replace table (unit, value)
        { service; operation; path = public_path unit value })
    Operation_table.all;
  table

let operation_of ~unit value = Hashtbl.find_opt by_value (unit, value)

let operations =
  Hashtbl.fold (fun _ operation all -> operation :: all) by_value []
  |> List.sort compare

let service_units =
  List.sort_uniq compare
    (List.map (fun (unit, _, _, _) -> unit) Operation_table.all)

(* ---------- types ---------- *)

let rec final_result type_ =
  match Types.get_desc type_ with
  | Tarrow (_, _, result, _) -> final_result result
  | Tpoly (inner, _) -> final_result inner
  | _ -> type_

let ends_with ~suffix text =
  String.length text >= String.length suffix
  && String.sub text
       (String.length text - String.length suffix)
       (String.length suffix)
     = suffix

(* The request type, under any of the names the runtime is reachable by:
   Macro_sdk_runtime__Request.t, Macro_sdk_runtime.Request.t, Macro_sdk.Request.t. *)
let is_request_path path =
  let name = Path.name path in
  name = "Macro_sdk_runtime__Request.t"
  || String.starts_with ~prefix:"Macro_sdk" name
     && ends_with ~suffix:".Request.t" name

(* Expands a type abbreviation one step, if [env] knows it. *)
let expand env type_ =
  match env with
  | None -> None
  | Some env -> (
      match Ctype.expand_head_opt (Lazy.force env) type_ with
      | expanded when not (Types.eq_type expanded type_) -> Some expanded
      | _ -> None
      | exception _ -> None)

(* The client configuration type, under the same names. A configuration
   chooses the URL each request goes to (its hosts), so a program that
   builds one can send an operation's request to another operation's URL. *)
let is_config_path path =
  let name = Path.name path in
  name = "Macro_sdk_runtime__Config.t"
  || String.starts_with ~prefix:"Macro_sdk" name
     && ends_with ~suffix:".Config.t" name

let rec returns ~is_path ?env type_ =
  let result = final_result type_ in
  match Types.get_desc result with
  | Tconstr (path, _, _) when is_path path -> true
  | Tconstr _ -> (
      match expand env result with
      | Some expanded -> returns ~is_path ?env expanded
      | None -> false)
  | _ -> false

let returns_request ?env type_ = returns ~is_path:is_request_path ?env type_

(* Whether a value of this type can hand out a request: the request type
   occurs in a covariant position (a result, or inside a result). Type
   constructor arguments count both ways, since their variance is unknown
   here. Operations yield requests; any other value that does is a way to
   reach one the table does not know. *)
let yields_request ?env type_ =
  let seen = Hashtbl.create 16 in
  let rec go positive type_ =
    let key = (Types.get_id type_, positive) in
    if Hashtbl.mem seen key then false
    else (
      Hashtbl.add seen key ();
      match Types.get_desc type_ with
      | Tarrow (_, argument, result, _) ->
          go (not positive) argument || go positive result
      | Tconstr (path, arguments, _) -> (
          (positive && is_request_path path)
          || List.exists
               (fun argument -> go true argument || go false argument)
               arguments
          ||
          match expand env type_ with
          | Some expanded -> go positive expanded
          | None -> false)
      | Ttuple elements ->
          List.exists (fun (_, element) -> go positive element) elements
      | Tpoly (inner, _) -> go positive inner
      | Tvar _ | Tunivar _ | Tnil -> false
      | _ ->
          let found = ref false in
          Btype.iter_type_expr
            (fun inner -> if go true inner || go false inner then found := true)
            type_;
          !found)
  in
  go true type_

(* ---------- analysis state ---------- *)

type sdk_value = Operation of operation | Unknown_operation of string

type state = {
  current_unit : string;
  libraries : string list;  (** unit name prefixes the program may use *)
  source_file : string;
  sdk : sdk_value Shape.Uid.Tbl.t;
      (** every SDK service value that returns a request *)
  found : (operation, (location * via) list) Hashtbl.t;
  mutable refusals : (string * location) list;
  mutable exempt : module_expr list;
      (** naming-only module identifiers, compared physically *)
}

let location_of (location : Location.t) =
  let position = location.loc_start in
  {
    file = position.pos_fname;
    line = position.pos_lnum;
    column = position.pos_cnum - position.pos_bol;
  }

let refuse state location message =
  state.refusals <- (message, location_of location) :: state.refusals

let record state location via operation =
  let previous =
    Option.value ~default:[] (Hashtbl.find_opt state.found operation)
  in
  Hashtbl.replace state.found operation ((location_of location, via) :: previous)

(* ---------- what a value is ---------- *)

let denied_unit unit =
  unit = "Stdlib__Obj" || unit = "Stdlib__Marshal"
  || String.starts_with ~prefix:"Camlinternal" unit

let display_unit unit =
  if String.starts_with ~prefix:"Stdlib__" unit then
    String.sub unit 8 (String.length unit - 8)
  else unit

let contains ~fragment text =
  let length = String.length fragment in
  let rec search index =
    index + length <= String.length text
    && (String.sub text index length = fragment || search (index + 1))
  in
  search 0

(* Libraries a program may use by default: the standard library, the SDK
   and its transports, code mode's program contract, and what their
   interfaces expose. Their code is not analyzed; they are trusted not to
   build SDK requests or cast values. Any other unit (another unit of the
   program, Dynlink, a third-party library, the JavaScript interop) could
   call the SDK out of sight.

   Macro_sdk_fetch and Code_mode (fetch/, code_mode/) are code mode's
   runtime. Neither depends on the generated operations: the transport sends
   only a request its caller hands it, and Code_mode only builds the client
   ([test_trusted] checks their sources). Js_of_ocaml, which both are built
   on, stays out: through it a program could call [fetch] directly. *)
let default_libraries =
  [
    "Stdlib";
    "Macro_sdk";
    "Macro_sdk_runtime";
    "Macro_sdk_eio";
    "Macro_sdk_fetch";
    "Code_mode";
    "Yojson";
    "Uri";
    "Eio";
    "Eio_main";
    "X509";
    "Ptime";
    "Mirage_crypto_rng";
    "Mirage_crypto_rng_unix";
  ]

let in_libraries libraries unit =
  List.exists
    (fun library ->
      unit = library || String.starts_with ~prefix:(library ^ "__") unit)
    libraries

(* Primitives that read arbitrary memory or build values of any type. *)
let denied_primitive name =
  contains ~fragment:"unsafe" name
  || String.starts_with ~prefix:"caml_input_value" name
  || String.starts_with ~prefix:"caml_obj_" name
  || String.starts_with ~prefix:"%obj_" name

type verdict = Plain | Calls of operation | Refused of string

(* [name] is the value's own name (names survive aliases, include, open and
   signature constraints unchanged). *)
let judge state env name (description : Types.value_description) =
  let unit =
    match description.val_uid with
    | Item { comp_unit; _ } -> Some comp_unit
    | _ -> None
  in
  let primitive =
    match description.val_kind with
    | Val_prim primitive when denied_primitive primitive.prim_name ->
        Some (Printf.sprintf "uses the primitive %s" primitive.prim_name)
    (* The standard library's identity externals are typed safely; anyone
       else's can be a cast. *)
    | Val_prim { prim_name = "%identity"; _ }
      when not (Option.fold ~none:false ~some:(in_libraries [ "Stdlib" ]) unit)
      ->
        Some "uses the primitive %identity, which can cast any value"
    | _ -> None
  in
  match (primitive, description.val_uid) with
  | Some reason, _ -> Refused reason
  | None, Item { comp_unit; _ } when comp_unit <> state.current_unit -> (
      if denied_unit comp_unit then
        Refused
          (Printf.sprintf "belongs to %s, which can forge any value"
             (display_unit comp_unit))
      else if String.starts_with ~prefix:"unsafe" name then
        Refused "skips bounds checks, so it can read any value"
      else if comp_unit = "Stdlib" && name = "input_value" then
        Refused "unmarshals, so it can build any value"
      else if not (in_libraries state.libraries comp_unit) then
        Refused
          (Printf.sprintf
             "belongs to %s, whose code the analysis cannot see (only the \
              standard library and the SDK's libraries are allowed)"
             comp_unit)
      else if
        comp_unit = "Macro_sdk_runtime__Config"
        && returns ~is_path:is_config_path ~env description.val_type
      then
        Refused
          "builds a client configuration, whose hosts can send an operation to \
           another operation's URL"
      else
        match Shape.Uid.Tbl.find_opt state.sdk description.val_uid with
        | Some (Operation operation) -> Calls operation
        | Some (Unknown_operation path) ->
            Refused
              (Printf.sprintf
                 "%s builds a request but is not in the analyzer's operation \
                  table"
                 path)
        | None ->
            if yields_request ~env description.val_type then
              Refused
                "returns a request but is not an operation this analyzer knows"
            else Plain)
  | None, _ -> Plain

let longident_name (lid : Longident.t Location.loc) =
  String.concat "." (Longident.flatten lid.txt)

let check_value state env location written name description =
  match judge state env name description with
  | Plain -> ()
  | Calls operation -> record state location Reference operation
  | Refused reason ->
      refuse state location (Printf.sprintf "`%s` %s" written reason)

(* ---------- environments ---------- *)

exception No_environment of string

(* Typed-tree environments in a .cmt are summaries; rebuild them from the
   load path. *)
let environment env =
  try Envaux.env_of_only_summary env
  with Envaux.Error error ->
    raise (No_environment (Format.asprintf "%a" Envaux.report_error error))

let head_unit path =
  let head = Path.head path in
  if Ident.persistent head || Ident.global head then Some (Ident.name head)
  else None

(* ---------- modules used as values ---------- *)

(* A module used as a value (functor argument, include, first-class module,
   constraint, nested alias) gives access to its contents without naming
   them. [view] is the signature it is seen through: every value [view] lets
   through is looked up in the real module and judged as if named here. *)
let rec module_contents ?(fallback = true) state env location written source
    view =
  let source =
    try Env.normalize_module_path None env source with Not_found -> source
  in
  match Env.scrape_alias env (Mtype.scrape env view) with
  | Types.Mty_signature items ->
      List.iter (module_item state env location written source) items
  | Types.Mty_functor _ -> ()
  | Types.Mty_ident _ | Types.Mty_alias _ -> (
      (* An abstract view hides the contents here, but they can resurface
         later (a functor result naming its argument): count the module as
         it really is. *)
      let real =
        if fallback then
          match Env.find_module source env with
          | declaration -> Some declaration.md_type
          | exception Not_found -> None
        else None
      in
      match real with
      | Some real ->
          module_contents ~fallback:false state env location written source real
      | None when head_unit source = None ->
          (* A functor parameter or an unpacked module of abstract type:
             what it holds was counted where it was passed or packed. *)
          ()
      | None ->
          refuse state location
            (Printf.sprintf
               "`%s` is used as a module whose contents cannot be resolved"
               written))

and module_item state env location written source = function
  | Types.Sig_value (id, _, _) -> (
      let name = Ident.name id in
      let path = Path.Pdot (source, name) in
      match Env.find_value path env with
      | description -> (
          match judge state (lazy env) name description with
          | Plain -> ()
          | Calls operation -> record state location Module operation
          | Refused reason ->
              refuse state location
                (Printf.sprintf
                   "`%s` is used as a module and exposes `%s`, which %s" written
                   (Path.name path) reason))
      | exception Not_found ->
          refuse state location
            (Printf.sprintf
               "`%s` is used as a module and `%s` cannot be resolved" written
               (Path.name path)))
  | Types.Sig_module (id, _, declaration, _, _) ->
      module_contents state env location written
        (Path.Pdot (source, Ident.name id))
        declaration.md_type
  | Types.Sig_type _ | Types.Sig_typext _ | Types.Sig_modtype _
  | Types.Sig_class _ | Types.Sig_class_type _ ->
      ()

let check_module_name state env location written path =
  let path =
    try Env.normalize_module_path None env path with Not_found -> path
  in
  match head_unit path with
  | Some unit when denied_unit unit ->
      refuse state location
        (Printf.sprintf "`%s` names %s, which can forge any value" written
           (display_unit unit))
  | Some unit
    when unit <> state.current_unit && not (in_libraries state.libraries unit)
    ->
      refuse state location
        (Printf.sprintf
           "`%s` names %s, whose code the analysis cannot see (only the \
            standard library and the SDK's libraries are allowed)"
           written unit)
  | _ -> ()

let functor_parameter env (functor_expression : module_expr) =
  match Mtype.scrape env (Env.scrape_alias env functor_expression.mod_type) with
  | Types.Mty_functor (Types.Named (_, parameter), _) -> Some parameter
  | _ -> None

(* ---------- the walk ---------- *)

let iterator state =
  let default = Tast_iterator.default_iterator in
  let exempt expression = state.exempt <- expression :: state.exempt in
  let is_alias (expression : module_expr) =
    match (expression.mod_desc, expression.mod_type) with
    | Tmod_ident _, Types.Mty_alias _ -> true
    | _ -> false
  in
  (* The type checker wraps functor arguments and packed modules in an
     implicit constraint. *)
  let rec module_identifier (expression : module_expr) =
    match expression.mod_desc with
    | Tmod_ident (path, lid) -> Some (expression, path, lid)
    | Tmod_constraint (inner, _, Tmodtype_implicit, _) ->
        exempt expression;
        module_identifier inner
    | _ -> None
  in
  let use (identifier : module_expr) path lid view =
    module_contents state
      (environment identifier.mod_env)
      identifier.mod_loc (longident_name lid) path view
  in
  let module_expr sub (expression : module_expr) =
    let handled = List.memq expression state.exempt in
    (match expression.mod_desc with
    | Tmod_ident (path, lid) ->
        let env = environment expression.mod_env in
        check_module_name state env expression.mod_loc (longident_name lid) path;
        if not handled then use expression path lid expression.mod_type
    | Tmod_apply (functor_expression, argument, _) -> (
        match module_identifier argument with
        | None -> ()
        | Some (identifier, path, lid) ->
            exempt identifier;
            let view =
              match
                functor_parameter
                  (environment expression.mod_env)
                  functor_expression
              with
              | Some parameter -> parameter
              | None -> identifier.mod_type
            in
            use identifier path lid view)
    | Tmod_constraint (inner, view, _, _) when not handled -> (
        match module_identifier inner with
        | None -> ()
        | Some (identifier, path, lid) ->
            exempt identifier;
            use identifier path lid view)
    | _ -> ());
    default.module_expr sub expression
  in
  let open_declaration sub (declaration : open_declaration) =
    (match declaration.open_expr.mod_desc with
    | Tmod_ident _ -> exempt declaration.open_expr
    | _ -> ());
    default.open_declaration sub declaration
  in
  let module_type sub (module_type : module_type) =
    match module_type.mty_desc with
    (* module type of M reads only types *)
    | Tmty_typeof _ -> ()
    | _ -> default.module_type sub module_type
  in
  let forged expression
      (fields : (Data_types.label_description * record_label_definition) array)
      =
    (* A record type can re-export the request's fields
       ([type r = Macro_sdk.Request.t = { ... }]): expand it first. *)
    let env = environment expression.exp_env in
    let is is_path type_ =
      match Types.get_desc (Ctype.expand_head env type_) with
      | Tconstr (path, _, _) ->
          let path =
            try Env.normalize_type_path None env path with Not_found -> path
          in
          is_path path
      | _ -> false
    in
    let builds is_path =
      is is_path expression.exp_type
      || Array.exists
           (fun ((label : Data_types.label_description), _) ->
             is is_path label.lbl_res)
           fields
    in
    if builds is_request_path then
      refuse state expression.exp_loc
        "builds a Macro_sdk_runtime.Request.t by hand, so its operation cannot \
         be known";
    if builds is_config_path then
      refuse state expression.exp_loc
        "builds a Macro_sdk_runtime.Config.t by hand, whose hosts can send an \
         operation to another operation's URL"
  in
  let expr sub (expression : expression) =
    (match expression.exp_desc with
    | Texp_ident (path, lid, description) ->
        check_value state
          (lazy (environment expression.exp_env))
          expression.exp_loc (longident_name lid) (Path.last path) description
    | Texp_letmodule (_, _, _, module_expression, _)
      when is_alias module_expression ->
        exempt module_expression
    | Texp_letop { let_; ands; _ } ->
        List.iter
          (fun (operator : binding_op) ->
            check_value state
              (lazy (environment expression.exp_env))
              operator.bop_loc operator.bop_op_name.txt
              (Path.last operator.bop_op_path)
              operator.bop_op_val)
          (let_ :: ands)
    | Texp_record { fields; _ } -> forged expression fields
    | _ -> ());
    default.expr sub expression
  in
  let value_description sub (description : value_description) =
    if description.val_prim <> [] then
      refuse state description.val_loc
        "external declarations can give any value any type";
    default.value_description sub description
  in
  {
    default with
    module_expr;
    open_declaration;
    module_type;
    expr;
    value_description;
  }

(* A toplevel [module X = M] or [include M] cannot be captured by a bigger
   module (nothing references the program's own unit), and the values it
   brings in keep the uid of their declaration, so uses are judged where they
   happen instead. *)
let exempt_toplevel state (structure : structure) =
  List.iter
    (fun item ->
      match item.str_desc with
      | Tstr_module
          {
            mb_expr =
              { mod_desc = Tmod_ident _; mod_type = Types.Mty_alias _; _ } as
              expression;
            _;
          } ->
          state.exempt <- expression :: state.exempt
      | Tstr_include { incl_mod; _ } ->
          (* the type checker wraps the included module in an implicit constraint *)
          let rec identifier (expression : module_expr) =
            match expression.mod_desc with
            | Tmod_ident _ -> Some [ expression ]
            | Tmod_constraint (inner, _, Tmodtype_implicit, _) ->
                Option.map (fun inner -> expression :: inner) (identifier inner)
            | _ -> None
          in
          Option.iter
            (fun nodes -> state.exempt <- nodes @ state.exempt)
            (identifier incl_mod)
      | _ -> ())
    structure.str_items

(* ---------- the SDK's interfaces ---------- *)

(* Index every SDK value the program's compilation read, by uid. The .cmi must
   be the one the program was compiled against (same CRC), or uids could
   name different values. *)
let load_sdk (imports : Misc.crcs) =
  let table = Shape.Uid.Tbl.create 1024 in
  let load (unit, crc) =
    if not (List.mem unit service_units) then Ok ()
    else
      match Load_path.find_normalized (unit ^ ".cmi") with
      | exception Not_found ->
          Error (Printf.sprintf "%s.cmi is not on the load path" unit)
      | file -> (
          let cmi = Cmi_format.read_cmi file in
          match (crc, List.assoc_opt unit cmi.cmi_crcs) with
          | Some expected, Some (Some actual) when expected <> actual ->
              Error
                (Printf.sprintf
                   "%s is not the interface the program was compiled against"
                   file)
          | _ ->
              List.iter
                (function
                  | Types.Sig_value (id, description, _)
                    when returns_request description.val_type ->
                      let name = Ident.name id in
                      Shape.Uid.Tbl.replace table description.val_uid
                        (match Hashtbl.find_opt by_value (unit, name) with
                        | Some operation -> Operation operation
                        | None -> Unknown_operation (public_path unit name))
                  | _ -> ())
                cmi.cmi_sign;
              Ok ())
  in
  List.fold_left
    (fun acc import -> Result.bind acc (fun () -> load import))
    (Ok ()) imports
  |> Result.map (fun () -> table)

(* ---------- entry point ---------- *)

let absolute base path =
  if Filename.is_relative path then Filename.concat base path else path

let compare_location (a : location) (b : location) =
  compare (a.file, a.line, a.column) (b.file, b.line, b.column)

let analyze ~libraries (cmt : Cmt_format.cmt_infos) sdk structure =
  let file = Option.value ~default:"<unknown>" cmt.cmt_sourcefile in
  let state =
    {
      current_unit = cmt.cmt_modname;
      libraries;
      source_file = file;
      sdk;
      found = Hashtbl.create 64;
      refusals = [];
      exempt = [];
    }
  in
  if Array.mem "-unsafe" cmt.cmt_args then
    refuse state
      (Location.in_file state.source_file)
      "compiled with -unsafe: unchecked array and string access can read any \
       value";
  exempt_toplevel state structure;
  let walker = iterator state in
  (match walker.structure walker structure with
  | () -> ()
  | exception No_environment message ->
      refuse state
        (Location.in_file state.source_file)
        ("cannot rebuild the typing environment: " ^ message)
  | exception error ->
      (* Fail closed: an analysis that stopped early has not seen everything. *)
      refuse state
        (Location.in_file state.source_file)
        ("the analysis failed: " ^ Printexc.to_string error));
  match state.refusals with
  | [] ->
      Analyzed
        (Hashtbl.fold
           (fun operation locations all ->
             {
               operation;
               locations =
                 List.sort_uniq
                   (fun (a, via) (b, via') ->
                     match compare_location a b with
                     | 0 -> compare via via'
                     | c -> c)
                   locations;
             }
             :: all)
           state.found []
        |> List.sort (fun a b -> compare a.operation b.operation))
  | refusals ->
      Cannot_analyze
        (List.sort_uniq
           (fun (m, a) (n, b) ->
             match compare_location a b with 0 -> compare m n | c -> c)
           refusals)

let cmt ?load_path ?root ?(libraries = default_libraries) file =
  match Cmt_format.read_cmt file with
  | exception Sys_error message -> Error message
  | exception Cmt_format.Error _ -> Error (file ^ " is not a .cmt file")
  | exception Cmi_format.Error _ -> Error (file ^ " is not a .cmt file")
  | cmt -> (
      match cmt.cmt_annots with
      | Implementation structure -> (
          let visible, hidden =
            match load_path with
            | Some directories -> (directories, [])
            | None ->
                (* dune records its build directory as /workspace_root *)
                let root =
                  match root with
                  | Some root -> root
                  | None ->
                      if Sys.file_exists cmt.cmt_builddir then cmt.cmt_builddir
                      else Sys.getcwd ()
                in
                ( List.map (absolute root) cmt.cmt_loadpath.visible,
                  List.map (absolute root) cmt.cmt_loadpath.hidden )
          in
          Load_path.init ~auto_include:Load_path.no_auto_include ~visible
            ~hidden;
          Envaux.reset_cache ();
          match load_sdk cmt.cmt_imports with
          | Error message -> Error message
          | Ok sdk -> Ok (analyze ~libraries cmt sdk structure))
      | Partial_implementation _ ->
          Error (file ^ " is from a program that did not type-check")
      | Interface _ | Partial_interface _ | Packed _ ->
          Error (file ^ " is not an implementation"))

(* ---------- output ---------- *)

let location_json { file; line; column } =
  [ ("file", `String file); ("line", `Int line); ("column", `Int column) ]

let to_json = function
  | Analyzed found ->
      `Assoc
        [
          ("status", `String "ok");
          ( "operations",
            `List
              (List.map
                 (fun { operation; locations } ->
                   `Assoc
                     [
                       ("service", `String operation.service);
                       ("operation", `String operation.operation);
                       ("path", `String operation.path);
                       ( "locations",
                         `List
                           (List.map
                              (fun (location, via) ->
                                `Assoc
                                  (location_json location
                                  @ [
                                      ( "via",
                                        `String
                                          (match via with
                                          | Reference -> "reference"
                                          | Module -> "module") );
                                    ]))
                              locations) );
                     ])
                 found) );
        ]
  | Cannot_analyze reasons ->
      `Assoc
        [
          ("status", `String "cannot_analyze");
          ( "reasons",
            `List
              (List.map
                 (fun (message, location) ->
                   `Assoc
                     [
                       ("message", `String message);
                       ("location", `Assoc (location_json location));
                     ])
                 reasons) );
        ]

let to_text = function
  | Analyzed [] -> "no SDK operations\n"
  | Analyzed found ->
      String.concat ""
        (List.map
           (fun { operation; locations } ->
             Printf.sprintf "%s %s (%s)\n%s" operation.service
               operation.operation operation.path
               (String.concat ""
                  (List.map
                     (fun (location, via) ->
                       Printf.sprintf "  %s:%d:%d%s\n" location.file
                         location.line location.column
                         (match via with
                         | Reference -> ""
                         | Module -> " (module use)"))
                     locations)))
           found)
  | Cannot_analyze reasons ->
      "cannot analyze:\n"
      ^ String.concat ""
          (List.map
             (fun (message, location) ->
               Printf.sprintf "  %s:%d:%d: %s\n" location.file location.line
                 location.column message)
             reasons)
