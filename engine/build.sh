#!/bin/sh
# Builds the Floyd-Warshall C engine into ../public/floyd.wasm
#
# Needs one of:
#   zig      (https://ziglang.org, or: pip install ziglang)
#   clang + wasm-ld (LLVM with the WebAssembly target and lld)
set -e
cd "$(dirname "$0")"
OUT=../public/floyd.wasm
FLAGS="-O2 -nostdlib -fno-builtin -Wall -Wextra -std=c99"

if command -v zig >/dev/null 2>&1; then
    zig cc --target=wasm32-freestanding $FLAGS -Wl,--no-entry -o "$OUT" floyd_core.c
elif python3 -m ziglang version >/dev/null 2>&1; then
    python3 -m ziglang cc --target=wasm32-freestanding $FLAGS -Wl,--no-entry -o "$OUT" floyd_core.c
else
    clang --target=wasm32 $FLAGS -Wl,--no-entry -o "$OUT" floyd_core.c
fi
echo "Built $OUT ($(wc -c < "$OUT" | tr -d ' ') bytes)"
