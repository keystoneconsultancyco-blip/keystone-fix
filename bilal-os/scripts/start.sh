#!/bin/sh
# Entry point used by Docker/Railway. Set ROLE=worker on the worker service.
set -e
npm run migrate
if [ "$ROLE" = "worker" ]; then
  exec npm run worker
else
  exec npm start
fi
