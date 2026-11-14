(* macro_sdk_eio against a local stand-in server: what goes over the wire,
   and how replies and failures come back. *)

open Kinds
module Config = Macro_sdk_runtime.Config
module Error = Macro_sdk_runtime.Error

let failures = ref 0

let check name condition =
  if not condition then begin
    incr failures;
    Printf.printf "FAIL %s\n" name
  end

type seen = {
  meth : string;
  target : string;
  headers : Http.Header.t;
  body : string;
}

(* Answers by path and records each request it receives. *)
let handler log _conn request body =
  let body = Eio.Buf_read.(parse_exn take_all) body ~max_size:max_int in
  let target = Http.Request.resource request in
  log :=
    {
      meth = Http.Method.to_string (Http.Request.meth request);
      target;
      headers = Http.Request.headers request;
      body;
    }
    :: !log;
  let json_headers =
    Http.Header.of_list [ ("content-type", "application/json") ]
  in
  match Uri.path (Uri.of_string target) with
  | "/base/profiles/ada" ->
      Cohttp_eio.Server.respond_string ~headers:json_headers ~status:`OK
        ~body:{|{"name":"Ada","bio":null}|} ()
  | "/base/profiles/nobody" ->
      Cohttp_eio.Server.respond_string ~headers:json_headers ~status:`Not_found
        ~body:{|{"message":"no such profile"}|} ()
  | "/base/profiles" ->
      Cohttp_eio.Server.respond_string ~headers:json_headers ~status:`Created
        ~body ()
  | "/base/profiles/broken" ->
      Cohttp_eio.Server.respond_string ~status:`OK ~body:"not json" ()
  | _ ->
      Cohttp_eio.Server.respond_string ~status:`Internal_server_error
        ~body:"unexpected" ()

let () =
  Eio_main.run @@ fun env ->
  Eio.Switch.run @@ fun sw ->
  let log = ref [] in
  let socket =
    Eio.Net.listen (Eio.Stdenv.net env) ~sw ~backlog:8 ~reuse_addr:true
      (`Tcp (Eio.Net.Ipaddr.V4.loopback, 0))
  in
  let port =
    match Eio.Net.listening_addr socket with
    | `Tcp (_, port) -> port
    | _ -> assert false
  in
  let stop, stopper = Eio.Promise.create () in
  Eio.Fiber.fork ~sw (fun () ->
      Cohttp_eio.Server.run ~stop ~on_error:raise socket
        (Cohttp_eio.Server.make ~callback:(handler log) ()));

  let config =
    Config.create ~env:Prod
      ~auth:(Config.Auth.user_token "secret-token")
      ~hosts:[ ("kinds", Printf.sprintf "http://127.0.0.1:%d/base" port) ]
      ()
  in
  let macro = Macro_sdk_eio.create ~config (Eio.Stdenv.net env) in

  (* A GET with path, query and header parameters, and auth. *)
  (match
     Macro_sdk_eio.call macro
       (get_profile ~id:"ada" ~fields:[ "a"; "b" ] ~x_trace:"t-1" ())
   with
  | Ok profile ->
      check "decoded reply" (profile.name = "Ada" && profile.bio = None)
  | Error e -> check ("GET failed: " ^ Error.to_string e) false);
  (match !log with
  | seen :: _ ->
      check "method" (seen.meth = "GET");
      check "target" (seen.target = "/base/profiles/ada?fields=a&fields=b");
      check "auth header"
        (Http.Header.get seen.headers "authorization"
        = Some "Bearer secret-token");
      check "parameter header"
        (Http.Header.get seen.headers "x-trace" = Some "t-1");
      check "accept"
        (Http.Header.get seen.headers "accept" = Some "application/json")
  | [] -> check "request reached the server" false);

  (* A JSON body: sent with its content type and length, echoed back. *)
  (match
     Macro_sdk_eio.call macro
       (create_profile ~name:"Grace" ~tags:[ ("team", "core") ] ())
   with
  | Ok profile ->
      check "echoed body"
        (profile.name = "Grace" && profile.tags = Some [ ("team", "core") ])
  | Error e -> check ("POST failed: " ^ Error.to_string e) false);
  (match !log with
  | seen :: _ ->
      check "post method" (seen.meth = "POST");
      check "content type"
        (Http.Header.get seen.headers "content-type" = Some "application/json");
      check "content length"
        (Http.Header.get seen.headers "content-length"
        = Some (string_of_int (String.length seen.body)))
  | [] -> ());

  (* A declared error body, an undeclared status, a bad 2xx body. *)
  (match Macro_sdk_eio.call macro (get_profile ~id:"nobody" ()) with
  | Error
      (Error.Api { status = 404; error = { message = "no such profile" }; _ })
    ->
      ()
  | _ -> check "typed 404" false);
  (match Macro_sdk_eio.call macro (download ~name:"x" ()) with
  | Error (Error.Http { status = 500; body = "unexpected" }) -> ()
  | _ -> check "undeclared status" false);
  (match Macro_sdk_eio.call macro (get_profile ~id:"broken" ()) with
  | Error (Error.Decode { status = 200; body = "not json"; _ }) -> ()
  | _ -> check "decode failure" false);
  (match Macro_sdk_eio.call_exn macro (get_profile ~id:"nobody" ()) with
  | _ -> check "call_exn raises" false
  | exception Error.Macro_error { status = Some 404; _ } -> ());

  Eio.Promise.resolve stopper ();

  (* Nothing listens here: a transport error, not an exception. *)
  let closed_port =
    Eio.Switch.run (fun sw ->
        let socket =
          Eio.Net.listen (Eio.Stdenv.net env) ~sw ~backlog:1
            (`Tcp (Eio.Net.Ipaddr.V4.loopback, 0))
        in
        match Eio.Net.listening_addr socket with
        | `Tcp (_, port) -> port
        | _ -> assert false)
  in
  let closed =
    Macro_sdk_eio.create (Eio.Stdenv.net env)
      ~config:
        {
          config with
          hosts =
            [ ("kinds", Printf.sprintf "http://127.0.0.1:%d" closed_port) ];
        }
  in
  (match Macro_sdk_eio.call closed (get_profile ~id:"ada" ()) with
  | Error (Error.Transport _) -> ()
  | _ -> check "connection refused" false);

  if !failures > 0 then exit 1;
  print_endline "transport: all checks passed"
