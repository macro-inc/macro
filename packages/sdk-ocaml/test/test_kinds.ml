(* Codecs and request builders for each shape the generator emits, checked
   with hand-written JSON against test/fixtures/kinds.json. *)

open Kinds
module Error = Macro_sdk_runtime.Error
module Request = Macro_sdk_runtime.Request

let failures = ref 0

let check name condition =
  if not condition then begin
    incr failures;
    Printf.printf "FAIL %s\n" name
  end

let json = Yojson.Safe.from_string
let same a b = Yojson.Safe.equal (Yojson.Safe.sort a) (Yojson.Safe.sort b)

let decodes_to name decode encode text expected =
  let value = decode (json text) in
  check (name ^ ": decodes") (value = expected);
  check (name ^ ": encodes back") (same (encode value) (json text))

let rejects name decode text =
  match decode (json text) with
  | _ -> check (name ^ ": rejected") false
  | exception Macro_sdk_runtime.Json.Decode_error _ -> ()

let () =
  (* Tagged by an arbitrary key, with inline fields, no fields, and the
     allOf [$ref, tag] form. Unknown tags are kept as received. *)
  decodes_to "tagged inline" shape_of_yojson yojson_of_shape
    {|{"kind":"circle","radius":2.5}|}
    (Circle { radius = 2.5 });
  decodes_to "tagged unit" shape_of_yojson yojson_of_shape {|{"kind":"square"}|}
    Square;
  decodes_to "tagged allOf" shape_of_yojson yojson_of_shape
    {|{"kind":"labeled","text":"hi"}|}
    (Labeled { text = "hi" });
  decodes_to "tagged unknown" shape_of_yojson yojson_of_shape
    {|{"kind":"hexagon","sides":6}|}
    (Unknown (json {|{"kind":"hexagon","sides":6}|}));
  check "make inline case"
    (make_shape_circle ~radius:1.0 () = Circle { radius = 1.0 });
  rejects "tagged without tag" shape_of_yojson {|{"radius":1}|};

  (* Externally tagged: bare strings and single-key objects. *)
  decodes_to "external unit" command_of_yojson yojson_of_command {|"pause"|}
    Pause;
  decodes_to "external value" command_of_yojson yojson_of_command
    {|{"start":{"speed":3}}|}
    (Start { speed = 3 });
  decodes_to "external unknown" command_of_yojson yojson_of_command {|"rewind"|}
    (Unknown (json {|"rewind"|}));

  (* String or object, decided by the value's JSON type. *)
  decodes_to "untagged string" glow_of_yojson yojson_of_glow {|"neon"|}
    (String "neon");
  decodes_to "untagged object" glow_of_yojson yojson_of_glow {|{"size":2.0}|}
    (Glow_2 { size = Some 2.0 });
  decodes_to "untagged unknown" glow_of_yojson yojson_of_glow {|true|}
    (Unknown (`Bool true));

  (* Open enums keep values this version does not know. *)
  decodes_to "enum known" color_of_yojson yojson_of_color {|"green"|} Green;
  decodes_to "enum unknown" color_of_yojson yojson_of_color {|"blue"|}
    (Unknown "blue");

  (* Required-nullable fields are sent as null; optional ones are left out.
     Absent and null both decode to None. *)
  let profile = make_profile ~name:"Ada" () in
  check "nullable sent as null, optional left out"
    (same (yojson_of_profile profile) (json {|{"name":"Ada","bio":null}|}));
  check "absent nullable decodes to None"
    ((profile_of_yojson (json {|{"name":"Ada"}|})).bio = None);
  check "null optional decodes to None"
    ((profile_of_yojson (json {|{"name":"Ada","bio":null,"nickname":null}|}))
       .nickname = None);
  rejects "required field missing" profile_of_yojson {|{"bio":"x"}|};
  rejects "wrong type names its field" profile_of_yojson
    {|{"name":1,"bio":null}|};
  (match
     profile_of_yojson
       (json
          {|{"name":"Ada","bio":null,"shape":{"kind":"circle","radius":"big"}}|})
   with
  | _ -> check "decode error raised" false
  | exception Macro_sdk_runtime.Json.Decode_error message ->
      check "decode error path"
        (message = "shape: radius: expected number, got string"));

  (* Maps, int64 beyond 2^53, and untyped JSON. *)
  decodes_to "map, int64, any JSON" profile_of_yojson yojson_of_profile
    {|{"name":"Ada","bio":"b","visits":9007199254740993,"tags":{"a":"1","b":"2"},"extra":{"any":[1,"x"]}}|}
    (make_profile ~name:"Ada" ~bio:"b" ~visits:9007199254740993L
       ~tags:[ ("a", "1"); ("b", "2") ]
       ~extra:(json {|{"any":[1,"x"]}|}) ());

  (* Recursion. *)
  decodes_to "recursive" tree_of_yojson yojson_of_tree
    {|{"value":1,"children":[{"value":2,"children":[]}]}|}
    { value = 1; children = [ { value = 2; children = [] } ] };

  (* serde flatten: the union's tag and fields share the struct's object. *)
  decodes_to "flattened union" setting_of_yojson yojson_of_setting
    {|{"type":"bool","value":true,"id":"dark"}|}
    { setting_value = Bool { value = true }; id = "dark" };

  (* Discriminator mapping. *)
  decodes_to "discriminator" pet_of_yojson yojson_of_pet
    {|{"petType":"dog","barks":true}|}
    (Dog { barks = true });

  (* Requests: path encoding, repeated query keys, enums in queries, headers. *)
  let request =
    get_profile ~id:"a/b c" ~fields:[ "x"; "y" ] ~verbose:true ~color:Red
      ~x_trace:"t1" ()
  in
  check "path segment encoded" (request.path = "/profiles/a%2Fb%20c");
  check "query"
    (request.query
    = [
        ("fields", [ "x"; "y" ]); ("verbose", [ "true" ]); ("color", [ "red" ]);
      ]);
  check "header" (request.headers = [ ("x-trace", "t1") ]);
  check "method" (request.meth = `GET && request.body = None);
  check "optional query left out" ((get_profile ~id:"a" ()).query = []);

  (* A plain record body spreads into labelled arguments. *)
  let create = create_profile ~name:"Ada" ~nickname:"A" () in
  (match create.body with
  | Some (Request.Json body) ->
      check "spread body"
        (same body (json {|{"name":"Ada","nickname":"A","bio":null}|}))
  | _ -> check "spread body is JSON" false);

  (* Raw and multipart bodies. *)
  (match (upload ~body:"\x00\x01" ()).body with
  | Some (Request.Raw { content_type; data }) ->
      check "raw body"
        (content_type = "application/octet-stream" && data = "\x00\x01")
  | _ -> check "raw body kind" false);
  (* Multipart: a file part carries the caller's filename (UTF-8 as is) and
     content type; a text part has neither. Only the quote and CR/LF are
     escaped in the header (RFC 7578). *)
  let attachment =
    attach
      ~file:
        {
          filename = "r\xc3\xa9sum\xc3\xa9 \"final\".pdf";
          content_type = "application/pdf";
          data = "%PDF";
        }
      ~note:"line\r\nbreak" ()
  in
  (match attachment.body with
  | Some (Request.Multipart [ file; note ]) ->
      check "file part"
        (file.name = "file"
        && file.filename = Some "r\xc3\xa9sum\xc3\xa9 \"final\".pdf"
        && file.content_type = Some "application/pdf"
        && file.data = "%PDF");
      check "text part" (note.filename = None && note.content_type = None)
  | _ -> check "multipart parts" false);
  (match attachment.body with
  | Some body ->
      let content_type, data = Request.encode_body ~boundary:"BOUNDARY" body in
      check "multipart content type"
        (content_type = "multipart/form-data; boundary=BOUNDARY");
      check "multipart bytes"
        (data
       = "--BOUNDARY\r\n\
          Content-Disposition: form-data; name=\"file\"; \
          filename=\"r\xc3\xa9sum\xc3\xa9 %22final%22.pdf\"\r\n\
          Content-Type: application/pdf\r\n\
          \r\n\
          %PDF\r\n\
          --BOUNDARY\r\n\
          Content-Disposition: form-data; name=\"note\"\r\n\
          \r\n\
          line\r\n\
          break\r\n\
          --BOUNDARY--\r\n")
  | None -> check "multipart body" false);

  (* The boundary is random per request and never occurs in the data. *)
  let boundary_of request =
    match request.Request.body with
    | Some body ->
        let content_type, _ = Request.encode_body body in
        String.sub content_type 30 (String.length content_type - 30)
    | None -> ""
  in
  let first = boundary_of attachment and second = boundary_of attachment in
  check "random boundary" (first <> second && String.length first > 20);
  let contains haystack needle =
    let n = String.length needle in
    let rec go i =
      i + n <= String.length haystack
      && (String.sub haystack i n = needle || go (i + 1))
    in
    go 0
  in
  let tricky =
    attach
      ~file:
        {
          filename = "x";
          content_type = "text/plain";
          data = "--" ^ first ^ "--";
        }
      ~note:first ()
  in
  check "boundary absent from data"
    (not (contains ("--" ^ first ^ "--" ^ first) (boundary_of tricky)));

  (* Replies by status, typed errors per status, undeclared statuses. *)
  let tree = put_tree ~body:[] () in
  check "202 reply" (Request.interpret tree ~status:202 "" = Ok Accepted);
  check "200 reply"
    (Request.interpret tree ~status:200 {|{"value":1,"children":[]}|}
    = Ok (Ok_ { value = 1; children = [] }));
  (match Request.interpret create ~status:409 {|{"existing":"p1"}|} with
  | Error (Error.Api { status = 409; error = Conflict { existing = "p1" }; _ })
    ->
      ()
  | _ -> check "409 typed error" false);
  (match Request.interpret create ~status:422 {|{"message":"bad"}|} with
  | Error (Error.Api { error = Unprocessable_entity { message = "bad" }; _ }) ->
      ()
  | _ -> check "422 typed error" false);
  (match Request.interpret request ~status:404 {|{"message":"gone"}|} with
  | Error (Error.Api { error = { message = "gone" }; _ }) -> ()
  | _ -> check "uniform typed error" false);
  (match Request.interpret request ~status:500 "boom" with
  | Error (Error.Http { status = 500; body = "boom" }) -> ()
  | _ -> check "text error is Http" false);
  (match Request.interpret request ~status:200 {|{"name":3}|} with
  | Error (Error.Decode { status = 200; _ }) -> ()
  | _ -> check "bad 2xx body is Decode" false);
  check "binary reply"
    (Request.interpret (download ~name:"f.pdf" ()) ~status:200 "%PDF"
    = Ok "%PDF");

  (* Strict decoding turns every Unknown into an error. *)
  Macro_sdk_runtime.Json.strict := true;
  rejects "strict enum" color_of_yojson {|"blue"|};
  rejects "strict tagged" shape_of_yojson {|{"kind":"hexagon"}|};
  rejects "strict external" command_of_yojson {|"rewind"|};
  rejects "strict untagged" glow_of_yojson {|true|};
  Macro_sdk_runtime.Json.strict := false;

  (* Integers beyond an OCaml int fail loudly, naming the field. *)
  (match
     tree_of_yojson (json {|{"value":99999999999999999999,"children":[]}|})
   with
  | _ -> check "huge int rejected" false
  | exception Macro_sdk_runtime.Json.Decode_error message ->
      check "huge int message"
        (message
       = "value: integer 99999999999999999999 does not fit in an OCaml int"));

  if !failures > 0 then exit 1;
  print_endline "kinds: all checks passed"
