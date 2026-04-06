#!/bin/bash

# Find processes using ports 3000-3999
processes=$(lsof -i -P -n | grep LISTEN | grep -E ':(3[0-9]{3})($| )')

if [ -z "$processes" ]; then
  echo "No processes found using ports 3000-3999."
  exit 0
fi

# Display what we found
echo "Found these processes using ports 3000-3999:"
echo "$processes" | awk '{printf "PID: %s, User: %s, Port: %s\n", $2, $3, $9}' | sed 's/.*://'

# Ask for confirmation
read -p "Kill these processes? (y/n): " confirm
if [[ "$confirm" != [yY]* ]]; then
  echo "Operation cancelled."
  exit 0
fi

# Kill the processes
for pid in $(echo "$processes" | awk '{print $2}'); do
  port=$(lsof -a -p $pid -i -P -n | grep LISTEN | awk '{print $9}' | cut -d: -f2)
  echo "Killing process $pid using port $port"
  kill -9 $pid
done

echo "Done. All specified processes have been terminated."