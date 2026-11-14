(* JSON helpers the generated codecs call. Decoders raise [Decode_error] with
   the path to the offending value; encoders build [Yojson.Safe.t]. *)

type t = Yojson.Safe.t

exception Decode_error of string

let fail fmt = Printf.ksprintf (fun message -> raise (Decode_error message)) fmt

let kind : t -> string = function
  | `Null -> "null"
  | `Bool _ -> "boolean"
  | `Int _ | `Intlit _ -> "integer"
  | `Float _ -> "number"
  | `String _ -> "string"
  | `List _ -> "array"
  | `Assoc _ -> "object"

(* Prefix a decode error with the field or index it happened under. *)
let within label decode value =
  try decode value
  with Decode_error message -> raise (Decode_error (label ^ ": " ^ message))

(* ---------- decoders ---------- *)

let string = function
  | `String s -> s
  | json -> fail "expected string, got %s" (kind json)

let int = function
  | `Int i -> i
  | json -> fail "expected integer, got %s" (kind json)

let int64 = function
  | `Int i -> Int64.of_int i
  | `Intlit s -> (
      match Int64.of_string_opt s with
      | Some i -> i
      | None -> fail "integer %s does not fit in 64 bits" s)
  | json -> fail "expected integer, got %s" (kind json)

let float = function
  | `Float f -> f
  | `Int i -> float_of_int i
  | `Intlit s -> float_of_string s
  | json -> fail "expected number, got %s" (kind json)

let bool = function
  | `Bool b -> b
  | json -> fail "expected boolean, got %s" (kind json)

let json (value : t) = value

let list decode = function
  | `List items ->
      List.mapi (fun i item -> within (string_of_int i) decode item) items
  | json -> fail "expected array, got %s" (kind json)

let option decode = function `Null -> None | json -> Some (decode json)

let obj = function
  | `Assoc fields -> fields
  | json -> fail "expected object, got %s" (kind json)

let map decode = function
  | `Assoc fields ->
      List.map (fun (key, value) -> (key, within key decode value)) fields
  | json -> fail "expected object, got %s" (kind json)

(* A field the schema requires. *)
let required fields key decode =
  match List.assoc_opt key fields with
  | Some value -> within key decode value
  | None -> fail "missing field %S" key

(* A field that may be absent or null; both decode to [None]. *)
let optional fields key decode =
  match List.assoc_opt key fields with
  | None | Some `Null -> None
  | Some value -> Some (within key decode value)

(* The value of a union's tag field. *)
let tag fields key = required fields key string

(* Untagged unions: the first member whose decoder accepts the value wins. *)
let first_ok decoders json =
  let rec attempt = function
    | [] -> fail "no member of the union accepts this %s" (kind json)
    | decode :: rest -> ( try decode json with Decode_error _ -> attempt rest)
  in
  attempt decoders

(* Externally tagged unions: a bare string for a case without data, or a
   single-key object whose key names the case. *)
let external_case = function
  | `String name -> (name, None)
  | `Assoc [ (name, value) ] -> (name, Some value)
  | json -> fail "expected a string or a single-key object, got %s" (kind json)

let payload name = function
  | Some value -> value
  | None -> fail "case %S needs a value" name

(* ---------- encoders ---------- *)

let of_string s : t = `String s
let of_int i : t = `Int i

let of_int64 i : t =
  if
    Int64.compare i (Int64.of_int max_int) <= 0
    && Int64.compare i (Int64.of_int min_int) >= 0
  then `Int (Int64.to_int i)
  else `Intlit (Int64.to_string i)

let of_float f : t = `Float f
let of_bool b : t = `Bool b
let of_json (value : t) = value
let of_list encode items : t = `List (List.map encode items)
let of_option encode = function None -> `Null | Some value -> encode value

let of_map encode fields : t =
  `Assoc (List.map (fun (key, value) -> (key, encode value)) fields)

(* Build an object; fields given as [None] are left out. *)
let record fields : t =
  `Assoc
    (List.filter_map
       (fun (key, value) -> Option.map (fun v -> (key, v)) value)
       fields)

(* Merge flattened objects into one, as serde's [flatten] writes them. *)
let merge objects : t =
  `Assoc
    (List.concat_map
       (function
         | `Assoc fields -> fields
         | json -> fail "cannot flatten a %s into an object" (kind json))
       objects)

let with_tag key value : t -> t = function
  | `Assoc fields ->
      `Assoc ((key, `String value) :: List.remove_assoc key fields)
  | json -> fail "cannot tag a %s" (kind json)

let external_value name value : t = `Assoc [ (name, value) ]
