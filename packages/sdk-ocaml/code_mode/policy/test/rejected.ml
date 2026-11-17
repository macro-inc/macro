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

(* A path to a local alias of Sys, behind a signature: the typer keeps
   these as unexpanded aliases, which the check expands. *)
module Path_constrained : Command = Nested.X

let p =
  let module L : Command = Nested.X in
  L.command "p"

module Holder = struct
  module S = Sys
end

module Submodule_constrained : sig
  module S : Command
end =
  Holder

(* The same through a functor's result, module type of, recursive
   modules, a first-class module unpacked later, a local open, and
   module substitutions. *)
module Returns_nested (A : sig end) = Nested

module Result_constrained : sig
  module X : Command
end = Returns_nested (struct end)

module Body_constrained (A : sig end) : Command = Nested.X

module type Of_nested = module type of Nested

module Typed_of : Of_nested = Nested

module Through_type_of (A : Of_nested) = struct
  let r = A.X.command "q"
end

module rec Recursive : sig
  module X : Command
end =
  Nested

let unpacked =
  let packed = (module Nested.X : Command) in
  let module U = (val packed) in
  U.command "r"

let local_open =
  let open Nested in
  let module L : Command = X in
  L.command "s"

module type With_x = sig
  module X : sig end
end
with module X = Nested.X

module Through_with (A : With_x) = struct
  let r = A.X.command "t"
end

module type Substituted = sig
  module X : Command
  module Y = X
end
with module X := Nested.X

module Through_substitution (A : Substituted) = struct
  let r = A.Y.command "u"
end

module Included_path : Command = struct
  include Nested.X
end

module Alias_chain = Nested
module Chain_constrained : Command = Alias_chain.X

(* Sys's own signature as a functor parameter's type keeps its values'
   declaration. *)
module Through_sys_type (A : module type of Sys) = struct
  let r = A.command "v"
end

(* A module too large to expand within the budget is refused. *)
module D0 = struct
  let x = 1
end

module D1 = struct
  module L = D0
  module R = D0
end

module D2 = struct
  module L = D1
  module R = D1
end

module D3 = struct
  module L = D2
  module R = D2
end

module D4 = struct
  module L = D3
  module R = D3
end

module D5 = struct
  module L = D4
  module R = D4
end

module D6 = struct
  module L = D5
  module R = D5
end

module D7 = struct
  module L = D6
  module R = D6
end

module D8 = struct
  module L = D7
  module R = D7
end

module D9 = struct
  module L = D8
  module R = D8
end

module D10 = struct
  module L = D9
  module R = D9
end

module D11 = struct
  module L = D10
  module R = D10
end

module D12 = struct
  module L = D11
  module R = D11
end

module D13 = struct
  module L = D12
  module R = D12
end

module D14 = struct
  module L = D13
  module R = D13
end

module D15 = struct
  module L = D14
  module R = D14
end

module D16 = struct
  module L = D15
  module R = D15
end

module D17 = struct
  module L = D16
  module R = D16
end

module D18 = struct
  module L = D17
  module R = D17
end

module D19 = struct
  module L = D18
  module R = D18
end

module Too_large : sig end = D19
