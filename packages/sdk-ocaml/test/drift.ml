(* Regenerate the SDK from packages/sdk/specs into a temporary directory and
   fail if any file differs from the committed packages/sdk-ocaml/generated. *)

let read path = In_channel.with_open_bin path In_channel.input_all

let generated_files dir =
  Sys.readdir dir |> Array.to_list
  |> List.filter (fun f -> f <> "dune")
  |> List.sort compare

let first_difference a b =
  let lines s = String.split_on_char '\n' s in
  let rec go n = function
    | x :: xs, y :: ys -> if x = y then go (n + 1) (xs, ys) else Some (n, x, y)
    | x :: _, [] -> Some (n, x, "<end of file>")
    | [], y :: _ -> Some (n, "<end of file>", y)
    | [], [] -> None
  in
  go 1 (lines a, lines b)

let () =
  let generator = Sys.argv.(1) in
  let root = Sys.getenv "DUNE_SOURCEROOT" in
  let committed = Filename.concat root "generated" in
  let fresh = Filename.temp_dir "macro-sdk-drift" "" in
  let command =
    Filename.quote_command generator
      [
        "sdk";
        "--specs";
        Filename.concat root "../sdk/specs";
        "--out";
        fresh;
        "--format-as";
        committed;
        "--main";
        "macro_sdk";
        "--untyped";
        Filename.concat fresh "untyped.txt";
      ]
      ~stdout:Filename.null
  in
  if Sys.command command <> 0 then failwith "the generator failed";
  let expected = generated_files fresh and actual = generated_files committed in
  let problems =
    List.filter_map
      (fun file ->
        if not (List.mem file actual) then
          Some (file ^ ": missing from generated/")
        else
          match
            first_difference
              (read (Filename.concat fresh file))
              (read (Filename.concat committed file))
          with
          | None -> None
          | Some (line, want, got) ->
              Some
                (Printf.sprintf "%s:%d: expected %S, committed %S" file line
                   want got))
      expected
    @ List.filter_map
        (fun file ->
          if List.mem file expected then None
          else Some (file ^ ": not produced by the generator"))
        actual
  in
  match problems with
  | [] -> print_endline "generated/ matches the specs"
  | _ ->
      List.iter prerr_endline problems;
      prerr_endline
        "generated/ is stale: run `just generate` in packages/sdk-ocaml and \
         commit the result";
      exit 1
