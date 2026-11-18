(* expect: contacts.add_contact contacts.get_contacts contacts.search_people *)
module F (X : sig end) = Macro_sdk.Contacts
module G = F (struct end)

let request = G.get_contacts ()
