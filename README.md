# Minecraft (EC2) Fargate

This repository contains a AWS-CDK project that deploys a Minecraft server using AWS Fargate.
As a private playground a big focus is on cost efficiency.
The server is designed to be started and stopped on demand, minimizing costs when not in use.
It is using an EC2-backed Fargate cluster to reduce expenses further.

## Useful commands
- `npx cdk deploy` - Deploy the stack to your AWS account

## RCON password

Before deploying, create the standard-tier SSM `SecureString` parameter once.
CloudFormation cannot create `SecureString` parameters natively. This command
generates a 48-character password without printing it or putting it in shell
arguments/history:

```sh
mise exec -- node -e 'process.stdout.write(require("node:crypto").randomBytes(24).toString("hex"))' |
  aws ssm put-parameter --region eu-central-1 \
    --name /minecraft/rcon-password --type SecureString --tier Standard \
    --value file:///dev/stdin
```

Use the default standard throughput and AWS-managed `aws/ssm` key; no Secrets
Manager resource or customer-managed KMS key is created. ECS injects the password
at task startup, and the outside-VPC coordinator reads it with decryption.
Restart the ECS task after changing the parameter. Missing or invalid parameters
fail explicitly; the password must contain exactly 48 alphanumeric characters.
