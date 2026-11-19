(* expect: contacts.add_contact *)
module rec R : sig
  val add_contact :
    user_id:string ->
    unit ->
    (unit, Macro_sdk.Request.no_error) Macro_sdk.Request.t
end =
  Macro_sdk.Contacts

let request = R.add_contact ~user_id:"u" ()
