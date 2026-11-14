(** The transport: one request to the SDK proxy (contract D3). It carries no
    macro attribute, so the analyzer rejects any program that names it. *)

exception Call_failed of string * string
(** The error code and message of a failed call. *)

val call : string -> Yojson.Safe.t -> Yojson.Safe.t
(** [call "<METHOD> <path>" body] sends [<METHOD> $MACRO_SDK_PROXY_URL/api<path>]
    with the run token, and [body] as JSON unless it is [`Null]; returns the
    reply's JSON. *)
