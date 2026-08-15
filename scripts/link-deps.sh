#!/usr/bin/env bash
# 本地开发依赖链接：把 dsh 全局安装的 @deepseek-ai 包链接到仓库 node_modules。
# 原因：@deepseek-ai 的包不在公共 npm registry（内部发布），而 dsh 全局安装
# 里已有一份。发布 npm 包时这些仍是正式 dependencies/peerDependencies，
# 用户侧由 dsh 环境提供。
# 用法：bash scripts/link-deps.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DSH_PKGS="/Users/liyou/.nvm/versions/node/v26.2.0/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai"

mkdir -p "$ROOT/node_modules/@deepseek-ai"
for pkg in "$DSH_PKGS"/*; do
  name="$(basename "$pkg")"
  ln -sfn "$pkg" "$ROOT/node_modules/@deepseek-ai/$name"
done

# sharp（可选依赖，dsh 全局树里有）
SHARP="$(node -e "try { console.log(require.resolve('sharp', { paths: ['$DSH_PKGS/../..'] })) } catch {}")"
if [ -n "$SHARP" ]; then
  ln -sfn "$(dirname "$(dirname "$SHARP")")" "$ROOT/node_modules/sharp"
fi

# 顶层直连依赖（bare specifier 从包目录向上解析，node_modules/@deepseek-ai 即可，
# 无需顶层再放；sharp 需要顶层因为它是 optionalDependencies 的裸名）
echo "linked $(ls "$ROOT/node_modules/@deepseek-ai" | wc -l | tr -d ' ') packages"
