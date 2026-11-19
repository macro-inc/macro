(* expect: cannot analyze: unmarshals @ 3 *)
let request : (unit, Macro_sdk.Request.no_error) Macro_sdk.Request.t =
  input_value stdin
