(* The sample code-mode program: one SDK call through the bootstrap's fetch,
   and the run's context, as JSON. Also what the bundle check compiles with
   plain ocamlc and wasm_of_ocaml (nix/cloud-storage.nix,
   code-mode-ocaml-sample). *)
open Macro_sdk

let () =
  Code_mode.run @@ fun { macro; session_id; execution_id; web_app_url } ->
  let string = function Some s -> `String s | None -> `Null in
  let reply = Macro_sdk_fetch.call_exn macro (Contacts.get_contacts ()) in
  `Assoc
    [
      ("contacts", `List (List.map (fun c -> `String c) reply.contacts));
      ("session", string session_id);
      ("execution", string execution_id);
      ("webAppUrl", string web_app_url);
    ]
