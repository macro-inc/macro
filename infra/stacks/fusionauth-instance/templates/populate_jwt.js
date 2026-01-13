// Using the user and registration parameters add additional values to the jwt object.
function populate(jwt, user, _registration) {
  jwt.fusion_user_id = user.id;
  jwt.email = user.email;

  var response = fetch('{{AUTH_SERVICE_URL}}/webhooks/user/jwt', {
    method: 'POST',
    headers: {
     'x-internal-auth-key': '{{INTERNAL_SECRET}}',
     'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      email: user.email
    })
  });

    if (response.status === 200) {
    var jsonResponse = JSON.parse(response.body);
    jwt.macro_user_id = jsonResponse.user_id;

    if (jsonResponse.root_macro_id) {
      jwt.root_macro_id = jsonResponse.root_macro_id;
    }

    if(jsonResponse.organization_id){
      jwt.macro_organization_id = jsonResponse.organization_id;
    }
  } else {
    throw new Error('unable to get user info for jwt');
  }
}
