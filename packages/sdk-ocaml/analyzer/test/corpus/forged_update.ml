(* expect: cannot analyze: builds a Macro_sdk_runtime.Request.t by hand @ 3 *)
let real = Macro_sdk.Contacts.get_contacts ()
let forged = { real with operation = "delete_document"; path = "/documents/x" }
