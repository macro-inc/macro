(* expect: contacts.get_contacts *)
module type S = sig
  val get_contacts :
    unit ->
    ( Macro_sdk.Contacts.get_contacts_response,
      Macro_sdk.Request.no_error )
    Macro_sdk.Request.t
end

let packed : (module S) = (module Macro_sdk.Contacts)
let modules : (module S) list = [ (module Macro_sdk.Contacts) ]
