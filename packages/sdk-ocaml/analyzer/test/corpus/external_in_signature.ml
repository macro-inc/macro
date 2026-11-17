(* expect: cannot analyze: external declarations @ 3 *)
module M : sig
  external id : int -> int = "%identity"
end = struct
  external id : int -> int = "%identity"
end
