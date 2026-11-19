(* expect: cannot analyze: uses the primitive %array_unsafe_get @ 2 *)
let x = Array.unsafe_get [| 1 |] 5
