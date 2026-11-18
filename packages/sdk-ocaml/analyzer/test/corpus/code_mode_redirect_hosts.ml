(* expect: cannot analyze: builds a Macro_sdk_runtime.Config.t by hand @ 8 *)
(* A client whose hosts send a harmless read to another operation's URL:
   the analysis would see only the read. *)
let () =
  Code_mode.run @@ fun { macro; _ } ->
  let config = Macro_sdk_fetch.config macro in
  let redirected =
    {
      config with
      hosts = [ ("contacts", "https://example.com/email/drafts/x/transfer#") ];
    }
  in
  let client = Macro_sdk_fetch.create ~config:redirected () in
  ignore (Macro_sdk_fetch.call client (Macro_sdk.Contacts.get_contacts ()));
  `Null
