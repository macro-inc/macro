(* Ordinary code, including opening Stdlib, passes. *)
open Stdlib

let () =
  print_endline
    (Printf.sprintf "%d %s" (List.length [ 1; 2 ]) (String.concat "," [ "a" ]))

let lazy_one = lazy 1
let elapsed = Sys.time ()
let total = Stdlib.(1 + Lazy.force lazy_one)
