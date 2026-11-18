(* Builds the analyzer's operation table from the generated SDK sources:
   index.exe generated/storage.ml ... > operation_table.ml

   An operation is a top-level value whose body builds the request record
   [{ Request.service = "..."; operation = "..."; ... }]. The table maps the
   value (compilation unit, name) to the service and operationId it sends;
   the OCaml name can differ from the operationId ([get_state_handler_2]),
   and two values can share one operationId on different routes. Each
   entry also has the request's HTTP method and route: its path with ["{}"]
   for each parameter segment, which code mode's fetch backstop matches a
   request's URL against. *)

let string_constant (expression : Parsetree.expression) =
  match expression.pexp_desc with
  | Pexp_constant { pconst_desc = Pconst_string (text, _, _); _ } -> Some text
  | _ -> None

let field_name (label : Longident.t Location.loc) =
  match label.txt with
  | Lident name | Ldot (_, { txt = name; _ }) -> Some name
  | _ -> None

(* The method of [meth = `GET], as "GET". *)
let variant (expression : Parsetree.expression) =
  match expression.pexp_desc with
  | Pexp_variant (name, None) -> Some name
  | _ -> None

(* The route of [path = "/a"] or [path = String.concat "" ["/a/"; segment; ...]]:
   literals as they are, anything else a parameter, "{}". *)
let route (expression : Parsetree.expression) =
  match expression.pexp_desc with
  | Pexp_constant _ -> string_constant expression
  | Pexp_apply
      ( {
          pexp_desc =
            Pexp_ident
              {
                txt = Ldot ({ txt = Lident "String"; _ }, { txt = "concat"; _ });
                _;
              };
          _;
        },
        [ (_, separator); (_, parts) ] )
    when string_constant separator = Some "" ->
      let rec items (list : Parsetree.expression) =
        match list.pexp_desc with
        | Pexp_construct ({ txt = Lident "[]"; _ }, None) -> Some []
        | Pexp_construct
            ( { txt = Lident "::"; _ },
              Some { pexp_desc = Pexp_tuple [ (None, head); (None, tail) ]; _ }
            ) ->
            Option.map
              (fun rest ->
                (match string_constant head with
                | Some text -> text
                | None -> "{}")
                :: rest)
              (items tail)
        | _ -> None
      in
      Option.map (String.concat "") (items parts)
  | _ -> None

(* The (service, operation, method, route) of every request record in
   [expression]. *)
let requests expression =
  let found = ref [] in
  let expr (iterator : Ast_iterator.iterator) (e : Parsetree.expression) =
    (match e.pexp_desc with
    | Pexp_record (fields, None) -> (
        let literal name =
          List.find_map
            (fun (label, value) ->
              if field_name label = Some name then string_constant value
              else None)
            fields
        in
        let field name =
          List.find_map
            (fun (label, value) ->
              if field_name label = Some name then Some value else None)
            fields
        in
        match (literal "service", literal "operation") with
        | Some service, Some operation -> (
            match
              ( Option.bind (field "meth") variant,
                Option.bind (field "path") route )
            with
            | Some meth, Some route ->
                found := (service, operation, meth, route) :: !found
            | _ ->
                Printf.ksprintf failwith
                  "%s.%s: the request's method or path is not in the shape the \
                   index reads"
                  service operation)
        | _ -> ())
    | _ -> ());
    Ast_iterator.default_iterator.expr iterator e
  in
  let iterator = { Ast_iterator.default_iterator with expr } in
  iterator.expr iterator expression;
  !found

let unit_name file =
  "Macro_sdk__"
  ^ String.capitalize_ascii (Filename.chop_extension (Filename.basename file))

let operations file =
  let structure =
    Pparse.parse_implementation ~tool_name:"macro-sdk-index" file
  in
  List.concat_map
    (fun (item : Parsetree.structure_item) ->
      match item.pstr_desc with
      | Pstr_value (_, bindings) ->
          List.filter_map
            (fun (binding : Parsetree.value_binding) ->
              match (binding.pvb_pat.ppat_desc, requests binding.pvb_expr) with
              | _, [] -> None
              | ( Ppat_var { txt = name; _ },
                  [ (service, operation, meth, route) ] ) ->
                  Some (unit_name file, name, service, operation, meth, route)
              | _ ->
                  Printf.ksprintf failwith
                    "%s: a binding builds several requests or is not a plain \
                     name"
                    file)
            bindings
      | _ -> [])
    structure

(* A rebinding of an operation's name would make the table name the wrong
   value. *)
let check_unique file operations =
  let names = List.map (fun (_, name, _, _, _, _) -> name) operations in
  if List.length (List.sort_uniq compare names) <> List.length names then
    Printf.ksprintf failwith "%s: an operation name is bound twice" file;
  operations

let () =
  let files =
    Array.to_list Sys.argv |> List.tl
    |> List.filter (fun f -> Filename.check_suffix f ".ml")
    |> List.filter (fun f -> Filename.basename f <> "macro_sdk.ml")
    |> List.sort compare
  in
  print_endline
    "(* Generated by analyzer/index from generated/*.ml. Do not edit. *)";
  print_endline "";
  print_endline "let all = [";
  List.iter
    (fun file ->
      List.iter
        (fun (unit, value, service, operation, meth, route) ->
          Printf.printf "  (%S, %S, %S, %S, %S, %S);\n" unit value service
            operation meth route)
        (check_unique file (operations file)))
    files;
  print_endline "]"
