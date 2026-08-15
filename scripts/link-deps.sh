#!/usr/bin/env bash
# 本地开发依赖链接：把 dsh 全局安装的 @deepseek-ai 包链接到仓库 node_modules。
# 原因：@deepseek-ai 的包不在公共 npm registry（内部发布），而 dsh 全局安装
# 里已有一份。发布 npm 包时这些仍是正式 dependencies/peerDependencies，
# 用户侧由 dsh 环境提供。
# 用法：bash scripts/link-deps.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# 可用环境变量 DSH_PKGS 覆盖；默认从当前 npm 全局根推导，避免硬编码用户/Node 版本。
if [ -n "${DSH_PKGS:-}" ]; then
  DSH_PKGS="$(cd "$DSH_PKGS" && pwd)"
else
  DSH_PKGS="$(npm root -g 2> /dev/null || true)/@deepseek-ai/dsh/node_modules/@deepseek-ai"
fi
if [ ! -d "$DSH_PKGS" ]; then
  echo "    错误：找不到 DSH 包目录 $DSH_PKGS（可设置 DSH_PKGS 覆盖）" >&2
  exit 1
fi

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
