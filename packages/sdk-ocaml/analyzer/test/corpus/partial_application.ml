(* expect: contacts.add_contact *)
let add = Macro_sdk.Contacts.add_contact ~user_id:"u"
let request = add ()
