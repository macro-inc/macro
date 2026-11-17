(* expect: contacts.add_contact *)
exception Deferred of (unit -> unit)

let defer () =
  raise
    (Deferred
       (fun () -> ignore (Macro_sdk.Contacts.add_contact ~user_id:"u" ())))
