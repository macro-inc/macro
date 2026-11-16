(* expect: contacts.get_contacts *)
let contacts client =
  match Macro_sdk_eio.call client (Macro_sdk.Contacts.get_contacts ()) with
  | Ok { contacts } -> contacts
  | Error _ -> []
