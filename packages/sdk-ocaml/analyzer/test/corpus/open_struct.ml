(* expect: contacts.add_contact contacts.get_contacts contacts.search_people *)
(* An include inside [open struct ... end] counts the whole module. *)
open struct
  include Macro_sdk.Contacts
end

let request = get_contacts ()
