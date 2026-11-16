(* expect: contacts.add_contact *)
open Macro_sdk

let request = Contacts.add_contact ~user_id:"u" ()
