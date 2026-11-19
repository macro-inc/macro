(* expect: contacts.get_contacts *)
let request =
  let open Macro_sdk.Contacts in
  get_contacts ()
