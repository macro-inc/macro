(* expect: contacts.get_contacts *)
let o =
  object
    method request = Macro_sdk.Contacts.get_contacts ()
  end
