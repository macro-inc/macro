(* A call described without doing any I/O: generated operations build a
   [t], a transport sends [prepare]'s result and hands the reply to [interpret]. *)

type meth = [ `GET | `POST | `PUT | `PATCH | `DELETE ]

type part = {
  name : string;
  filename : string option;
  content_type : string option;
  data : string;
}

type file = { filename : string; content_type : string; data : string }
(** A file for a binary multipart part: the server reads its name and type. *)

type body =
  | Json of Json.t
  | Raw of { content_type : string; data : string }
  | Multipart of part list

(** The error body type of operations that declare none. *)
type no_error = |

type ('reply, 'error) t = {
  service : string;  (** spec name, e.g. "storage" *)
  operation : string;  (** operationId *)
  meth : meth;
  path : string;  (** path parameters already substituted and encoded *)
  query : (string * string list) list;
  headers : (string * string) list;
  body : body option;
  decode_reply : status:int -> string -> 'reply;
      (** decodes a 2xx body; raises [Json.Decode_error] *)
  decode_error : status:int -> string -> 'error option;
      (** decodes a declared error body; [None] for undeclared statuses *)
}

(* Percent-encode a path parameter: everything but RFC 3986 unreserved
   characters, so a value can never add a segment or start the query. *)
let segment value =
  let buffer = Buffer.create (String.length value) in
  String.iter
    (fun c ->
      match c with
      | 'A' .. 'Z' | 'a' .. 'z' | '0' .. '9' | '-' | '.' | '_' | '~' ->
          Buffer.add_char buffer c
      | c -> Buffer.add_string buffer (Printf.sprintf "%%%02X" (Char.code c)))
    value;
  Buffer.contents buffer

(* ---------- reply decoders used by generated code ---------- *)

let json decode ~status:_ body = decode (Yojson.Safe.from_string body)
let text ~status:_ body = body
let unit ~status:_ _ = ()
let no_error ~status:_ _ = None

let by_status decoders ~status body =
  match List.assoc_opt status decoders with
  | Some decode -> decode body
  | None -> Json.fail "undeclared success status %d" status

let error_json statuses decode ~status body =
  if List.mem status statuses then Some (decode (Yojson.Safe.from_string body))
  else None

(* ---------- wire form ---------- *)

type wire = {
  wire_meth : meth;
  uri : Uri.t;
  wire_headers : (string * string) list;
  wire_body : string option;
}

let random = lazy (Random.State.make_self_init ())

(* A fresh boundary that occurs in no part, so data can never end its part
   early or start another (RFC 2046 section 5.1.1). *)
let boundary_for parts =
  let occurs_in boundary =
    List.exists
      (fun (part : part) ->
        let rec search i =
          i + String.length boundary <= String.length part.data
          && (String.sub part.data i (String.length boundary) = boundary
             || search (i + 1))
        in
        search 0)
      parts
  in
  let rec pick () =
    let state = Lazy.force random in
    let boundary =
      "macro-sdk-"
      ^ String.init 24 (fun _ -> "0123456789abcdef".[Random.State.int state 16])
    in
    if occurs_in boundary then pick () else boundary
  in
  pick ()

(* Header parameter values per RFC 7578 section 4.2: UTF-8 as is, with only
   the quote and CR/LF percent-encoded. *)
let quoted value =
  let buffer = Buffer.create (String.length value + 2) in
  Buffer.add_char buffer '"';
  String.iter
    (function
      | '"' -> Buffer.add_string buffer "%22"
      | '\r' -> Buffer.add_string buffer "%0D"
      | '\n' -> Buffer.add_string buffer "%0A"
      | c -> Buffer.add_char buffer c)
    value;
  Buffer.add_char buffer '"';
  Buffer.contents buffer

let encode_part boundary ({ name; filename; content_type; data } : part) =
  let disposition =
    match filename with
    | Some file ->
        Printf.sprintf "form-data; name=%s; filename=%s" (quoted name)
          (quoted file)
    | None -> Printf.sprintf "form-data; name=%s" (quoted name)
  in
  let type_line =
    match content_type with
    | Some ct -> "Content-Type: " ^ ct ^ "\r\n"
    | None -> ""
  in
  Printf.sprintf "--%s\r\nContent-Disposition: %s\r\n%s\r\n%s\r\n" boundary
    disposition type_line data

(* The content type and bytes of a body. [boundary] is for tests. *)
let encode_body ?boundary = function
  | Json json -> ("application/json", Yojson.Safe.to_string json)
  | Raw { content_type; data } -> (content_type, data)
  | Multipart parts ->
      let boundary =
        match boundary with Some b -> b | None -> boundary_for parts
      in
      ( "multipart/form-data; boundary=" ^ boundary,
        String.concat "" (List.map (encode_part boundary) parts)
        ^ "--" ^ boundary ^ "--\r\n" )

(* Resolve host, auth and body encoding. Operation headers come last so an
   operation's own x-macro-bot-scope is the one sent. *)
let prepare (config : Config.t) request =
  let base = Config.host config request.service in
  (* Array parameters repeat their key (form style, explode), as hey-api sends them. *)
  let query =
    List.concat_map
      (fun (key, values) -> List.map (fun v -> (key, v)) values)
      request.query
  in
  let uri = Uri.with_query' (Uri.of_string (base ^ request.path)) query in
  let has_bot_scope =
    List.exists
      (fun (name, _) -> String.lowercase_ascii name = "x-macro-bot-scope")
      request.headers
  in
  let auth =
    Config.Auth.headers ?requested_as:config.requested_as ~has_bot_scope
      config.auth
  in
  (* A POST, PUT or PATCH without a body still says it has none: some
     proxies refuse such requests without a content length. *)
  let content_type, wire_body =
    match request.body with
    | None when request.meth = `GET || request.meth = `DELETE -> ([], None)
    | None -> ([], Some "")
    | Some body ->
        let content_type, data = encode_body body in
        ([ ("content-type", content_type) ], Some data)
  in
  {
    wire_meth = request.meth;
    uri;
    wire_headers =
      (("accept", "application/json") :: content_type) @ auth @ request.headers;
    wire_body;
  }

(* Turn a status and body into the call's result. *)
let interpret request ~status body : ('reply, 'error Error.t) result =
  if status >= 200 && status < 300 then
    match request.decode_reply ~status body with
    | reply -> Ok reply
    | exception (Json.Decode_error message | Yojson.Json_error message) ->
        Error (Error.Decode { status; message; body })
  else
    match request.decode_error ~status body with
    | Some error -> Error (Error.Api { status; error; body })
    | None -> Error (Error.Http { status; body })
    | exception (Json.Decode_error _ | Yojson.Json_error _) ->
        Error (Error.Http { status; body })
