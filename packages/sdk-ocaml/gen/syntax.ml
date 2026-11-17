(* Small Parsetree helpers shared by the emitters. *)
open Ppxlib

let loc = Location.none

module B = Ast_builder.Make (struct
  let loc = Location.none
end)

let lid name = B.Located.mk (Longident.parse name)
let name s = B.Located.mk s
let evar = B.evar
let pvar = B.pvar
let estring = B.estring
let pstring = B.pstring
let eint = B.eint
let tconstr ?(args = []) name = B.ptyp_constr (lid name) args
let ctor ?arg name = B.pexp_construct (lid name) arg
let pctor ?arg name = B.ppat_construct (lid name) arg
let case lhs rhs = B.case ~lhs ~guard:None ~rhs

(* Docs ride on [ocaml.doc] attributes; the printer turns them into
   (** *) comments. *)
let doc_attributes = function
  | None -> []
  | Some text when String.trim text = "" -> []
  | Some text ->
      [
        B.attribute ~name:(name "ocaml.doc")
          ~payload:(PStr [ B.pstr_eval (estring text) [] ]);
      ]

let fun_ label pattern body = B.pexp_fun label None pattern body
