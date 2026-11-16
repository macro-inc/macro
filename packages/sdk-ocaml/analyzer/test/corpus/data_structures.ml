(* expect: contacts.add_contact contacts.get_contacts unfurl.get_unfurl *)
type job = { run : unit -> unit }

let jobs =
  [
    { run = (fun () -> ignore (Macro_sdk.Contacts.get_contacts ())) };
    {
      run = (fun () -> ignore (Macro_sdk.Contacts.add_contact ~user_id:"u" ()));
    };
  ]

let lazy_request =
  lazy (Macro_sdk.Unfurl.get_unfurl ~url:"https://example.com" ())
