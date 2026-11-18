(* expect: cannot analyze: exposes `Stdlib__Obj.magic` @ 9 *)
module F (X : sig
  val magic : 'a -> 'b
end) =
struct
  let coerce = X.magic
end

module G = F (Obj)
