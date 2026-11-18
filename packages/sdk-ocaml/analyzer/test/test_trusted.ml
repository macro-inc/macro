(* The analyzer trusts code mode's runtime (Macro_sdk_fetch, Code_mode)
   without analyzing it: a program that names them is analyzed as if their
   code called no operation. That holds while neither source names the
   generated SDK (Macro_sdk, whose service modules hold the operations) nor
   builds a request record by hand, so the transport only ever sends the
   request its caller passed. This checks both, on the parse trees of the
   sources the bundle builds. *)

let sources = [ "fetch/macro_sdk_fetch.ml"; "code_mode/code_mode.ml" ]
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
      when List.exists (fun (label, _) -> field_name label = "operation") fields
      ->
        fail file e.pexp_loc "builds a request record"
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
  List.iter (fun file -> check (Filename.concat root file)) sources;
  Printf.printf "%d trusted sources checked, %d failures\n"
    (List.length sources) !failures;
  if !failures > 0 then exit 1
