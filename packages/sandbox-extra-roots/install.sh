#!/usr/bin/env bash
# sandbox-extra-roots 安装脚本（@dsh-plugins/sandbox-extra-roots）
# 两种模式：
#   1) file:// 模式（默认）：复制插件到 ~/.dsh/plugins/sandbox-extra-roots/，
#      cordis.patch.yml 引用 file:// 路径——不依赖 npm。
#   2) npm 模式（--npm）：把包装入 ~/.dsh/profiles/web 的 node_modules，patch 引用包名。
# 用法：bash install.sh [--npm]
# 卸载：bash uninstall.sh
set -euo pipefail

NAME="sandbox-extra-roots"
PKG="@dsh-plugins/sandbox-extra-roots"
SRC="$(cd "$(dirname "$0")" && pwd)"
PLUGIN_DIR="$HOME/.dsh/plugins/$NAME"
PROFILE_DIR="$HOME/.dsh/profiles/web"
PATCH="$PROFILE_DIR/cordis.patch.yml"
MODE="all"
if [ $# -gt 0 ]; then MODE="$1"; fi

if [ "$MODE" = "--npm" ]; then
  echo "==> npm 模式：安装 $PKG 到 $PROFILE_DIR"
  if [ ! -d "$PROFILE_DIR" ]; then
    echo "    错误：找不到 profile 目录 $PROFILE_DIR" >&2
    exit 1
  fi
  if [ -f "$PATCH" ]; then
    bash "$SRC/uninstall.sh" > /dev/null 2>&1 || true
  fi
  (cd "$PROFILE_DIR" && npm install "$SRC" --no-save --no-package-lock > /dev/null 2>&1 || pnpm add "$SRC" > /dev/null 2>&1) \
    || { echo "    错误：npm/pnpm 安装失败（请确认 profile 的包管理器可用）" >&2; exit 1; }
  BLOCK=$(cat << 'PATCH_EOF'

# ── sandbox-extra-roots（沙盒额外允许目录，host 层全局，npm 安装）──────────
# workspace-write 模式下，除了官方白名单（会话工作区根 + /tmp + 平台临时目录），
# 额外允许写入下面的工具缓存目录（bash 走 Seatbelt/bwrap/Landlock 白名单，
# 文件工具走 fs fence；Windows ACL runner 仅 fs fence 生效）。
# 注意：web profile 的 HMR 被官方禁用，改本文件后需重启 dsh web 生效。
# 安全提示：这些目录可获得"写"权限（读本就不受限），请只保留确需写入的
# 工具缓存；含明文凭证的目录（如 ~/.docker、~/.dotnet、~/.gradle）谨慎列入。
# 卸载：删除下面这个 insert 块（或运行 uninstall.sh）。
- insert:
    - id: sandbox-extra-roots
      name: @dsh-plugins/sandbox-extra-roots
      config:
        extraWritableRoots:
          # Python：uv / pip
          - $HOME/.cache/uv
          - $HOME/Library/Caches/pip
          # Node 生态：pnpm / npm / bun / typescript / node-gyp
          - $HOME/Library/Caches/pnpm
          - $HOME/.npm
          - $HOME/.bun
          - $HOME/.cache/bun
          - $HOME/Library/Caches/bun
          - $HOME/Library/Caches/typescript
          - $HOME/Library/Caches/node-gyp
          # Go：module / build / gopls / goimports
          - $HOME/go
          - $HOME/Library/Caches/go-build
          - $HOME/Library/Caches/gopls
          - $HOME/Library/Caches/goimports
          # Android / Gradle：~/.gradle、Android SDK、AVD
          - $HOME/.gradle
          - $HOME/Library/Android/sdk
          - $HOME/.android
          # HarmonyOS：ohpm / hvigor / DevEco 缓存 / ArkUI-X SDK
          - $HOME/.ohpm
          - $HOME/.hvigor
          - $HOME/Library/Caches/Huawei
          - $HOME/Library/ArkUI-X
          # Godot C#：NuGet 包缓存、.NET、Godot 编辑器缓存
          - $HOME/.nuget
          - $HOME/.dotnet
          - $HOME/Library/Application Support/Godot
          - $HOME/Library/Caches/Godot
          # Docker CLI 配置
          - $HOME/.docker
PATCH_EOF
)
else
  if [ "$MODE" != "all" ]; then
    echo "用法: bash install.sh [--npm]" >&2
    exit 1
  fi
  echo "==> file:// 模式：插件本体到 $PLUGIN_DIR/"
  mkdir -p "$PLUGIN_DIR"
  cp -f "$SRC/lib/index.mjs" "$PLUGIN_DIR/index.mjs"
  cp -f "$SRC/lib/common.mjs" "$PLUGIN_DIR/common.mjs"
  cp -f "$SRC/lib/config-store.mjs" "$PLUGIN_DIR/config-store.mjs"
  cp -f "$SRC/lib/remote.mjs" "$PLUGIN_DIR/remote.mjs"
  BLOCK=$(cat << 'PATCH_EOF'

# ── sandbox-extra-roots（沙盒额外允许目录，host 层全局）────────────────────
# workspace-write 模式下，除了官方白名单（会话工作区根 + /tmp + 平台临时目录），
# 额外允许写入下面的工具缓存目录（bash 走 Seatbelt/bwrap/Landlock 白名单，
# 文件工具走 fs fence；Windows ACL runner 仅 fs fence 生效）。
# 注意：web profile 的 HMR 被官方禁用，改本文件后需重启 dsh web 生效。
# 安全提示：这些目录可获得"写"权限（读本就不受限），请只保留确需写入的
# 工具缓存；含明文凭证的目录（如 ~/.docker、~/.dotnet、~/.gradle）谨慎列入。
# 卸载：删除下面这个 insert 块（或运行本目录下的 uninstall.sh）。
- insert:
    - id: sandbox-extra-roots
      name: file://$HOME/.dsh/plugins/sandbox-extra-roots/index.mjs
      config:
        extraWritableRoots:
          # Python：uv / pip
          - $HOME/.cache/uv
          - $HOME/Library/Caches/pip
          # Node 生态：pnpm / npm / bun / typescript / node-gyp
          - $HOME/Library/Caches/pnpm
          - $HOME/.npm
          - $HOME/.bun
          - $HOME/.cache/bun
          - $HOME/Library/Caches/bun
          - $HOME/Library/Caches/typescript
          - $HOME/Library/Caches/node-gyp
          # Go：module / build / gopls / goimports
          - $HOME/go
          - $HOME/Library/Caches/go-build
          - $HOME/Library/Caches/gopls
          - $HOME/Library/Caches/goimports
          # Android / Gradle：~/.gradle、Android SDK、AVD
          - $HOME/.gradle
          - $HOME/Library/Android/sdk
          - $HOME/.android
          # HarmonyOS：ohpm / hvigor / DevEco 缓存 / ArkUI-X SDK
          - $HOME/.ohpm
          - $HOME/.hvigor
          - $HOME/Library/Caches/Huawei
          - $HOME/Library/ArkUI-X
          # Godot C#：NuGet 包缓存、.NET、Godot 编辑器缓存
          - $HOME/.nuget
          - $HOME/.dotnet
          - $HOME/Library/Application Support/Godot
          - $HOME/Library/Caches/Godot
          # Docker CLI 配置
          - $HOME/.docker
PATCH_EOF
)
fi

echo "==> 向 $PATCH 追加插件行"
if [ -f "$PATCH" ]; then
  cp "$PATCH" "$PATCH.bak-$NAME"
fi
if grep -q "$NAME" "$PATCH" 2>/dev/null; then
  echo "    已存在 $NAME 行，跳过"
else
  local_tmp="$(mktemp)"
  printf '%s\n' "$BLOCK" > "$local_tmp"
  sed -i '' "s|\$HOME|$HOME|g" "$local_tmp" 2>/dev/null || sed -i "s|\$HOME|$HOME|g" "$local_tmp"
  cat "$local_tmp" >> "$PATCH"
  rm -f "$local_tmp"
  echo "    已追加"
fi

if [ "$MODE" = "--npm" ]; then
  echo
  echo "✅ $NAME 安装完成（npm 模式）。重启 harness 后生效。"
  echo "   卸载：bash $SRC/uninstall.sh（node_modules 里的包用 npm/pnpm remove 移除）"
else
  echo
  echo "✅ $NAME 安装完成（file:// 模式）。重启 harness 后生效。"
  echo "   卸载：bash $SRC/uninstall.sh"
fi
