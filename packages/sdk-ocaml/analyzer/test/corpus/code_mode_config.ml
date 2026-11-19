(* expect: none *)
(* The transport's other values hand out no request: a program that reads
   the client's configuration and the TypeScript method name calls nothing. *)
let () =
  Code_mode.run @@ fun { macro; web_app_url; _ } ->
  let _config = Macro_sdk_fetch.config macro in
  `Assoc
    [
      ("method", `String (Macro_sdk_fetch.sdk_method "get_contacts"));
      ("web", match web_app_url with Some url -> `String url | None -> `Null);
    ]
