# 依赖安全分析系统文档

## 概述

本系统实现了一套完整的插件依赖安全分析机制，用于自动检测和标记包含不安全依赖的Koishi插件。

## 功能特性

### 1. 深度依赖遍历

系统会递归遍历每个插件的依赖树，检查所有直接和间接依赖：

- **遍历深度**: 默认最多3层，平衡性能和覆盖度
- **依赖类型**: 包括 dependencies、peerDependencies 和 optionalDependencies
- **循环检测**: 使用访问集合防止依赖循环导致的无限递归

### 2. 不安全包检测

系统通过多种方式识别不安全的包：

#### 2.1 静态不安全包列表
从配置的URL加载不安全包列表（`INSECURE_PACKAGES_URL`），定期更新。

#### 2.2 硬编码不安全依赖
以下包被认为是不安全的：
- `sharp` - 原生依赖，可能导致部署问题
- `puppeteer` - 包含Chromium，体积大且可能有安全风险
- `canvas` - 原生依赖，跨平台兼容性问题

#### 2.3 传递性依赖检测
不仅检查直接依赖，还会检查依赖的依赖，确保深层依赖中的不安全包也能被发现。

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

### 4. 批量处理

为避免API速率限制，系统采用批量处理策略：

- **批量大小**: 每批10个依赖
- **并发控制**: 使用 Promise.all 并发处理批次
- **错误隔离**: 单个依赖分析失败不影响其他依赖

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
    ├─ 获取包元数据
    ├─ 检查直接依赖
    └─ 递归遍历传递性依赖
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

分析指定包的依赖安全性。

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

### 1. 遍历深度限制

默认最大遍历深度为3层：
- 第1层: 直接依赖
- 第2层: 依赖的依赖
- 第3层: 依赖的依赖的依赖

这个深度可以平衡：
- 覆盖度: 能检测到大部分传递性依赖
- 性能: 避免过多的API调用

### 2. API调用优化

- **缓存机制**: 避免重复分析相同的包
- **批量处理**: 每批10个依赖并发处理
- **错误处理**: 单个依赖失败不影响整体分析
- **超时控制**: 使用配置的请求超时时间

### 3. 内存管理

分析缓存存储在内存中，对于大量包可能占用较多内存。建议：
- 定期重启服务以清空缓存
- 监控缓存大小
- 根据需要调整分析策略

## 配置选项

相关配置项（在 `config.ts` 中）：

```typescript
// NPM镜像地址
NPM_REGISTRY: 'https://registry.npmmirror.com'

// 不安全包列表URL
INSECURE_PACKAGES_URL: 'https://koishi-registry.github.io/insecures/index.json'

// 请求超时时间
REQUEST_TIMEOUT: 10000

// 最大重试次数
MAX_RETRIES: 3

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
Warning: Deep dependency analysis failed for <name>: <error>
Warning: Could not analyze dependency <name>: <error>
```

### 错误日志
```
Error analyzing dependencies for <name>@<version>: <error>
```

## 故障排除

### 问题1: 分析速度慢

**原因**: 大量依赖需要遍历
**解决方案**:
- 减少遍历深度
- 增加批处理大小
- 使用更快的NPM镜像

### 问题2: 内存占用高

**原因**: 缓存过多分析结果
**解决方案**:
- 定期清空缓存
- 定期重启服务
- 减少遍历深度

### 问题3: API限流

**原因**: 请求过于频繁
**解决方案**:
- 增加请求间隔
- 使用本地NPM镜像
- 减小批处理大小

## 最佳实践

1. **定期更新不安全包列表**: 确保 `INSECURE_PACKAGES_URL` 指向最新的列表
2. **监控分析结果**: 定期检查数据库中的 `securityAnalysis` 数据
3. **处理失败情况**: 对于分析失败的包，手动检查或重试
4. **平衡性能和准确性**: 根据实际需求调整遍历深度
5. **日志监控**: 关注警告和错误日志，及时处理问题

## 未来改进

可能的改进方向：

1. **持久化缓存**: 使用Redis等存储缓存，避免重复分析
2. **增量分析**: 仅分析变更的依赖
3. **并行度控制**: 更细粒度的并发控制
4. **CVE数据库集成**: 集成CVE数据库，检测已知漏洞
5. **自定义规则**: 允许用户定义自己的不安全包规则
