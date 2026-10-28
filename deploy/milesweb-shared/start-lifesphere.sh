#!/usr/bin/env bash
# LifeSphere on MilesWeb shared hosting — single-Node.js-app-slot layout.
#
# This hosting plan only allows ONE Node.js application slot per site. Both the API and the
# website need to run at the same time, so this script keeps the API alive internally on
# port 4000 (self-healing: restarts it if it ever exits) and runs the website in the
# foreground on port 3000 — that's the process the panel actually supervises/restarts.
# The website's own /api/v1/* route (src/app/api/v1/[...path]/route.ts) forwards browser
# calls to the internal API via API_URL (defaults to http://localhost:4000), so the API
# itself never needs to be publicly exposed.
#
# Panel setup (Node.js → app → Edit):
#   Startup command:    bash /absolute/path/to/start-lifesphere.sh   (the panel does NOT
#                        expand $HOME in that field — use the real absolute path)
#   Working directory:  .
#   Port:               3000
#   Proxy Path:         (leave blank — proxies the whole site)
#
# ~/api/.env must have PORT=4000 (not 3000) since the website now owns port 3000.
set -u

cd "$HOME/api"
nohup bash -c 'while true; do node --env-file-if-exists=.env dist/main.js; sleep 2; done' >> "$HOME/api/runtime.log" 2>&1 &
disown

cd "$HOME/web"
exec env PORT=3000 node server.js
