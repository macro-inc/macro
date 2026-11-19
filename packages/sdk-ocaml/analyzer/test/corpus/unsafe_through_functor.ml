(* expect: cannot analyze: exposes `Stdlib__String.unsafe_get` @ 9 *)
module F (X : sig
  val unsafe_get : string -> int -> char
end) =
struct
  let get = X.unsafe_get
end

module G = F (String)
