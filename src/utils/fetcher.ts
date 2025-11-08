import fetch, {
  type RequestInfo,
  type RequestInit,
  type Response
} from 'node-fetch'
import { config } from '../config'
import { calculatePackageScore } from './scoring'
import { getCategory, loadCategories } from './categories'
import semver from 'semver'
import { loadInsecurePackages, isPackageInsecure } from './insecure'
import { validatePackage } from './validator'
import pLimit from 'p-limit'
import { analyzePackageDependencies } from './dependency-analyzer'

// 针对 npmjs.org 官方源的并发限制器
const npmjsLimiter = pLimit(config.NPMJS_CONCURRENT_REQUESTS)

// 最小化的 NPM registry 响应类型定义（仅包含本文件中用到的字段）
export interface NpmPackageVersionInfo {
  deprecated?: boolean
  repository?: string | { url?: string }
  _npmUser?: { name?: string; email?: string }
  contributors?: Array<{ name?: string; email?: string; url?: string } | string>
  license?: string
  dist?: { unpackedSize?: number; size?: number }
  peerDependencies?: Record<string, string>
  koishi?: any
  description?: string
  bugs?: { url?: string }
  homepage?: string
  keywords?: string[]
}

export interface NpmPackageData {
  'dist-tags'?: { latest?: string }
  versions?: Record<string, NpmPackageVersionInfo>
  deprecated?: boolean
  license?: string
  time?: Record<string, string>
  maintainers?: Array<{ name?: string; email?: string }>
  repository?: string | { url?: string }
  koishi?: any
}

export interface NpmSearchResult {
  package: { name: string; version?: string }
  downloads?: { all?: number }
}

export interface NpmSearchResponse {
  total?: number
  objects?: NpmSearchResult[]
}

// 获取包的短名称
function getPackageShortname(name: string) {
  if (name.startsWith('@koishijs/')) {
    return name.replace('@koishijs/plugin-', '')
  } else if (name.startsWith('@')) {
    const [scope, pkgName] = name.split('/')
    return `${scope}/${pkgName.replace('koishi-plugin-', '')}`
  } else {
    return name.replace('koishi-plugin-', '')
  }
}

// 验证包是否为官方包
function isVerifiedPackage(name: string) {
  return name.startsWith('@koishijs/')
}

// 导出 fetchWithRetry
// Overloads：当 returnJson 为 false 时返回 Response，否则返回 JSON（unknown，由调用方断言）
export async function fetchWithRetry(
  url: URL | RequestInfo,
  options?: RequestInit,
  retries?: number,
  returnJson?: true,
  isNpmjsOfficialSource?: boolean
): Promise<unknown>
export async function fetchWithRetry(
  url: URL | RequestInfo,
  options: RequestInit,
  retries: number,
  returnJson: false,
  isNpmjsOfficialSource?: boolean
): Promise<Response>
export async function fetchWithRetry(
  url: URL | RequestInfo,
  options: RequestInit = {},
  retries: number = config.MAX_RETRIES,
  returnJson: boolean = true,
  isNpmjsOfficialSource: boolean = false // 是否为 npmjs 官方源请求
): Promise<unknown | Response> {
  for (let i = 0; i < retries; i++) {
    try {
      let response: Response
      const fetchOperation = async () => {
        const controller = new AbortController()
        const timeoutId = setTimeout(
          () => controller.abort(),
          config.REQUEST_TIMEOUT
        )
        const res = await fetch(url, {
          ...options,
          signal: controller.signal
        })
        clearTimeout(timeoutId)
        // 如果是 429 错误，抛出特殊错误以便重试逻辑处理
        if (res.status === 429) {
          const retryAfter = res.headers.get('Retry-After')
          throw new Error(
            `429 Too Many Requests${retryAfter ? ` (Retry-After: ${retryAfter}s)` : ''}`,
            {
              cause: {
                status: 429,
                retryAfter: retryAfter ? parseInt(retryAfter, 10) * 1000 : 0
              }
            }
          )
        }
        return res
      }

      if (isNpmjsOfficialSource) {
        // 如果是 npmjs 官方源请求，通过限制器执行
        response = await npmjsLimiter(fetchOperation)
      } else {
        // 否则直接执行
        response = await fetchOperation()
      }

      if (!response.ok && response.status !== 404) {
        // 404 不算网络错误，但其他非 2xx 状态码需要处理
        throw new Error(`HTTP error! status: ${response.status} for ${url}`)
      }

      if (returnJson) {
        return await response.json()
      } else {
        return response
      }
    } catch (error) {
      const isLastAttempt = i === retries - 1
      const status = error.cause?.status
      const retryAfter = error.cause?.retryAfter

      if (status === 429) {
        const waitTime = retryAfter || 2 ** i * 1000 // 如果有 Retry-After，则使用，否则指数退避
        console.warn(
          `Retry ${i + 1}/${retries} for ${url} failed with 429. Waiting ${waitTime / 1000}s...`
        )
        await new Promise((resolve) => setTimeout(resolve, waitTime))
      } else if (error.message.includes('ECONNRESET')) {
        const waitTime = 2 ** i * 1000 // 指数退避
        console.warn(
          `Retry ${i + 1}/${retries} for ${url} failed with ECONNRESET. Waiting ${waitTime / 1000}s...`
        )
        await new Promise((resolve) => setTimeout(resolve, waitTime))
      } else {
        // 其他错误，直接抛出或简单重试
        if (isLastAttempt) {
          console.error(`Final attempt failed for ${url}: ${error.message}`)
          throw error
        }
        console.warn(
          `Retry ${i + 1}/${retries} for ${url} failed: ${error.message}. Retrying...`
        )
        await new Promise((resolve) => setTimeout(resolve, 1000)) // 默认等待 1 秒
      }
    }
  }
}

// 导出 fetchPackageDetails
export async function fetchPackageDetails(
  name: string,
  result: { downloads?: { all?: any }; category?: any; portable?: any }
) {
  try {
    const npmjsOfficialUrl = `https://registry.npmjs.org/${name}` // npmjs 官方源地址
    const officialResponse = await fetchWithRetry(
      npmjsOfficialUrl,
      { method: 'HEAD' },
      5,
      false,
      true
    )

    if (officialResponse.status === 404) {
      console.log(`Package ${name} not found on npmjs.org, skipping.`)
      return null // 包在官方源不存在，直接跳过
    }
    if (!officialResponse.ok) {
      console.warn(
        `Warning: npmjs.org returned status ${officialResponse.status} for ${name}. Attempting to fetch from npmminnor.`
      )
    }

    const pkgUrl = `${config.NPM_REGISTRY}/${name}`
    const pkgData = (await fetchWithRetry(pkgUrl)) as NpmPackageData

    const latestVersion = pkgData['dist-tags']?.latest
    const versionInfo = latestVersion ? pkgData.versions?.[latestVersion] : {}

    // 检查包是否被弃用
    if (versionInfo.deprecated || pkgData.deprecated) {
      return null
    }

    // 使用 validatePackage 验证包数据
    const validatedPackage = validatePackage(versionInfo)
    if (!validatedPackage) {
      console.log(
        `Package ${name} validation failed, skipping. (Error message seen on the line above this one)`
      )
      return null
    }

    // 检查 koishi 版本要求
    const peerDependencies = versionInfo.peerDependencies || {}
    const versionRequirement = peerDependencies.koishi

    if (!peerDependencies || !versionRequirement) return null

    // 如果没有指定 koishi 版本要求，则跳过版本检查
    if (versionRequirement) {
      try {
        // 处理确切版本号的情况（包括预发布版本）
        if (semver.valid(versionRequirement)) {
          const requiredVersion = semver.clean(versionRequirement)
          const majorVersion = semver.major(requiredVersion)

          // 如果主版本号匹配，则认为兼容
          if (majorVersion === 4) {
            // 兼容，继续处理
            console.log(
              `Package ${name} uses exact version ${versionRequirement}, accepting as compatible with Koishi v4.`
            )
          } else {
            console.log(
              `Package ${name} requires Koishi v${majorVersion}, not compatible with v4, skipping.`
            )
            return null
          }
        } else {
          // 处理版本范围的情况
          const intersection = semver.intersects(
            versionRequirement,
            config.KOISHI_VERSION_REQUIREMENT
          )
          if (!intersection) {
            console.log(
              `Package ${name} koishi version requirement ${versionRequirement} not compatible with ${config.KOISHI_VERSION_REQUIREMENT}, skipping.`
            )
            return null
          }
        }
      } catch (_error) {
        console.warn(`Invalid semver range for ${name}: ${versionRequirement}`)
        return null
      }
    }

    const koishiManifest = versionInfo.koishi || pkgData.koishi || {}

    const timeInfo = pkgData.time || {}
    const publisher = {
      name: versionInfo._npmUser?.name || '',
      email: versionInfo._npmUser?.email || '',
      username: versionInfo._npmUser?.name || ''
    }

    const maintainers = (pkgData.maintainers || []).map(
      (maintainer: { name: any; email: any }) => ({
        name: maintainer.name || '',
        email: maintainer.email || '',
        username: maintainer.name || ''
      })
    )

    const contributors = Array.isArray(versionInfo.contributors)
      ? versionInfo.contributors.map(
          (contributor: { name: any; email: any; url: any }) => {
            if (typeof contributor === 'string') {
              return { name: contributor }
            }
            return {
              name: contributor.name || '',
              email: contributor.email || '',
              url: contributor.url || '',
              username: contributor.name || ''
            }
          }
        )
      : []

    const npmLink = name.startsWith('@')
      ? `${config.NPM_PACKAGE_URL}/${name}`
      : `${config.NPM_PACKAGE_URL}/package/${name}`

    // 处理仓库链接，移除 git+ 前缀
    let repositoryUrl = ''
    if (typeof versionInfo.repository === 'object') {
      repositoryUrl = versionInfo.repository.url || ''
    } else {
      repositoryUrl = versionInfo.repository || ''
    }

    // 移除 git+ 前缀
    if (repositoryUrl.startsWith('git+')) {
      repositoryUrl = repositoryUrl.substring(4)
    }

    const packageLinks = {
      npm: npmLink,
      bugs: versionInfo.bugs?.url || '',
      homepage: versionInfo.homepage || '',
      repository: repositoryUrl
    }

    if (!packageLinks.bugs) {
      delete packageLinks.bugs
    }
    if (!packageLinks.homepage) {
      delete packageLinks.homepage
    }
    if (!packageLinks.repository) {
      delete packageLinks.repository
    }

    const isVerified = isVerifiedPackage(name)
    const shortname = getPackageShortname(name)

    if (!koishiManifest.description) {
      koishiManifest.description = { zh: versionInfo.description || '' }
    }

    // 计算评分
    const score = calculatePackageScore({
      packageInfo: pkgData,
      versionInfo,
      timeInfo,
      maintainers,
      contributors,
      packageLinks
    })

    // 从 search 结果中获取下载量
    const downloads = {
      lastMonth: result.downloads?.all || 0
    }

    // 检查包是否不安全 - 使用深度依赖分析
    // First check manifest and shallow dependencies
    let isInsecure =
      (await isPackageInsecure(name, versionInfo)) ||
      koishiManifest.insecure === true

    // Perform deep dependency analysis
    let analysisResult = null
    try {
      analysisResult = await analyzePackageDependencies(name, latestVersion)
      // Update insecure status if deep analysis finds insecure packages
      if (analysisResult.isInsecure) {
        isInsecure = true
      }
    } catch (error) {
      console.warn(
        `Warning: Deep dependency analysis failed for ${name}:`,
        error
      )
    }

    return {
      category: result.category || 'other',
      shortname,
      createdAt: timeInfo.created,
      updatedAt: timeInfo.modified,
      updated: timeInfo.modified,
      portable: result.portable || false,
      verified: isVerified,
      score: {
        final: score.final,
        detail: {
          quality: score.quality,
          popularity: score.popularity,
          maintenance: score.maintenance
        }
      },
      rating: score.final,
      license: versionInfo.license || pkgData.license || '',
      package: {
        name,
        keywords: versionInfo.keywords || [],
        version: latestVersion,
        description: versionInfo.description || '',
        publisher,
        maintainers,
        license: versionInfo.license || pkgData.license || '',
        date: timeInfo[latestVersion],
        links: packageLinks,
        contributors
      },
      flags: {
        insecure: isInsecure ? 1 : 0
      },
      manifest: koishiManifest,
      publishSize: versionInfo.dist?.unpackedSize || 0,
      installSize: versionInfo.dist?.size || 0,
      dependents: 0,
      downloads,
      insecure: isInsecure,
      ignored: false,
      // Add security analysis metadata
      securityAnalysis: analysisResult
        ? {
            analyzed: true,
            analyzedAt: analysisResult.analyzedAt.toISOString(),
            insecurePackages: analysisResult.insecurePackages,
            hasError: !!analysisResult.error
          }
        : {
            analyzed: false,
            analyzedAt: null,
            insecurePackages: [],
            hasError: false
          }
    }
  } catch (error) {
    console.error(`Error fetching ${name}:`, error)
    return null
  }
}

// 导出 getCategoryForPackage
export const getCategoryForPackage = getCategory

export async function fetchKoishiPlugins() {
  // 预加载分类和不安全包列表
  const [categories, _insecurePackages] = await Promise.all([
    loadCategories(),
    loadInsecurePackages()
  ])

  const plugins = []
  let fromOffset = 0
  let totalPackages = null
  let skippedPackages = 0

  while (true) {
    const params = new URLSearchParams({
      text: config.SEARCH_QUERY,
      size: String(config.SEARCH_SIZE),
      from: String(fromOffset)
    })

    const data = (await fetchWithRetry(
      `${config.NPM_SEARCH_URL}?${params}`
    )) as NpmSearchResponse

    if (!totalPackages) {
      totalPackages = data.total
    }

    const results = data.objects || []
    if (!results.length) break

    // 预处理所有有效的包，包括它们的分类信息
    const validPackages = results
      .filter((result: { package: { name: string } }) =>
        config.VALID_PACKAGE_PATTERN.test(result.package?.name)
      )
      .map((result: { package: { name: string }; downloads: any }) => ({
        name: result.package.name,
        result: {
          ...result,
          category: categories.get(result.package.name) || 'other',
          downloads: result.downloads || { all: 0 }
        }
      }))

    // 并行处理包详情，传入预加载的不安全包列表
    const batchPromises = validPackages.map(({ name, result }) =>
      fetchPackageDetails(name, result)
    )

    const batchResults = await Promise.all(batchPromises)
    const validResults = batchResults.filter(Boolean)
    skippedPackages += batchResults.length - validResults.length
    plugins.push(...validResults)

    fromOffset += results.length
    console.log(
      `进度: ${fromOffset}/${totalPackages} | 已收录: ${plugins.length} | 已跳过: ${skippedPackages}`
    )

    if (fromOffset >= totalPackages) break
  }

  console.log(`\n扫描完成：`)
  console.log(`- 总扫描数量: ${totalPackages}`)
  console.log(`- 最终收录: ${plugins.length}`)
  console.log(`- 已跳过: ${skippedPackages}`)

  return plugins
}
