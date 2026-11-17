(* expect: contacts.get_contacts *)
module type S = sig
  val get_contacts :
    unit ->
    ( Macro_sdk.Contacts.get_contacts_response,
      Macro_sdk.Request.no_error )
    Macro_sdk.Request.t
end

let packed = (module Macro_sdk.Contacts : S)

let request =
  let module M = (val packed : S) in
  M.get_contacts ()
