# Minecraft Fargate

## Useful commands

 * `npm run build`   compile typescript to js
 * `npm run watch`   watch for changes and compile
 * `npm run test`    perform the jest unit tests
 * `cdk deploy`      deploy this stack to your default AWS account/region
 * `cdk diff`        compare deployed stack with current state
 * `cdk synth`       emits the synthesized CloudFormation template


## Params
- serverBucketName: The name of a bucket with world/mods already exists (optional)
- duckDnsSubDomain: The subdomain under which you will reach your server
## Secrets
- mcDuckDnsToken: create a secret with this name and place the token for duckdns as plaintext
