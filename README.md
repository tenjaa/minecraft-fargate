# Minecraft (EC2) Fargate

This repository contains a AWS-CDK project that deploys a Minecraft server using AWS Fargate.
As a private playground a big focus is on cost efficiency.
The server is designed to be started and stopped on demand, minimizing costs when not in use.
It is using an EC2-backed Fargate cluster to reduce expenses further.

## Useful commands
- `npx cdk deploy` - Deploy the stack to your AWS account