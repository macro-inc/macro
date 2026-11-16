(* Every way in that the policy refuses, including through aliases. *)
external system : string -> int = "caml_sys_system_command"

module S = Stdlib

let a = S.Obj.magic 0

module O = Obj

let b : int = O.magic "x"
let c = Sys.command
let d = Marshal.to_string 1 []
let e = Stdlib__Obj.repr 1

module type T = sig
  external f : int -> int = "x"
end

let g (x : Obj.t) = x

module M = struct
  include Stdlib
end

let h =
  let open Obj in
  repr 1

let i = Stdlib.(Obj.repr 2)
let j = system "true"
