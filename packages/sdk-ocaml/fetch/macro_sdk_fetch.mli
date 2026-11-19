(** Send {!Macro_sdk} requests through JavaScript's [globalThis.fetch], from
    a program compiled with wasm_of_ocaml ([--effects=jspi]), in direct style.

    {[
      let macro = Macro_sdk_fetch.create ~config () in
      match Macro_sdk_fetch.call macro (Macro_sdk.Contacts.get_contacts ()) with
      | Ok reply -> List.iter print_endline reply.contacts
      | Error error -> prerr_endline (Macro_sdk_runtime.Error.to_string error)
    ]}

    A call suspends the WebAssembly stack until [fetch] settles (JSPI), so it
    must run on the program's own stack, the one the loader entered through
    [WebAssembly.promising]; never from a JavaScript callback.

    {b The contract with the caller's [fetch].} Each call is one
    [fetch(url, init)] with [init.method], [init.headers] (an array of
    [[name, value]] pairs), [init.body] (a [Uint8Array], when there is one)
    and [init.macroSdkOperation = {service, operation, operationId}]: the
    spec's service name and the TypeScript SDK's method name for the
    operation ({!sdk_method}), the same pair the TypeScript SDK hands to
    [gateRequests] and uses for [sdkVerbs] keys, plus the raw operationId,
    the key code mode's permission gate checks. A plain [fetch] ignores
    the extra field. Code mode's bootstrap wraps [fetch] and reads it to
    gate the call and add its verb header:
    - answer with a [Response] instead of sending (a dry run's skip): the
      response is interpreted as if the server had sent it;
    - reject the promise (a refusal): the call returns [Error (Transport _)]
      carrying the rejection;
    - otherwise send the request, with any headers it adds. *)

type t

val create : ?config:Macro_sdk_runtime.Config.t -> unit -> t
(** A client for [config] (default [Macro_sdk.Config.create ()]: [MACRO_ENV],
    then [MACRO_API_KEY] or [MACRO_BOT_TOKEN]). *)

val config : t -> Macro_sdk_runtime.Config.t

val call :
  t ->
  ('reply, 'error) Macro_sdk_runtime.Request.t ->
  ('reply, 'error Macro_sdk_runtime.Error.t) result
(** Send one request and decode its reply. Never raises for HTTP, decode or
    [fetch] failures (including a rejected [fetch]); those come back as
    [Error]. *)

val call_exn : t -> ('reply, 'error) Macro_sdk_runtime.Request.t -> 'reply
(** Like {!call}, raising {!Macro_sdk_runtime.Error.Macro_error} on failure. *)

val sdk_method : string -> string
(** The TypeScript SDK's method name for an operationId: hey-api's
    camelCase, e.g. [get_contacts] is [getContacts]. An operationId a spec
    declares twice (only cognition's [get_state_handler], both reads) maps
    to the first one's name; the TypeScript SDK suffixes the second with
    [2]. *)
