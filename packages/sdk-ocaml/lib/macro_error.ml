(* The one exception the client raises. [Macro] re-exports it as
   [Macro.Error]; it lives here so the runtime can raise it too.

   [status] is the HTTP status of the reply that caused it, or 0 when there
   was no reply (the proxy unreachable, a bad argument, a JSON helper given
   the wrong shape). *)

exception Error of { code : string; message : string; status : int }
