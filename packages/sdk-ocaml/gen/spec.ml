(* Reading an OpenAPI 3.1 document. *)

type json = Yojson.Safe.t

(* Raised for any schema or operation shape the generator cannot emit; the
   generator exits non-zero naming the JSON pointer. *)
exception Unsupported of { at : string; message : string }

let unsupported ~at fmt =
  Printf.ksprintf (fun message -> raise (Unsupported { at; message })) fmt

let member key = function
  | `Assoc fields -> List.assoc_opt key fields
  | _ -> None

let string key json =
  match member key json with Some (`String s) -> Some s | _ -> None

let list key json =
  match member key json with Some (`List items) -> items | _ -> []

let assoc key json =
  match member key json with Some (`Assoc fields) -> fields | _ -> []

let fields = function `Assoc fields -> fields | _ -> []
let has key json = member key json <> None
let bool key json = member key json = Some (`Bool true)

let strings key json =
  List.filter_map (function `String s -> Some s | _ -> None) (list key json)

let ref_name ~at reference =
  match String.split_on_char '/' reference with
  | [ "#"; "components"; "schemas"; name ] -> name
  | _ ->
      unsupported ~at "only #/components/schemas references are supported: %s"
        reference

type t = {
  name : string;
      (** spec file name without extension, e.g. "scheduled-action" *)
  components : (string * json) list;
  paths : (string * json) list;
}

let load file =
  let json = Yojson.Safe.from_file file in
  (match string "openapi" json with
  | Some version when String.starts_with ~prefix:"3.1" version -> ()
  | version ->
      unsupported ~at:file "expected OpenAPI 3.1, got %s"
        (Option.value version ~default:"none"));
  {
    name = Filename.remove_extension (Filename.basename file);
    components =
      assoc "schemas" (Option.value (member "components" json) ~default:`Null);
    paths = assoc "paths" json;
  }

(* Follow $ref until a schema that is not a reference. *)
let rec resolve spec ~at schema =
  match string "$ref" schema with
  | Some reference -> (
      let name = ref_name ~at reference in
      match List.assoc_opt name spec.components with
      | Some target -> resolve spec ~at target
      | None -> unsupported ~at "dangling reference %s" reference)
  | None -> schema

let is_null_schema schema = string "type" schema = Some "null"

(* The one string a schema allows, written as a one-value enum or a const. *)
let single_value schema =
  match (member "enum" schema, member "const" schema) with
  | Some (`List [ `String value ]), _ | _, Some (`String value) -> Some value
  | _ -> None

(* oneOf or anyOf members; the generator treats both as "exactly one". *)
let union_members schema =
  match (member "oneOf" schema, member "anyOf" schema) with
  | Some (`List members), _ | None, Some (`List members) -> Some members
  | _ -> None
