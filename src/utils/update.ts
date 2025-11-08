import { config } from '../config'
import { getPluginsCollection } from './db'
import { loadCategories } from './categories'
import {
  fetchWithRetry,
  fetchPackageDetails,
  type NpmSearchResponse,
  type NpmSearchResult
} from './fetcher'
import semver from 'semver'
import { loadInsecurePackages } from './insecure'
import {
  readUpdateCounter,
  incrementUpdateCounter,
  resetUpdateCounter
} from './update-counter'

export async function checkForUpdates() {
  // 记录开始时间
  const startTime = process.hrtime.bigint() // 使用高精度时间，避免毫秒级误差
  const collection = await getPluginsCollection()
  const updatedCount = 0
  let removedCount = 0

  // 读取当前更新计数
  const currentCount = await readUpdateCounter()
  let _newCount = currentCount

  // 判断是否需要进行全量更新
  // 1. 如果配置为全量更新，直接进行全量更新
  // 2. 如果配置为增量更新，但当前计数达到了设定的次数，也进行全量更新
  const shouldDoFullUpdate =
    !config.INCREMENTAL_UPDATE ||
    (config.INCREMENTAL_UPDATE_TIMES > 0 &&
      currentCount >= config.INCREMENTAL_UPDATE_TIMES)

  if (shouldDoFullUpdate) {
    if (!config.INCREMENTAL_UPDATE) {
      console.log('配置为全量更新，正在清空数据库...')
    } else {
      console.log(
        `已完成 ${currentCount} 次增量更新，根据配置进行全量更新，正在清空数据库...`
      )
      // 重置计数器
      _newCount = await resetUpdateCounter()
    }
    await collection.deleteMany({}) // 清空所有文档
    console.log('数据库已清空。')
  } else {
    // 增加计数
    _newCount = await incrementUpdateCounter()
  }

  const params = new URLSearchParams({
    text: config.SEARCH_QUERY,
    size: String(config.SEARCH_SIZE),
    from: String(0)
  })

  // 并行获取搜索数据、现有插件和不安全包列表
  const [searchData, existingPlugins, _insecurePackages] = await Promise.all([
    fetchWithRetry(
      `${config.NPM_SEARCH_URL}?${params}`
    ) as Promise<NpmSearchResponse>,
    collection
      .find({ 'package.name': { $exists: true } })
      .toArray(), // 只获取有 package.name 的文档
    loadInsecurePackages()
  ])

  console.log('正在验证数据库中现有插件的 npmjs 官方源可用性...')
  const existingPluginsCheckPromises = existingPlugins.map(async (plugin) => {
    const packageName = plugin.package.name
    const npmjsOfficialUrl = `https://registry.npmjs.org/${packageName}`
    try {
      // 使用 HEAD 请求，只获取头部信息
      const officialResponse = await fetchWithRetry(
        npmjsOfficialUrl,
        { method: 'HEAD' },
        5,
        false,
        true
      )

      if (officialResponse.status === 404) {
        console.log(
          `Package ${packageName} not found on npmjs.org, marking for removal.`
        )
        return { name: packageName, status: 'removed' }
      }
      if (!officialResponse.ok) {
        // 如果不是 404，但也不是 2xx，可能是其他错误，记录警告但不移除
        console.warn(
          `Warning: npmjs.org returned status ${officialResponse.status} for existing package ${packageName}.`
        )
        return { name: packageName, status: 'removed' }
        // 移除掉
      }
      return { name: packageName, status: 'ok' }
    } catch (error) {
      console.warn(
        `Error checking npmjs.org for existing package ${packageName}: ${error.message}. Marking for removal.`
      )
      return { name: packageName, status: 'removed' }
    }
  })
  const existingPluginsCheckResults = await Promise.all(
    existingPluginsCheckPromises
  )
  const packagesToRemove = existingPluginsCheckResults
    .filter((result) => result.status === 'removed')
    .map((result) => result.name)

  if (packagesToRemove.length > 0) {
    console.log(
      `正在从数据库中移除 ${packagesToRemove.length} 个在 npmjs.org 上已不存在的包...`
    )
    const deleteResult = await collection.deleteMany({
      'package.name': { $in: packagesToRemove }
    })
    removedCount += deleteResult.deletedCount
    console.log(`已移除 ${deleteResult.deletedCount} 个包。`)
  } else {
    // console.log('所有现有插件在 npmjs.org 上均可用。');
  }

  // 重新获取现有插件列表，因为可能已经移除了部分
  const currentExistingPlugins = await collection
    .find({ 'package.name': { $exists: true } })
    .toArray()

  // 在增量更新时，只对有版本变化的包重新检查 insecure 状态
  // 这些包通过 fetchPackageDetails 函数会正确检查和设置 insecure 状态

  // 创建现有版本的映射 (基于重新获取的列表)
  const existingVersions = new Map(
    currentExistingPlugins.map((plugin) => [
      plugin.package.name,
      plugin.package.version
    ])
  )

  // 创建现有插件的安全分析状态映射
  const existingAnalysisStatus = new Map(
    currentExistingPlugins.map((plugin) => [
      plugin.package.name,
      plugin.securityAnalysis?.analyzed || false
    ])
  )

  const packagesToUpdate = []
  const categories = await loadCategories()

  // 通过搜索结果筛选需要更新的包
  const searchResults: NpmSearchResult[] = searchData.objects || []
  for (const result of searchResults) {
    const packageName = result.package?.name
    if (!packageName || !config.VALID_PACKAGE_PATTERN.test(packageName))
      continue

    const latestVersion = result.package.version
    if (!latestVersion) continue
    const currentVersion = existingVersions.get(packageName)
    const hasAnalysis = existingAnalysisStatus.get(packageName)

    // 如果是全量更新模式，或者包是新增的，或者版本有更新，或者没有安全分析，则加入待更新列表
    if (
      !config.INCREMENTAL_UPDATE ||
      !currentVersion ||
      semver.gt(latestVersion, currentVersion) ||
      !hasAnalysis
    ) {
      packagesToUpdate.push({
        name: packageName,
        version: latestVersion,
        result: {
          ...result,
          category: categories.get(packageName) || 'other',
          downloads: result.downloads || { all: 0 }
        }
      })
    }
  }

  if (packagesToUpdate.length === 0 && removedCount === 0) {
    // 检查是否有移除的包
    console.log('没有需要更新或移除的包')
    return 0
  }

  // 并行获取需要更新的包的详细信息
  // fetchPackageDetails 内部会再次验证 npmjs 官方源，确保新增/更新的包也有效
  const updatesPromises = packagesToUpdate.map(async (p) => {
    return await fetchPackageDetails(p.name, p.result)
  })

  const updates = (await Promise.all(updatesPromises)).filter(Boolean)

  if (updates.length > 0) {
    // 批量更新数据库
    const bulkOps = updates.map((update) => ({
      updateOne: {
        filter: { 'package.name': update.package.name },
        update: { $set: update },
        upsert: true
      }
    }))
    await collection.bulkWrite(bulkOps)

    // 输出更新信息
    console.log(`更新了 ${updates.length} 个有效包:`)
    updates.forEach((update) => {
      const currentVersion = existingVersions.get(update.package.name)
      const action = currentVersion ? '更新' : '新增'
      console.log(
        `- ${action}: ${update.package.name}@${update.package.version}${
          currentVersion ? ` (原版本: ${currentVersion})` : ''
        }`
      )
    })
  } else {
    console.log('没有有效的包需要新增或更新。')
  }

  // 记录结束时间
  const endTime = process.hrtime.bigint()
  const durationNs = endTime - startTime
  const durationMs = Number(durationNs) / 1_000_000 // 转换为毫秒
  const durationSeconds = durationMs / 1000 // 转换为秒

  console.log(`本次数据库更新总耗时：${durationSeconds.toFixed(2)} 秒`)

  return updates.length + updatedCount + removedCount // 返回总更新/移除数量
}
