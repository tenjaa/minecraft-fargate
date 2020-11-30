#!/bin/bash
set -e

scriptsDir=$(dirname "$0")
export SCRIPTS_DIR=$scriptsDir
mainDir=$(dirname "$SCRIPTS_DIR")
export MAIN_DIR=$mainDir

source "$SCRIPTS_DIR"/init.sh

echo "Start server"
# https://serverfault.com/questions/188936/writing-to-stdin-of-background-process
mkfifo /tmp/srv-input
tail -f /tmp/srv-input | java -jar "$MAIN_DIR"/forge-"$FORGE_VERSION".jar &
minecraftPid=$!
echo $minecraftPid

## Wait for server to start
#sleep 5m
#echo "/save-on" > /tmp/srv-input &
#
#while true; do
#  for i in $(seq 1 10);
#  do
#    sleep 2m & wait $!
#    players=$(curl -s "https://mcapi.xdefcon.com/server/${PUBLIC_IP}/players/json" | jq '.players')
#    if [ "$players" = 0 ]; then
#      break
#    fi
#  done
#  ./scripts/backup.sh
#  players=$(curl -s "https://mcapi.xdefcon.com/server/${PUBLIC_IP}/players/json" | jq '.players')
#  if [ "$players" = 0 ]; then
#    break
#  fi
#done
#
#./scripts/shutdown.sh
