(* Print a Parsetree as OCaml source with (** *) doc comments, then format it
   with ocamlformat.

   Pprintast prints docs as [@ocaml.doc "..."] attributes. We lex its output
   with the compiler's lexer and replace each such attribute, token for
   token, with a doc comment in the same position, where OCaml attaches it to
   the same item, field or constructor. *)

(* Split [s] on every occurrence of [separator]. *)
let split_on separator s =
  let k = String.length separator in
  let rec go start i acc =
    if i + k > String.length s then
      List.rev (String.sub s start (String.length s - start) :: acc)
    else if String.sub s i k = separator then
      go (i + k) (i + k) (String.sub s start (i - start) :: acc)
    else go start (i + 1) acc
  in
  go 0 0 []

(* "{id|" opens a quoted string even inside a comment; put a space before
   the bar. *)
let break_quoted_string_openers s =
  let out = Buffer.create (String.length s) in
  let n = String.length s in
  let rec go i =
    if i < n then begin
      Buffer.add_char out s.[i];
      if s.[i] = '{' then begin
        let j = ref (i + 1) in
        while
          !j < n && match s.[!j] with 'a' .. 'z' | '_' -> true | _ -> false
        do
          incr j
        done;
        if !j < n && s.[!j] = '|' then begin
          Buffer.add_string out (String.sub s (i + 1) (!j - i - 1));
          Buffer.add_char out ' ';
          go !j
        end
        else go (i + 1)
      end
      else go (i + 1)
    end
  in
  go 0;
  Buffer.contents out

(* Make spec prose safe inside an OCaml comment and readable as odoc:
   Markdown code spans become [code], odoc markup characters are escaped,
   and sequences the comment lexer treats specially are broken up. *)
let doc_text text =
  let text = String.trim text in
  let out = Buffer.create (String.length text + 16) in
  let n = String.length text in
  let escape c =
    match c with
    | '{' | '}' | '[' | ']' | '@' ->
        Buffer.add_char out '\\';
        Buffer.add_char out c
    | c -> Buffer.add_char out c
  in
  let rec scan i =
    if i < n then
      if text.[i] = '`' then (
        match String.index_from_opt text (i + 1) '`' with
        | Some close
          when close > i + 1
               && not
                    (String.exists
                       (fun c -> c = '[' || c = ']' || c = '\n')
                       (String.sub text (i + 1) (close - i - 1))) ->
            Buffer.add_char out '[';
            Buffer.add_string out (String.sub text (i + 1) (close - i - 1));
            Buffer.add_char out ']';
            scan (close + 1)
        | _ ->
            Buffer.add_char out '`';
            scan (i + 1))
      else begin
        escape text.[i];
        scan (i + 1)
      end
  in
  scan 0;
  let s = Buffer.contents out in
  (* The comment lexer nests on "(*", ends on "*)", reads "..." as a string
     literal and {id|...|id} as a quoted string. *)
  let s = String.concat "( *" (split_on "(*" s) in
  let s = String.concat "* )" (split_on "*)" s) in
  let quotes =
    String.fold_left (fun count c -> if c = '"' then count + 1 else count) 0 s
  in
  let s =
    if quotes mod 2 = 1 then String.map (fun c -> if c = '"' then '\'' else c) s
    else s
  in
  let s = break_quoted_string_openers s in
  if String.ends_with ~suffix:"*" s then s ^ " " else s

let lex_all source =
  let lexbuf = Lexing.from_string source in
  Lexer.init ();
  let rec loop acc =
    let token = Lexer.token lexbuf in
    let start = lexbuf.Lexing.lex_start_p.pos_cnum
    and stop = lexbuf.Lexing.lex_curr_p.pos_cnum in
    match token with
    | Parser.EOF -> List.rev acc
    | token -> loop ((token, start, stop) :: acc)
  in
  loop []

(* Replace [@ocaml.doc "s"] / [@@ocaml.doc "s"] with (** s *). *)
let docstrings source =
  let out = Buffer.create (String.length source) in
  let rec go position = function
    | (Parser.(LBRACKETAT | LBRACKETATAT), start, _)
      :: (Parser.LIDENT "ocaml", _, _)
      :: (Parser.DOT, _, _)
      :: (Parser.LIDENT "doc", _, _)
      :: (Parser.STRING (text, _, _), _, _)
      :: (Parser.RBRACKET, _, stop)
      :: rest ->
        Buffer.add_string out (String.sub source position (start - position));
        Buffer.add_string out ("(** " ^ doc_text text ^ " *)");
        go stop rest
    | _ :: rest -> go position rest
    | [] ->
        Buffer.add_string out
          (String.sub source position (String.length source - position))
  in
  go 0 (lex_all source);
  Buffer.contents out

let header spec_file =
  Printf.sprintf
    "(* Generated from packages/sdk/specs/%s by packages/sdk-ocaml/gen. Do not \
     edit. *)\n\n"
    spec_file

(* [name] places the file inside the package so ocamlformat reads its
   .ocamlformat, even when [path] is a temporary directory. *)
let write ~name ~path source =
  let raw = path ^ ".raw" in
  Out_channel.with_open_text raw (fun oc -> output_string oc source);
  let command =
    Filename.quote_command "ocamlformat"
      [ "--name"; name; "--output"; path; raw ]
  in
  let status = Sys.command command in
  if status <> 0 then
    failwith
      (Printf.sprintf
         "ocamlformat failed (%d) on %s; unformatted source kept in %s" status
         path raw);
  Sys.remove raw

(* ---------- item docs ----------

   A doc after a long [let] or [val] is ambiguous, so item docs go before
   the item: before [type] or [and] for each declaration of a type group,
   before [let]/[val] for values. *)

module Compiler_parser = Parser
open Ppxlib

let is_doc (attribute : attribute) = attribute.attr_name.txt = "ocaml.doc"

let doc_of attributes =
  List.find_map
    (fun (attribute : attribute) ->
      match attribute.attr_payload with
      | PStr
          [
            {
              pstr_desc =
                Pstr_eval
                  ( { pexp_desc = Pexp_constant (Pconst_string (text, _, _)); _ },
                    _ );
              _;
            };
          ]
        when is_doc attribute ->
          Some text
      | _ -> None)
    attributes

let without_doc attributes = List.filter (fun a -> not (is_doc a)) attributes

let comment = function
  | Some text -> "\n(** " ^ doc_text text ^ " *)\n"
  | None -> ""

(* Put [docs.(k)] before the k-th declaration of a printed type item, which
   starts at its [type] or k-th [and] token (types never contain [and]). *)
let insert_type_docs source docs =
  let starts =
    lex_all source
    |> List.filter_map (fun (token, start, _) ->
        match token with
        | Compiler_parser.TYPE | Compiler_parser.AND -> Some start
        | _ -> None)
  in
  let out = Buffer.create (String.length source + 256) in
  let rec go position starts docs =
    match (starts, docs) with
    | start :: starts, doc :: docs ->
        Buffer.add_string out (String.sub source position (start - position));
        Buffer.add_string out (comment doc);
        go start starts docs
    | _ ->
        Buffer.add_string out
          (String.sub source position (String.length source - position))
  in
  go 0 starts docs;
  Buffer.contents out

let print_with printer value = Format.asprintf "%a@." printer value

let structure_item (item : structure_item) =
  match item.pstr_desc with
  | Pstr_type (flag, declarations) ->
      let docs =
        List.map
          (fun (d : type_declaration) -> doc_of d.ptype_attributes)
          declarations
      in
      let declarations =
        List.map
          (fun (d : type_declaration) ->
            { d with ptype_attributes = without_doc d.ptype_attributes })
          declarations
      in
      insert_type_docs
        (docstrings
           (print_with Pprintast.structure_item
              { item with pstr_desc = Pstr_type (flag, declarations) }))
        docs
  | Pstr_value (flag, [ binding ]) ->
      let doc = doc_of binding.pvb_attributes in
      let binding =
        { binding with pvb_attributes = without_doc binding.pvb_attributes }
      in
      comment doc
      ^ docstrings
          (print_with Pprintast.structure_item
             { item with pstr_desc = Pstr_value (flag, [ binding ]) })
  | _ -> docstrings (print_with Pprintast.structure_item item)

let signature_item (item : signature_item) =
  match item.psig_desc with
  | Psig_type (flag, declarations) ->
      let docs =
        List.map
          (fun (d : type_declaration) -> doc_of d.ptype_attributes)
          declarations
      in
      let declarations =
        List.map
          (fun (d : type_declaration) ->
            { d with ptype_attributes = without_doc d.ptype_attributes })
          declarations
      in
      insert_type_docs
        (docstrings
           (print_with Pprintast.signature_item
              { item with psig_desc = Psig_type (flag, declarations) }))
        docs
  | Psig_value description ->
      let doc = doc_of description.pval_attributes in
      let description =
        {
          description with
          pval_attributes = without_doc description.pval_attributes;
        }
      in
      comment doc
      ^ docstrings
          (print_with Pprintast.signature_item
             { item with psig_desc = Psig_value description })
  | _ -> docstrings (print_with Pprintast.signature_item item)

let structure ~header items =
  header ^ String.concat "\n" (List.map structure_item items)

let signature ~header items =
  header ^ String.concat "\n" (List.map signature_item items)
