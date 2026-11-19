(* expect: cannot analyze: belongs to Dynlink @ 3 *)
(* Loaded code can call operations out of sight. *)
let () = Dynlink.loadfile "plugin.cmo"
