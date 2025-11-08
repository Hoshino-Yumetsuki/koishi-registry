import { fetchWithRetry } from './fetcher'
import { config } from '../config'
import { loadInsecurePackages } from './insecure'

const UNSAFE_DEPENDENCIES = new Set(['sharp', 'puppeteer', 'canvas'])

interface AnalysisResult {
  isInsecure: boolean
  insecurePackages: string[]
  analyzedAt: Date
  error?: string
}

/**
 * Cache for analyzed packages to avoid redundant API calls
 * Key: packageName@version, Value: analysis result
 */
const analysisCache = new Map<string, AnalysisResult>()

/**
 * Deep analyze package dependencies for insecure packages
 * This function traverses the entire dependency tree and checks each package
 */
export async function analyzePackageDependencies(
  packageName: string,
  version: string
): Promise<AnalysisResult> {
  const cacheKey = `${packageName}@${version}`

  // Check cache first
  if (analysisCache.has(cacheKey)) {
    const cached = analysisCache.get(cacheKey)
    if (cached) {
      return cached
    }
  }

  const result: AnalysisResult = {
    isInsecure: false,
    insecurePackages: [],
    analyzedAt: new Date()
  }

  try {
    // Load the insecure packages list
    const insecurePackages = await loadInsecurePackages()

    // Check if the package itself is in the insecure list
    if (insecurePackages.has(packageName)) {
      result.isInsecure = true
      result.insecurePackages.push(packageName)
      analysisCache.set(cacheKey, result)
      return result
    }

    // Fetch package metadata to get dependencies
    const pkgUrl = `${config.NPM_REGISTRY}/${packageName}`
    const pkgData = (await fetchWithRetry(pkgUrl)) as any

    if (!pkgData || !pkgData.versions || !pkgData.versions[version]) {
      result.error = 'Package version not found'
      analysisCache.set(cacheKey, result)
      return result
    }

    const versionInfo = pkgData.versions[version]

    // Collect all dependencies
    const allDeps: Record<string, string> = {
      ...versionInfo.dependencies,
      ...versionInfo.peerDependencies,
      ...versionInfo.optionalDependencies
    }

    // First, check direct dependencies for unsafe packages
    for (const depName of Object.keys(allDeps)) {
      if (UNSAFE_DEPENDENCIES.has(depName)) {
        result.isInsecure = true
        if (!result.insecurePackages.includes(depName)) {
          result.insecurePackages.push(depName)
        }
      }

      // Check if dependency is in the insecure list
      if (insecurePackages.has(depName)) {
        result.isInsecure = true
        if (!result.insecurePackages.includes(depName)) {
          result.insecurePackages.push(depName)
        }
      }
    }

    // Deep traverse dependencies (with depth limit to prevent infinite loops)
    const visited = new Set<string>([cacheKey])
    const maxDepth = 3 // Limit depth to avoid excessive API calls
    await traverseDependencies(
      allDeps,
      insecurePackages,
      result,
      visited,
      0,
      maxDepth
    )

    analysisCache.set(cacheKey, result)
    return result
  } catch (error) {
    console.error(
      `Error analyzing dependencies for ${packageName}@${version}:`,
      error
    )
    result.error = error.message
    analysisCache.set(cacheKey, result)
    return result
  }
}

/**
 * Recursively traverse dependencies to find insecure packages
 */
async function traverseDependencies(
  dependencies: Record<string, string>,
  insecurePackages: Set<string>,
  result: AnalysisResult,
  visited: Set<string>,
  currentDepth: number,
  maxDepth: number
): Promise<void> {
  if (currentDepth >= maxDepth) {
    return
  }

  const depEntries = Object.entries(dependencies)

  // Process dependencies in batches to avoid overwhelming the API
  const batchSize = 10
  for (let i = 0; i < depEntries.length; i += batchSize) {
    const batch = depEntries.slice(i, i + batchSize)

    await Promise.all(
      batch.map(async ([depName, versionRange]) => {
        // Check if this dependency is unsafe
        if (UNSAFE_DEPENDENCIES.has(depName)) {
          result.isInsecure = true
          if (!result.insecurePackages.includes(depName)) {
            result.insecurePackages.push(depName)
          }
        }

        // Check if dependency is in the insecure list
        if (insecurePackages.has(depName)) {
          result.isInsecure = true
          if (!result.insecurePackages.includes(depName)) {
            result.insecurePackages.push(depName)
          }
        }

        // Skip already visited packages to prevent cycles
        const depKey = `${depName}@${versionRange}`
        if (visited.has(depKey)) {
          return
        }
        visited.add(depKey)

        try {
          // Fetch the dependency's metadata
          const depUrl = `${config.NPM_REGISTRY}/${depName}`
          const depData = (await fetchWithRetry(depUrl)) as any

          if (!depData || !depData['dist-tags'] || !depData.versions) {
            return
          }

          // Get the latest version or a compatible version
          const latestVersion = depData['dist-tags'].latest
          if (!latestVersion || !depData.versions[latestVersion]) {
            return
          }

          const depVersionInfo = depData.versions[latestVersion]

          // Get nested dependencies
          const nestedDeps: Record<string, string> = {
            ...depVersionInfo.dependencies
          }

          // Continue traversing
          if (Object.keys(nestedDeps).length > 0) {
            await traverseDependencies(
              nestedDeps,
              insecurePackages,
              result,
              visited,
              currentDepth + 1,
              maxDepth
            )
          }
        } catch (error) {
          // Silently ignore errors for individual dependencies
          // to avoid breaking the entire analysis
          console.warn(
            `Warning: Could not analyze dependency ${depName}: ${error.message}`
          )
        }
      })
    )
  }
}

/**
 * Clear the analysis cache
 * Useful when the insecure packages list is updated
 */
export function clearAnalysisCache(): void {
  analysisCache.clear()
}

/**
 * Get cache size for monitoring
 */
export function getAnalysisCacheSize(): number {
  return analysisCache.size
}
