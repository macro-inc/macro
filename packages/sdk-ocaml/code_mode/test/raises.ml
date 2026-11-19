(* An exception from the program ends the run with an error frame. *)
let () = Code_mode.run @@ fun _ -> failwith "boom"
