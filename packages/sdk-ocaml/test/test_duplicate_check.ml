(* Run the duplicate-check program against a fake proxy that keeps its
   connections open, and check the requests it sends, the result it
   returns, chunked replies, and how proxy refusals and service errors
   surface as Macro.Error. *)

let token = "test-run-token"
let title = "Fix login redirect loop"
let body = "Signing in from a deep link returns to the login page."
let failures = ref 0

let check what expected actual =
  if expected <> actual then (
    incr failures;
    Printf.printf "FAIL %s\n  expected: %s\n  actual:   %s\n" what expected actual)
  else Printf.printf "ok   %s\n" what

let json = Yojson.Safe.to_string
let search_target = "/api/storage/documents/similarity_search"
let create_target = "/api/storage/documents/create_task"
let search_body = json (`Assoc [ ("markdown", `String body); ("taskName", `String title) ])
let create_body = json (`Assoc [ ("markdown", `String body); ("taskName", `String title) ])

let similar score =
  `Assoc
    [
      ( "results",
        `List
          [ `Assoc [ ("taskId", `String "task-old"); ("taskName", `String "Login redirect loops"); ("vectorScore", `Float score) ] ]
      );
    ]

let created =
  `Assoc
    [
      ("documentId", `String "task-new");
      ( "documentMetadata",
        `Assoc
          [
            ("documentId", `String "task-new"); ("documentVersionId", `Int 1); ("documentName", `String title); ("owner", `String "someone");
          ] );
      ("initialSnapshot", `String "");
      ("token", `String "t");
    ]

let refused code = Fake_proxy.json_reply ~headers:[ ("x-macro-proxy", "refused") ] 403 (`Assoc [ ("error", `Assoc [ ("code", `String code); ("message", `String (code ^ " by the proxy")) ]) ])

(* Run [main] against a fake proxy; return its result (or the error it
   raised) and the recorded requests. *)
let run respond =
  let proxy = Fake_proxy.start (fun _ request -> respond request) in
  Unix.putenv "MACRO_SDK_PROXY_URL" proxy.url;
  Unix.putenv "MACRO_SDK_RUN_TOKEN" token;
  let outcome =
    match Duplicate_check.main () with
    | result -> Ok (json result)
    | exception Macro.Error { code; message; status } -> Error (Printf.sprintf "%s %d %s" code status message)
  in
  (outcome, Fake_proxy.stop proxy)

let show = function Ok result -> result | Error error -> "error: " ^ error
let code_of = function Ok _ -> "returned" | Error error -> List.hd (String.split_on_char ' ' error)

let check_requests scenario expected (requests : Fake_proxy.request list) =
  check (scenario ^ ": number of requests") (string_of_int (List.length expected)) (string_of_int (List.length requests));
  List.iteri
    (fun i (request : Fake_proxy.request) ->
      let what part = Printf.sprintf "%s: request %d %s" scenario (i + 1) part in
      check (what "authorization") ("Bearer " ^ token) (Option.value (List.assoc_opt "authorization" request.headers) ~default:"");
      check (what "content-type") "application/json" (Option.value (List.assoc_opt "content-type" request.headers) ~default:"");
      match List.nth_opt expected i with
      | Some (target, body) ->
          check (what "method") "POST" request.meth;
          check (what "target") target request.target;
          check (what "body") body request.body
      | None -> ())
    requests

let route ?(chunked = false) ~score ~create (request : Fake_proxy.request) =
  if request.target = search_target then Fake_proxy.json_reply ~chunked 200 (similar score)
  else if request.target = create_target then create
  else Fake_proxy.json_reply 404 (`Assoc [ ("message", `String "no route") ])

let () =
  ignore (Unix.alarm 60);
  (* No likely duplicate: search, then create. *)
  let outcome, requests = run (route ~score:0.4 ~create:(Fake_proxy.json_reply 200 created)) in
  check_requests "no duplicate" [ (search_target, search_body); (create_target, create_body) ] requests;
  check "no duplicate: result"
    (json (`Assoc [ ("created", `Assoc [ ("id", `String "task-new"); ("name", `String title) ]); ("duplicates", `List []) ]))
    (show outcome);

  (* A likely duplicate, in a chunked reply: return it and create nothing. *)
  let outcome, requests = run (route ~chunked:true ~score:0.9 ~create:(Fake_proxy.json_reply 200 created)) in
  check_requests "duplicate" [ (search_target, search_body) ] requests;
  check "duplicate: result"
    (json
       (`Assoc
         [
           ("created", `Null);
           ( "duplicates",
             `List [ `Assoc [ ("id", `String "task-old"); ("name", `String "Login redirect loops"); ("similarity", `Float 0.9) ] ] );
         ]))
    (show outcome);

  (* The proxy refuses task creation: the code is the proxy's reason. *)
  List.iter
    (fun code ->
      let outcome, requests = run (route ~score:0.2 ~create:(refused code)) in
      check_requests ("refused " ^ code) [ (search_target, search_body); (create_target, create_body) ] requests;
      check ("refused " ^ code ^ ": error")
        (Printf.sprintf "error: %s 403 storage.create_task_handler: the SDK proxy refused it: %s by the proxy" code code)
        (show outcome))
    [ "blocked"; "not_analyzed"; "unknown_operation" ];

  (* The service's own 403 (no x-macro-proxy header) is forbidden, with its message. *)
  let outcome, _ = run (route ~score:0.2 ~create:(Fake_proxy.json_reply 403 (`Assoc [ ("message", `String "not your team") ]))) in
  check "service 403: error" "error: forbidden 403 storage.create_task_handler: HTTP 403: not your team" (show outcome);

  (* A text error body. *)
  let outcome, _ = run (route ~score:0.2 ~create:(Fake_proxy.reply 500 "boom")) in
  check "service 500: error" "error: internal 500 storage.create_task_handler: HTTP 500: boom" (show outcome);

  (* A result that doesn't match its type is a decode error, not a crash. *)
  let outcome, _ = run (fun _ -> Fake_proxy.json_reply 200 (`Assoc [ ("results", `String "not a list") ])) in
  check "bad result: error code" "decode" (code_of outcome);

  (* No proxy listening: unreachable. *)
  Unix.putenv "MACRO_SDK_PROXY_URL" "http://127.0.0.1:1";
  check "no proxy: error code" "unreachable"
    (code_of (match Duplicate_check.main () with r -> Ok (json r) | exception Macro.Error { code; _ } -> Error code));

  (* A path parameter that would need an encoded slash fails before any request. *)
  let proxy = Fake_proxy.start (fun _ _ -> Fake_proxy.json_reply 200 `Null) in
  Unix.putenv "MACRO_SDK_PROXY_URL" proxy.url;
  let outcome =
    match Macro.Storage.get_document_permissions_v2 ~document_id:"a/b" () with
    | _ -> "returned"
    | exception Macro.Error { code; status; _ } -> Printf.sprintf "%s %d" code status
  in
  check "slash in a path parameter: error" "invalid 0" outcome;
  check "slash in a path parameter: no request" "0" (string_of_int (List.length (Fake_proxy.stop proxy)));

  if !failures > 0 then exit 1
