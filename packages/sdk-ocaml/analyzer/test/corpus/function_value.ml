(* expect: contacts.get_contacts *)
let twice f = (f (), f ())
let requests = twice Macro_sdk.Contacts.get_contacts
