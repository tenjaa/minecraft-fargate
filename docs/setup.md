# Setup

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

## Deploy

Run `npx cdk deploy` to deploy the stack to your AWS account.

## Renaming the repository

Renaming the repository changes the default GitHub Pages URL from
`https://<owner>.github.io/<old-name>/` to
`https://<owner>.github.io/<new-name>/`. Frontend navigation and assets use
relative paths, and the Pages deployment workflow obtains its environment URL
from the deployment output.

No backend changes are needed for a repository rename under the same owner.
The API's CORS configuration allows `https://tenjaa.github.io`, an origin that
does not include the repository path. The email-code sign-in flow does not use
a registered website callback URL.

If the website moves to a different domain or GitHub owner, update
`allowOrigins` in `lib/minecraft-stack.ts` and redeploy the backend.
