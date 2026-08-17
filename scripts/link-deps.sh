#!/usr/bin/env bash
# 本地开发依赖链接：只链接本仓库实际用到的 @deepseek-ai 内部包。
# 这些包不在公共 npm registry，测试/remote 网关需要从全局 DSH 安装里借用。
# 这不是运行时依赖方案；发布后由用户的 DSH 环境提供这些包。
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

# 仅链接仓库代码和测试实际 import 的包；不要盲目全量链接，避免版本污染。
REQUIRED_PKGS=(
  "dsh-typert-protocol"
  "dsh-sandbox"
  "node-addon-landlock-run"
  # adaptive-perf 真实 Minimal 工具对（bootstrap.realPair）：运行时动态
  # import 官方 minimal preset 同款插件，仓库开发/测试需要从全局安装借用。
  "dsh-terminal"
  "dsh-terminal-bash"
  "dsh-tool-bash-persistent"
  "dsh-fs-local"
  "dsh-tool-str-replace-editor"
)

mkdir -p "$ROOT/node_modules/@deepseek-ai"
# 清理旧的全量链接，避免升级/切换 DSH 后残留不相关包。
find "$ROOT/node_modules/@deepseek-ai" -maxdepth 1 -type l -delete 2>/dev/null || true
for name in "${REQUIRED_PKGS[@]}"; do
  if [ -e "$DSH_PKGS/$name" ]; then
    ln -sfn "$DSH_PKGS/$name" "$ROOT/node_modules/@deepseek-ai/$name"
  else
    echo "    提示：$DSH_PKGS/$name 不存在，跳过（非当前平台/功能需要）" >&2
  fi
done

# sharp（可选依赖；vision-router 包内已有本地副本时可不需要顶层链接）
SHARP="$(node -e "try { console.log(require.resolve('sharp', { paths: ['$DSH_PKGS/../..'] })) } catch {}")"
if [ -n "$SHARP" ]; then
  ln -sfn "$(dirname "$(dirname "$SHARP")")" "$ROOT/node_modules/sharp"
fi

echo "linked required @deepseek-ai packages under $ROOT/node_modules/@deepseek-ai"
