(* A result with no JSON form ends the run with an error frame. *)
let () = Code_mode.run @@ fun _ -> `Assoc [ ("x", `Float Float.nan) ]
