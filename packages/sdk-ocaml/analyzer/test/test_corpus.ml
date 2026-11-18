(* Analyzes every program in corpus/ and compares the answer with the one its
   first line states:
     (* expect: <service>.<operation> ... *)   exactly these operations
     (* expect: none *)                       no operations
     (* expect: cannot analyze: <text> @ <line> *)
                                              refused, with a reason that
                                              contains <text> on that line *)

module Analyze = Macro_sdk_analyzer.Analyze

type expected = Operations of string list | Refused of string * int

let contains ~fragment text =
  let length = String.length fragment in
  let rec search index =
    index + length <= String.length text
    && (String.sub text index length = fragment || search (index + 1))
  in
  search 0

let strip_prefix ~prefix text =
  if String.starts_with ~prefix text then
    Some
      (String.sub text (String.length prefix)
         (String.length text - String.length prefix))
  else None

let expected_of file =
  let first = In_channel.with_open_bin file In_channel.input_line in
  let header =
    match first with
    | Some line -> (
        match strip_prefix ~prefix:"(* expect: " (String.trim line) with
        | Some rest when String.ends_with ~suffix:" *)" rest ->
            String.sub rest 0 (String.length rest - 3)
        | _ -> failwith (file ^ ": the first line must be (* expect: ... *)"))
    | None -> failwith (file ^ " is empty")
  in
  match strip_prefix ~prefix:"cannot analyze: " header with
  | Some reason -> (
      match String.rindex_opt reason '@' with
      | Some at ->
          Refused
            ( String.trim (String.sub reason 0 at),
              int_of_string
                (String.trim
                   (String.sub reason (at + 1) (String.length reason - at - 1)))
            )
      | None -> failwith (file ^ ": a refusal needs @ <line>"))
  | None when header = "none" -> Operations []
  | None ->
      Operations
        (String.split_on_char ' ' header
        |> List.filter (( <> ) "")
        |> List.sort compare)

let describe = function
  | Analyze.Analyzed found ->
      "operations: "
      ^ String.concat " "
          (List.map
             (fun ({ operation; _ } : Analyze.found) ->
               operation.service ^ "." ^ operation.operation)
             found)
  | Analyze.Cannot_analyze reasons ->
      "cannot analyze: "
      ^ String.concat " | "
          (List.map
             (fun (message, (location : Analyze.location)) ->
               Printf.sprintf "line %d: %s" location.line message)
             reasons)

let passes expected result =
  match (expected, result) with
  | Operations names, Analyze.Analyzed found ->
      List.sort compare
        (List.map
           (fun ({ operation; _ } : Analyze.found) ->
             operation.service ^ "." ^ operation.operation)
           found)
      = names
  | Refused (fragment, line), Analyze.Cannot_analyze reasons ->
      List.exists
        (fun (message, (location : Analyze.location)) ->
          contains ~fragment message && location.line = line)
        reasons
  | _ -> false

let () =
  let root = Filename.concat (Sys.getcwd ()) "../.." in
  let programs =
    Sys.readdir "corpus" |> Array.to_list
    |> List.filter (fun f -> Filename.check_suffix f ".ml")
    |> List.sort compare
  in
  let failures =
    List.filter
      (fun program ->
        let name = Filename.chop_suffix program ".ml" in
        let expected = expected_of (Filename.concat "corpus" program) in
        let cmt = Printf.sprintf "corpus/.corpus.objs/byte/%s.cmt" name in
        let ok, got =
          match Analyze.cmt ~root cmt with
          | Error message -> (false, "error: " ^ message)
          | Ok result -> (passes expected result, describe result)
        in
        Printf.printf "%s %s\n" (if ok then "ok  " else "FAIL") name;
        if not ok then Printf.printf "     got %s\n" got;
        not ok)
      programs
  in
  Printf.printf "%d programs, %d failed\n" (List.length programs)
    (List.length failures);
  if failures <> [] then exit 1
