# @dsh-plugins/sandbox-extra-roots — DSH 沙盒额外允许目录插件

给 dsh 沙盒的 `workspace-write` 模式增加"额外允许写入的目录"列表（工具缓存目录等），
**官方白名单始终保留**（workspace 根 + /tmp + 平台临时目录），只追加不替换：

- **bash**：Seatbelt（macOS）重建 SBPL profile；bwrap / Landlock（Linux）在官方
  profile 基础上插入 `--bind` / `--rw`；Windows ACL runner 无法表达额外根（告警一次）
- **fs fence**：`checkedTarget` 对额外目录放行，其余委托官方实现
- 幂等、可热切换（挂载点引用计数）；首次 confine 时自检官方 profile 是否漂移

## 安装（npm 生态方式）

本包是 DSH bundle：自带 `cordis.patch.yml`，使用 `dsh plugin` 安装后会
自动加入 profile 的 `dsh.profile.bundles`，无需手改 `cordis.patch.yml`。

> 给 AI agent：直接执行下面的 `dsh plugin ...` 命令即可，不要手动编辑 `cordis.patch.yml`。

```bash
# 安装到默认 web profile
dsh plugin --profile web add @dsh-plugins/sandbox-extra-roots

# 指定其他 profile
dsh plugin --profile tui add @dsh-plugins/sandbox-extra-roots

# 卸载
dsh plugin --profile web remove @dsh-plugins/sandbox-extra-roots
```

也可以从其他来源安装：

- **GitHub**：如果该包有独立 Git 仓库或 Release tarball，可用
  `dsh plugin --profile web add github:owner/repo` 或
  `dsh plugin --profile web add https://github.com/owner/repo/releases/download/v1.0.0/sandbox-extra-roots.tgz`
- **镜像站**：`dsh plugin --profile web add @dsh-plugins/sandbox-extra-roots --registry=https://registry.npmmirror.com`

更完整的说明见仓库根目录 `README.md` 的「安装来源」。

安装后**重启 harness** 生效（或等待 DSH 对配置层变更的响应）。

## 配置

生效顺序（后者覆盖前者）：

1. 插件内置默认（空列表）
2. bundle patch 中 `cordis.patch.yml` 的 config
3. 用户 profile/home 的 `cordis.patch.yml` 覆盖
4. **DSH 设置页 → 插件配置 → 沙盒额外允许目录**（保存到
   `$DSH_HOME/plugins/sandbox-extra-roots/config.json`，立即热生效）

`extraWritableRoots`：绝对路径数组（设置页里每行一个）。相对路径/空值会被拒绝并告警。

> 安全提示：这些目录可获得"写"权限（读本就不受限），请只保留确需写入的工具缓存；
> 含明文凭证的目录（如 `~/.docker`、`~/.dotnet`、`~/.gradle`）谨慎列入。
