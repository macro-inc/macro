(* expect: cannot analyze: belongs to Obj @ 8 *)
external system : string -> int = "caml_sys_system_command"

let () =
  ignore (system "true");
  ignore (Unix.getpid ())

let () = ignore (Obj.magic 0 : string)
