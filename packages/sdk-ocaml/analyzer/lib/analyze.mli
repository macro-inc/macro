(** Finds every SDK operation a program can call, or why it is refused.

    The program is type-checked in-process against the SDK (and an
    allow-listed part of the standard library), then its typed tree is walked.
    An operation is any value whose declaration carries [[@@macro.op "<name>"]].
    The walk refuses everything that could reach an operation, or any other
    effect, without the operation's identifier appearing in the file: see
    README.md for the list. *)

type error = { message : string; line : int }

val program : Sdk.t -> filename:string -> string -> (Sdk.operation list, error list) result
(** [program sdk ~filename source] analyzes [source]; [filename] is used in
    locations only. Operations are sorted by name and unique. *)

val to_json : (Sdk.operation list, error list) result -> Yojson.Safe.t
(** The CLI output (contract D6). *)
