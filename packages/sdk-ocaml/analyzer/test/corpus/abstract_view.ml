(* expect: contacts.add_contact contacts.get_contacts contacts.search_people *)
(* The parameter hides the module behind an abstract module type, but the
   result gives it back: count the module as it really is. *)
module F (X : sig
  module type T

  module M : T
end) =
struct
  module Out = X.M
end

module A = struct
  module type T = module type of Macro_sdk.Contacts

  module M = Macro_sdk.Contacts
end

module G = F (A)
