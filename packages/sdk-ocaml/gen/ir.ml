(* What the generator emits, independent of OCaml syntax. *)

type prim = String | Int | Int64 | Float | Bool

type ty =
  | Prim of prim
  | Named of string  (** a definition, by OCaml type name *)
  | List of ty
  | Map of ty  (** JSON object with arbitrary keys *)
  | Option of ty  (** nullable: [null] is [None] *)
  | Json  (** the spec allows any JSON value here *)

type field = {
  json_name : string;
  ml_name : string;
  ty : ty;  (** never [Option]; see [nullable] *)
  required : bool;
  nullable : bool;
  flatten : bool;
      (** serde [flatten]: a union whose tag and fields share this object *)
  doc : string option;
}

(* A field's OCaml type is [ty option] unless it is required and not
   nullable. Required-but-nullable fields send [null]; optional ones are
   left out when [None]. *)
let field_is_option field = field.nullable || not field.required

type tagged_case = {
  tag_value : string;
  case_name : string;
  payload : payload;
  case_doc : string option;
}

and payload =
  | No_payload
  | Fields of field list  (** inline record constructor *)
  | Same_object of ty  (** the tag sits beside this type's fields *)

type external_case = {
  key : string;  (** a bare string, or the single key of an object *)
  ext_name : string;
  value : ty option;
  ext_doc : string option;
}

type untagged_case = {
  untagged_name : string;
  member : ty;
  untagged_doc : string option;
}

type kind =
  | Record of field list
  | Enum of (string * string) list
      (** JSON value, constructor; open with [Unknown] *)
  | Tagged of { tag : string; cases : tagged_case list }
      (** open with [Unknown] *)
  | External of external_case list
  | Untagged of untagged_case list
  | Alias of ty

type def = { name : string; kind : kind; doc : string option }
type location = Path | Query | Header

type param = {
  param_name : string;
  param_ml : string;
  param_ty : ty;  (** never [Option] *)
  param_required : bool;
  location : location;
  param_doc : string option;
}

type content =
  | Reply_json of ty
  | Reply_text  (** text/plain *)
  | Reply_binary of string  (** any other media type, as bytes *)
  | Reply_empty

type reply = Single of content | By_status of (int * string * content) list

type errors =
  | No_errors
  | Uniform of { statuses : int list; error_ty : ty }
  | Error_by_status of (int * string * ty) list

type body =
  | Json_body of {
      body_ty : ty;
      body_required : bool;
      spread : field list option;
    }
      (** [spread]: the body record's fields, passed as the operation's labelled arguments *)
  | Raw_body of { content_type : string; raw_required : bool }
  | Multipart_body of {
      parts : field list;
      binary : string list;  (** parts sent as files, by JSON name *)
      multipart_required : bool;
    }

type operation = {
  operation_id : string;  (** as in the spec *)
  fn_name : string;
  meth : string;  (** lowercase *)
  path : string;
  params : param list;
  body : body option;
  reply : reply;
  reply_type : string option;
      (** name of the generated reply variant for [By_status] *)
  errors : errors;
  error_type : string option;  (** name of the generated error variant *)
  summary : string option;
}

type service = {
  spec_name : string;
  module_name : string;
  defs : def list;
  operations : operation list;
  untyped : (string * string) list;
      (** JSON pointer, reason: where [Json] was emitted *)
}
