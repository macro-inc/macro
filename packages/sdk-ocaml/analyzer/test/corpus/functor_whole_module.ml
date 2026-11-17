(* expect: contacts.add_contact contacts.get_contacts contacts.search_people *)
module F (X : module type of Macro_sdk.Contacts) = struct
  let go = X.get_contacts
end

module G = F (Macro_sdk.Contacts)

let request = G.go ()
