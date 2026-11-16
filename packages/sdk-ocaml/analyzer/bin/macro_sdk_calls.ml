(* macro_sdk_calls [--json] [--root DIR] [--allow-library UNIT]... [-I DIR]... main.cmt

   Lists the Macro SDK operations a compiled program may call. Exit 0 when
   analyzed, 1 when the program cannot be analyzed, 2 on a usage error. *)

let usage =
  "usage: macro_sdk_calls [--json] [--root DIR] [--allow-library UNIT]... [-I \
   DIR]... main.cmt"

let () =
  let libraries = ref Macro_sdk_analyzer.Analyze.default_libraries in
  let json = ref false
  and include_dirs = ref []
  and root = ref None
  and files = ref [] in
  let options =
    [
      ("--json", Arg.Set json, " print JSON instead of text");
      ( "--root",
        Arg.String (fun dir -> root := Some dir),
        "DIR resolve the .cmt's relative load path from DIR" );
      ( "-I",
        Arg.String (fun dir -> include_dirs := dir :: !include_dirs),
        "DIR look for .cmi files in DIR" );
    ]
  in
  (try
     Arg.parse_argv Sys.argv (Arg.align options)
       (fun file -> files := file :: !files)
       usage
   with
  | Arg.Help text ->
      print_string text;
      exit 0
  | Arg.Bad text ->
      prerr_string text;
      exit 2);
  match !files with
  | [ file ] -> (
      let load_path =
        match !include_dirs with [] -> None | dirs -> Some (List.rev dirs)
      in
      match
        Macro_sdk_analyzer.Analyze.cmt ?load_path ?root:!root
          ~libraries:!libraries file
      with
      | Error message ->
          prerr_endline ("macro_sdk_calls: " ^ message);
          exit 2
      | Ok result ->
          if !json then
            print_endline
              (Yojson.Safe.pretty_to_string
                 (Macro_sdk_analyzer.Analyze.to_json result))
          else print_string (Macro_sdk_analyzer.Analyze.to_text result);
          exit (match result with Analyzed _ -> 0 | Cannot_analyze _ -> 1))
  | _ ->
      prerr_endline usage;
      exit 2
