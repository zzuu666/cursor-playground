#!/usr/bin/env bash
# Phase 1 验收：成功路径（mock）与失败路径（缺少 key）
set -euo pipefail

CLI_DIR="${1:-$(dirname "$0")/../packages/cli}"
cd "$CLI_DIR"

echo "=== Phase 1 verification ==="

echo "1. Mock provider single turn..."
out=$(pnpm exec tsx src/index.ts --provider mock --prompt "hello" 2>&1)
echo "$out" | grep -q "Phase 0 provider is running" || (echo "Mock output not found"; exit 1)
echo "$out" | grep -q "turns=1" || (echo "turns=1 not found"; exit 1)
echo "$out" | grep -q "transcript=" || (echo "transcript path not found"; exit 1)
echo "   OK"

echo "2. Missing MINIMAX_API_KEY (minimax provider)..."
unset MINIMAX_API_KEY
err=$(pnpm exec tsx src/index.ts --provider minimax --prompt "hi" 2>&1) || true
echo "$err" | grep -qi "MINIMAX_API_KEY" || (echo "Expected key error message"; exit 1)
echo "$err" | grep -q "mini-agent failed" || true
echo "   OK"

echo "=== Phase 1 verification passed ==="
