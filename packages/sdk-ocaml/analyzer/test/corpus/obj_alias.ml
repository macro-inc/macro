(* expect: cannot analyze: names Obj @ 2 *)
module O = Stdlib.Obj

let x : string = O.magic 0
