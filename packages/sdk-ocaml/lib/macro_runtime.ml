(* The transport and codec helpers the generated client calls. Not for
   programs: nothing here carries [@@macro.op] or [@@macro.pure], so a
   program that names it is refused before it runs, and only the generated
   operations (each marked with its operation) can send a request.

   [call] sends one blocking HTTP/1.1 request to
   $MACRO_SDK_PROXY_URL/api/<service><path>?<query> with
   [authorization: Bearer $MACRO_SDK_RUN_TOKEN], reads the reply to its
   Content-Length or last chunk (never to end of file: the proxy keeps
   connections open), and raises [Macro_error.Error] for a status that is
   not a success. *)

type json = Yojson.Safe.t

let error ?(status = 0) code message = raise (Macro_error.Error { code; message; status })

(* Encoding *)

let obj fields =
  `Assoc (List.filter_map (fun (key, value) -> Option.map (fun v -> (key, v)) value) fields)

let enc_null () : json = `Null
let enc_empty () : json = `Assoc []

(* A tagged union member: its encoding with the tag field set. *)
let set_field name (value : json) (encoded : json) : json =
  match encoded with
  | `Assoc fields -> `Assoc ((name, value) :: List.remove_assoc name fields)
  | other -> `Assoc [ (name, value); ("value", other) ]

(* Decoding. Generated decoders raise [Decode_error]; [decode] turns it into
   a [Macro.Error] with code [decode]. *)

exception Decode_error of string

let show value =
  let text = Yojson.Safe.to_string value in
  if String.length text > 200 then String.sub text 0 197 ^ "..." else text

let fail expected value = raise (Decode_error (Printf.sprintf "expected %s, got %s" expected (show value)))
let dec_string = function `String s -> s | value -> fail "a string" value

let dec_int = function
  | `Int i -> i
  | `Intlit s as value -> ( match int_of_string_opt s with Some i -> i | None -> fail "an integer" value)
  | `Float f when Float.is_integer f && Float.abs f < 4e18 -> int_of_float f
  | value -> fail "an integer" value

(* In a union with a number member, 3.0 is the number. *)
let dec_int_strict = function `Int _ | `Intlit _ as value -> dec_int value | value -> fail "an integer" value

let dec_float = function
  | `Float f -> f
  | `Int i -> float_of_int i
  | `Intlit s -> float_of_string s
  | value -> fail "a number" value

let dec_bool = function `Bool b -> b | value -> fail "a boolean" value
let dec_null = function `Null -> () | value -> fail "null" value
let dec_empty = function `Assoc _ -> () | value -> fail "an object" value
let dec_list = function `List items -> items | value -> fail "an array" value
let dec_assoc = function `Assoc fields -> fields | value -> fail "an object" value

let field value name =
  match value with
  | `Assoc fields -> Option.value (List.assoc_opt name fields) ~default:`Null
  | value -> fail "an object" value

(* A required field: absent is an error, so a union decoder can tell members
   apart by the fields they require. *)
let req_field value name =
  match value with
  | `Assoc fields -> (
      match List.assoc_opt name fields with
      | Some field -> field
      | None -> fail (Printf.sprintf "an object with %S" name) value)
  | value -> fail "an object" value

let opt_field value name decode =
  match field value name with `Null -> None | present -> Some (decode present)

let num_eq value expected =
  match value with
  | `Int i -> float_of_int i = expected
  | `Float f -> f = expected
  | `Intlit s -> float_of_string_opt s = Some expected
  | _ -> false

(* A record's constant field (the tag of a union member) must have its
   value, so a union decoder picks the right member. *)
let expect_field value name (expected : json) =
  let actual = field value name in
  let same =
    match expected with
    | `Int i -> num_eq actual (float_of_int i)
    | `Float f -> num_eq actual f
    | expected -> actual = expected
  in
  if not same then fail (Printf.sprintf "%s = %s" name (Yojson.Safe.to_string expected)) actual

(* An untagged union: the first member whose decoder accepts the value. *)
let attempt value decoders =
  let rec go = function
    | [] -> fail "one of the union's shapes" value
    | decode :: rest -> ( try decode value with Decode_error _ -> go rest)
  in
  go decoders

let decode what decoder value =
  try decoder value
  with Decode_error message -> error "decode" (Printf.sprintf "%s: unexpected JSON: %s" what message)

(* Parameters *)

let float_text f =
  let rec go precision =
    let text = Printf.sprintf "%.*g" precision f in
    if precision >= 17 || float_of_string text = f then text else go (precision + 1)
  in
  go 15

let scalar_text name = function
  | `String s -> s
  | `Int i -> string_of_int i
  | `Intlit s -> s
  | `Float f -> float_text f
  | `Bool b -> string_of_bool b
  | value -> error "invalid" (Printf.sprintf "parameter %s: %s is not a string, number or boolean" name (show value))

let unreserved = function 'A' .. 'Z' | 'a' .. 'z' | '0' .. '9' | '-' | '.' | '_' | '~' -> true | _ -> false

(* Percent-encodes everything but RFC 3986's unreserved characters, so the
   result is safe as one path segment or one query key or value. *)
let percent_encode text =
  let out = Buffer.create (String.length text * 3) in
  String.iter
    (fun c ->
      if unreserved c then Buffer.add_char out c else Buffer.add_string out (Printf.sprintf "%%%02X" (Char.code c)))
    text;
  Buffer.contents out

(* One path parameter, encoded as one segment. The proxy refuses empty and
   dot segments and an encoded slash, backslash, % or control character (a
   router on the way might read them differently), so such a value fails
   here, before any request. *)
let path_segment name (value : json) =
  let text = scalar_text name value in
  let refused = function '/' | '\\' | '%' -> true | c -> Char.code c < 0x20 || Char.code c = 0x7f in
  if text = "" || text = "." || text = ".." || String.exists refused text then
    error "invalid"
      (Printf.sprintf
         "path parameter %s: %S can't be sent as one path segment (empty, a dot segment, or a slash, backslash, %% or control character)"
         name text);
  percent_encode text

(* One query parameter (style form, explode true): an array repeats the
   key, null leaves it out. *)
let query name (value : json) =
  match value with
  | `Null -> []
  | `List items -> List.map (fun item -> (name, scalar_text name item)) items
  | value -> [ (name, scalar_text name value) ]

let query_opt name encode = function None -> [] | Some value -> query name (encode value)
let header name (value : json) = match value with `Null -> [] | value -> [ (name, scalar_text name value) ]
let header_opt name encode = function None -> [] | Some value -> header name (encode value)

(* multipart/form-data: each part is a text field or a file. *)
type part = Text of string | File of string

let multipart parts =
  let boundary = Printf.sprintf "macro-sdk-%08x%08x" (Random.bits ()) (Random.bits ()) in
  let out = Buffer.create 1024 in
  List.iter
    (fun (name, part) ->
      Buffer.add_string out (Printf.sprintf "--%s\r\n" boundary);
      (match part with
      | Text text ->
          Buffer.add_string out (Printf.sprintf "content-disposition: form-data; name=%S\r\n\r\n" name);
          Buffer.add_string out text
      | File bytes ->
          Buffer.add_string out
            (Printf.sprintf
               "content-disposition: form-data; name=%S; filename=%S\r\ncontent-type: application/octet-stream\r\n\r\n"
               name name);
          Buffer.add_string out bytes);
      Buffer.add_string out "\r\n")
    parts;
  Buffer.add_string out (Printf.sprintf "--%s--\r\n" boundary);
  ("multipart/form-data; boundary=" ^ boundary, Buffer.contents out)

(* HTTP *)

let env name =
  match Sys.getenv_opt name with Some value when value <> "" -> value | _ -> error "internal" (name ^ " is not set")

(* "http://host:port/prefix" -> host, port, prefix *)
let parse_url url =
  let prefix = "http://" in
  let n = String.length prefix in
  if String.length url < n || String.sub url 0 n <> prefix then
    error "internal" ("MACRO_SDK_PROXY_URL must be an http:// URL: " ^ url);
  let rest = String.sub url n (String.length url - n) in
  let authority, path =
    match String.index_opt rest '/' with
    | Some i -> (String.sub rest 0 i, String.sub rest i (String.length rest - i))
    | None -> (rest, "")
  in
  let host, port =
    match String.rindex_opt authority ':' with
    | Some i -> (
        let port = String.sub authority (i + 1) (String.length authority - i - 1) in
        match int_of_string_opt port with
        | Some port -> (String.sub authority 0 i, port)
        | None -> error "internal" ("bad port in MACRO_SDK_PROXY_URL: " ^ url))
    | None -> (authority, 80)
  in
  let path =
    if String.length path > 0 && path.[String.length path - 1] = '/' then String.sub path 0 (String.length path - 1)
    else path
  in
  (host, port, path)

let rec write_all socket bytes offset length =
  if length > 0 then
    let written = Unix.write socket bytes offset length in
    write_all socket bytes (offset + written) (length - written)

type response = { status : int; headers : (string * string) list; body : string }

let header_value headers name = List.assoc_opt name headers

(* A buffered reader over the socket: what has arrived, and a cursor. *)
type reader = { socket : Unix.file_descr; buffer : Buffer.t; chunk : Bytes.t; mutable position : int }

let more reader =
  match Unix.read reader.socket reader.chunk 0 (Bytes.length reader.chunk) with
  | 0 -> error "internal" "the SDK proxy closed the connection in the middle of its reply"
  | n -> Buffer.add_subbytes reader.buffer reader.chunk 0 n

let available reader = Buffer.length reader.buffer - reader.position

(* The next line, without its CRLF. *)
let rec line reader =
  let text = Buffer.contents reader.buffer in
  match String.index_from_opt text reader.position '\n' with
  | Some i ->
      let stop = if i > reader.position && text.[i - 1] = '\r' then i - 1 else i in
      let value = String.sub text reader.position (stop - reader.position) in
      reader.position <- i + 1;
      value
  | None ->
      more reader;
      line reader

let rec take reader length =
  if available reader >= length then (
    let value = Buffer.sub reader.buffer reader.position length in
    reader.position <- reader.position + length;
    value)
  else (
    more reader;
    take reader length)

let read_chunked reader =
  let out = Buffer.create 4096 in
  let rec chunks () =
    let size_line = line reader in
    let size_text = match String.index_opt size_line ';' with Some i -> String.sub size_line 0 i | None -> size_line in
    match int_of_string_opt ("0x" ^ String.trim size_text) with
    | None -> error "internal" ("the SDK proxy sent a bad chunk size: " ^ size_line)
    | Some 0 ->
        (* Trailers, up to the empty line that ends the reply. *)
        let rec trailers () = if line reader <> "" then trailers () in
        trailers ()
    | Some size ->
        Buffer.add_string out (take reader size);
        ignore (take reader 2);
        chunks ()
  in
  chunks ();
  Buffer.contents out

(* Read one reply: to its Content-Length or its last chunk, never to end of
   file. *)
let read_response ~meth socket =
  let reader = { socket; buffer = Buffer.create 4096; chunk = Bytes.create 65536; position = 0 } in
  let rec head () =
    let status_line = line reader in
    let rec headers acc =
      match line reader with
      | "" -> List.rev acc
      | text -> (
          match String.index_opt text ':' with
          | Some i ->
              let name = String.lowercase_ascii (String.trim (String.sub text 0 i)) in
              let value = String.trim (String.sub text (i + 1) (String.length text - i - 1)) in
              headers ((name, value) :: acc)
          | None -> headers acc)
    in
    let status =
      match String.split_on_char ' ' status_line with
      | _ :: code :: _ -> Option.value (int_of_string_opt code) ~default:0
      | _ -> 0
    in
    let headers = headers [] in
    (* 1xx replies come before the real one. *)
    if status >= 100 && status < 200 then head () else (status, headers)
  in
  let status, headers = head () in
  let chunked =
    match header_value headers "transfer-encoding" with
    | Some encoding -> String.lowercase_ascii encoding = "chunked"
    | None -> false
  in
  let body =
    if meth = "HEAD" || status = 204 || status = 304 then ""
    else if chunked then read_chunked reader
    else
      match Option.map String.trim (header_value headers "content-length") with
      | Some length -> (
          match int_of_string_opt length with
          | Some length -> take reader length
          | None -> error ~status "internal" ("the SDK proxy sent a bad content-length: " ^ length))
      | None ->
          error ~status "internal" "the SDK proxy replied without a content-length or chunked transfer encoding"
  in
  { status; headers; body }

let sigpipe_ignored = ref false

let send ~host ~port ~meth ~target ~headers ~body =
  if not !sigpipe_ignored then (
    Sys.set_signal Sys.sigpipe Sys.Signal_ignore;
    sigpipe_ignored := true);
  let address =
    match Unix.getaddrinfo host (string_of_int port) [ Unix.AI_SOCKTYPE Unix.SOCK_STREAM ] with
    | info :: _ -> info.Unix.ai_addr
    | [] -> error "internal" ("cannot resolve the SDK proxy host " ^ host)
  in
  let socket = Unix.socket (Unix.domain_of_sockaddr address) Unix.SOCK_STREAM 0 in
  Fun.protect
    ~finally:(fun () -> try Unix.close socket with Unix.Unix_error _ -> ())
    (fun () ->
      Unix.connect socket address;
      let lines =
        (Printf.sprintf "%s %s HTTP/1.1" meth target :: Printf.sprintf "host: %s:%d" host port :: headers)
        @ [ Printf.sprintf "content-length: %d" (String.length body); "connection: close"; ""; "" ]
      in
      let request = String.concat "\r\n" lines ^ body in
      let bytes = Bytes.of_string request in
      write_all socket bytes 0 (Bytes.length bytes);
      read_response ~meth socket)

let code_of_status status =
  match status with
  | 400 | 422 -> "invalid"
  | 401 -> "unauthorized"
  | 402 -> "payment_required"
  | 403 -> "forbidden"
  | 404 | 410 -> "not_found"
  | 409 | 412 -> "conflict"
  | 413 -> "too_large"
  | 429 -> "rate_limited"
  | status when status >= 500 -> "internal"
  | _ -> "failed"

(* The code and message of a failed reply. The proxy's own replies carry
   [x-macro-proxy: refused] and {"error": {"code", "message"}}; a service's
   carry {"message"} or text. *)
let failure ~operation response =
  let parsed = try Some (Yojson.Safe.from_string response.body) with Yojson.Json_error _ -> None in
  let string_at path =
    let rec go value = function
      | [] -> ( match value with `String s -> Some s | _ -> None)
      | key :: rest -> ( match value with `Assoc fields -> Option.bind (List.assoc_opt key fields) (fun v -> go v rest) | _ -> None)
    in
    Option.bind parsed (fun value -> go value path)
  in
  let refused = header_value response.headers "x-macro-proxy" = Some "refused" in
  let code =
    if refused then Option.value (string_at [ "error"; "code" ]) ~default:(code_of_status response.status)
    else code_of_status response.status
  in
  let detail =
    match (string_at [ "error"; "message" ], string_at [ "message" ], string_at [ "error" ]) with
    | Some message, _, _ | None, Some message, _ | None, None, Some message -> message
    | None, None, None ->
        let text = String.trim response.body in
        if String.length text > 500 then String.sub text 0 497 ^ "..." else text
  in
  let source = if refused then "the SDK proxy refused it" else Printf.sprintf "HTTP %d" response.status in
  let message =
    if detail = "" then Printf.sprintf "%s: %s" operation source else Printf.sprintf "%s: %s: %s" operation source detail
  in
  error ~status:response.status code message

(* Send one operation's request. [path] is already encoded; [query] pairs
   are not. A 2xx reply, or one of the operation's other success statuses
   [ok], is returned; anything else raises. *)
let call ~operation ~service ~meth ~path ~query ~headers ~body ~accept ~ok =
  let url = env "MACRO_SDK_PROXY_URL" in
  let token = env "MACRO_SDK_RUN_TOKEN" in
  let host, port, prefix = parse_url url in
  let query_text =
    match query with
    | [] -> ""
    | pairs -> "?" ^ String.concat "&" (List.map (fun (k, v) -> percent_encode k ^ "=" ^ percent_encode v) pairs)
  in
  let target = prefix ^ "/api/" ^ service ^ path ^ query_text in
  let content_type, payload = match body with Some (content_type, text) -> ([ "content-type: " ^ content_type ], text) | None -> ([], "") in
  let headers =
    (("authorization: Bearer " ^ token) :: ("accept: " ^ accept) :: content_type)
    @ List.map (fun (name, value) -> name ^ ": " ^ value) headers
  in
  let response =
    try send ~host ~port ~meth ~target ~headers ~body:payload
    with Unix.Unix_error (problem, _, _) ->
      error "unreachable"
        (Printf.sprintf "%s: cannot reach the SDK proxy at %s: %s" operation url (Unix.error_message problem))
  in
  if (response.status >= 200 && response.status < 300) || List.mem response.status ok then response
  else failure ~operation response

let json_text (value : json) = Yojson.Safe.to_string value

(* Results *)

let json_result ~operation decoder response =
  let value =
    try Yojson.Safe.from_string response.body
    with Yojson.Json_error message ->
      error ~status:response.status "decode" (Printf.sprintf "%s: the reply is not JSON: %s" operation message)
  in
  try decoder value
  with Decode_error message ->
    error ~status:response.status "decode" (Printf.sprintf "%s returned an unexpected result: %s" operation message)

let text_result response = response.body
let unit_result (_ : response) = ()
let is_empty response = String.trim response.body = ""

let unexpected_status ~operation response =
  error ~status:response.status "decode" (Printf.sprintf "%s: no result type for HTTP %d" operation response.status)
