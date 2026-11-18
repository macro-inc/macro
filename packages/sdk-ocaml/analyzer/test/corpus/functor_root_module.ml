(* expect: contacts.get_contacts *)
(* The whole SDK given to a functor: only what its parameter lets through. *)
module F (Sdk : sig
  module Contacts : sig
    val get_contacts :
      unit ->
      ( Macro_sdk.Contacts.get_contacts_response,
        Macro_sdk.Request.no_error )
      Macro_sdk.Request.t
  end
end) =
struct
  let go = Sdk.Contacts.get_contacts
end

module G = F (Macro_sdk)
