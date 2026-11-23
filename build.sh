#!/usr/bin/env bash
# Sestaví webovou část hry do www/
set -e
cd "$(dirname "$0")"
npx esbuild src/main.js --bundle --minify --format=iife --target=es2020 --outfile=www/game.js
mkdir -p www/wasm www/models
cp node_modules/@mediapipe/tasks-vision/wasm/vision_wasm_internal.* www/wasm/
