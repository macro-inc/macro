(* Ordinary code, including opening Stdlib, passes. *)
open Stdlib

let () =
  print_endline
    (Printf.sprintf "%d %s" (List.length [ 1; 2 ]) (String.concat "," [ "a" ]))

let lazy_one = lazy 1
let elapsed = Sys.time ()
let total = Stdlib.(1 + Lazy.force lazy_one)

(* Sys by its name, opened or renamed, and Sys's own submodules. *)
module S = Sys

let renamed = S.time ()
let opened = Sys.(time ())

let local =
  let open Sys in
  time ()

module Immediate = Sys.Immediate64

let formatted = Format.asprintf "%a" (fun f () -> Format.pp_print_int f 1) ()

let obj =
  object
    method x = 1
  end
