(* expect: cannot analyze: builds a Macro_sdk_runtime.Request.t by hand @ 18 *)
(* A local type that re-exports the request's fields builds a real request. *)
type ('reply, 'error) request = ('reply, 'error) Macro_sdk.Request.t = {
  service : string;
  operation : string;
  meth : Macro_sdk.Request.meth;
  path : string;
  query : (string * string list) list;
  headers : (string * string) list;
  body : Macro_sdk.Request.body option;
  decode_reply : status:int -> string -> 'reply;
  decode_error : status:int -> string -> 'error option;
}

let forged : (unit, Macro_sdk.Request.no_error) request =
  let reply = Macro_sdk.Request.unit in
  let error = Macro_sdk.Request.no_error in
  {
    service = "storage";
    operation = "delete_document";
    meth = `DELETE;
    path = "/documents/x";
    query = [];
    headers = [];
    body = None;
    decode_reply = reply;
    decode_error = error;
  }
