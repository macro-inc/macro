(* expect: contacts.get_contacts *)
(* Reading a request's fields is fine; only building one by hand is not. *)
let request = Macro_sdk.Contacts.get_contacts ()
let summary = (request.service, request.operation, request.path)
