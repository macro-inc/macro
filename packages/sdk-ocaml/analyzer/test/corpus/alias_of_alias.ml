(* expect: contacts.get_contacts *)
module M = Macro_sdk
module C = M.Contacts

let request = C.get_contacts ()
