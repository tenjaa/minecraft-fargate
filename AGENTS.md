# Validation

Run `mise run validate` after code changes. This runs `npx tsc && npx biome ci`
with the Node.js version configured in `mise.toml`, followed by Bash syntax checks.

Do not introduce a local DynamoDB or new tests for the Minecraft account feature.
Use the existing Bash/AWS CLI/jq stack for container scripts; do not add Python.
For infrastructure changes, also run `mise exec -- npx cdk synth '*' --quiet`.
