(* [Macro.Json]: the bindings' JSON type and pure helpers for reading
   results and building a program's return value. *)

type t = Yojson.Safe.t

let invalid message = raise (Macro_error.Error { code = "invalid"; message; status = 0 })

let show value =
  let text = Yojson.Safe.to_string value in
  if String.length text > 120 then String.sub text 0 117 ^ "..." else text

let member name = function
  | `Assoc fields -> Option.value (List.assoc_opt name fields) ~default:`Null
  | `Null -> `Null
  | value -> invalid (Printf.sprintf "Json.member %S: not an object: %s" name (show value))

let to_string = function
  | `String s -> s
  | value -> invalid ("Json.to_string: not a string: " ^ show value)

let to_float = function
  | `Float f -> f
  | `Int i -> float_of_int i
  | `Intlit s -> float_of_string s
  | value -> invalid ("Json.to_float: not a number: " ^ show value)

let to_int = function
  | `Int i -> i
  | `Float f when Float.is_integer f -> int_of_float f
  | value -> invalid ("Json.to_int: not an integer: " ^ show value)

let to_bool = function
  | `Bool b -> b
  | value -> invalid ("Json.to_bool: not a boolean: " ^ show value)

let to_list = function
  | `List items -> items
  | value -> invalid ("Json.to_list: not an array: " ^ show value)

let to_assoc = function
  | `Assoc fields -> fields
  | value -> invalid ("Json.to_assoc: not an object: " ^ show value)

let to_option read = function `Null -> None | value -> Some (read value)
let is_null value = value = `Null
let null : t = `Null
let string s : t = `String s
let float f : t = `Float f
let int i : t = `Int i
let bool b : t = `Bool b
let list items : t = `List items
let obj fields : t = `Assoc fields
let option write = function None -> `Null | Some value -> write value
let to_text value = Yojson.Safe.to_string value

let of_text text =
  try Yojson.Safe.from_string text
  with Yojson.Json_error message -> invalid ("Json.of_text: " ^ message)
