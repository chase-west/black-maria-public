#!/bin/sh
# usage: mkpkg.sh <dir> <name> [deps-json]
dir=$1; name=$2
mkdir -p $dir/src $dir/test
cat > $dir/tsconfig.json <<JSON
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "noEmit": true },
  "include": ["src", "test"]
}
JSON
cat > $dir/tsconfig.build.json <<JSON
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src", "customConditions": [], "noEmit": false },
  "include": ["src"]
}
JSON
