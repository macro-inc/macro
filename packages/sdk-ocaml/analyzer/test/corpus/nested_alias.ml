(* expect: contacts.add_contact contacts.get_contacts contacts.search_people *)
module M = struct
  module C = Macro_sdk.Contacts
end

module N : sig
  module C : sig
    val get_contacts :
      unit ->
      ( Macro_sdk.Contacts.get_contacts_response,
        Macro_sdk.Request.no_error )
      Macro_sdk.Request.t
  end
end =
  M

let request = N.C.get_contacts ()
