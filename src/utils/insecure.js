import fetch from 'node-fetch'
import { config } from '../config.js'

class InsecurePackagesManager {
    constructor() {
        this.insecurePackages = null
        this.loading = null
    }

    async fetchWithRetry(url) {
        let lastError

        for (let i = 0; i < config.MAX_RETRIES; i++) {
            try {
                const response = await fetch(url, {
                    timeout: config.REQUEST_TIMEOUT
                })
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`)
                }
                return await response.json()
            } catch (error) {
                lastError = error
                console.error(`第 ${i + 1} 次获取不安全包列表失败:`, error)
                if (i < config.MAX_RETRIES - 1) {
                    await new Promise((resolve) => setTimeout(resolve, 1000))
                }
            }
        }
        throw lastError
    }

    async loadInsecurePackages() {
        // 如果已经有缓存的数据，直接返回
        if (this.insecurePackages) {
            return this.insecurePackages
        }

        // 如果正在加载，等待加载完成并返回结果
        if (this.loading) {
            return await this.loading
        }

        // 开始新的加载过程
        this.loading = this.fetchInsecurePackages()
        try {
            this.insecurePackages = await this.loading
            return this.insecurePackages
        } finally {
            this.loading = null
        }
    }

    async fetchInsecurePackages() {
        try {
            const data = await this.fetchWithRetry(config.INSECURE_PACKAGES_URL)
            return new Set(data)
        } catch (error) {
            console.error('不安全包列表加载失败（已尝试所有重试）:', error)
            return new Set()
        }
    }

    async isPackageInsecure(packageName) {
        const insecurePackages = await this.loadInsecurePackages()
        return insecurePackages.has(packageName)
    }
}

// 创建单例
const insecurePackagesManager = new InsecurePackagesManager()

// 导出新的接口
export const loadInsecurePackages = () =>
    insecurePackagesManager.loadInsecurePackages()
export const isPackageInsecure = (packageName) =>
    insecurePackagesManager.isPackageInsecure(packageName)
