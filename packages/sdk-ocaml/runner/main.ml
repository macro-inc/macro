(* macro-sdk-run <prog.ml> (contract D6): analyze the program, ask the
   permission endpoint about every operation it can call, and only when all
   are allowed compile it and run it against the proxy.

   Before running, it registers the analyzed operations with the proxy
   (POST /v1/executions, with the execution token) and gives the program only
   the run token it gets back.

   Exit codes: 0 ran; 1 the analyzer refused the program; 2 setup failure
   (environment, permission endpoint, compiler, run registration); 3 an operation is blocked;
   4 the program failed (main raised). *)

open Macro_sdk_analyzer

let fail code message =
  prerr_endline ("macro-sdk-run: " ^ message);
  exit code

let required name =
  match Sys.getenv_opt name with
  | Some value when value <> "" -> value
  | _ -> fail 2 (name ^ " is not set")

let print_json json = print_endline (Yojson.Safe.to_string json)

(* Every requested method must come back "allow"; a missing or unknown answer
   counts as blocked, so a broken endpoint cannot let a program through. *)
let decide permissions_url methods =
  let body = Yojson.Safe.to_string (`Assoc [ ("methods", `List (List.map (fun m -> `String m) methods)) ]) in
  match Macro_sdk_http.post_json ~url:(permissions_url ^ "/v1/decide") body with
  | Error message -> fail 2 ("permission endpoint: " ^ message)
  | Ok { status = 200; body } -> (
      match Yojson.Safe.from_string body with
      | `Assoc fields -> (
          match List.assoc_opt "decisions" fields with
          | Some (`Assoc decisions) ->
              List.filter (fun m -> List.assoc_opt m decisions <> Some (`String "allow")) methods
          | _ -> fail 2 "permission endpoint: reply has no decisions")
      | _ -> fail 2 "permission endpoint: reply is not an object"
      | exception Yojson.Json_error message -> fail 2 ("permission endpoint: " ^ message))
  | Ok { status; _ } -> fail 2 (Printf.sprintf "permission endpoint answered %d" status)

(* Registers the analyzed operations with the proxy and returns the run token,
   the only credential the program gets: with it the proxy refuses any
   operation outside this list, whatever the permission endpoint says. *)
let register_run proxy_url execution_token methods =
  let body = Yojson.Safe.to_string (`Assoc [ ("operations", `List (List.map (fun m -> `String m) methods)) ]) in
  match Macro_sdk_http.post_json ~url:(proxy_url ^ "/v1/executions") ~bearer:execution_token body with
  | Error message -> Error ("proxy: " ^ message)
  | Ok { status = 200; body } -> (
      match Yojson.Safe.from_string body with
      | `Assoc fields -> (
          match List.assoc_opt "token" fields with
          | Some (`String token) -> Ok token
          | _ -> Error "proxy: registration reply has no token")
      | _ -> Error "proxy: registration reply is not an object"
      | exception Yojson.Json_error message -> Error ("proxy: " ^ message))
  | Ok { status; _ } -> Error (Printf.sprintf "proxy answered %d to the run registration" status)

let wait_for pid =
  match snd (Unix.waitpid [] pid) with
  | Unix.WEXITED code -> code
  | Unix.WSIGNALED _ | Unix.WSTOPPED _ -> 128

(* OCAMLPARAM would let the environment add compiler flags (-unsafe, -ppx). *)
let compiler_environment () =
  Array.of_list
    (List.filter
       (fun entry -> not (String.starts_with ~prefix:"OCAMLPARAM=" entry))
       (Array.to_list (Unix.environment ())))

let run_command ?(env = compiler_environment ()) ~cwd program arguments =
  let previous = Sys.getcwd () in
  Sys.chdir cwd;
  let pid =
    Unix.create_process_env program (Array.of_list (program :: arguments)) env Unix.stdin Unix.stdout Unix.stderr
  in
  Sys.chdir previous;
  wait_for pid

let entry_point =
  {|let () =
  let reply =
    match User_program.main () with
    | value -> Ok value
    | exception Macro.Error { code; message; _ } -> Error (code, message)
    | exception error -> Error ("exception", Printexc.to_string error)
  in
  match reply with
  | Ok value -> print_endline (Yojson.Safe.to_string (`Assoc [ ("result", value) ]))
  | Error (code, message) ->
      print_endline
        (Yojson.Safe.to_string (`Assoc [ ("error", `Assoc [ ("code", `String code); ("message", `String message) ]) ]));
      exit 4
|}

let write_file path text = Out_channel.with_open_bin path (fun channel -> output_string channel text)

let rec remove_tree path =
  if Sys.is_directory path then (
    Array.iter (fun name -> remove_tree (Filename.concat path name)) (Sys.readdir path);
    Sys.rmdir path)
  else Sys.remove path

(* The program is compiled with exactly the analyzer's search path: the SDK
   visible, its dependencies hidden (-H). Only the generated entry point sees
   the whole package, to link and print. *)
let compile (sdk : Sdk.t) directory source =
  write_file (Filename.concat directory "user_program.ml") source;
  write_file (Filename.concat directory "entry.ml") entry_point;
  let hidden = List.concat_map (fun dependency -> [ "-H"; dependency ]) sdk.dependency_directories in
  let compiled =
    run_command ~cwd:directory "ocamlfind"
      ([ "ocamlopt"; "-c"; "-w"; "-a"; "-I"; sdk.directory ] @ hidden @ [ "user_program.ml" ])
  in
  if compiled <> 0 then Error "compiling the program failed"
  else
    let linked =
      run_command ~cwd:directory "ocamlfind"
        [ "ocamlopt"; "-w"; "-a"; "-package"; sdk.package; "-linkpkg"; "user_program.cmx"; "entry.ml"; "-o"; "program" ]
    in
    if linked <> 0 then Error "linking the program failed" else Ok (Filename.concat directory "program")

let run filename =
  let proxy_url = required "MACRO_SDK_PROXY_URL" in
  let permissions_url = required "MACRO_SDK_PERMISSIONS_URL" in
  let token = required "MACRO_SDK_EXECUTION_TOKEN" in
  let source =
    try In_channel.with_open_bin filename In_channel.input_all with Sys_error message -> fail 2 message
  in
  let sdk = match Sdk.locate () with Ok sdk -> sdk | Error message -> fail 2 message in
  match Analyze.program sdk ~filename source with
  | Error _ as refused ->
      print_json (Analyze.to_json refused);
      fail 1 "the analyzer refused the program"
  | Ok operations ->
      let methods = List.map (fun (operation : Sdk.operation) -> operation.name) operations in
      prerr_endline ("macro-sdk-run: operations: " ^ if methods = [] then "none" else String.concat ", " methods);
      let blocked = if methods = [] then [] else decide permissions_url methods in
      if blocked <> [] then (
        let message = "blocked by the permission endpoint: " ^ String.concat ", " blocked in
        print_json
          (`Assoc
            [
              ( "error",
                `Assoc
                  [
                    ("code", `String "blocked");
                    ("message", `String message);
                    ("methods", `List (List.map (fun m -> `String m) blocked));
                  ] );
            ]);
        fail 3 (message ^ "; the program was not compiled or run"));
      let directory = Filename.temp_dir "macro-sdk-run" "" in
      let outcome =
        Fun.protect
          ~finally:(fun () -> remove_tree directory)
          (fun () ->
            match compile sdk directory source with
            | Error message -> Error message
            | Ok program -> (
                match register_run proxy_url token methods with
                | Error message -> Error message
                | Ok run_token ->
                    (* The program gets the proxy and its run token, nothing
                       else from this environment: never the execution token. *)
                    let env = [| "MACRO_SDK_PROXY_URL=" ^ proxy_url; "MACRO_SDK_RUN_TOKEN=" ^ run_token |] in
                    Ok (run_command ~env ~cwd:directory program [])))
      in
      match outcome with Ok code -> exit code | Error message -> fail 2 message

let () =
  match Sys.argv with
  | [| _; filename |] -> run filename
  | _ -> fail 2 "usage: macro-sdk-run <prog.ml>"
