(* expect: contacts.get_contacts *)
module C = Macro_sdk.Contacts

let request = C.get_contacts ()
