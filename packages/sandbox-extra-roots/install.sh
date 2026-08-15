#!/usr/bin/env bash
# sandbox-extra-roots 安装脚本（@dsh-plugins/sandbox-extra-roots）
# 两种模式：
#   1) file:// 模式（默认）：复制插件到 ~/.dsh/plugins/sandbox-extra-roots/，
#      cordis.patch.yml 引用 file:// 路径——不依赖 npm。
#   2) npm 模式（--npm）：把包装入 ~/.dsh/profiles/web 的 node_modules，patch 引用包名。
# 用法：bash install.sh [--npm] [--profile <name>]
# 卸载：bash uninstall.sh [--profile <name>]
set -euo pipefail

NAME="sandbox-extra-roots"
PKG="@dsh-plugins/sandbox-extra-roots"
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
  echo "==> npm 模式：安装 $PKG 到 $PROFILE_DIR"
  if [ ! -d "$PROFILE_DIR" ]; then
    echo "    错误：找不到 profile 目录 $PROFILE_DIR" >&2
    exit 1
  fi
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

# ── sandbox-extra-roots（沙盒额外允许目录，host 层全局，npm 安装）──────────
# workspace-write 模式下，除了官方白名单（会话工作区根 + /tmp + 平台临时目录），
# 可以按需追加额外可写目录（bash 走 Seatbelt/bwrap/Landlock 白名单，
# 文件工具走 fs fence；Windows ACL runner 仅 fs fence 生效）。默认不开放。
# 注意：profile 的 HMR 被官方禁用，改本文件后需重启 dsh 生效。
# 安全提示：这些目录可获得"写"权限（读本就不受限），请只保留确需写入的
# 工具缓存；含明文凭证的目录（如 ~/.docker、~/.dotnet、~/.gradle）谨慎列入。
# 卸载：删除下面这个 insert 块（或运行 uninstall.sh）。
- insert:
    - id: sandbox-extra-roots
      name: @dsh-plugins/sandbox-extra-roots
      config:
        # 安全默认：不授予任何额外写目录，按需显式打开。
        extraWritableRoots: []
        # 常用工具缓存示例（绝对路径，每行一个）。确认需要后再启用：
        # 删除下面各行的 “# ” 注释，并删除上一行的 “extraWritableRoots: []”。
        # extraWritableRoots:
        #   - $HOME/.cache/uv
        #   - $HOME/Library/Caches/pip
        #   - $HOME/Library/Caches/pnpm
        #   - $HOME/.npm
        #   - $HOME/.bun
        #   - $HOME/.cache/bun
        #   - $HOME/Library/Caches/typescript
        #   - $HOME/Library/Caches/node-gyp
        #   - $HOME/go
        #   - $HOME/Library/Caches/go-build
        #   - $HOME/.gradle
        #   - $HOME/Library/Android/sdk
        #   - $HOME/.android
        #   - $HOME/.ohpm
        #   - $HOME/.hvigor
        #   - $HOME/.nuget
        # 不建议默认开放含凭证的目录（~/.docker、~/.dotnet、~/.gradle、~/.android）。
PATCH_EOF
)
else
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
  BLOCK=$(cat << 'PATCH_EOF'

# ── sandbox-extra-roots（沙盒额外允许目录，host 层全局）────────────────────
# workspace-write 模式下，除了官方白名单（会话工作区根 + /tmp + 平台临时目录），
# 可以按需追加额外可写目录（bash 走 Seatbelt/bwrap/Landlock 白名单，
# 文件工具走 fs fence；Windows ACL runner 仅 fs fence 生效）。默认不开放。
# 注意：profile 的 HMR 被官方禁用，改本文件后需重启 dsh 生效。
# 安全提示：这些目录可获得"写"权限（读本就不受限），请只保留确需写入的
# 工具缓存；含明文凭证的目录（如 ~/.docker、~/.dotnet、~/.gradle）谨慎列入。
# 卸载：删除下面这个 insert 块（或运行本目录下的 uninstall.sh）。
- insert:
    - id: sandbox-extra-roots
      name: file://$DSH_ROOT/plugins/sandbox-extra-roots/index.mjs
      config:
        # 安全默认：不授予任何额外写目录，按需显式打开。
        extraWritableRoots: []
        # 常用工具缓存示例（绝对路径，每行一个）。确认需要后再启用：
        # 删除下面各行的 “# ” 注释，并删除上一行的 “extraWritableRoots: []”。
        # extraWritableRoots:
        #   - $HOME/.cache/uv
        #   - $HOME/Library/Caches/pip
        #   - $HOME/Library/Caches/pnpm
        #   - $HOME/.npm
        #   - $HOME/.bun
        #   - $HOME/.cache/bun
        #   - $HOME/Library/Caches/typescript
        #   - $HOME/Library/Caches/node-gyp
        #   - $HOME/go
        #   - $HOME/Library/Caches/go-build
        #   - $HOME/.gradle
        #   - $HOME/Library/Android/sdk
        #   - $HOME/.android
        #   - $HOME/.ohpm
        #   - $HOME/.hvigor
        #   - $HOME/.nuget
        # 不建议默认开放含凭证的目录（~/.docker、~/.dotnet、~/.gradle、~/.android）。
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
