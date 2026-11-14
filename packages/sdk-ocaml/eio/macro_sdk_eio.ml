module Config = Macro_sdk_runtime.Config
module Error = Macro_sdk_runtime.Error
module Request = Macro_sdk_runtime.Request

type t = { http : Cohttp_eio.Client.t; config : Config.t }

(* Built on first HTTPS use, so plain-HTTP clients never read the trust store. *)
let tls_config =
  lazy
    (Mirage_crypto_rng_unix.use_default ();
     let authenticator =
       match Ca_certs.authenticator () with
       | Ok a -> a
       | Error (`Msg m) -> failwith ("trust store: " ^ m)
     in
     match Tls.Config.client ~authenticator () with
     | Ok c -> c
     | Error (`Msg m) -> failwith ("TLS: " ^ m))

let https uri flow =
  let host =
    Option.bind (Uri.host uri) (fun name ->
        Result.to_option
          (Result.bind (Domain_name.of_string name) Domain_name.host))
  in
  Tls_eio.client_of_flow ?host (Lazy.force tls_config) flow

let create ?config net =
  let config = match config with Some c -> c | None -> Config.create () in
  { http = Cohttp_eio.Client.make ~https:(Some https) net; config }

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
