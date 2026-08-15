# @dsh-plugins/sandbox-extra-roots — DSH 沙盒额外允许目录插件

给 dsh 沙盒的 `workspace-write` 模式增加"额外允许写入的目录"列表（工具缓存目录等），
**官方白名单始终保留**（workspace 根 + /tmp + 平台临时目录），只追加不替换：

- **bash**：Seatbelt（macOS）重建 SBPL profile；bwrap / Landlock（Linux）在官方
  profile 基础上插入 `--bind` / `--rw`；Windows ACL runner 无法表达额外根（告警一次）
- **fs fence**：`checkedTarget` 对额外目录放行，其余委托官方实现
- 幂等、可热切换（挂载点引用计数）；首次 confine 时自检官方 profile 是否漂移

## 安装

```bash
bash packages/sandbox-extra-roots/install.sh              # file:// 模式
bash packages/sandbox-extra-roots/install.sh --npm        # npm 模式
bash packages/sandbox-extra-roots/install.sh --profile tui  # 指定 profile
```

卸载：`bash packages/sandbox-extra-roots/uninstall.sh [--profile <name>]`（会自动移除 patch 块、
file:// 插件本体和 npm/pnpm 安装的包）。

## 配置

三种方式（后者覆盖前者）：

1. 内置默认（空列表）
2. `cordis.patch.yml` 中 sandbox-extra-roots 行的 config（安装脚本生成**空列表 + 注释示例**，按需显式开启）
3. **DSH 设置页 → 插件配置 → 沙盒额外允许目录**（保存到
   `$DSH_HOME/plugins/sandbox-extra-roots/config.json`，立即热生效）

`extraWritableRoots`：绝对路径数组（设置页里每行一个）。相对路径/空值会被拒绝并告警。

> 安全提示：这些目录可获得"写"权限（读本就不受限），请只保留确需写入的工具缓存；
> 含明文凭证的目录（如 `~/.docker`、`~/.dotnet`、`~/.gradle`）谨慎列入。
