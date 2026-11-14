(* macro-sdk-analyze <prog.ml>: prints the operations the program can call
   (contract D6). Exit 0 when accepted, 1 when refused, 2 on a setup error. *)

let () =
  match Sys.argv with
  | [| _; filename |] -> (
      match Macro_sdk_analyzer.Sdk.locate () with
      | Error message ->
          prerr_endline ("macro-sdk-analyze: " ^ message);
          exit 2
      | Ok sdk ->
          let source = In_channel.with_open_bin filename In_channel.input_all in
          let result = Macro_sdk_analyzer.Analyze.program sdk ~filename source in
          print_endline (Yojson.Safe.to_string (Macro_sdk_analyzer.Analyze.to_json result));
          exit (match result with Ok _ -> 0 | Error _ -> 1))
  | _ ->
      prerr_endline "usage: macro-sdk-analyze <prog.ml>";
      exit 2
