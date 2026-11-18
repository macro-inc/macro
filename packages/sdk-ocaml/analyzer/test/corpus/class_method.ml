(* expect: unfurl.get_unfurl *)
class fetcher url =
  object
    method request = Macro_sdk.Unfurl.get_unfurl ~url ()
  end
