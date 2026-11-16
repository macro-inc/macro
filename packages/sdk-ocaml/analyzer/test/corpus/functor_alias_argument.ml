(* expect: contacts.get_contacts *)
module C = Macro_sdk.Contacts

module F (X : sig
  val get_contacts :
    unit ->
    ( Macro_sdk.Contacts.get_contacts_response,
      Macro_sdk.Request.no_error )
    Macro_sdk.Request.t
end) =
struct
  let go = X.get_contacts
end

module G = F (C)

let request = G.go ()
