(* macro_sdk_eio over real TLS, without the network: a throwaway CA and
   server certificates made here, a local HTTPS server, and the client
   trusting only that CA. Checks the handshake, host name and IP address
   verification, and that untrusted or mismatched certificates fail. *)

open Kinds
module Config = Macro_sdk_runtime.Config
module Error = Macro_sdk_runtime.Error

let failures = ref 0

let check name condition =
  if not condition then begin
    incr failures;
    Printf.printf "FAIL %s\n" name
  end

let ok = function Ok v -> v | Error (`Msg m) -> failwith m

let dn name =
  [ X509.Distinguished_name.(Relative_distinguished_name.singleton (CN name)) ]

let now () = Ptime_clock.now ()
let hours n = Ptime.Span.of_int_s (n * 3600)
let valid_from () = Option.get (Ptime.sub_span (now ()) (hours 1))
let valid_until () = Option.get (Ptime.add_span (now ()) (hours 24))

let sign csr ~issuer_key ~issuer extensions =
  match
    X509.Signing_request.sign csr ~valid_from:(valid_from ())
      ~valid_until:(valid_until ()) ~extensions issuer_key issuer
  with
  | Ok cert -> cert
  | Error _ -> failwith "signing failed"

let make_ca () =
  let key = X509.Private_key.generate `P256 in
  let csr = ok (X509.Signing_request.create (dn "Macro SDK test CA") key) in
  let extensions =
    X509.Extension.(
      add Basic_constraints
        (true, (true, None))
        (singleton Key_usage (true, [ `Key_cert_sign ])))
  in
  (key, sign csr ~issuer_key:key ~issuer:(dn "Macro SDK test CA") extensions)

(* A server certificate for [names] and [ips] (4-byte IPv4 octets). *)
let make_server (ca_key, _) ~names ~ips =
  let key = X509.Private_key.generate `P256 in
  let csr = ok (X509.Signing_request.create (dn "server") key) in
  let san = X509.General_name.(add IP ips (singleton DNS names)) in
  let extensions =
    X509.Extension.(
      add Subject_alt_name (false, san)
        (add Ext_key_usage (false, [ `Server_auth ])
           (singleton Basic_constraints (true, (false, None)))))
  in
  (key, sign csr ~issuer_key:ca_key ~issuer:(dn "Macro SDK test CA") extensions)

let loopback_octets = "\127\000\000\001"

(* A minimal HTTPS server: one JSON reply per connection. *)
let serve ~sw net (key, cert) =
  let config =
    ok (Tls.Config.server ~certificates:(`Single ([ cert ], key)) ())
  in
  (* Dual-stack, since "localhost" may resolve to ::1 or 127.0.0.1. *)
  let socket =
    Eio.Net.listen net ~sw ~backlog:8 ~reuse_addr:true
      (`Tcp (Eio.Net.Ipaddr.V6.any, 0))
  in
  let port =
    match Eio.Net.listening_addr socket with
    | `Tcp (_, port) -> port
    | _ -> assert false
  in
  let body = {|{"name":"Ada","bio":null}|} in
  let reply =
    Printf.sprintf
      "HTTP/1.1 200 OK\r\n\
       Content-Type: application/json\r\n\
       Content-Length: %d\r\n\
       Connection: close\r\n\
       \r\n\
       %s"
      (String.length body) body
  in
  Eio.Fiber.fork_daemon ~sw (fun () ->
      let rec loop () =
        Eio.Net.accept_fork ~sw socket ~on_error:ignore (fun flow _ ->
            match Tls_eio.server_of_flow config flow with
            | tls ->
                let input = Eio.Buf_read.of_flow tls ~max_size:65536 in
                let rec headers () =
                  if Eio.Buf_read.line input <> "" then headers ()
                in
                headers ();
                Eio.Flow.copy_string reply tls;
                Eio.Flow.shutdown tls `Send
            | exception _ -> (* the client rejected our certificate *) ());
        loop ()
      in
      loop ());
  port

let call net ~authenticator url =
  let config =
    Config.create ~env:Prod
      ~auth:(Config.Auth.user_token "t")
      ~hosts:[ ("kinds", url) ]
      ()
  in
  let client =
    match authenticator with
    | Some authenticator -> Macro_sdk_eio.create ~config ~authenticator net
    | None -> Macro_sdk_eio.create ~config net
  in
  Macro_sdk_eio.call client (get_profile ~id:"ada" ())

let () =
  Mirage_crypto_rng_unix.use_default ();
  Eio_main.run @@ fun env ->
  Eio.Switch.run @@ fun sw ->
  let net = Eio.Stdenv.net env in
  let ca = make_ca () in
  let trust =
    Some
      (X509.Authenticator.chain_of_trust
         ~time:(fun () -> Some (now ()))
         [ snd ca ])
  in
  let good =
    serve ~sw net
      (make_server ca ~names:[ "localhost" ] ~ips:[ loopback_octets ])
  in
  let wrong =
    serve ~sw net (make_server ca ~names:[ "elsewhere.test" ] ~ips:[])
  in
  let untrusted =
    serve ~sw net
      (make_server (make_ca ()) ~names:[ "localhost" ] ~ips:[ loopback_octets ])
  in

  (match
     call net ~authenticator:trust (Printf.sprintf "https://localhost:%d" good)
   with
  | Ok profile -> check "TLS by host name" (profile.name = "Ada")
  | Error e -> check ("TLS by host name: " ^ Error.to_string e) false);
  (match
     call net ~authenticator:trust (Printf.sprintf "https://127.0.0.1:%d" good)
   with
  | Ok profile -> check "TLS by IP address" (profile.name = "Ada")
  | Error e -> check ("TLS by IP address: " ^ Error.to_string e) false);
  (match
     call net ~authenticator:trust (Printf.sprintf "https://localhost:%d" wrong)
   with
  | Error (Error.Transport _) -> ()
  | _ -> check "certificate for another name rejected" false);
  (match
     call net ~authenticator:trust (Printf.sprintf "https://127.0.0.1:%d" wrong)
   with
  | Error (Error.Transport _) -> ()
  | _ -> check "certificate without the IP rejected" false);
  (match
     call net ~authenticator:trust
       (Printf.sprintf "https://localhost:%d" untrusted)
   with
  | Error (Error.Transport _) -> ()
  | _ -> check "certificate from another CA rejected" false);
  (match
     call net ~authenticator:None (Printf.sprintf "https://localhost:%d" good)
   with
  | Error (Error.Transport _) -> ()
  | _ -> check "system trust store rejects the test CA" false);

  if !failures > 0 then exit 1;
  print_endline "tls: all checks passed"
