(* OpenAPI operations -> IR operations. *)
open Ir
module L = Lower_schema

let methods = [ "get"; "put"; "post"; "delete"; "patch" ]
let ( / ) = L.( / )

(* JSON pointers escape "/" in path keys as "~1". *)
let escape_key key =
  String.concat "~1"
    (String.split_on_char '/'
       (String.concat "~0" (String.split_on_char '~' key)))

let reason_phrase = function
  | 200 -> "Ok_"
  | 201 -> "Created"
  | 202 -> "Accepted"
  | 204 -> "No_content"
  | 206 -> "Partial_content"
  | 400 -> "Bad_request"
  | 401 -> "Unauthorized"
  | 402 -> "Payment_required"
  | 403 -> "Forbidden"
  | 404 -> "Not_found"
  | 405 -> "Method_not_allowed"
  | 409 -> "Conflict"
  | 410 -> "Gone"
  | 412 -> "Precondition_failed"
  | 413 -> "Payload_too_large"
  | 415 -> "Unsupported_media_type"
  | 422 -> "Unprocessable_entity"
  | 423 -> "Locked"
  | 424 -> "Failed_dependency"
  | 428 -> "Precondition_required"
  | 429 -> "Too_many_requests"
  | 500 -> "Internal_server_error"
  | 501 -> "Not_implemented"
  | 502 -> "Bad_gateway"
  | 503 -> "Service_unavailable"
  | 504 -> "Gateway_timeout"
  | code -> Printf.sprintf "Status_%d" code

let status_code ~at code =
  match int_of_string_opt code with
  | Some status when status >= 100 && status < 600 -> status
  | _ ->
      Spec.unsupported ~at "response code %S (only numeric codes are supported)"
        code

let param ctx ~at ~hint names raw =
  let at, schema = L.target ctx ~at raw in
  let name =
    match Spec.string "name" schema with
    | Some name -> name
    | None -> Spec.unsupported ~at "a parameter without a name"
  in
  let location =
    match Spec.string "in" schema with
    | Some "path" -> Path
    | Some "query" -> Query
    | Some "header" -> Header
    | other ->
        Spec.unsupported ~at "parameter location %s"
          (Option.value other ~default:"none")
  in
  let style = Spec.string "style" schema in
  if style <> None && style <> Some "form" && style <> Some "simple" then
    Spec.unsupported ~at "parameter style %s" (Option.get style);
  if Spec.member "explode" schema = Some (`Bool false) then
    Spec.unsupported ~at "explode: false";
  let ty =
    match Spec.member "schema" schema with
    | Some s -> L.ty_of ctx ~at:(at / "schema") ~hint:(hint ^ "_" ^ name) s
    | None -> Spec.unsupported ~at "a parameter without a schema"
  in
  let ty, is_nullable =
    match ty with Option inner -> (inner, true) | ty -> (ty, false)
  in
  {
    param_name = name;
    param_ml = Naming.fresh names (Naming.snake name);
    param_ty = ty;
    param_required =
      (location = Path || Spec.bool "required" schema) && not is_nullable;
    location;
    param_doc = L.description schema;
  }

(* Operation-level parameters replace path-level ones with the same name and location. *)
let merge_params path_level op_level =
  let key p = (Spec.string "name" p, Spec.string "in" p) in
  List.filter
    (fun p -> not (List.exists (fun q -> key q = key p) op_level))
    path_level
  @ op_level

let content_of ctx ~at ~hint media =
  match media with
  | [] -> Reply_empty
  | _ -> (
      match List.assoc_opt "application/json" media with
      | Some content -> (
          match Spec.member "schema" content with
          | Some schema ->
              Reply_json
                (L.ty_of ctx
                   ~at:(at / "content" / "application~1json" / "schema")
                   ~hint schema)
          | None ->
              Reply_json (L.untyped ctx ~at "a JSON reply without a schema"))
      | None -> (
          match media with
          | [ ("text/plain", _) ] -> Reply_text
          | [ (media_type, _) ] -> Reply_binary media_type
          | _ ->
              Spec.unsupported ~at
                "a reply with several media types and no JSON"))

let reply ctx ~at ~fn responses =
  let success =
    List.filter_map
      (fun (code, response) ->
        let response_at = at / "responses" / code in
        let status = status_code ~at:response_at code in
        if status >= 200 && status < 300 then
          Some
            ( status,
              content_of ctx ~at:response_at ~hint:(fn ^ "_reply")
                (Spec.assoc "content" response) )
        else None)
      responses
  in
  match success with
  | [] -> Single (Reply_binary "application/octet-stream")
  | (_, first) :: rest when List.for_all (fun (_, c) -> c = first) rest ->
      Single first
  | _ ->
      By_status
        (List.map
           (fun (status, c) -> (status, reason_phrase status, c))
           success)

let errors ctx ~at ~fn responses =
  let declared =
    List.filter_map
      (fun (code, response) ->
        let response_at = at / "responses" / code in
        let status = status_code ~at:response_at code in
        let media = Spec.assoc "content" response in
        match List.assoc_opt "application/json" media with
        | Some content when status >= 300 -> (
            match Spec.member "schema" content with
            | Some schema ->
                let schema_at =
                  response_at / "content" / "application~1json" / "schema"
                in
                Some
                  ( status,
                    L.ty_of ctx ~at:schema_at ~hint:(fn ^ "_error") schema )
            | None -> None)
        | _ -> None)
      responses
  in
  match declared with
  | [] -> No_errors
  | (_, first) :: rest when List.for_all (fun (_, ty) -> ty = first) rest ->
      Uniform { statuses = List.map fst declared; error_ty = first }
  | _ ->
      Error_by_status
        (List.map
           (fun (status, ty) -> (status, reason_phrase status, ty))
           declared)

(* The fields of a body that is a plain record, to pass as labelled
   arguments, unless one would clash with a parameter. *)
let spread_fields ctx ~params ty =
  let defs = ctx.L.defs in
  match ty with
  | Named name -> (
      match List.find_opt (fun d -> d.name = name) defs with
      | Some { kind = Record fields; _ }
        when List.for_all (fun f -> not f.flatten) fields
             && not
                  (List.exists
                     (fun f ->
                       f.ml_name = "body"
                       || List.exists (fun p -> p.param_ml = f.ml_name) params)
                     fields) ->
          Some fields
      | _ -> None)
  | _ -> None

let body ctx ~at ~fn ~params request_body =
  let at, request_body = L.target ctx ~at request_body in
  let required = Spec.bool "required" request_body in
  match Spec.assoc "content" request_body with
  | [ ("application/json", content) ] ->
      let schema =
        Option.value (Spec.member "schema" content) ~default:(`Bool true)
      in
      let ty =
        L.ty_of ctx
          ~at:(at / "content" / "application~1json" / "schema")
          ~hint:(fn ^ "_body") schema
      in
      let spread = if required then spread_fields ctx ~params ty else None in
      Json_body { body_ty = ty; body_required = required; spread }
  | [ ("multipart/form-data", content) ] -> (
      let schema_at = at / "content" / "multipart~1form-data" / "schema" in
      let schema = Option.value (Spec.member "schema" content) ~default:`Null in
      let target_at, resolved = L.target ctx ~at:schema_at schema in
      let parts =
        L.fields_of ctx ~at:target_at ~parent:(fn ^ "_part") resolved
      in
      match List.find_opt (fun f -> f.ty <> Prim String) parts with
      | Some part ->
          Spec.unsupported ~at:schema_at
            "multipart part %S is not a string or binary" part.json_name
      | None ->
          let binary =
            List.filter_map
              (fun (key, property) ->
                let property = Spec.resolve ctx.L.spec ~at property in
                if Spec.string "format" property = Some "binary" then Some key
                else None)
              (Spec.assoc "properties" resolved)
          in
          Multipart_body { parts; binary; multipart_required = required })
  | [ (content_type, _) ] -> Raw_body { content_type; raw_required = required }
  | [] -> Spec.unsupported ~at "a request body without content"
  | _ -> Spec.unsupported ~at "a request body with several media types"

let operations ctx ~values =
  List.concat_map
    (fun (path, item) ->
      let item_at = "#/paths" / escape_key path in
      List.filter_map
        (fun meth ->
          match Spec.member meth item with
          | None -> None
          | Some op ->
              let at = item_at / meth in
              let operation_id =
                match Spec.string "operationId" op with
                | Some id -> id
                | None ->
                    Spec.unsupported ~at "an operation without operationId"
              in
              let fn = Naming.fresh values (Naming.snake operation_id) in
              (* "body" is the request body's argument; a parameter gets body_2. *)
              let names = Naming.namespace () in
              Naming.claim names "body" ~what:"request body argument";
              let raw =
                merge_params
                  (Spec.list "parameters" item)
                  (Spec.list "parameters" op)
              in
              (* Path parameters are named first so they keep their plain names. *)
              let is_path p =
                Spec.string "in" (Spec.resolve ctx.L.spec ~at p) = Some "path"
              in
              let ordered =
                List.filter is_path raw
                @ List.filter (fun p -> not (is_path p)) raw
              in
              let params =
                List.mapi
                  (fun i p ->
                    param ctx
                      ~at:(at / "parameters" / string_of_int i)
                      ~hint:fn names p)
                  ordered
              in
              let body =
                Option.map
                  (body ctx ~at:(at / "requestBody") ~fn ~params)
                  (Spec.member "requestBody" op)
              in
              let responses = Spec.assoc "responses" op in
              let reply = reply ctx ~at ~fn responses in
              let errors = errors ctx ~at ~fn responses in
              let reply_type =
                match reply with
                | By_status _ ->
                    Some
                      (Naming.fresh ctx.L.types
                         (Naming.type_name (fn ^ "_reply")))
                | Single _ -> None
              in
              let error_type =
                match errors with
                | Error_by_status _ ->
                    Some
                      (Naming.fresh ctx.L.types
                         (Naming.type_name (fn ^ "_error")))
                | _ -> None
              in
              Some
                {
                  operation_id;
                  fn_name = fn;
                  meth;
                  path;
                  params;
                  body;
                  reply;
                  reply_type;
                  errors;
                  error_type;
                  summary =
                    (match Spec.string "summary" op with
                    | Some s -> Some s
                    | None -> Spec.string "description" op);
                })
        methods)
    ctx.L.spec.paths

let service spec =
  let ctx = L.create spec in
  L.define_components ctx;
  let values = Naming.namespace () in
  let operations = operations ctx ~values in
  {
    spec_name = spec.Spec.name;
    module_name = Naming.module_name spec.name;
    defs = List.rev ctx.defs;
    operations;
    untyped = List.sort_uniq compare ctx.untyped;
  }
