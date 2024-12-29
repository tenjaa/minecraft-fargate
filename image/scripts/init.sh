#!/bin/bash
set -e

echo "Download backup"
if [[ $(aws s3 ls s3://"${BUCKET}"/backup.tar | wc -l) = 1 ]]; then
  echo "Backup found"
  aws s3 cp s3://"${BUCKET}"/backup.tar - --no-progress | tar -C minecraft -x
fi

echo "Download mods"
if [[ $(aws s3 ls s3://"${BUCKET}"/mods/server | wc -l) = 1 ]]; then
  echo "Server mods found"
  aws s3 cp s3://"${BUCKET}"/mods/server minecraft/mods --recursive --no-progress
fi

if [[ $(aws s3 ls s3://"${BUCKET}"/mods/client | wc -l) = 1 ]]; then
  echo "Client mods found"
  aws s3 cp s3://"${BUCKET}"/mods/client minecraft/mods --recursive --no-progress
fi

echo "Get IP"
publicIp=$(curl -s "https://checkip.amazonaws.com/")
echo "IPv4: $publicIp"

echo "Update IP"
curl -s "https://www.duckdns.org/update?domains=$DUCK_DNS_DOMAIN&token=$DUCK_DNS_TOKEN&ip=$publicIp"

export PUBLIC_IP=$publicIp
