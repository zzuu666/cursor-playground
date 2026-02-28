#!/usr/bin/env bash
set -euo pipefail

pnpm --filter @mini-agent/cli dev --prompt "${1:-hello from phase0}"
