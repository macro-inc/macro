(* Every operation, called with sample arguments (required ones only, then
   all of them), against the fake proxy. For each call, checks against
   all_operations.json (written by the generator from the spec):
   - the request: method, path (encoded), query pairs, header parameters,
     the run token, content type and body;
   - the reply: the fake proxy answers with a sample generated from the
     operation's response schema, which the call must decode.

   Usage: all_operations.exe all_operations.json *)

let token = "test-run-token"
let failures = ref 0

let fail fmt =
  Printf.ksprintf
    (fun message ->
      incr failures;
      if !failures <= 50 then print_endline ("FAIL " ^ message))
    fmt

let hex c = match c with '0' .. '9' -> Char.code c - 48 | 'A' .. 'F' -> Char.code c - 55 | 'a' .. 'f' -> Char.code c - 87 | _ -> -1

let percent_decode text =
  let out = Buffer.create (String.length text) in
  let rec go i =
    if i < String.length text then
      if text.[i] = '%' && i + 2 < String.length text then (
        Buffer.add_char out (Char.chr ((hex text.[i + 1] * 16) + hex text.[i + 2]));
        go (i + 3))
      else (
        Buffer.add_char out text.[i];
        go (i + 1))
  in
  go 0;
  Buffer.contents out

(* Only unreserved characters and %XX escapes. *)
let well_encoded text =
  let ok = ref true in
  String.iteri
    (fun i c ->
      match c with
      | 'A' .. 'Z' | 'a' .. 'z' | '0' .. '9' | '-' | '.' | '_' | '~' -> ()
      | '%' -> if i + 2 >= String.length text || hex text.[i + 1] < 0 || hex text.[i + 2] < 0 then ok := false
      | _ -> ok := false)
    text;
  !ok

let rec normalize (json : Yojson.Safe.t) : Yojson.Safe.t =
  match json with
  | `Assoc fields -> `Assoc (List.sort compare (List.map (fun (k, v) -> (k, normalize v)) fields))
  | `List items -> `List (List.map normalize items)
  | `Intlit s -> `Int (int_of_string s)
  | other -> other

let () =
  ignore (Unix.alarm 300);
  let open Yojson.Safe.Util in
  let fixtures = Array.of_list (to_list (Yojson.Safe.from_file Sys.argv.(1))) in
  let calls = Array.of_list All_operations_calls.calls in
  if Array.length fixtures <> Array.length calls then fail "%d calls for %d fixtures" (Array.length calls) (Array.length fixtures);
  let proxy =
    Fake_proxy.start (fun index _ ->
        let response = member "response" fixtures.(index) in
        let headers = match member "contentType" response with `String ct -> [ ("content-type", ct) ] | _ -> [] in
        Fake_proxy.reply ~headers (member "status" response |> to_int) (member "body" response |> to_string))
  in
  Unix.putenv "MACRO_SDK_PROXY_URL" (proxy.url ^ "/prefix/");
  Unix.putenv "MACRO_SDK_RUN_TOKEN" token;
  let called = ref 0 in
  Array.iteri
    (fun index (name, call) ->
      let fixture = fixtures.(index) in
      let what = Printf.sprintf "%s (%s)" name (member "variant" fixture |> to_string) in
      if member "name" fixture |> to_string <> name then fail "%s: fixture %d is for another operation" what index;
      incr called;
      match call () with
      | () -> ()
      | exception Macro.Error { code; message; status } -> fail "%s raised %s (%d): %s" what code status message)
    calls;
  let requests = Array.of_list (Fake_proxy.stop proxy) in
  if Array.length requests <> !called then fail "%d requests for %d calls" (Array.length requests) !called;
  Array.iteri
    (fun index (request : Fake_proxy.request) ->
      let fixture = fixtures.(index) in
      let what = Printf.sprintf "%s (%s)" (member "name" fixture |> to_string) (member "variant" fixture |> to_string) in
      let expect field expected actual = if expected <> actual then fail "%s: %s: expected %S, sent %S" what field expected actual in
      expect "method" (member "method" fixture |> to_string) request.meth;
      let path, query =
        match String.index_opt request.target '?' with
        | Some i -> (String.sub request.target 0 i, String.sub request.target (i + 1) (String.length request.target - i - 1))
        | None -> (request.target, "")
      in
      expect "path" ("/prefix" ^ (member "target" fixture |> to_string)) path;
      let pairs =
        if query = "" then []
        else
          List.map
            (fun pair ->
              match String.index_opt pair '=' with
              | Some i ->
                  let key = String.sub pair 0 i and value = String.sub pair (i + 1) (String.length pair - i - 1) in
                  if not (well_encoded key && well_encoded value) then fail "%s: query pair %S is not percent-encoded" what pair;
                  (percent_decode key, percent_decode value)
              | None ->
                  fail "%s: query pair %S has no =" what pair;
                  (pair, ""))
            (String.split_on_char '&' query)
      in
      let expected_pairs = member "query" fixture |> to_list |> List.map (fun p -> match to_list p with [ k; v ] -> (to_string k, to_string v) | _ -> ("", "")) in
      if pairs <> expected_pairs then
        fail "%s: query: expected [%s], sent [%s]" what
          (String.concat "; " (List.map (fun (k, v) -> k ^ "=" ^ v) expected_pairs))
          (String.concat "; " (List.map (fun (k, v) -> k ^ "=" ^ v) pairs));
      List.iter
        (fun p ->
          match to_list p with
          | [ k; v ] -> expect ("header " ^ to_string k) (to_string v) (Option.value (List.assoc_opt (String.lowercase_ascii (to_string k)) request.headers) ~default:"<none>")
          | _ -> ())
        (member "headers" fixture |> to_list);
      expect "authorization" ("Bearer " ^ token) (Option.value (List.assoc_opt "authorization" request.headers) ~default:"<none>");
      let content_type = List.assoc_opt "content-type" request.headers in
      match member "body" fixture with
      | `Null ->
          if request.body <> "" then fail "%s: sent a body: %s" what request.body;
          if content_type <> None then fail "%s: sent a content type without a body" what
      | body -> (
          let expected_type = member "contentType" body |> to_string in
          let actual_type = Option.value content_type ~default:"<none>" in
          let prefix = String.length expected_type in
          if String.length actual_type < prefix || String.sub actual_type 0 prefix <> expected_type then
            expect "content-type" expected_type actual_type;
          match (member "json" body, member "text" body, member "multipart" body) with
          | `Null, `String text, _ -> expect "body" text request.body
          | `Null, `Null, `Bool true ->
              if not (String.length request.body > 0) then fail "%s: empty multipart body" what
          | json, _, _ -> (
              match Yojson.Safe.from_string request.body with
              | sent ->
                  if normalize sent <> normalize json then
                    fail "%s: body: expected %s, sent %s" what (Yojson.Safe.to_string json) request.body
              | exception Yojson.Json_error message -> fail "%s: body is not JSON (%s): %s" what message request.body)))
    requests;
  Printf.printf "%d calls (%d operations), %d failures\n" (Array.length calls) (Array.length calls / 2) !failures;
  if !failures > 0 then exit 1
