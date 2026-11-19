(* expect: cannot analyze: exposes `Stdlib__Obj.repr` @ 6 *)
module type M = sig
  val repr : 'a -> Obj.t
end

let m = (module Obj : M)
