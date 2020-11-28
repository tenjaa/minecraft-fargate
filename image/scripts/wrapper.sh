#!/bin/bash
set -e

exit_script() {
    echo "FOUND SIGTERM!"
    echo "/stop" > /tmp/srv-input &
    tail --pid="$minecraftPid" -f /dev/null
    ./scripts/sync-s3.sh minecraft s3://"${BUCKET}"
    exit 0
}

trap exit_script SIGTERM

. scripts/init.sh

echo "Start server"
cd minecraft
# https://serverfault.com/questions/188936/writing-to-stdin-of-background-process
mkfifo /tmp/srv-input
tail -f /tmp/srv-input | java -jar forge-*.jar &
minecraftPid=$!
cd ..

# Wait for server to start
sleep 5m
echo "/save-on" > /tmp/srv-input &

while true; do
  for i in $(seq 1 10);
  do
    sleep 2m & wait $!
    players=$(curl -s "https://mcapi.xdefcon.com/server/${PUBLIC_IP}/players/json" | jq '.players')
    if [ "$players" = 0 ]; then
      break
    fi
  done
  ./scripts/backup.sh
  players=$(curl -s "https://mcapi.xdefcon.com/server/${PUBLIC_IP}/players/json" | jq '.players')
  if [ "$players" = 0 ]; then
    break
  fi
done

./scripts/shutdown.sh
