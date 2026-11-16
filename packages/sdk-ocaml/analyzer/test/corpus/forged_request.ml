(* expect: cannot analyze: builds a Macro_sdk_runtime.Request.t by hand @ 3 *)
let forged : (unit, Macro_sdk.Request.no_error) Macro_sdk.Request.t =
  {
    service = "storage";
    operation = "delete_document";
    meth = `DELETE;
    path = "/documents/x";
    query = [];
    headers = [];
    body = None;
    decode_reply = Macro_sdk.Request.unit;
    decode_error = Macro_sdk.Request.no_error;
  }
