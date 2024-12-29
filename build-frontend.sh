#!/usr/bin/env bash

npm ci
npx esbuild www/main.ts --bundle --outfile=www/main.js
