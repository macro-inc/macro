(* expect: contacts.add_contact *)
(* May-call: a reference counts even in code that never runs. *)
module Make (X : sig end) = struct
  let request = Macro_sdk.Contacts.add_contact ~user_id:"u" ()
end

let request =
  if false then Some (Macro_sdk.Contacts.add_contact ~user_id:"v" ()) else None
