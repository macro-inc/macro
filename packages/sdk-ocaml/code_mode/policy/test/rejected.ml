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

(* Sys seen through a signature the program writes: its value's path and
   declaration then name the program, not Sys. *)
module Constrained : sig
  val command : string -> int
end =
  Sys

module Run (S : sig
  val command : string -> int
end) =
struct
  let r = S.command "id"
end

module Applied = Run (Sys)

module type Command = sig
  val command : string -> int
end

module Packed = (val (module Sys : Command))
module Sys_alias = Sys
module Applied_alias = Run (Sys_alias)

module Included : Command = struct
  include Sys
end

module Included_alias = struct
  include Sys_alias
end

module Applied_struct = Run (struct
  include Sys
end)

let k =
  let module L : Command = Sys in
  L.command "x"

let packed = (module Sys : Command)

module Nested = struct
  module X = Sys
end

module Run_nested (A : sig
  module X : Command
end) =
struct
  let r = A.X.command "y"
end

module Applied_nested = Run_nested (Nested)

(* Unmarshalling by another name, and the compiler's internals. *)
let l = input_value stdin
let m = Stdlib.output_value stdout 1
let n = CamlinternalOO.new_method
let o = CamlinternalMod.init_mod
