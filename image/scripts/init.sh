#!/bin/bash
set -e

echo "Download backup"
if [[ $(aws s3 ls s3://"${BUCKET}"/backup.tar | wc -l) = 1 ]]; then
  echo "Backup found"
  aws s3 cp s3://"${BUCKET}"/backup.tar - --no-progress | tar -C minecraft --anchored --exclude=whitelist.json --exclude=ops.json -x
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

echo "Enable private RCON and start with empty Minecraft player lists"
: "${RCON_PASSWORD:?Missing RCON_PASSWORD}"
touch minecraft/server.properties
chmod 600 minecraft/server.properties
sed -i -E '/^[[:space:]]*(white-list|enforce-whitelist|online-mode|server-ip|enable-rcon|rcon\.port|rcon\.password|broadcast-rcon-to-ops)[[:space:]]*[:=]/d' minecraft/server.properties
printf '%s\n' 'white-list=true' 'enforce-whitelist=true' 'online-mode=true' 'server-ip=' 'enable-rcon=true' 'rcon.port=25575' 'broadcast-rcon-to-ops=false' "rcon.password=$RCON_PASSWORD" >> minecraft/server.properties
unset RCON_PASSWORD

echo "Get IP"
publicIp=$(curl -s "https://checkip.amazonaws.com/")
echo "IPv4: $publicIp"

echo "Update IP"
curl -s "https://www.duckdns.org/update?domains=$DUCK_DNS_DOMAIN&token=$DUCK_DNS_TOKEN&ip=$publicIp"

export PUBLIC_IP=$publicIp
