(* expect: cannot analyze: belongs to Marshal @ 3 *)
let request : (unit, Macro_sdk.Request.no_error) Macro_sdk.Request.t =
  Marshal.from_string "" 0
