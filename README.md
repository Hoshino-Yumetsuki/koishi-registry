# koishi-registry


## 如何使用
首先克隆仓库

```bash
git clone https://github.com/Hoshino-Yumetsuki/koishi-registry.git
cd koishi-registry
```

然后，您需要构建Docker镜像。在项目根目录下打开终端或命令提示符，然后运行以下命令：

```bash
docker build -t koishi-registry .
```

你可以自定义镜像名称。如果需要替换注意在docker-compose文件中也需要修改

### 使用Docker Compose启动容器
构建完镜像后，您可以使用Docker Compose启动容器。在项目根目录下运行以下命令：

```bash
docker-compose up -d
```
-d选项表示在后台运行容器。


## 功能特性

### 深度依赖安全分析
本项目实现了一套完整的依赖安全分析系统，用于静态分析插件的依赖树中是否存在不安全的包：

- **深度遍历**: 递归分析依赖树，检测直接和传递性依赖中的不安全包
- **智能缓存**: 使用缓存机制避免重复分析相同的包，提升性能
- **批量处理**: 分批处理依赖分析，避免API限流
- **自动更新**: 当插件版本更新时自动重新分析
- **状态追踪**: 在数据库中存储分析结果和时间戳

#### 不安全包检测
系统会检测以下类型的不安全依赖：
1. 在不安全包列表中的包（从配置的URL加载）
2. 硬编码的不安全依赖（如 sharp、puppeteer、canvas）
3. 传递性依赖中的不安全包（最多遍历3层）

#### 数据库存储
每个插件的分析结果包含：
- `analyzed`: 是否已分析
- `analyzedAt`: 分析时间戳
- `insecurePackages`: 发现的不安全包列表
- `hasError`: 分析过程是否出错

#### 触发条件
在以下情况下会触发安全分析：
- 插件首次添加到数据库
- 插件版本更新
- 插件缺少安全分析数据
- 执行全量更新

## 文件结构
Dockerfile: 包含构建Docker镜像的指令。
docker-compose.yml: 定义了服务、网络和卷等配置。
src/: 项目的源代码目录。
  - utils/dependency-analyzer.ts: 深度依赖分析模块
  - utils/insecure.ts: 不安全包管理模块
  - utils/fetcher.ts: 包详情获取和分析
  - utils/update.ts: 插件更新逻辑

## 注意事项
确保您已经安装了Docker和Docker Compose。
在构建和启动容器之前，请检查Dockerfile和docker-compose.yml文件以确保配置正确。
如果您需要修改项目的源代码，请在src/目录下进行更改，然后重新构建和启动容器以应用更改。

# 贡献
如果您有任何建议或想要贡献代码，请随时提交Pull Request或创建Issue。
