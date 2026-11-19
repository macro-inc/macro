(* expect: contacts.get_contacts *)
(* A toplevel include keeps each value's identity: only what is used counts. *)
include Macro_sdk.Contacts

let request = get_contacts ()
