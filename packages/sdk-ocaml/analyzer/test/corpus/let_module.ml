(* expect: contacts.add_contact *)
let request =
  let module C = Macro_sdk.Contacts in
  C.add_contact ~user_id:"u" ()
