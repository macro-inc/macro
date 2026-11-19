(* expect: contacts.get_contacts *)
let ( let+ ) () f = f (Macro_sdk.Contacts.get_contacts ())

let path =
  let+ request = () in
  request.Macro_sdk.Request.path
