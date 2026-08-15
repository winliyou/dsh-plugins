#!/usr/bin/env bash
# vision-router 安装脚本（@dsh-plugins/vision-router）
# 两种模式：
#   1) file:// 模式（默认）：复制插件到 ~/.dsh/plugins/vision-router/，
#      cordis.patch.yml 引用 file:// 路径——不依赖 npm。
#   2) npm 模式（--npm）：把包装入 ~/.dsh/profiles/web 的 node_modules
#      （当前目录做 file: 安装），patch 引用包名。
# 用法：bash install.sh [--npm] [--profile <name>]
# 卸载：bash uninstall.sh [--profile <name>]
# 注意：两种模式切换时先卸载旧模式；改完需重启 harness 生效。
set -euo pipefail

NAME="vision-router"
PKG="@dsh-plugins/vision-router"
SRC="$(cd "$(dirname "$0")" && pwd)"
DSH_ROOT="${DSH_HOME:-$HOME/.dsh}"
MODE="all"
PROFILE="web"
while [ $# -gt 0 ]; do
  case "$1" in
    --npm) MODE="--npm" ;;
    --profile)
      shift
      if [ $# -eq 0 ]; then echo "用法: bash install.sh [--npm] [--profile <name>]" >&2; exit 1; fi
      PROFILE="$1"
      ;;
    --profile=*) PROFILE="${1#--profile=}" ;;
    *) echo "用法: bash install.sh [--npm] [--profile <name>]" >&2; exit 1 ;;
  esac
  shift
done
case "$PROFILE" in
  ""|*/*|*\\*) echo "    错误：非法的 profile 名称 $PROFILE" >&2; exit 1 ;;
esac
PROFILE_DIR="$DSH_ROOT/profiles/$PROFILE"
PLUGIN_DIR="$DSH_ROOT/plugins/$NAME"
PATCH="$PROFILE_DIR/cordis.patch.yml"
MARKER="# ── $NAME"

if [ "$MODE" = "--npm" ]; then
  # ── npm 模式 ──────────────────────────────────────────────────────
  echo "==> npm 模式：安装 $PKG 到 $PROFILE_DIR"
  if [ ! -d "$PROFILE_DIR" ]; then
    echo "    错误：找不到 profile 目录 $PROFILE_DIR" >&2
    exit 1
  fi
  # 先移除旧模式块（file:// 或上次 npm 块）
  if [ -f "$PATCH" ]; then
    bash "$SRC/uninstall.sh" --profile "$PROFILE" > /dev/null 2>&1 || true
  fi
  # 按 profile 的锁文件选择包管理器，避免 npm/pnpm 混用导致 package.json 被意外改写。
  if [ -f "$PROFILE_DIR/pnpm-lock.yaml" ]; then
    (cd "$PROFILE_DIR" && pnpm add "$SRC" --ignore-workspace-root-check > /dev/null 2>&1) \
      || { echo "    错误：pnpm 安装失败（请确认 profile 的包管理器可用）" >&2; exit 1; }
  else
    (cd "$PROFILE_DIR" && npm install "$SRC" --no-save --no-package-lock > /dev/null 2>&1) \
      || { echo "    错误：npm 安装失败（请确认 profile 的包管理器可用）" >&2; exit 1; }
  fi
  BLOCK=$(cat << 'PATCH_EOF'

# ── vision-router（识图自动降级，host 层全局插件，npm 安装）───────────────
# 对所有 preset 的会话生效：模型不支持图片时自动调用视觉模型转述。
# 卸载：删除下面这个 insert 块（或运行 uninstall.sh）。
- insert:
    - id: vision-router
      name: @dsh-plugins/vision-router
      config:
        visionProvider: zai-open
        visionModel: glm-4v-flash
        autoDiscover: true
        maxVisionTokens: 2048
PATCH_EOF
)
else
  # ── file:// 模式（默认）────────────────────────────────────────────
  if [ "$MODE" != "all" ]; then
    echo "用法: bash install.sh [--npm] [--profile <name>]" >&2
    exit 1
  fi
  echo "==> file:// 模式：插件本体到 $PLUGIN_DIR/"
  # 模式切换/重装时先移除旧块（file:// 与 npm 块都按 MARKER 移除）
  if [ -f "$PATCH" ]; then
    bash "$SRC/uninstall.sh" --profile "$PROFILE" > /dev/null 2>&1 || true
  fi
  mkdir -p "$PROFILE_DIR" "$PLUGIN_DIR"
  cp -R "$SRC/lib/." "$PLUGIN_DIR/"
  mv -f "$PLUGIN_DIR/index.mjs" "$PLUGIN_DIR/vision-router.mjs"
  BLOCK=$(cat << 'PATCH_EOF'

# ── vision-router（识图自动降级，host 层全局插件）───────────────────────────
# 对所有 preset 的会话生效：模型不支持图片时自动调用视觉模型转述。
# 卸载：删除下面这个 insert 块（或运行本目录下的 uninstall.sh）。
- insert:
    - id: vision-router
      name: file://$DSH_ROOT/plugins/vision-router/vision-router.mjs
      config:
        visionProvider: zai-open
        visionModel: glm-4v-flash
        autoDiscover: true
        maxVisionTokens: 2048
PATCH_EOF
)
fi

echo "==> 向 $PATCH 追加插件行"
if [ -f "$PATCH" ]; then
  cp "$PATCH" "$PATCH.bak-$NAME"
fi
if grep -qF "$MARKER" "$PATCH" 2>/dev/null; then
  echo "    已存在 $MARKER 块，跳过"
else
  local_tmp="$(mktemp)"
  printf '%s\n' "$BLOCK" > "$local_tmp"
  sed -i '' -e "s|\$HOME|$HOME|g" -e "s|\$DSH_ROOT|$DSH_ROOT|g" "$local_tmp" 2>/dev/null || sed -i -e "s|\$HOME|$HOME|g" -e "s|\$DSH_ROOT|$DSH_ROOT|g" "$local_tmp"
  cat "$local_tmp" >> "$PATCH"
  rm -f "$local_tmp"
  echo "    已追加"
fi

if [ "$MODE" = "--npm" ]; then
  echo
  echo "✅ $NAME 安装完成（npm 模式，profile=${PROFILE}）。重启 harness 后生效。"
  echo "   卸载：bash $SRC/uninstall.sh --profile $PROFILE"
else
  echo
  echo "✅ $NAME 安装完成（file:// 模式，profile=${PROFILE}）。重启 harness 后生效。"
  echo "   卸载：bash $SRC/uninstall.sh --profile $PROFILE"
fi
