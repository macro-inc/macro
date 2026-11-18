(* expect: none *)
(* A local module named like the SDK calls nothing. *)
module Macro_sdk = struct
  module Contacts = struct
    let get_contacts () = 1
  end
end

let request = Macro_sdk.Contacts.get_contacts ()
