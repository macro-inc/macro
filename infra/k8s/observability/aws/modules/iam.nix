# Helpers for IAM policy documents, rendered as JSON strings. OpenTofu
# interpolates the `${...}` references inside them.
{
  # A role trust policy for an AWS service principal.
  trust = service: actions: {
    Version = "2012-10-17";
    Statement = [
      {
        Effect = "Allow";
        Principal.Service = service;
        Action = actions;
      }
    ];
  };

  policy = statements: {
    Version = "2012-10-17";
    Statement = statements;
  };

  managed = name: "arn:aws:iam::aws:policy/${name}";
}
