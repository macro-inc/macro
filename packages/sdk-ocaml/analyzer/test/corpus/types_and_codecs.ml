(* expect: none *)
(* Types, record builders, codecs, the runtime and the transport are not
   operations. *)
let body = Macro_sdk.Contacts.make_add_contact_request ~user_id:"u" ()
let json = Macro_sdk.Contacts.yojson_of_add_contact_request body

let file : Macro_sdk.Request.file =
  { filename = "a.txt"; content_type = "text/plain"; data = "" }

let send client request = Macro_sdk_eio.call_exn client request
let config = Macro_sdk.Config.create
