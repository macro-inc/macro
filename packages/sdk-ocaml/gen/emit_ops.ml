(* IR operations -> request builder functions and their signatures. *)
open Ppxlib
open Syntax
open Ir
module T = Emit_types

let request_type ~reply ~error =
  [%type: ([%t reply], [%t error]) Macro_sdk_runtime.Request.t]

(* ---------- parameters as strings ---------- *)

let rec param_to_string ~at defs = function
  | Prim String -> [%expr fun value -> value]
  | Prim Int -> [%expr string_of_int]
  | Prim Int64 -> [%expr Int64.to_string]
  | Prim Float -> [%expr Float.to_string]
  | Prim Bool -> [%expr string_of_bool]
  | Named n as ty -> (
      match List.find_opt (fun d -> d.name = n) defs with
      | Some { kind = Alias inner; _ } -> param_to_string ~at defs inner
      | Some { kind = Enum _; _ } ->
          [%expr fun value -> Json.string ([%e T.encoder ty] value)]
      | Some { kind = Untagged cases; _ }
        when List.for_all
               (fun c -> match c.member with Prim _ -> true | _ -> false)
               cases ->
          B.pexp_function_cases
            (List.map
               (fun c ->
                 case
                   (pctor ~arg:[%pat? inner] c.untagged_name)
                   [%expr [%e param_to_string ~at defs c.member] inner])
               cases)
      | _ -> Spec.unsupported ~at "parameter of non-scalar type %s" n)
  | _ -> Spec.unsupported ~at "parameter of non-scalar type"

let param_values ~at defs p =
  let value = evar p.param_ml in
  match p.param_ty with
  | List item when p.param_required ->
      [%expr List.map [%e param_to_string ~at defs item] [%e value]]
  | List item ->
      [%expr
        match [%e value] with
        | None -> []
        | Some items -> List.map [%e param_to_string ~at defs item] items]
  | ty when p.param_required ->
      [%expr [ [%e param_to_string ~at defs ty] [%e value] ]]
  | ty ->
      [%expr
        match [%e value] with
        | None -> []
        | Some value -> [ [%e param_to_string ~at defs ty] value ]]

(* "/a/{id}/b" -> String.concat "" [ "/a/"; Request.segment id; "/b" ] *)
let path_expression ~at defs op =
  let pieces = ref [] and literal = Buffer.create 16 in
  let flush () =
    if Buffer.length literal > 0 then begin
      pieces := estring (Buffer.contents literal) :: !pieces;
      Buffer.clear literal
    end
  in
  let path = op.path in
  let rec scan i =
    if i < String.length path then
      if path.[i] = '{' then begin
        let close = String.index_from path i '}' in
        let param_name = String.sub path (i + 1) (close - i - 1) in
        flush ();
        let param =
          match
            List.find_opt
              (fun p -> p.param_name = param_name && p.location = Path)
              op.params
          with
          | Some p -> p
          | None ->
              Spec.unsupported ~at "path parameter {%s} is not declared"
                param_name
        in
        pieces :=
          [%expr
            Request.segment
              ([%e param_to_string ~at defs param.param_ty]
                 [%e evar param.param_ml])]
          :: !pieces;
        scan (close + 1)
      end
      else begin
        Buffer.add_char literal path.[i];
        scan (i + 1)
      end
  in
  scan 0;
  flush ();
  match List.rev !pieces with
  | [ only ] -> only
  | pieces -> [%expr String.concat "" [%e B.elist pieces]]

(* ---------- arguments ---------- *)

type argument = { label : arg_label; arg_name : string; arg_ty : ty }

let arguments op =
  let of_param p =
    {
      label =
        (if p.param_required then Labelled p.param_ml else Optional p.param_ml);
      arg_name = p.param_ml;
      arg_ty = p.param_ty;
    }
  in
  let of_field (f : field) =
    {
      label =
        (if field_is_option f then Optional f.ml_name else Labelled f.ml_name);
      arg_name = f.ml_name;
      arg_ty = f.ty;
    }
  in
  let body_args =
    match op.body with
    | None -> []
    | Some (Json_body { spread = Some fields; _ }) -> List.map of_field fields
    | Some (Json_body { body_ty; body_required; spread = None }) ->
        [
          {
            label = (if body_required then Labelled "body" else Optional "body");
            arg_name = "body";
            arg_ty = body_ty;
          };
        ]
    | Some (Raw_body { raw_required; _ }) ->
        [
          {
            label = (if raw_required then Labelled "body" else Optional "body");
            arg_name = "body";
            arg_ty = Prim String;
          };
        ]
    | Some (Multipart_body { parts; _ }) -> List.map of_field parts
  in
  let all = List.map of_param op.params @ body_args in
  let required =
    List.filter
      (fun a -> match a.label with Labelled _ -> true | _ -> false)
      all
  in
  let optional =
    List.filter
      (fun a -> match a.label with Optional _ -> true | _ -> false)
      all
  in
  required @ optional

(* ---------- replies and errors ---------- *)

let content_type = function
  | Reply_json ty -> T.core_type ty
  | Reply_text | Reply_binary _ -> [%type: string]
  | Reply_empty -> [%type: unit]

let reply_type op =
  match (op.reply, op.reply_type) with
  | Single content, _ -> content_type content
  | By_status _, Some name -> tconstr name
  | By_status _, None -> assert false

let error_type op =
  match (op.errors, op.error_type) with
  | No_errors, _ -> [%type: Macro_sdk_runtime.Request.no_error]
  | Uniform { error_ty; _ }, _ -> T.core_type error_ty
  | Error_by_status _, Some name -> tconstr name
  | Error_by_status _, None -> assert false

let content_decoder = function
  | Reply_json ty -> [%expr Request.json [%e T.decoder ty]]
  | Reply_text | Reply_binary _ -> [%expr Request.text]
  | Reply_empty -> [%expr Request.unit]

let reply_decoder op =
  match op.reply with
  | Single content -> content_decoder content
  | By_status cases ->
      let entry (status, ctor_name, content) =
        let value =
          match content with
          | Reply_json ty ->
              Some [%expr [%e T.decoder ty] (Yojson.Safe.from_string body)]
          | Reply_text | Reply_binary _ -> Some [%expr body]
          | Reply_empty -> None
        in
        B.pexp_tuple
          [
            eint status;
            fun_ Nolabel
              (pvar (if value = None then "_body" else "body"))
              (B.pexp_constraint (ctor ?arg:value ctor_name) (reply_type op));
          ]
      in
      [%expr Request.by_status [%e B.elist (List.map entry cases)]]

let error_decoder op =
  match op.errors with
  | No_errors -> [%expr Request.no_error]
  | Uniform { statuses; error_ty } ->
      [%expr
        Request.error_json
          [%e B.elist (List.map eint statuses)]
          [%e T.decoder error_ty]]
  | Error_by_status cases ->
      let branch (status, ctor_name, ty) =
        case
          (B.ppat_constant (Pconst_integer (string_of_int status, None)))
          [%expr
            Some
              [%e
                B.pexp_constraint
                  (ctor
                     ~arg:
                       [%expr [%e T.decoder ty] (Yojson.Safe.from_string body)]
                     ctor_name)
                  (error_type op)]]
      in
      [%expr
        fun ~status body ->
          [%e
            B.pexp_match [%expr status]
              (List.map branch cases @ [ case [%pat? _] [%expr None] ])]]

(* Variant types for operations with several success shapes or error bodies. *)
let status_types op =
  let variant type_name cases =
    let constructors =
      List.map
        (fun (status, ctor_name, payload) ->
          let args =
            match payload with
            | Some ty -> Pcstr_tuple [ ty ]
            | None -> Pcstr_tuple []
          in
          T.constructor
            ~doc:(Some (Printf.sprintf "HTTP %d." status))
            ctor_name args)
        cases
    in
    B.type_declaration ~name:(name type_name) ~params:[] ~cstrs:[]
      ~kind:(Ptype_variant constructors) ~private_:Public ~manifest:None
  in
  let reply =
    match (op.reply, op.reply_type) with
    | By_status cases, Some type_name ->
        [
          variant type_name
            (List.map
               (fun (s, c, content) ->
                 ( s,
                   c,
                   match content with
                   | Reply_empty -> None
                   | content -> Some (content_type content) ))
               cases);
        ]
    | _ -> []
  in
  let error =
    match (op.errors, op.error_type) with
    | Error_by_status cases, Some type_name ->
        [
          variant type_name
            (List.map (fun (s, c, ty) -> (s, c, Some (T.core_type ty))) cases);
        ]
    | _ -> []
  in
  reply @ error

(* ---------- the function ---------- *)

let method_variant op = B.pexp_variant (String.uppercase_ascii op.meth) None

let body_expression op =
  match op.body with
  | None -> [%expr None]
  | Some (Json_body { body_ty; spread = Some fields; _ }) ->
      let record =
        B.pexp_constraint (T.record_of_names fields) (T.core_type body_ty)
      in
      [%expr Some (Request.Json ([%e T.encoder body_ty] [%e record]))]
  | Some (Json_body { body_ty; body_required = true; _ }) ->
      [%expr Some (Request.Json ([%e T.encoder body_ty] body))]
  | Some (Json_body { body_ty; _ }) ->
      [%expr
        Option.map (fun body -> Request.Json ([%e T.encoder body_ty] body)) body]
  | Some (Raw_body { content_type; raw_required }) ->
      let raw =
        [%expr
          Request.Raw { content_type = [%e estring content_type]; data = body }]
      in
      if raw_required then [%expr Some [%e raw]]
      else [%expr Option.map (fun body -> [%e raw]) body]
  | Some (Multipart_body { parts; _ }) ->
      let part (f : field) =
        let make value =
          [%expr
            {
              Request.name = [%e estring f.json_name];
              filename = Some [%e estring f.json_name];
              content_type = None;
              data = [%e value];
            }]
        in
        if field_is_option f then
          [%expr
            Option.map (fun data -> [%e make [%expr data]]) [%e evar f.ml_name]]
        else [%expr Some [%e make (evar f.ml_name)]]
      in
      [%expr
        Some
          (Request.Multipart
             (List.filter_map Fun.id [%e B.elist (List.map part parts)]))]

let doc op =
  let summary = match op.summary with Some s -> "\n\n" ^ s | None -> "" in
  Some
    (Printf.sprintf "`%s %s`%s"
       (String.uppercase_ascii op.meth)
       op.path summary)

let structure_item ~service defs op =
  let at = Printf.sprintf "%s %s" op.meth op.path in
  let pairs location =
    op.params
    |> List.filter (fun p -> p.location = location)
    |> List.map (fun p ->
        B.pexp_tuple [ estring p.param_name; param_values ~at defs p ])
    |> B.elist
  in
  let request =
    [%expr
      {
        Request.service = [%e estring service];
        operation = [%e estring op.operation_id];
        meth = [%e method_variant op];
        path = [%e path_expression ~at defs op];
        query = List.filter (fun (_, values) -> values <> []) [%e pairs Query];
        headers =
          List.concat_map
            (fun (name, values) -> List.map (fun v -> (name, v)) values)
            [%e pairs Header];
        body = [%e body_expression op];
        decode_reply = [%e reply_decoder op];
        decode_error = [%e error_decoder op];
      }]
  in
  let request =
    B.pexp_constraint request
      (request_type ~reply:(reply_type op) ~error:(error_type op))
  in
  let fn =
    List.fold_right
      (fun a acc ->
        let pattern =
          match a.label with
          | Optional _ -> pvar a.arg_name
          | _ -> B.ppat_constraint (pvar a.arg_name) (T.core_type a.arg_ty)
        in
        fun_ a.label pattern acc)
      (arguments op)
      [%expr fun () -> [%e request]]
  in
  let binding = B.value_binding ~pat:(pvar op.fn_name) ~expr:fn in
  B.pstr_value Nonrecursive
    [ { binding with pvb_attributes = doc_attributes (doc op) } ]

let signature_item op =
  let ty =
    List.fold_right
      (fun a acc -> B.ptyp_arrow a.label (T.core_type a.arg_ty) acc)
      (arguments op)
      [%type:
        unit -> [%t request_type ~reply:(reply_type op) ~error:(error_type op)]]
  in
  T.value_description ?doc:(doc op) op.fn_name ty

let structure service =
  let types = List.concat_map status_types service.operations in
  (if types = [] then [] else [ B.pstr_type Nonrecursive types ])
  @ List.map
      (structure_item ~service:service.spec_name service.defs)
      service.operations

let signature service =
  let types = List.concat_map status_types service.operations in
  (if types = [] then [] else [ B.psig_type Nonrecursive types ])
  @ List.map signature_item service.operations
