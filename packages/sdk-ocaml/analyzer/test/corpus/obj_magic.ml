(* expect: cannot analyze: belongs to Obj @ 5 *)
let request = Macro_sdk.Contacts.get_contacts ()

let forged : (unit, Macro_sdk.Request.no_error) Macro_sdk.Request.t =
  Obj.magic request
