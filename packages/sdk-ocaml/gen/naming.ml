(* OCaml identifiers from spec names. *)

let keywords =
  [
    "and";
    "as";
    "assert";
    "asr";
    "begin";
    "class";
    "constraint";
    "do";
    "done";
    "downto";
    "effect";
    "else";
    "end";
    "exception";
    "external";
    "false";
    "for";
    "fun";
    "function";
    "functor";
    "if";
    "in";
    "include";
    "inherit";
    "initializer";
    "land";
    "lazy";
    "let";
    "lor";
    "lsl";
    "lsr";
    "lxor";
    "match";
    "method";
    "mod";
    "module";
    "mutable";
    "new";
    "nonrec";
    "object";
    "of";
    "open";
    "or";
    "private";
    "rec";
    "sig";
    "struct";
    "then";
    "to";
    "true";
    "try";
    "type";
    "val";
    "virtual";
    "when";
    "while";
    "with";
  ]

(* Type names that would shadow a predefined type used by generated code. *)
let predefined_types =
  [
    "string";
    "int";
    "int64";
    "float";
    "bool";
    "list";
    "option";
    "unit";
    "result";
    "array";
    "bytes";
    "char";
    "exn";
  ]

(* Constructor names the generated code relies on. *)
let reserved_constructors =
  [ "None"; "Some"; "Ok"; "Error"; "Unknown"; "true"; "false" ]

let is_lower = function 'a' .. 'z' | '0' .. '9' -> true | _ -> false
let is_upper = function 'A' .. 'Z' -> true | _ -> false

(* camelCase, PascalCase, kebab-case and dotted names to snake_case. An
   uppercase letter starts a word after a lowercase letter or digit, and
   before a lowercase letter when it ends an acronym ("HTTPServer"). *)
let words name =
  let n = String.length name in
  let buffer = Buffer.create (n + 8) in
  String.iteri
    (fun i c ->
      if is_upper c then begin
        let after_lower = i > 0 && is_lower name.[i - 1] in
        let ends_acronym =
          i > 0 && is_upper name.[i - 1] && i + 1 < n && is_lower name.[i + 1]
        in
        if after_lower || ends_acronym then Buffer.add_char buffer '_';
        Buffer.add_char buffer (Char.lowercase_ascii c)
      end
      else if is_lower c then Buffer.add_char buffer c
      else Buffer.add_char buffer '_')
    name;
  String.split_on_char '_' (Buffer.contents buffer) |> List.filter (( <> ) "")

let snake name =
  let joined = String.concat "_" (words name) in
  let joined = if joined = "" then "x" else joined in
  let joined =
    match joined.[0] with '0' .. '9' -> "v" ^ joined | _ -> joined
  in
  if List.mem joined keywords then joined ^ "_" else joined

let type_name name =
  let s = snake name in
  if List.mem s predefined_types then s ^ "_" else s

let constructor name =
  let s = String.capitalize_ascii (String.concat "_" (words name)) in
  let s = if s = "" then "X" else s in
  let s = match s.[0] with 'A' .. 'Z' -> s | _ -> "V" ^ s in
  if List.mem s reserved_constructors then s ^ "_" else s

let module_name name = String.capitalize_ascii (snake name)

(* Hand out [base], then [base_2], [base_3], ... within one namespace. *)
type namespace = (string, unit) Hashtbl.t

let namespace () : namespace = Hashtbl.create 64

let fresh (ns : namespace) base =
  let rec attempt i =
    let candidate = if i = 1 then base else Printf.sprintf "%s_%d" base i in
    if Hashtbl.mem ns candidate then attempt (i + 1)
    else begin
      Hashtbl.replace ns candidate ();
      candidate
    end
  in
  attempt 1

let claim (ns : namespace) name ~what =
  if Hashtbl.mem ns name then
    failwith
      (Printf.sprintf "generated name %s (%s) is already taken" name what);
  Hashtbl.replace ns name ()
