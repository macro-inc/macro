open Js_of_ocaml
module Config = Macro_sdk_runtime.Config
module Error = Macro_sdk_runtime.Error
module Request = Macro_sdk_runtime.Request

type t = { config : Config.t }

let create ?config () =
  { config = (match config with Some c -> c | None -> Config.create ()) }

let config t = t.config

(* JSPI: suspends until the promise settles (await.wat, await.js). *)
external await : Js.Unsafe.any -> Js.Unsafe.any = "caml_macro_sdk_fetch_await"

let sdk_method operation_id =
  match
    String.split_on_char '_' operation_id
    |> List.concat_map (String.split_on_char '-')
    |> List.concat_map (String.split_on_char ' ')
    |> List.filter (( <> ) "")
  with
  | [] -> operation_id
  | first :: rest ->
      String.concat ""
        (String.uncapitalize_ascii first
        :: List.map String.capitalize_ascii rest)

let meth = function
  | `GET -> "GET"
  | `POST -> "POST"
  | `PUT -> "PUT"
  | `PATCH -> "PATCH"
  | `DELETE -> "DELETE"

let js_string s = Js.Unsafe.inject (Js.string s)

let send (request : (_, _) Request.t) (wire : Request.wire) =
  (* Pairs, not an object: a header may repeat. *)
  let headers =
    Js.array
      (Array.of_list
         (List.map
            (fun (name, value) ->
              Js.array [| js_string name; js_string value |])
            wire.wire_headers))
  in
  let operation =
    Js.Unsafe.obj
      [|
        ("service", js_string request.service);
        ("operation", js_string (sdk_method request.operation));
        (* The raw operationId: the key the permission gate checked. *)
        ("operationId", js_string request.operation);
      |]
  in
  let body =
    match wire.wire_body with
    | Some data ->
        (* Bytes, not a JavaScript string, so binary bodies stay exact. *)
        [|
          ( "body",
            Js.Unsafe.inject
              (Typed_array.Bytes.to_uint8Array (Bytes.of_string data)) );
        |]
    | None -> [||]
  in
  let init =
    Js.Unsafe.obj
      (Array.append
         [|
           ("method", js_string (meth wire.wire_meth));
           ("headers", Js.Unsafe.inject headers);
           ("macroSdkOperation", Js.Unsafe.inject operation);
         |]
         body)
  in
  let response =
    await
      (Js.Unsafe.fun_call
         (Js.Unsafe.pure_js_expr "globalThis.fetch")
         [| js_string (Uri.to_string wire.uri); Js.Unsafe.inject init |])
  in
  let status : int = Js.Unsafe.get response (Js.string "status") in
  let buffer : Typed_array.arrayBuffer Js.t =
    Js.Unsafe.coerce (await (Js.Unsafe.meth_call response "arrayBuffer" [||]))
  in
  (status, Typed_array.String.of_arrayBuffer buffer)

(* Configuration mistakes (no credential, unknown service) raise; only the
   exchange itself is caught as a transport error. *)
let call t request =
  let wire = Request.prepare t.config request in
  match send request wire with
  | status, body -> Request.interpret request ~status body
  | exception exn -> Error (Error.Transport exn)

let call_exn t request =
  match call t request with
  | Ok reply -> reply
  | Error error -> Error.raise_error error
