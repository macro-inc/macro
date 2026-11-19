(* macro_sdk_fetch under Deno against the stand-in server in run.mjs: what
   goes over the wire, what the bootstrap's fetch is told, and how replies,
   failures, skips and refusals come back. *)

open Js_of_ocaml
open Kinds
module Config = Macro_sdk_runtime.Config
module Error = Macro_sdk_runtime.Error

let failures = ref 0

let check name condition =
  if not condition then begin
    incr failures;
    Printf.printf "FAIL %s\n%!" name
  end

let test = Js.Unsafe.pure_js_expr "globalThis.macroSdkFetchTest"
let field name : string = Js.to_bytestring (Js.Unsafe.get test name)
let requests () : int = Js.Unsafe.meth_call test "requests" [||]

type seen = {
  meth : string;
  target : string;
  header : string -> string option;
  body : string;
}

let last () =
  let seen = Js.Unsafe.meth_call test "last" [||] in
  let headers = Js.Unsafe.get seen "headers" in
  {
    meth = Js.to_string (Js.Unsafe.get seen "method");
    target = Js.to_string (Js.Unsafe.get seen "target");
    header =
      (fun name ->
        Js.Optdef.to_option (Js.Unsafe.get headers (Js.string name))
        |> Option.map Js.to_string);
    body = Js.to_bytestring (Js.Unsafe.get seen "body");
  }

(* The service.operation the last fetch was told. *)
let operation () = Js.to_string (Js.Unsafe.meth_call test "operation" [||])

(* The service.operationId (raw, as the spec has it) the last fetch was told. *)
let operation_id () = Js.to_string (Js.Unsafe.meth_call test "operationId" [||])

let check_names () =
  let names = Js.to_array (Js.Unsafe.get test "names") in
  check "operation names to check" (Array.length names > 100);
  Array.iter
    (fun entry ->
      let item i = Js.Unsafe.get entry i in
      let service = Js.to_string (item 0) in
      let id = Js.to_string (item 1) in
      let methods = Array.map Js.to_string (Js.to_array (item 2)) in
      let name = Macro_sdk_fetch.sdk_method id in
      check
        (Printf.sprintf "TypeScript name of %s.%s (%s)" service id name)
        (Array.mem name methods))
    names

let () =
  let config =
    Config.create ~env:Prod
      ~auth:(Config.Auth.user_token "secret-token")
      ~hosts:[ ("kinds", field "base") ]
      ()
  in
  let macro = Macro_sdk_fetch.create ~config () in

  (* A GET with path, query and header parameters, auth, and the operation
     handed to fetch, which adds its verb header. *)
  (match
     Macro_sdk_fetch.call macro
       (get_profile ~id:"ada" ~fields:[ "a"; "b" ] ~x_trace:"t-1" ())
   with
  | Ok profile ->
      check "decoded reply" (profile.name = "Ada" && profile.bio = None)
  | Error e -> check ("GET failed: " ^ Error.to_string e) false);
  let seen = last () in
  check "method" (seen.meth = "GET");
  check "target" (seen.target = "/base/profiles/ada?fields=a&fields=b");
  check "auth header" (seen.header "authorization" = Some "Bearer secret-token");
  check "parameter header" (seen.header "x-trace" = Some "t-1");
  check "accept" (seen.header "accept" = Some "application/json");
  check "operation handed to fetch" (operation () = "kinds.getProfile");
  check "raw operationId handed to fetch" (operation_id () = "kinds.get_profile");
  check "verb header from the operation"
    (seen.header "x-macro-sdk-verb" = Some "read");

  (* A JSON body, sent with its content type and echoed back. *)
  (match
     Macro_sdk_fetch.call macro
       (create_profile ~name:"Grace" ~tags:[ ("team", "core") ] ())
   with
  | Ok profile ->
      check "echoed body"
        (profile.name = "Grace" && profile.tags = Some [ ("team", "core") ])
  | Error e -> check ("POST failed: " ^ Error.to_string e) false);
  let seen = last () in
  check "post method" (seen.meth = "POST");
  check "content type" (seen.header "content-type" = Some "application/json");
  check "operation of a write" (operation () = "kinds.createProfile");

  (* A POST without a body still sends an empty one. *)
  check "ping" (Macro_sdk_fetch.call macro (ping ()) = Ok ());
  check "empty POST body" ((last ()).header "content-length" = Some "0");

  (* Binary both ways: every byte value survives. *)
  let all_bytes = String.init 256 Char.chr in
  check "binary upload"
    (Macro_sdk_fetch.call macro (upload ~body:all_bytes ()) = Ok ());
  let seen = last () in
  check "binary request body" (seen.body = all_bytes);
  check "binary content type"
    (seen.header "content-type" = Some "application/octet-stream");
  check "binary reply"
    (Macro_sdk_fetch.call macro (download ~name:"binary" ()) = Ok all_bytes);

  (* Multipart: the file part keeps its name and type on the wire. *)
  (match
     Macro_sdk_fetch.call macro
       (attach
          ~file:
            {
              filename = "r\xc3\xa9sum\xc3\xa9.pdf";
              content_type = "application/pdf";
              data = "%PDF\xff";
            }
          ~note:"hi" ())
   with
  | Ok "stored" -> ()
  | _ -> check "multipart call" false);
  let seen = last () in
  let content_type = Option.value (seen.header "content-type") ~default:"" in
  let prefix = "multipart/form-data; boundary=" in
  check "multipart content type" (String.starts_with ~prefix content_type);
  let boundary =
    String.sub content_type (String.length prefix)
      (String.length content_type - String.length prefix)
  in
  check "multipart body on the wire"
    (seen.body
    = "--" ^ boundary
      ^ "\r\n\
         Content-Disposition: form-data; name=\"file\"; \
         filename=\"r\xc3\xa9sum\xc3\xa9.pdf\"\r\n\
         Content-Type: application/pdf\r\n\
         \r\n\
         %PDF\xff\r\n\
         --" ^ boundary
      ^ "\r\nContent-Disposition: form-data; name=\"note\"\r\n\r\nhi\r\n--"
      ^ boundary ^ "--\r\n");

  (* A declared error body, an undeclared status, a bad 2xx body. *)
  (match Macro_sdk_fetch.call macro (get_profile ~id:"nobody" ()) with
  | Error
      (Error.Api { status = 404; error = { message = "no such profile" }; _ })
    ->
      ()
  | _ -> check "typed 404" false);
  (match Macro_sdk_fetch.call macro (download ~name:"x" ()) with
  | Error (Error.Http { status = 500; body = "unexpected" }) -> ()
  | _ -> check "undeclared status" false);
  (match Macro_sdk_fetch.call macro (get_profile ~id:"broken" ()) with
  | Error (Error.Decode { status = 200; body = "not json"; _ }) -> ()
  | _ -> check "decode failure" false);
  (match Macro_sdk_fetch.call_exn macro (get_profile ~id:"nobody" ()) with
  | _ -> check "call_exn raises" false
  | exception Error.Macro_error { status = Some 404; _ } -> ());

  (* The bootstrap refuses a call: a transport error, nothing sent. *)
  let before = requests () in
  (match Macro_sdk_fetch.call macro (put_tree ~body:[] ()) with
  | Error (Error.Transport _ as e) ->
      check
        ("refusal reason: " ^ Error.to_string e)
        (let message = Error.to_string e in
         let reason = "refused by the gate" in
         let rec contains i =
           i + String.length reason <= String.length message
           && (String.sub message i (String.length reason) = reason
              || contains (i + 1))
         in
         contains 0)
  | _ -> check "refused call" false);
  check "refused call not sent" (requests () = before);

  (* The bootstrap answers a dry run's write itself: nothing sent. *)
  Js.Unsafe.set test "dryRun" Js._true;
  check "skipped call" (Macro_sdk_fetch.call macro (upload ~body:"x" ()) = Ok ());
  check "skipped call not sent" (requests () = before);
  Js.Unsafe.set test "dryRun" Js._false;

  (* Nothing listens here: a transport error, not an exception. *)
  let closed =
    Macro_sdk_fetch.create
      ~config:{ config with hosts = [ ("kinds", field "closed") ] }
      ()
  in
  (match Macro_sdk_fetch.call closed (get_profile ~id:"ada" ()) with
  | Error (Error.Transport _) -> ()
  | _ -> check "connection refused" false);

  check_names ();

  if !failures = 0 then print_endline "fetch: all checks passed";
  ignore (Js.Unsafe.meth_call test "finish" [| Js.Unsafe.inject !failures |])
