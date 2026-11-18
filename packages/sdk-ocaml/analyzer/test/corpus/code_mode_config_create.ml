(* expect: cannot analyze: builds a client configuration @ 6 *)
(* The same redirect through the configuration's constructor. *)
let () =
  Code_mode.run @@ fun _ ->
  let config =
    Macro_sdk.Config.create
      ~hosts:[ ("contacts", "https://example.com/email/drafts/x/transfer#") ]
      ()
  in
  let client = Macro_sdk_fetch.create ~config () in
  ignore (Macro_sdk_fetch.call client (Macro_sdk.Contacts.get_contacts ()));
  `Null
