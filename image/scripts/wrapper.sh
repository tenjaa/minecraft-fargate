#!/bin/sh
set -e

. scripts/init.sh

echo "Start server"
cd minecraft
# https://serverfault.com/questions/188936/writing-to-stdin-of-background-process
mkfifo /tmp/srv-input
tail -f /tmp/srv-input | java -jar forge-*.jar &
cd ..

# Disable auto-save for reliable backup
sleep 5m
echo "Disable auto-save"
echo "/save-off" > /tmp/srv-input &
sleep 10s

while true; do
  ./scripts/backup.sh
  players=$(curl -s "https://mcapi.xdefcon.com/server/${PUBLIC_IP}/players/json" | jq '.players')
  if [ "$players" = 0 ]; then
    break
  fi
  sleep 5m
done

./scripts/shutdown.sh
