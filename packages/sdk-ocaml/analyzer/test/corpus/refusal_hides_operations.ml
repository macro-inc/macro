(* expect: cannot analyze: external declarations @ 4 *)
let request = Macro_sdk.Contacts.get_contacts ()

external id : 'a -> 'a = "%identity"
