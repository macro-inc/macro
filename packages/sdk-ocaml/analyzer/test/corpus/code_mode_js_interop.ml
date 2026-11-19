(* expect: cannot analyze: belongs to Js_of_ocaml @ 5 *)
(* The JavaScript interop code mode's libraries are built on could call
   fetch directly. *)
let () =
  let fetch = Js_of_ocaml.Js.Unsafe.pure_js_expr "globalThis.fetch" in
  Code_mode.run @@ fun _ ->
  ignore fetch;
  `Null
