type operation = { name : string; group : string; action : string }

type t = {
  package : string;
  directory : string;
  dependency_directories : string list;
  units : string list;
  operations : operation list;
}

let environment_or name default =
  match Sys.getenv_opt name with Some "" | None -> default | Some value -> value

let read_process program arguments =
  let output, input, errors =
    Unix.open_process_args_full program (Array.of_list (program :: arguments)) (Unix.environment ())
  in
  close_out input;
  let text = In_channel.input_all output in
  let error_text = In_channel.input_all errors in
  match Unix.close_process_full (output, input, errors) with
  | Unix.WEXITED 0 -> Ok text
  | _ -> Error (String.trim error_text)

let absolute path = if Filename.is_relative path then Filename.concat (Sys.getcwd ()) path else path

(* Each output line is "<package> <directory>"; the package itself is one of
   them, its dependencies the others. *)
let query_directories package =
  match read_process "ocamlfind" [ "query"; "-r"; "-format"; "%p %d"; package ] with
  | Error message -> Error (Printf.sprintf "cannot find the SDK package %s: %s" package message)
  | exception Unix.Unix_error (error, _, _) ->
      Error (Printf.sprintf "cannot run ocamlfind: %s" (Unix.error_message error))
  | Ok text ->
      let entries =
        String.split_on_char '\n' text
        |> List.filter_map (fun line ->
               match String.index_opt line ' ' with
               | Some space ->
                   Some
                     ( String.sub line 0 space,
                       absolute (String.sub line (space + 1) (String.length line - space - 1)) )
               | None -> None)
      in
      (match List.assoc_opt package entries with
      | None -> Error (Printf.sprintf "ocamlfind did not list %s" package)
      | Some directory ->
          let dependencies =
            List.filter_map
              (fun (name, dependency) -> if name = package || dependency = directory then None else Some dependency)
              entries
          in
          Ok (directory, List.sort_uniq compare dependencies))

let compilation_units directory =
  Sys.readdir directory |> Array.to_list
  |> List.filter (fun file -> Filename.check_suffix file ".cmi")
  |> List.map (fun file -> String.capitalize_ascii (Filename.chop_suffix file ".cmi"))

let read_operations path =
  let field name fields =
    match List.assoc_opt name fields with Some (`String text) -> Some text | _ -> None
  in
  match Yojson.Safe.from_file path with
  | exception Sys_error message -> Error message
  | exception Yojson.Json_error message -> Error (Printf.sprintf "%s: %s" path message)
  | `Assoc top -> (
      match List.assoc_opt "operations" top with
      | Some (`List entries) ->
          let parse = function
            | `Assoc fields -> (
                match (field "name" fields, field "group" fields, field "action" fields) with
                | Some name, Some group, Some action -> Some { name; group; action }
                | _ -> None)
            | _ -> None
          in
          let operations = List.filter_map parse entries in
          if List.length operations = List.length entries then Ok operations
          else Error (Printf.sprintf "%s: every operation needs name, group and action" path)
      | _ -> Error (Printf.sprintf "%s: expected {\"operations\": [...]}" path))
  | _ -> Error (Printf.sprintf "%s: expected {\"operations\": [...]}" path)

let locate () =
  let package = environment_or "MACRO_SDK_PACKAGE" "macro_sdk" in
  match query_directories package with
  | Error message -> Error message
  | Ok (directory, dependency_directories) -> (
      let operations_path =
        environment_or "MACRO_SDK_OPERATIONS" (Filename.concat directory "operations.json")
      in
      match read_operations operations_path with
      | Error message -> Error (Printf.sprintf "cannot read operations: %s" message)
      | Ok operations ->
          Ok
            {
              package;
              directory;
              dependency_directories;
              units = compilation_units directory;
              operations;
            })

let find_operation sdk name = List.find_opt (fun operation -> operation.name = name) sdk.operations
