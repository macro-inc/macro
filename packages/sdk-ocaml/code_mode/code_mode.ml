open Js_of_ocaml

type ctx = {
  macro : Macro_sdk_fetch.t;
  session_id : string option;
  execution_id : string option;
  web_app_url : string option;
}

let hook () =
  match
    Js.Optdef.to_option
      (Js.Unsafe.get Js.Unsafe.global (Js.string "__macroCodeMode"))
  with
  | Some hook -> hook
  | None ->
      prerr_endline
        "Code_mode.run: no globalThis.__macroCodeMode; run this program \
         through code mode's bootstrap";
      exit 2

let context hook =
  let json =
    Yojson.Safe.from_string
      (Js.to_string (Js.Unsafe.get hook (Js.string "context")))
  in
  let open Yojson.Safe.Util in
  let hosts =
    json |> member "hosts" |> to_assoc
    |> List.map (fun (service, host) -> (service, to_string host))
  in
  let config =
    Macro_sdk_runtime.Config.create
    (* Every service's host is passed; Prod only names the fallback. *)
      ~env:Macro_sdk_runtime.Config.Prod ~hosts
      ~auth:
        (Macro_sdk_runtime.Config.Auth.user_token
           (json |> member "token" |> to_string))
      ()
  in
  {
    macro = Macro_sdk_fetch.create ~config ();
    session_id = json |> member "sessionId" |> to_string_option;
    execution_id = json |> member "executionId" |> to_string_option;
    web_app_url = json |> member "webAppUrl" |> to_string_option;
  }

let message = function
  | Macro_sdk_runtime.Error.Macro_error { message; _ }
  | Yojson.Json_error message ->
      message
  | exn -> Printexc.to_string exn

(* The final frame's JSON text. [std]: a value with no JSON form (nan,
   infinity) raises instead of printing non-JSON. *)
let frame hook main =
  let error message =
    `Assoc [ ("type", `String "error"); ("message", `String message) ]
  in
  let outcome =
    match context hook with
    | exception exn -> error ("unreadable code-mode context: " ^ message exn)
    | ctx -> (
        match main ctx with
        | value -> `Assoc [ ("type", `String "result"); ("value", value) ]
        | exception exn -> error (message exn))
  in
  match Yojson.Safe.to_string ~std:true outcome with
  | text -> text
  | exception exn ->
      Yojson.Safe.to_string
        (error ("the result has no JSON form: " ^ message exn))

let run main =
  let hook = hook () in
  let text = frame hook main in
  ignore
    (Js.Unsafe.meth_call hook "finish" [| Js.Unsafe.inject (Js.string text) |])
