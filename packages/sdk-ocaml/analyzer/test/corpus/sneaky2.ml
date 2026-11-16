(* expect: cannot analyze: external declarations @ 2 *)
external system : string -> int = "caml_sys_system_command"

let () = ignore (system "echo plugin ran a shell command")
