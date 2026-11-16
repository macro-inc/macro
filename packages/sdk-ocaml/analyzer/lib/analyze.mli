(** Which Macro SDK operations a compiled program may call.

    Reads the typed tree of one program's [.cmt] (compiled with [-bin-annot]
    against the SDK's [.cmi] files) and reports every operation it references,
    by any path, without evaluating anything. When the program could reach an
    operation in a way the analysis cannot see (external declarations, [Obj],
    [Marshal], unchecked memory access, a hand-built request), the result is
    [Cannot_analyze] with the locations, never a partial set. *)

type operation = {
  service : string;  (** spec name, e.g. ["storage"] *)
  operation : string;  (** operationId, e.g. ["create_task_handler"] *)
  path : string;  (** e.g. ["Macro_sdk.Storage.create_task_handler"] *)
}

val operations : operation list
(** Every operation in the SDK this analyzer was built with, sorted. *)

val returns_request : ?env:Env.t Lazy.t -> Types.type_expr -> bool
(** The type of an operation: a function whose final result is
    [Macro_sdk_runtime.Request.t]. *)

val yields_request : ?env:Env.t Lazy.t -> Types.type_expr -> bool
(** The request type occurs in a result position, so a value of this type
    can hand out a request. With [env], type abbreviations are expanded. *)

val default_libraries : string list
(** Compilation units (and their [Unit__] submodules) a program may use: the
    standard library, the SDK, its runtime and transport, and the libraries
    their interfaces expose. Their code is trusted, not analyzed. *)

val operation_of : unit:string -> string -> operation option
(** The operation a service unit's value builds, e.g.
    [operation_of ~unit:"Macro_sdk__Storage" "create_task_handler"]. *)

type location = { file : string; line : int; column : int }

type via =
  | Reference  (** the program names the operation's value *)
  | Module
      (** a module containing it is used as a value (functor argument, include, ...) *)

type found = { operation : operation; locations : (location * via) list }

type result =
  | Analyzed of found list
      (** sorted by service and operation; locations sorted *)
  | Cannot_analyze of (string * location) list
      (** reasons, sorted by location *)

val cmt :
  ?load_path:string list ->
  ?root:string ->
  ?libraries:string list ->
  string ->
  (result, string) Stdlib.result
(** [cmt file] analyzes [file]. [load_path] is where the SDK and standard
    library [.cmi] files are; by default the load path recorded in the [.cmt],
    its relative entries taken from [root] (default: the build directory the
    [.cmt] records if it exists, else the current directory).
    A reference to a unit outside [libraries] (default
    {!default_libraries}) cannot be analyzed.
    [Error] is a usage problem: unreadable file, not an implementation, no SDK
    on the load path. *)

val to_json : result -> Yojson.Safe.t
val to_text : result -> string
