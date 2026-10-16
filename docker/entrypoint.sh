#!/bin/sh
set -e

cd /root/Yunzai

# Ensure pnpm dependencies are installed
if [ ! -f "node_modules/.pnpm/lock.yaml" ]; then
    echo "Installing pnpm dependencies..."
    pnpm install --force
fi

echo "Starting TRSS-Yunzai..."
exec node . start
