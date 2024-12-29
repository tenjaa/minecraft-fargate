#!/bin/bash
set -e

exit_script() {
    echo "FOUND SIGTERM!"
    echo "/stop" > /tmp/mc-stdin &
    tail --pid="$minecraftPid" -f /dev/null
    ./scripts/backup.sh
    exit 0
}

trap exit_script SIGTERM

. scripts/init.sh

echo "Start server"
cd minecraft
# https://serverfault.com/questions/188936/writing-to-stdin-of-background-process
mkfifo /tmp/mc-stdin
tail -f /tmp/mc-stdin | ./run.sh &
minecraftPid=$!
cd ..

# Wait for server to start
echo "Server starting! Waiting 10m for someone to join"
echo "/op ${OP_USERNAME}" > /tmp/mc-stdin &
sleep 10m & wait $!

players=1
minutes=1
while [[ "$players" != 0 ]]; do
  echo "Get players"
  players=$(curl -s "https://mcapi.xdefcon.com/server/${PUBLIC_IP}/players/json" | jq '.players')
  echo "Players: $players"
  if [ $((minutes % 60)) = 0 ]; then
    echo "Starting backup"
    ./scripts/backup-wrapper.sh
    echo "Backup done"
  fi
  sleep 1m & wait $!
  minutes=$((minutes+1))
done

echo "Starting shutdown"
./scripts/shutdown.sh

while true; do
  echo "Waiting for shutdown"
  sleep 1m & wait $!
done
