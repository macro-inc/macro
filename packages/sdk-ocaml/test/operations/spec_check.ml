(* Checks a generated case against the OpenAPI spec itself, independently of
   the generator: a small JSON Schema validator for request bodies, sample
   replies built from the response schemas, and the method, path, query and
   header parameters the spec declares. *)

type json = Yojson.Safe.t

let member key = function
  | `Assoc fields -> List.assoc_opt key fields
  | _ -> None

let string key json =
  match member key json with Some (`String s) -> Some s | _ -> None

let list key json =
  match member key json with Some (`List items) -> items | _ -> []

let assoc key json =
  match member key json with Some (`Assoc fields) -> fields | _ -> []

let strings key json =
  List.filter_map (function `String s -> Some s | _ -> None) (list key json)

type spec = { name : string; document : json }

let load ~dir name =
  {
    name;
    document = Yojson.Safe.from_file (Filename.concat dir (name ^ ".json"));
  }

let components spec =
  assoc "schemas"
    (Option.value (member "components" spec.document) ~default:`Null)

let rec resolve spec schema =
  match string "$ref" schema with
  | Some reference ->
      let name = List.nth (String.split_on_char '/' reference) 3 in
      resolve spec (List.assoc name (components spec))
  | None -> schema

let union_members schema =
  match list "oneOf" schema with
  | [] -> list "anyOf" schema
  | members -> members

let is_null schema = string "type" schema = Some "null"

(* ---------- validation ---------- *)

let matches_type json = function
  | "string" -> ( match json with `String _ -> true | _ -> false)
  | "integer" -> ( match json with `Int _ | `Intlit _ -> true | _ -> false)
  | "number" -> (
      match json with `Int _ | `Intlit _ | `Float _ -> true | _ -> false)
  | "boolean" -> ( match json with `Bool _ -> true | _ -> false)
  | "null" -> json = `Null
  | "array" -> ( match json with `List _ -> true | _ -> false)
  | "object" -> ( match json with `Assoc _ -> true | _ -> false)
  | _ -> false

(* Property names an allOf composition contributes, through nested
   compositions, so each member accepts its siblings' keys. *)
let declared_keys spec schema =
  let rec go seen schema =
    match string "$ref" schema with
    | Some reference when List.mem reference seen -> []
    | Some reference -> go (reference :: seen) (resolve spec schema)
    | None ->
        List.map fst (assoc "properties" schema)
        @ List.concat_map (go seen) (list "allOf" schema @ union_members schema)
  in
  go [] schema

let rec validate spec ?(allowed = []) ~at schema (json : json) =
  match schema with
  | `Bool true -> []
  | `Assoc _ -> (
      match string "$ref" schema with
      | Some _ -> validate spec ~allowed ~at (resolve spec schema) json
      | None ->
          let errors = ref [] in
          let fail fmt =
            Printf.ksprintf (fun m -> errors := (at ^ ": " ^ m) :: !errors) fmt
          in
          let types =
            match member "type" schema with
            | Some (`String t) -> [ t ]
            | Some (`List _) -> strings "type" schema
            | _ -> []
          in
          if types <> [] && not (List.exists (matches_type json) types) then
            fail "expected %s, got %s" (String.concat "|" types)
              (Yojson.Safe.to_string json);
          (match member "enum" schema with
          | Some (`List values) when not (List.mem json values) ->
              fail "%s is not in the enum" (Yojson.Safe.to_string json)
          | _ -> ());
          (match json with
          | `Assoc fields ->
              let properties = assoc "properties" schema in
              List.iter
                (fun key ->
                  if not (List.mem_assoc key fields) then
                    fail "missing required %S" key)
                (strings "required" schema);
              List.iter
                (fun (key, value) ->
                  match List.assoc_opt key properties with
                  | Some property ->
                      errors :=
                        validate spec ~at:(at ^ "/" ^ key) property value
                        @ !errors
                  | None -> (
                      match member "additionalProperties" schema with
                      | Some (`Assoc _ as values) ->
                          errors :=
                            validate spec ~at:(at ^ "/" ^ key) values value
                            @ !errors
                      | Some (`Bool true) -> ()
                      | _ ->
                          if
                            (properties <> []
                            || member "additionalProperties" schema
                               = Some (`Bool false))
                            && not (List.mem key allowed)
                          then fail "unexpected property %S" key))
                fields
          | `List items -> (
              match member "items" schema with
              | Some items_schema ->
                  List.iteri
                    (fun i item ->
                      errors :=
                        validate spec
                          ~at:(Printf.sprintf "%s/%d" at i)
                          items_schema item
                        @ !errors)
                    items
              | None -> ())
          | _ -> ());
          let all_of = list "allOf" schema in
          if all_of <> [] then begin
            let allowed =
              allowed @ List.concat_map (declared_keys spec) all_of
            in
            List.iter
              (fun m -> errors := validate spec ~allowed ~at m json @ !errors)
              all_of
          end;
          (match union_members schema with
          | [] -> ()
          | members ->
              if
                not
                  (List.exists
                     (fun m -> validate spec ~allowed ~at m json = [])
                     members)
              then
                fail "matches no member of the union: %s"
                  (Yojson.Safe.to_string json));
          List.rev !errors)
  | _ -> [ at ^ ": schema is not an object" ]

(* ---------- sample replies ---------- *)

let shallow = 2

let merge objects =
  `Assoc
    (List.concat_map (function `Assoc fields -> fields | _ -> []) objects)

let rec sample spec ?(depth = 0) schema : json =
  if depth > 40 then failwith "sample: schema never ends";
  let deep = depth > shallow in
  match schema with
  | `Bool true -> `Assoc []
  | _ -> (
      match string "$ref" schema with
      | Some _ -> sample spec ~depth:(depth + 1) (resolve spec schema)
      | None -> (
          let members =
            List.filter (fun m -> not (is_null m)) (union_members schema)
          in
          match (members, list "allOf" schema) with
          | first :: _, _ -> (
              match member "discriminator" schema with
              | Some discriminator -> (
                  (* The tag value is the mapping key for the first member. *)
                  let tag = Option.get (string "propertyName" discriminator) in
                  let reference = Option.get (string "$ref" first) in
                  let value =
                    match
                      List.find_opt
                        (fun (_, target) -> target = `String reference)
                        (assoc "mapping" discriminator)
                    with
                    | Some (key, _) -> key
                    | None -> List.nth (String.split_on_char '/' reference) 3
                  in
                  match sample spec ~depth first with
                  | `Assoc fields ->
                      `Assoc
                        ((tag, `String value) :: List.remove_assoc tag fields)
                  | other -> other)
              | None -> sample spec ~depth first)
          | [], (_ :: _ as all_of) ->
              merge (List.map (sample spec ~depth) all_of)
          | [], [] -> (
              match member "enum" schema with
              | Some (`List (first :: _)) -> first
              | _ -> (
                  let types =
                    match member "type" schema with
                    | Some (`String t) -> [ t ]
                    | Some (`List _) -> strings "type" schema
                    | _ -> []
                  in
                  match List.filter (( <> ) "null") types with
                  | "string" :: _ -> `String "sample"
                  | "integer" :: _ -> `Int 1
                  | "number" :: _ -> `Float 1.5
                  | "boolean" :: _ -> `Bool true
                  | "array" :: _ ->
                      if deep then `List []
                      else
                        `List
                          [
                            sample spec ~depth:(depth + 1)
                              (Option.value (member "items" schema)
                                 ~default:(`Bool true));
                          ]
                  | _ -> (
                      let required = strings "required" schema in
                      match
                        ( assoc "properties" schema,
                          member "additionalProperties" schema )
                      with
                      | [], Some (`Assoc _ as values) ->
                          if deep then `Assoc []
                          else
                            `Assoc
                              [ ("key", sample spec ~depth:(depth + 1) values) ]
                      | properties, _ ->
                          `Assoc
                            (List.filter_map
                               (fun (key, property) ->
                                 if List.mem key required || not deep then
                                   Some
                                     ( key,
                                       sample spec ~depth:(depth + 1) property
                                     )
                                 else None)
                               properties))))))

(* ---------- one operation ---------- *)

let methods = [ "get"; "put"; "post"; "delete"; "patch" ]

(* By path and method: operationIds are not always unique within a spec. *)
let find_operation spec ~path ~meth =
  match List.assoc_opt path (assoc "paths" spec.document) with
  | Some item ->
      Option.map (fun op -> (path, meth, item, op)) (member meth item)
  | None -> None

let parameters spec item op =
  let op_params = List.map (resolve spec) (list "parameters" op) in
  let key p = (string "name" p, string "in" p) in
  List.filter
    (fun p -> not (List.exists (fun q -> key q = key p) op_params))
    (List.map (resolve spec) (list "parameters" item))
  @ op_params

let canonical json = Yojson.Safe.sort json

let short json =
  let s = Yojson.Safe.to_string json in
  if String.length s > 300 then String.sub s 0 300 ^ "..." else s

let check spec (case : Cases_support.t) =
  let wire = case.wire in
  let wire_meth =
    String.lowercase_ascii
      (match wire.wire_meth with
      | `GET -> "get"
      | `POST -> "post"
      | `PUT -> "put"
      | `PATCH -> "patch"
      | `DELETE -> "delete")
  in
  match find_operation spec ~path:case.path ~meth:wire_meth with
  | None -> [ Printf.sprintf "no %s %s in the spec" wire_meth case.path ]
  | Some (path, _, item, op) ->
      let errors = ref [] in
      let fail fmt = Printf.ksprintf (fun m -> errors := m :: !errors) fmt in
      if string "operationId" op <> Some case.operation_id then
        fail "operationId differs";

      (* Path: the host's base path, then the template with every
         parameter filled. *)
      let base =
        Uri.path
          (Uri.of_string (Macro_sdk.Config.host Cases_support.config spec.name))
      in
      let actual = Uri.path wire.uri in
      if not (String.starts_with ~prefix:base actual) then
        fail "path %s is not under %s" actual base
      else begin
        let rest =
          String.sub actual (String.length base)
            (String.length actual - String.length base)
        in
        let segments s = String.split_on_char '/' s in
        let template = segments path and got = segments rest in
        if List.length template <> List.length got then
          fail "path %s does not match %s" rest path
        else
          List.iter2
            (fun t g ->
              let is_param = String.length t > 1 && t.[0] = '{' in
              if is_param && g = "" then fail "empty path parameter %s" t
              else if (not is_param) && t <> g then
                fail "path segment %S, spec says %S" g t)
            template got
      end;

      (* Every declared query and header parameter is sent (cases pass
         every argument); nothing undeclared is. *)
      let params = parameters spec item op in
      let declared location =
        List.filter_map
          (fun p ->
            if string "in" p = Some location then string "name" p else None)
          params
      in
      let query_keys =
        List.sort_uniq compare (List.map fst (Uri.query wire.uri))
      in
      if query_keys <> List.sort_uniq compare (declared "query") then
        fail "query keys [%s], spec declares [%s]"
          (String.concat "," query_keys)
          (String.concat "," (declared "query"));
      let header_names =
        List.map (fun (k, _) -> String.lowercase_ascii k) wire.wire_headers
      in
      List.iter
        (fun h ->
          if not (List.mem (String.lowercase_ascii h) header_names) then
            fail "header %s not sent" h)
        (declared "header");
      if not (List.mem "authorization" header_names) then fail "no auth header";

      (* Body. *)
      let header name =
        List.assoc_opt name
          (List.map
             (fun (k, v) -> (String.lowercase_ascii k, v))
             wire.wire_headers)
      in
      (match (member "requestBody" op, wire.wire_body) with
      | None, None -> ()
      | None, Some _ -> fail "sends a body the spec does not declare"
      | Some _, None -> fail "sends no body"
      | Some request_body, Some body -> (
          match assoc "content" (resolve spec request_body) with
          | [ ("application/json", content) ] -> (
              if header "content-type" <> Some "application/json" then
                fail "JSON body without its content type";
              match Yojson.Safe.from_string body with
              | json ->
                  List.iter
                    (fun e -> fail "body %s" e)
                    (validate spec ~at:""
                       (Option.value (member "schema" content)
                          ~default:(`Bool true))
                       json)
              | exception Yojson.Json_error m -> fail "body is not JSON: %s" m)
          | [ ("multipart/form-data", content) ] ->
              if
                not
                  (String.starts_with ~prefix:"multipart/form-data"
                     (Option.value (header "content-type") ~default:""))
              then fail "multipart content type";
              let schema =
                resolve spec
                  (Option.value (member "schema" content) ~default:`Null)
              in
              List.iter
                (fun part ->
                  let needle = Printf.sprintf "name=%S" part in
                  let rec contains i =
                    i + String.length needle <= String.length body
                    && (String.sub body i (String.length needle) = needle
                       || contains (i + 1))
                  in
                  if not (contains 0) then fail "multipart part %s missing" part)
                (strings "required" schema)
          | [ (media_type, _) ] ->
              if header "content-type" <> Some media_type then
                fail "raw body content type %s"
                  (Option.value (header "content-type") ~default:"none")
          | _ -> fail "unexpected request body content"));

      (* Replies: a sample of each declared response goes through the
         operation's decoders and back to JSON unchanged. *)
      List.iter
        (fun (code, response) ->
          let status = int_of_string code in
          let success = status >= 200 && status < 300 in
          let content = assoc "content" (resolve spec response) in
          let expect body expected =
            match (case.outcome ~status body, expected) with
            | Cases_support.Reply (Json_reply got), `Json want
            | Api_error got, `Api want ->
                if not (Yojson.Safe.equal (canonical got) (canonical want)) then
                  fail "HTTP %d: round trip changed\n    sent %s\n    got  %s"
                    status (short want) (short got)
            | Reply (Text_reply got), `Text want ->
                if got <> want then fail "HTTP %d: text reply changed" status
            | Reply Empty_reply, `Empty | Http_error, `Http -> ()
            | Decode_error m, _ ->
                fail "HTTP %d: reply did not decode: %s (body %s)" status m
                  (if String.length body > 300 then String.sub body 0 300
                   else body)
            | _ -> fail "HTTP %d: unexpected outcome" status
          in
          match List.assoc_opt "application/json" content with
          | Some json_content -> (
              match member "schema" json_content with
              | Some schema ->
                  let value = sample spec schema in
                  expect
                    (Yojson.Safe.to_string value)
                    (if success then `Json value else `Api value)
              | None -> ())
          | None -> (
              match content with
              | [ ("text/plain", _) ] ->
                  expect "sample text"
                    (if success then `Text "sample text" else `Http)
              | [] -> expect "" (if success then `Empty else `Http)
              | _ ->
                  expect "\x00bytes"
                    (if success then `Text "\x00bytes" else `Http)))
        (assoc "responses" op);
      List.rev !errors
