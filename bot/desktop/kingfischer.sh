#!/usr/bin/env sh
# Launcher for chess GUIs that need one executable file: point the GUI's "add engine" at this script.
exec node "$(dirname "$0")/kingfischer.js" "$@"
