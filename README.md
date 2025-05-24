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


## 文件结构
Dockerfile: 包含构建Docker镜像的指令。
docker-compose.yml: 定义了服务、网络和卷等配置。
src/: 项目的源代码目录。

## 注意事项
确保您已经安装了Docker和Docker Compose。
在构建和启动容器之前，请检查Dockerfile和docker-compose.yml文件以确保配置正确。
如果您需要修改项目的源代码，请在src/目录下进行更改，然后重新构建和启动容器以应用更改。

# 贡献
如果您有任何建议或想要贡献代码，请随时提交Pull Request或创建Issue。
