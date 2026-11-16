(* expect: cannot analyze: belongs to Direct, whose code the analysis cannot see @ 3 *)
(* Another unit of the program can call operations out of sight. *)
let request = Direct.request
