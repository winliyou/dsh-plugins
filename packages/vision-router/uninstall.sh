#!/usr/bin/env bash
# vision-router 卸载脚本（@dsh-plugins/vision-router）
# 用法：bash uninstall.sh [--profile <name>]
# 1) 从 cordis.patch.yml 删除本插件的 insert 块（逐行扫描，不误伤相邻块）
# 2) 删除 file:// 模式部署的插件本体（~/.dsh/plugins/vision-router/*.mjs）
# 3) 若 profile node_modules 中存在 npm/pnpm 安装的包，自动移除。
set -euo pipefail

NAME="vision-router"
PKG="@dsh-plugins/vision-router"
MARKER="# ── vision-router"
PROFILE="web"
while [ $# -gt 0 ]; do
  case "$1" in
    --profile)
      shift
      if [ $# -eq 0 ]; then echo "用法: bash uninstall.sh [--profile <name>]" >&2; exit 1; fi
      PROFILE="$1"
      ;;
    --profile=*) PROFILE="${1#--profile=}" ;;
    *) echo "用法: bash uninstall.sh [--profile <name>]" >&2; exit 1 ;;
  esac
  shift
done
DSH_ROOT="${DSH_HOME:-$HOME/.dsh}"
PROFILE_DIR="$DSH_ROOT/profiles/$PROFILE"
PLUGIN_DIR="$DSH_ROOT/plugins/$NAME"
PATCH="$PROFILE_DIR/cordis.patch.yml"

echo "==> 从 $PATCH 删除 $NAME 插件行"
if [ ! -f "$PATCH" ]; then
  echo "    $PATCH 不存在，跳过"
else
  node - "$PATCH" "$MARKER" << 'NODE_EOF'
const fs = require("fs");
const NL = String.fromCharCode(10);
const SP_CODE = 32;
const TAB_CODE = 9;
const [patch, marker] = process.argv.slice(2);
const lines = fs.readFileSync(patch, "utf8").split(NL);
const out = [];
let inBlock = false;
let afterInsert = false;
let removed = false;
for (const line of lines) {
  if (!inBlock && line.startsWith(marker)) {
    inBlock = true;
    removed = true;
    continue;
  }
  if (inBlock) {
    if (afterInsert) {
      if (line.trim().length === 0) {
        inBlock = false;
        continue;
      }
      if (line.charCodeAt(0) === SP_CODE || line.charCodeAt(0) === TAB_CODE) continue;
      inBlock = false;
      out.push(line);
      continue;
    }
    if (line.startsWith("#") || line.trim().length === 0) continue;
    if (line.startsWith("- ")) {
      afterInsert = true;
      continue;
    }
    inBlock = false;
    out.push(line);
    continue;
  }
  out.push(line);
}
if (removed) {
  fs.writeFileSync(patch, out.join(NL));
  console.log("    已删除插件行");
} else {
  console.log("    未找到插件行（可能已删除）");
}
NODE_EOF
fi

echo "==> 删除 file:// 部署的插件本体 $PLUGIN_DIR/*.mjs"
rm -f "$PLUGIN_DIR"/*.mjs
rm -f "$PATCH.bak-$NAME"

echo "==> 移除 profile node_modules 中的 ${PKG}（如有）"
if [ -d "$PROFILE_DIR" ]; then
  PKG_DIR="$PROFILE_DIR/node_modules/$PKG"
  if [ -e "$PKG_DIR" ] || [ -L "$PKG_DIR" ]; then
    if [ -f "$PROFILE_DIR/pnpm-lock.yaml" ]; then
      (cd "$PROFILE_DIR" && pnpm remove "$PKG" --ignore-workspace-root-check > /dev/null 2>&1) \
        || echo "    警告：pnpm remove 失败，请手动删除 $PKG_DIR" >&2
    else
      (cd "$PROFILE_DIR" && npm uninstall "$PKG" --no-save --no-package-lock > /dev/null 2>&1) \
        || echo "    警告：npm uninstall 失败，请手动删除 $PKG_DIR" >&2
    fi
  else
    echo "    $PKG_DIR 不存在，跳过"
  fi
fi

echo
echo "✅ $NAME 已卸载。重启 harness 后生效。"
echo "   如需重新安装：bash $PWD/install.sh [--npm] [--profile $PROFILE]"
