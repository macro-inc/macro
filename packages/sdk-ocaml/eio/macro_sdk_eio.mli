(** Send {!Macro_sdk} requests over HTTP(S) with cohttp-eio (OCaml 5, direct style).

    {[
      Eio_main.run @@ fun env ->
      let macro = Macro_sdk_eio.create (Eio.Stdenv.net env) in
      match Macro_sdk_eio.call macro (Macro_sdk.Contacts.get_contacts ()) with
      | Ok reply -> List.iter print_endline reply.contacts
      | Error error -> prerr_endline (Macro_sdk_runtime.Error.to_string error)
    ]} *)

type t

val create : ?config:Macro_sdk_runtime.Config.t -> _ Eio.Net.t -> t
(** A client for [config] (default [Macro_sdk.Config.create ()]: [MACRO_ENV],
    then [MACRO_API_KEY] or [MACRO_BOT_TOKEN]). HTTPS checks certificates
    against the system trust store. *)

val config : t -> Macro_sdk_runtime.Config.t

val call :
  t ->
  ('reply, 'error) Macro_sdk_runtime.Request.t ->
  ('reply, 'error Macro_sdk_runtime.Error.t) result
(** Send one request and decode its reply. Never raises for HTTP, decode or
    connection failures; those come back as [Error]. *)

val call_exn : t -> ('reply, 'error) Macro_sdk_runtime.Request.t -> 'reply
(** Like {!call}, raising {!Macro_sdk_runtime.Error.Macro_error} on failure. *)
