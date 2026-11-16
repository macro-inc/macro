(* expect: contacts.get_contacts *)
module Contacts = struct
  let get = Macro_sdk.Contacts.get_contacts
end

let request = Contacts.get ()
