import { loadInsecurePackages } from './insecure'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

const execFileAsync = promisify(execFile)

const UNSAFE_DEPENDENCIES = new Set(['sharp', 'puppeteer', 'canvas'])

interface AnalysisResult {
  isInsecure: boolean
  insecurePackages: string[]
  analyzedAt: Date
  error?: string
}

/**
 * Cache for analyzed packages to avoid redundant installations
 * Key: packageName@version, Value: analysis result
 */
const analysisCache = new Map<string, AnalysisResult>()

/**
 * Deep analyze package dependencies for insecure packages using actual package installation
 *
 * This function performs a comprehensive security analysis by:
 * 1. Creating an isolated temporary directory
 * 2. Installing the package with yarn (similar to WebContainer approach)
 * 3. Analyzing the complete installed dependency tree from node_modules
 * 4. Checking all dependencies against the insecure packages list
 *
 * The analysis checks for:
 * - Packages in the external insecure packages list
 * - Hardcoded unsafe dependencies (sharp, puppeteer, canvas)
 * - All transitive dependencies as actually installed by yarn
 *
 * @param packageName - The name of the package to analyze
 * @param version - The specific version to analyze
 * @returns AnalysisResult containing security status and found insecure packages
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

  let tempDir: string | null = null

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

    // Create a temporary directory for isolated installation
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'koishi-security-'))

    // Create a minimal package.json
    const packageJson = {
      name: 'security-analysis-temp',
      version: '1.0.0',
      private: true,
      dependencies: {
        [packageName]: version
      }
    }

    await fs.writeFile(
      path.join(tempDir, 'package.json'),
      JSON.stringify(packageJson, null, 2)
    )

    // Install the package with yarn in the temporary directory
    // Use --production to avoid devDependencies and --ignore-scripts for security
    try {
      await execFileAsync(
        'yarn',
        ['install', '--production', '--ignore-scripts', '--non-interactive'],
        {
          cwd: tempDir,
          timeout: 120000, // 2 minutes timeout
          env: {
            ...process.env,
            NODE_ENV: 'production'
          }
        }
      )
    } catch (installError) {
      // If yarn install fails, record the error but don't fail completely
      console.warn(
        `Warning: yarn install failed for ${packageName}@${version}: ${installError.message}`
      )
      result.error = `Installation failed: ${installError.message}`
      analysisCache.set(cacheKey, result)
      return result
    }

    // Analyze the installed node_modules directory
    const nodeModulesPath = path.join(tempDir, 'node_modules')

    try {
      await fs.access(nodeModulesPath)
    } catch {
      // node_modules doesn't exist, package might have no dependencies
      analysisCache.set(cacheKey, result)
      return result
    }

    // Get all installed packages from node_modules
    const installedPackages = await getInstalledPackages(nodeModulesPath)

    // Check each installed package against insecure list and unsafe dependencies
    for (const installedPkg of installedPackages) {
      if (UNSAFE_DEPENDENCIES.has(installedPkg)) {
        result.isInsecure = true
        if (!result.insecurePackages.includes(installedPkg)) {
          result.insecurePackages.push(installedPkg)
        }
      }

      if (insecurePackages.has(installedPkg)) {
        result.isInsecure = true
        if (!result.insecurePackages.includes(installedPkg)) {
          result.insecurePackages.push(installedPkg)
        }
      }
    }

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
  } finally {
    // Clean up temporary directory
    if (tempDir) {
      try {
        await fs.rm(tempDir, { recursive: true, force: true })
      } catch (cleanupError) {
        console.warn(
          `Warning: Failed to cleanup temp directory ${tempDir}:`,
          cleanupError
        )
      }
    }
  }
}

/**
 * Recursively get all installed package names from node_modules
 *
 * @param nodeModulesPath - Path to the node_modules directory
 * @param packages - Accumulator for package names
 * @returns Array of all installed package names
 */
async function getInstalledPackages(
  nodeModulesPath: string,
  packages: Set<string> = new Set()
): Promise<string[]> {
  try {
    const entries = await fs.readdir(nodeModulesPath, { withFileTypes: true })

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue
      }

      if (entry.name.startsWith('@')) {
        // Scoped package, need to go one level deeper
        const scopePath = path.join(nodeModulesPath, entry.name)
        const scopedEntries = await fs.readdir(scopePath, {
          withFileTypes: true
        })

        for (const scopedEntry of scopedEntries) {
          if (scopedEntry.isDirectory()) {
            const packageName = `${entry.name}/${scopedEntry.name}`
            packages.add(packageName)

            // Check for nested node_modules
            const nestedNodeModules = path.join(
              scopePath,
              scopedEntry.name,
              'node_modules'
            )
            try {
              await fs.access(nestedNodeModules)
              await getInstalledPackages(nestedNodeModules, packages)
            } catch {
              // No nested node_modules, skip
            }
          }
        }
      } else if (entry.name !== '.bin' && entry.name !== '.yarn-integrity') {
        // Regular package
        packages.add(entry.name)

        // Check for nested node_modules
        const nestedNodeModules = path.join(
          nodeModulesPath,
          entry.name,
          'node_modules'
        )
        try {
          await fs.access(nestedNodeModules)
          await getInstalledPackages(nestedNodeModules, packages)
        } catch {
          // No nested node_modules, skip
        }
      }
    }

    return Array.from(packages)
  } catch (error) {
    console.warn(
      `Warning: Error reading node_modules at ${nodeModulesPath}:`,
      error
    )
    return Array.from(packages)
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
