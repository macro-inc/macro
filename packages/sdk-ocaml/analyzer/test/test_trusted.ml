(* The analyzer trusts code mode's runtime (Macro_sdk_fetch, Code_mode)
   without analyzing it: a program that names them is analyzed as if their
   code called no operation. That holds while neither source names the
   generated SDK (Macro_sdk, whose service modules hold the operations) nor
   builds or rewrites a request or its prepared wire form, so the transport
   only ever sends the request its caller passed, to the URL that request
   names. This checks both, on the parse trees of every source in the two
   libraries. *)

let directories = [ "fetch"; "code_mode" ]

(* Fields of Request.t and Request.wire: a record that sets any of them
   builds or rewrites what is sent. *)
let request_fields =
  [
    "service";
    "operation";
    "meth";
    "path";
    "query";
    "decode_reply";
    "decode_error";
    "wire_meth";
    "uri";
    "wire_headers";
    "wire_body";
  ]

let failures = ref 0

let fail file (location : Location.t) message =
  incr failures;
  Printf.printf "FAIL %s:%d: %s\n" file location.loc_start.pos_lnum message

let head (lid : Longident.t) =
  match Longident.flatten lid with head :: _ -> head | [] -> ""

(* The generated SDK, under any name it is reachable by. *)
let names_sdk lid =
  let head = head lid in
  head = "Macro_sdk" || String.starts_with ~prefix:"Macro_sdk__" head

let field_name (label : Longident.t Location.loc) = Longident.last label.txt

let check file =
  let structure = Pparse.parse_implementation ~tool_name:"test_trusted" file in
  let longident (lid : Longident.t Location.loc) =
    if names_sdk lid.txt then
      fail file lid.loc
        (Printf.sprintf "names %s, the generated SDK"
           (String.concat "." (Longident.flatten lid.txt)))
  in
  let expr (iterator : Ast_iterator.iterator) (e : Parsetree.expression) =
    (match e.pexp_desc with
    | Pexp_ident lid | Pexp_construct (lid, _) -> longident lid
    | Pexp_record (fields, _)
      when List.exists
             (fun (label, _) -> List.mem (field_name label) request_fields)
             fields ->
        fail file e.pexp_loc "builds or rewrites a request record"
    | _ -> ());
    Ast_iterator.default_iterator.expr iterator e
  in
  let module_expr (iterator : Ast_iterator.iterator) (m : Parsetree.module_expr)
      =
    (match m.pmod_desc with Pmod_ident lid -> longident lid | _ -> ());
    Ast_iterator.default_iterator.module_expr iterator m
  in
  let iterator = { Ast_iterator.default_iterator with expr; module_expr } in
  iterator.structure iterator structure

let () =
  let root = Sys.getenv "DUNE_SOURCEROOT" in
  let sources =
    List.concat_map
      (fun directory ->
        Sys.readdir (Filename.concat root directory)
        |> Array.to_list
        |> List.filter (fun file -> Filename.check_suffix file ".ml")
        |> List.map (Filename.concat (Filename.concat root directory)))
      directories
  in
  List.iter check sources;
  Printf.printf "%d trusted sources checked, %d failures\n"
    (List.length sources) !failures;
  if !failures > 0 then exit 1
