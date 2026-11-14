(** Where the SDK library a program compiles against lives, and what its
    operations are. *)

type operation = { name : string; group : string; action : string }

type t = {
  package : string;  (** findlib package, e.g. [macro_sdk] *)
  directory : string;  (** holds the SDK's .cmi files; visible to programs *)
  dependency_directories : string list;
      (** its dependencies' directories; the type checker reads them, programs
          cannot name their modules *)
  units : string list;  (** compilation units in [directory] *)
  operations : operation list;  (** from operations.json (contract D1, plus "ocaml") *)
}

val locate : unit -> (t, string) result
(** Finds the package named by [MACRO_SDK_PACKAGE] (default [macro_sdk])
    with [ocamlfind query -r], and reads [MACRO_SDK_OPERATIONS] (default
    [operations.json] in the package directory). *)

val find_operation : t -> string -> operation option
