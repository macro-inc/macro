(* expect: contacts.add_contact contacts.get_contacts contacts.search_people *)
(* Included inside a module, the module could later be captured by a
   signature that renames nothing but hides the origin: everything counts. *)
module M = struct
  include Macro_sdk.Contacts
end

module N : sig
  val get_contacts :
    unit ->
    ( Macro_sdk.Contacts.get_contacts_response,
      Macro_sdk.Request.no_error )
    Macro_sdk.Request.t
end =
  M

let request = N.get_contacts ()
