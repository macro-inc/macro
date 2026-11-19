(* Test cases: every operation called with sample arguments built from its
   types, plus encoders that turn its decoded replies and errors back into
   JSON. The test harness checks both against the spec itself. *)
open Ppxlib
open Syntax
open Ir
module T = Emit_types

(* Past this depth, samples leave out optional values and lists stay empty,
   so recursive types end. *)
let shallow = 2
let deepest = 12
let qualified module_name n = module_name ^ "." ^ n

let rec sample ~m defs depth ty =
  if depth > deepest then
    failwith
      ("sample value for a type that never ends: "
      ^ Option.value
          (match ty with Named n -> Some n | _ -> None)
          ~default:"?");
  let deep = depth > shallow in
  match ty with
  | Prim String -> estring "sample"
  | Prim Int -> eint 1
  | Prim Int64 -> [%expr 1L]
  | Prim Float -> [%expr 1.5]
  | Prim Bool -> [%expr true]
  | List t ->
      if deep then [%expr []] else [%expr [ [%e sample ~m defs (depth + 1) t] ]]
  | Map t ->
      if deep then [%expr []]
      else [%expr [ ("key", [%e sample ~m defs (depth + 1) t]) ]]
  | Option t ->
      if deep then [%expr None]
      else [%expr Some [%e sample ~m defs (depth + 1) t]]
  | Json -> [%expr `Assoc []]
  | Named n -> (
      let def = List.find (fun d -> d.name = n) defs in
      match def.kind with
      | Alias t -> sample ~m defs depth t
      | Enum ((_, c) :: _) -> ctor (qualified m c)
      | Enum [] -> failwith ("empty enum " ^ n)
      | Record fields ->
          let args =
            List.filter_map
              (fun f ->
                if field_is_option f && not f.flatten then
                  if deep then None
                  else
                    Some
                      ( Optional f.ml_name,
                        [%expr Some [%e sample ~m defs (depth + 1) f.ty]] )
                else Some (Labelled f.ml_name, sample ~m defs (depth + 1) f.ty))
              fields
          in
          B.pexp_apply
            (evar (qualified m (T.make_name n)))
            (args @ [ (Nolabel, [%expr ()]) ])
      | Tagged { cases; _ } -> (
          let chosen =
            if deep then
              match List.find_opt (fun c -> c.payload = No_payload) cases with
              | Some c -> c
              | None -> List.hd cases
            else List.hd cases
          in
          match chosen.payload with
          | No_payload -> ctor (qualified m chosen.case_name)
          | Same_object t ->
              ctor
                ~arg:(sample ~m defs (depth + 1) t)
                (qualified m chosen.case_name)
          | Fields fields ->
              let record =
                B.pexp_record
                  (List.map
                     (fun f ->
                       let value =
                         if field_is_option f && not f.flatten then
                           if deep then [%expr None]
                           else
                             [%expr Some [%e sample ~m defs (depth + 1) f.ty]]
                         else sample ~m defs (depth + 1) f.ty
                       in
                       (lid f.ml_name, value))
                     fields)
                  None
              in
              ctor ~arg:record (qualified m chosen.case_name))
      | External cases -> (
          let chosen =
            if deep then
              match List.find_opt (fun c -> c.value = None) cases with
              | Some c -> c
              | None -> List.hd cases
            else List.hd cases
          in
          match chosen.value with
          | None -> ctor (qualified m chosen.ext_name)
          | Some t ->
              ctor
                ~arg:(sample ~m defs (depth + 1) t)
                (qualified m chosen.ext_name))
      | Untagged cases ->
          let c = List.hd cases in
          ctor
            ~arg:(sample ~m defs (depth + 1) c.member)
            (qualified m c.untagged_name))

let content_encoder ~m = function
  | Reply_json ty ->
      fun value ->
        [%expr
          Cases_support.Json_reply
            ([%e T.encoder ~qualify:(qualified m) ty] [%e value])]
  | Reply_text | Reply_binary _ ->
      fun value -> [%expr Cases_support.Text_reply [%e value]]
  | Reply_empty -> fun _ -> [%expr Cases_support.Empty_reply]

let reply_encoder ~m op =
  match op.reply with
  | Single Reply_empty -> [%expr fun () -> Cases_support.Empty_reply]
  | Single content ->
      [%expr fun reply -> [%e content_encoder ~m content [%expr reply]]]
  | By_status cases ->
      B.pexp_function_cases
        (List.map
           (fun (_, c, content) ->
             match content with
             | Reply_empty ->
                 case
                   (pctor (qualified m c))
                   (content_encoder ~m content [%expr ()])
             | _ ->
                 case
                   (pctor ~arg:[%pat? value] (qualified m c))
                   (content_encoder ~m content [%expr value]))
           cases)

let error_encoder ~m op =
  match op.errors with
  | No_errors ->
      [%expr
        fun (error : Macro_sdk_runtime.Request.no_error) ->
          match error with _ -> .]
  | Uniform { error_ty; _ } -> T.encoder ~qualify:(qualified m) error_ty
  | Error_by_status cases ->
      B.pexp_function_cases
        (List.map
           (fun (_, c, ty) ->
             case
               (pctor ~arg:[%pat? value] (qualified m c))
               [%expr [%e T.encoder ~qualify:(qualified m) ty] value])
           cases)

let case_expression ~library service op =
  let m = library ^ "." ^ service.module_name in
  let defs = service.defs in
  let args =
    List.map
      (fun (a : Emit_ops.argument) ->
        let value =
          if a.file then
            [%expr
              {
                Macro_sdk_runtime.Request.filename = "r\xc3\xa9sum\xc3\xa9.pdf";
                content_type = "application/pdf";
                data = "%PDF-1.7";
              }]
          else sample ~m defs 1 a.arg_ty
        in
        match a.label with
        | Optional _ -> (a.label, [%expr Some [%e value]])
        | _ -> (a.label, value))
      (Emit_ops.arguments op)
  in
  let call =
    B.pexp_apply
      (evar (qualified m op.fn_name))
      (args @ [ (Nolabel, [%expr ()]) ])
  in
  [%expr
    Cases_support.make ~spec:[%e estring service.spec_name]
      ~operation_id:[%e estring op.operation_id] ~path:[%e estring op.path]
      [%e call] ~reply:[%e reply_encoder ~m op] ~error:[%e error_encoder ~m op]]

(* One binding per service, then [all]. *)
let structure ~library services =
  let per_service =
    List.map
      (fun service ->
        let cases =
          B.elist
            (List.map (case_expression ~library service) service.operations)
        in
        B.pstr_value Nonrecursive
          [
            B.value_binding
              ~pat:(pvar (Naming.snake service.spec_name))
              ~expr:cases;
          ])
      services
  in
  let all =
    B.elist (List.map (fun s -> evar (Naming.snake s.spec_name)) services)
  in
  let open_library =
    B.pstr_open
      (B.open_infos ~override:Fresh ~expr:(B.pmod_ident (lid library)))
  in
  (open_library :: per_service) @ [%str let all = List.concat [%e all]]
