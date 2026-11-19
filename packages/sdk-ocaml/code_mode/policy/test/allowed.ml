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

(* Coercions of modules that hold nothing forbidden. *)
module String_map = Map.Make (String)

module Length : sig
  val length : 'a list -> int
end =
  List

module Local : sig
  val now : unit -> float
end = struct
  let now () = Sys.time ()
end

module type Now = sig
  val now : unit -> float
end

let packed = (module Local : Now)

module Unpacked = (val packed)

module type List_type = module type of List

module Typed_list : List_type = List

module Wrapped = struct
  include List
end

module Apply_local (A : Now) = struct
  let twice () = A.now () +. A.now ()
end

module Applied = Apply_local (Local)
