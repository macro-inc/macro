(* What a program may name from the standard library. Everything else in the
   standard library directory (Obj, Marshal, Sys, Unix-like I/O, Effect,
   Domain, CamlinternalOO, Std_exit ...) is refused, so a new Stdlib module is
   unusable until it is reviewed and listed here. *)

type module_rule =
  | Allow_all
  | Allow_all_except of string list
  | Allow_only of string list

(* Values of the Stdlib module itself. Left out: the channels, every function
   that reads or writes them (the print, prerr, read, open, input, output,
   flush, seek and close families), exit, at_exit and do_at_exit. *)
let stdlib_values =
  [
    "raise"; "raise_notrace"; "invalid_arg"; "failwith";
    "="; "<>"; "<"; ">"; "<="; ">="; "compare"; "min"; "max"; "=="; "!=";
    "not"; "&&"; "||"; "&"; "or";
    "__LOC__"; "__FILE__"; "__LINE__"; "__MODULE__"; "__POS__"; "__FUNCTION__";
    "__LOC_OF__"; "__LINE_OF__"; "__POS_OF__";
    "|>"; "@@";
    "~-"; "~+"; "succ"; "pred"; "+"; "-"; "*"; "/"; "mod"; "abs";
    "max_int"; "min_int"; "land"; "lor"; "lxor"; "lnot"; "lsl"; "lsr"; "asr";
    "~-."; "~+."; "+."; "-."; "*."; "/."; "**";
    "sqrt"; "cbrt"; "exp"; "exp2"; "log"; "log10"; "log2"; "expm1"; "log1p";
    "cos"; "sin"; "tan"; "acos"; "asin"; "atan"; "atan2"; "hypot";
    "cosh"; "sinh"; "tanh"; "acosh"; "asinh"; "atanh";
    "ceil"; "floor"; "abs_float"; "copysign"; "mod_float"; "frexp"; "ldexp"; "modf";
    "float"; "float_of_int"; "truncate"; "int_of_float";
    "infinity"; "neg_infinity"; "nan"; "max_float"; "min_float"; "epsilon_float";
    "classify_float";
    "^"; "int_of_char"; "char_of_int"; "ignore";
    "string_of_bool"; "bool_of_string"; "bool_of_string_opt";
    "string_of_int"; "int_of_string"; "int_of_string_opt";
    "string_of_float"; "float_of_string"; "float_of_string_opt"; "valid_float_lexem";
    "fst"; "snd"; "@";
    "ref"; "!"; ":="; "incr"; "decr";
    "^^"; "format_of_string"; "string_of_format";
  ]

(* Stdlib submodules by name (the unit is Stdlib__<name>). Data structures
   are allowed whole; formatting modules only through the functions that
   build strings or write to buffers. *)
let stdlib_modules =
  [
    ("Array", Allow_all); ("ArrayLabels", Allow_all); ("Bool", Allow_all);
    ("Buffer", Allow_all_except [ "add_channel"; "output_buffer" ]);
    ("Bytes", Allow_all); ("BytesLabels", Allow_all); ("Char", Allow_all);
    ("Complex", Allow_all); ("Dynarray", Allow_all); ("Either", Allow_all);
    ("Float", Allow_all); ("Fun", Allow_all); ("Hashtbl", Allow_all);
    ("Iarray", Allow_all); ("Int", Allow_all); ("Int32", Allow_all);
    ("Int64", Allow_all); ("Lazy", Allow_all); ("List", Allow_all);
    ("ListLabels", Allow_all); ("Map", Allow_all); ("MoreLabels", Allow_all);
    ("Nativeint", Allow_all); ("Option", Allow_all); ("Pair", Allow_all);
    ("Pqueue", Allow_all); ("Queue", Allow_all); ("Result", Allow_all);
    ("Seq", Allow_all); ("Set", Allow_all); ("Stack", Allow_all);
    ("StdLabels", Allow_all); ("String", Allow_all); ("StringLabels", Allow_all);
    ("Uchar", Allow_all); ("Unit", Allow_all);
    ( "Printf",
      Allow_only [ "sprintf"; "ksprintf"; "bprintf"; "kbprintf"; "ifprintf"; "ikfprintf" ] );
    ( "Format",
      Allow_only
        [
          "asprintf"; "kasprintf"; "sprintf"; "ksprintf"; "fprintf"; "kfprintf";
          "dprintf"; "kdprintf"; "ifprintf"; "ikfprintf";
          "formatter_of_buffer"; "pp_print_flush"; "pp_print_newline";
          "pp_print_string"; "pp_print_bytes"; "pp_print_int"; "pp_print_float";
          "pp_print_bool"; "pp_print_char"; "pp_print_nothing"; "pp_print_list";
          "pp_print_seq"; "pp_print_array"; "pp_print_iter"; "pp_print_text";
          "pp_print_option"; "pp_print_result"; "pp_print_either";
          "pp_print_space"; "pp_print_cut"; "pp_print_break";
          "pp_open_box"; "pp_open_hbox"; "pp_open_vbox"; "pp_open_hvbox";
          "pp_open_hovbox"; "pp_close_box";
        ] );
    ("Printexc", Allow_only [ "to_string"; "to_string_default" ]);
  ]

type verdict = Allowed | Refused of string

(* Functions named unsafe... (Array.unsafe_get, Bytes.unsafe_set) skip bounds
   checks, and an out-of-bounds write could forge a call to the transport. *)
let is_unsafe name =
  String.length name >= 6 && String.sub name 0 6 = "unsafe"

let stdlib_value name =
  if List.mem name stdlib_values then Allowed
  else Refused "is not in the allowed part of the standard library"

(* [path] is the value's path inside the module, e.g. ["Array"; "unsafe_get"]
   for Float.Array.unsafe_get. *)
let stdlib_module_value module_name path =
  let name = List.nth path (List.length path - 1) in
  let dotted = String.concat "." path in
  match List.assoc_opt module_name stdlib_modules with
  | _ when is_unsafe name -> Refused "skips bounds checks"
  | None -> Refused (Printf.sprintf "belongs to %s, which programs may not use" module_name)
  | Some Allow_all -> Allowed
  | Some (Allow_all_except refused) ->
      if List.mem dotted refused then Refused "does input or output" else Allowed
  | Some (Allow_only allowed) ->
      if List.mem dotted allowed then Allowed
      else Refused (Printf.sprintf "is not one of the allowed %s functions" module_name)

let stdlib_module_allowed module_name = List.mem_assoc module_name stdlib_modules

(* Functors of fully allowed modules (Map.Make, Set.Make, Hashtbl.Make ...)
   produce only pure values. *)
let stdlib_functor_allowed module_name =
  List.assoc_opt module_name stdlib_modules = Some Allow_all

(* Attributes a program may write. Everything else (including [@@macro.op]
   and unknown ones that a ppx would interpret) is refused. *)
let allowed_attributes =
  [
    "warning"; "warnerror"; "doc"; "text"; "alert"; "deprecated";
    "deprecated_mutable"; "inline"; "inlined"; "tailcall"; "unrolled";
    "specialise"; "specialised"; "immediate"; "unboxed"; "boxed";
    "warn_on_literal_pattern";
  ]

let attribute_allowed name =
  let bare =
    if String.length name > 6 && String.sub name 0 6 = "ocaml." then
      String.sub name 6 (String.length name - 6)
    else name
  in
  List.mem bare allowed_attributes
