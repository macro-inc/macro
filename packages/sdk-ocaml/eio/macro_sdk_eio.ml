module Config = Macro_sdk_runtime.Config
module Error = Macro_sdk_runtime.Error
module Request = Macro_sdk_runtime.Request

type t = { http : Cohttp_eio.Client.t; config : Config.t }

exception Unverifiable_host of string

let system_trust_store () =
  match Ca_certs.authenticator () with
  | Ok authenticator -> authenticator
  | Error (`Msg m) -> failwith ("trust store: " ^ m)

let tls_client authenticator ?ip () =
  match Tls.Config.client ~authenticator ?ip () with
  | Ok config -> config
  | Error (`Msg m) -> failwith ("TLS: " ^ m)

(* Every TLS connection checks the certificate against the host it was asked
   for: a DNS name through SNI and the certificate's names, an IP literal
   against its IP addresses. A host that is neither cannot be checked, so the
   connection is refused rather than trusting any valid chain. *)
let https authenticator =
  let by_name = lazy (tls_client (Lazy.force authenticator) ()) in
  fun uri flow ->
    let host = Option.value (Uri.host uri) ~default:"" in
    match Ipaddr.of_string host with
    | Ok ip ->
        Tls_eio.client_of_flow
          (tls_client (Lazy.force authenticator) ~ip ())
          flow
    | Error _ -> (
        match Result.bind (Domain_name.of_string host) Domain_name.host with
        | Ok name -> Tls_eio.client_of_flow ~host:name (Lazy.force by_name) flow
        | Error _ -> raise (Unverifiable_host host))

let create ?config ?authenticator net =
  let config = match config with Some c -> c | None -> Config.create () in
  (* Read on first HTTPS use, so plain-HTTP clients never touch the trust
     store or the random number generator. *)
  let authenticator =
    lazy
      (Mirage_crypto_rng_unix.use_default ();
       match authenticator with Some a -> a | None -> system_trust_store ())
  in
  {
    http = Cohttp_eio.Client.make ~https:(Some (https authenticator)) net;
    config;
  }

let config t = t.config

let send t (wire : Request.wire) =
  let headers =
    let length =
      match wire.wire_body with
      | Some data -> [ ("content-length", string_of_int (String.length data)) ]
      | None -> []
    in
    Http.Header.of_list (wire.wire_headers @ length)
  in
  let body = Option.map Cohttp_eio.Body.of_string wire.wire_body in
  Eio.Switch.run @@ fun sw ->
  let response, body =
    Cohttp_eio.Client.call t.http ~sw ~headers ?body ~chunked:false
      (wire.wire_meth :> Http.Method.t)
      wire.uri
  in
  let status = Http.Status.to_int (Http.Response.status response) in
  (status, Eio.Buf_read.(parse_exn take_all) body ~max_size:max_int)

(* Configuration mistakes (no credential, unknown service) raise; only the
   exchange itself is caught as a transport error. *)
let call t request =
  let wire = Request.prepare t.config request in
  match send t wire with
  | status, body -> Request.interpret request ~status body
  | exception (Eio.Cancel.Cancelled _ as cancelled) -> raise cancelled
  | exception exn -> Error (Error.Transport exn)

let call_exn t request =
  match call t request with
  | Ok reply -> reply
  | Error error -> Error.raise_error error
