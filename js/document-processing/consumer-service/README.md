# Consumer Service

## Requirements

- node v20. ZMQ will not build on node v21

## Running Locally

We need to copy the schema.prisma file from the service directory before we can generate the prisma client.
From the current directory run the following command:

```bash
cp ../../database/prisma/schema.prisma prisma/schema.prisma
```

This process is automated in the CI/CD pipeline.



