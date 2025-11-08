# 依赖安全分析系统文档

## 概述

本系统实现了一套完整的插件依赖安全分析机制，用于自动检测和标记包含不安全依赖的Koishi插件。系统使用 yarn 在隔离的临时环境中实际安装包，然后分析完整的已安装依赖树。

## 功能特性

### 1. 隔离安装分析

系统通过实际安装包来进行分析：

- **隔离环境**: 在临时目录中创建独立的安装环境
- **真实依赖树**: 使用 yarn 安装获得实际的依赖解析结果
- **完整覆盖**: 分析所有传递性依赖，无深度限制
- **安全安装**: 使用 `--production` 和 `--ignore-scripts` 参数确保安全

### 2. 不安全包检测

系统通过多种方式识别不安全的包：

#### 2.1 静态不安全包列表
从配置的URL加载不安全包列表（`INSECURE_PACKAGES_URL`），定期更新。

#### 2.2 硬编码不安全依赖
以下包被认为是不安全的：
- `sharp` - 原生依赖，可能导致部署问题
- `puppeteer` - 包含Chromium，体积大且可能有安全风险
- `canvas` - 原生依赖，跨平台兼容性问题

#### 2.3 完整依赖树检测
分析 node_modules 中所有已安装的包，包括嵌套的 node_modules，确保所有传递性依赖都被检查。

### 3. 智能缓存机制

为提升性能，系统实现了分析结果缓存：

```typescript
// 缓存键: packageName@version
// 缓存值: AnalysisResult
analysisCache: Map<string, AnalysisResult>
```

缓存特性：
- 以 `包名@版本` 为键，确保版本特定的缓存
- 内存缓存，进程重启后清空
- 可手动清空：`clearAnalysisCache()`

### 4. 自动清理

系统会自动清理临时安装目录：

- **临时目录**: 使用系统临时目录创建隔离环境
- **自动清理**: 分析完成后自动删除临时目录
- **错误处理**: 即使清理失败也不影响分析结果

### 5. 数据库存储

分析结果存储在每个插件的文档中：

```typescript
securityAnalysis: {
  analyzed: boolean,          // 是否已分析
  analyzedAt: string | null,  // 分析时间（ISO 8601格式）
  insecurePackages: string[], // 发现的不安全包列表
  hasError: boolean           // 分析过程是否出错
}
```

## 工作流程

### 1. 插件扫描阶段

```
开始扫描
    ↓
获取NPM搜索结果
    ↓
筛选需要更新的包
    ├─ 新增的包
    ├─ 版本更新的包
    └─ 缺少安全分析的包
    ↓
并行获取包详情
```

### 2. 安全分析阶段

```
fetchPackageDetails
    ↓
检查浅层依赖（快速检查）
    ↓
调用 analyzePackageDependencies
    ├─ 检查缓存
    ├─ 创建临时隔离目录
    ├─ 使用 yarn 安装包
    ├─ 遍历 node_modules 获取所有已安装包
    └─ 检查每个包是否在不安全列表中
    ↓
清理临时目录
    ↓
生成分析结果
    ↓
存储到数据库
```

### 3. 更新触发条件

以下情况会触发安全分析：

1. **全量更新模式**: 所有包都会被重新分析
2. **新增包**: 首次添加到数据库的包
3. **版本更新**: 包版本号大于数据库中的版本
4. **缺失分析**: 数据库中的包没有 `securityAnalysis` 数据或 `analyzed` 为 false

## API 接口

### analyzePackageDependencies

分析指定包的依赖安全性，使用 yarn 在隔离环境中实际安装包。

```typescript
async function analyzePackageDependencies(
  packageName: string,
  version: string
): Promise<AnalysisResult>
```

**参数**:
- `packageName`: 包名
- `version`: 版本号

**返回值**:
```typescript
interface AnalysisResult {
  isInsecure: boolean          // 是否不安全
  insecurePackages: string[]   // 不安全包列表
  analyzedAt: Date             // 分析时间
  error?: string               // 错误信息（如果有）
}
```

### clearAnalysisCache

清空分析缓存，用于强制重新分析。

```typescript
function clearAnalysisCache(): void
```

### getAnalysisCacheSize

获取当前缓存大小，用于监控。

```typescript
function getAnalysisCacheSize(): number
```

## 性能考虑

### 1. 实际安装分析

使用 yarn 实际安装包进行分析：
- **完整覆盖**: 分析所有已安装的包，无深度限制
- **真实依赖**: 获得 yarn 实际解析的依赖树
- **隔离安全**: 每次分析在独立的临时目录中进行

优势：
- 准确性高：反映实际安装情况
- 覆盖全面：包含所有传递性依赖

注意事项：
- 需要磁盘空间：每次分析创建临时目录
- 安装时间：实际安装需要时间（已设置2分钟超时）

### 2. 优化措施

- **缓存机制**: 避免重复安装和分析相同的包
- **错误处理**: 安装失败不影响其他包的分析
- **自动清理**: 分析完成后立即清理临时目录
- **安全参数**: 使用 `--production` 和 `--ignore-scripts` 提高安全性

### 3. 内存和磁盘管理

- **内存**: 分析缓存存储在内存中
- **磁盘**: 临时目录在系统临时目录中创建，分析后自动清理
- **建议**: 
  - 定期重启服务以清空内存缓存
  - 监控磁盘空间
  - 确保临时目录有足够空间

## 配置选项

相关配置项（在 `config.ts` 中）：

```typescript
// 不安全包列表URL
INSECURE_PACKAGES_URL: 'https://koishi-registry.github.io/insecures/index.json'

// 增量更新
INCREMENTAL_UPDATE: true
```

## 监控和日志

系统在运行过程中会输出详细日志：

### 成功日志
```
Package <name> analyzed: secure
Package <name> analyzed: insecure (found: sharp, puppeteer)
```

### 警告日志
```
Warning: yarn install failed for <name>@<version>: <error>
Warning: Failed to cleanup temp directory <path>: <error>
```

### 错误日志
```
Error analyzing dependencies for <name>@<version>: <error>
```

## 故障排除

### 问题1: 分析速度慢

**原因**: 实际安装包需要时间
**解决方案**:
- 确保网络连接稳定
- 使用更快的NPM镜像
- 增加缓存命中率

### 问题2: 磁盘空间不足

**原因**: 临时目录占用磁盘空间
**解决方案**:
- 确保系统临时目录有足够空间
- 检查清理逻辑是否正常运行
- 定期清理系统临时目录

### 问题3: 安装超时

**原因**: 包依赖过多或网络慢
**解决方案**:
- 增加超时时间（默认2分钟）
- 使用本地或更快的NPM镜像
- 检查网络连接

## 最佳实践

1. **定期更新不安全包列表**: 确保 `INSECURE_PACKAGES_URL` 指向最新的列表
2. **监控分析结果**: 定期检查数据库中的 `securityAnalysis` 数据
3. **处理失败情况**: 对于分析失败的包，手动检查或重试
4. **监控系统资源**: 关注磁盘空间和内存使用
5. **日志监控**: 关注警告和错误日志，及时处理问题

## 未来改进

可能的改进方向：

1. **持久化缓存**: 使用Redis等存储缓存，避免重复安装
2. **并行安装**: 并行分析多个包（需要控制并发数）
3. **增量分析**: 复用已安装的 node_modules
4. **CVE数据库集成**: 集成CVE数据库，检测已知漏洞
5. **自定义规则**: 允许用户定义自己的不安全包规则
