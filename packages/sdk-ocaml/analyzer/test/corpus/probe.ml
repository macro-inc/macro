(* expect: contacts.get_contacts storage.create_task_handler *)
(* The Wasm probe from 2026-11-16: dune stanza
   (executable (name probe) (modes byte js wasm) (libraries macro_sdk)),
   built in packages/sdk-ocaml/wasmtest with wasm-shell.nix, run with
   deno run --no-prompt --allow-env=OCAMLRUNPARAM --allow-read=. probe-wasm.cjs
   (the built probe.bc.wasm.js copied to .cjs). *)
open Macro_sdk

let () =
  let r =
    Storage.create_task_handler ~task_name:"[sdk-e2e wasm] probe" ~markdown:"hi"
      ()
  in
  let body =
    match r.body with
    | Some (Request.Json j) -> Yojson.Safe.to_string j
    | _ -> "(other)"
  in
  Printf.printf "%s %s\n%s\n"
    (match r.meth with `POST -> "POST" | _ -> "?")
    r.path body;
  match
    Contacts.(get_contacts ()).decode_reply ~status:200
      {|{"contacts":["a","b"]}|}
  with
  | { contacts } -> Printf.printf "decoded %d contacts\n" (List.length contacts)
