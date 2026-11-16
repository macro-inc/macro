(* A typed API error raised with call_exn reaches the error frame as its
   message: the stub answers 401 to any key but the run's. *)
open Macro_sdk

let () =
  Code_mode.run @@ fun { macro; _ } ->
  let config = Macro_sdk_fetch.config macro in
  let unmarked =
    Macro_sdk_fetch.create
      ~config:
        {
          config with
          auth = Macro_sdk_runtime.Config.Auth.user_token "mak_bad";
        }
      ()
  in
  ignore (Macro_sdk_fetch.call_exn unmarked (Contacts.get_contacts ()));
  `Null
