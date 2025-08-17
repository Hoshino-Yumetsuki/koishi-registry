import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { execSync } from 'child_process'

// 获取当前文件的目录
const __dirname = path.dirname(fileURLToPath(import.meta.url))
// 计数器文件名
const COUNTER_FILENAME = '.update-counter'

/**
 * 从 pages 分支获取更新计数器
 * @returns {number} 当前更新计数
 */
export function readUpdateCounter() {
    try {
        // 检查是否在 GitHub Actions 环境中
        const isGitHubActions = process.env.GITHUB_ACTIONS === 'true'
        
        if (isGitHubActions) {
            console.log('正在从 pages 分支获取更新计数...')
            
            try {
                // 尝试从 pages 分支获取计数器文件
                const counterContent = execSync('git fetch origin pages && git show origin/pages:.update-counter', { 
                    stdio: ['pipe', 'pipe', 'pipe'],
                    encoding: 'utf8' 
                }).trim()
                
                const count = parseInt(counterContent, 10)
                if (!isNaN(count)) {
                    console.log(`从 pages 分支获取的更新计数: ${count}`)
                    return count
                }
            } catch (error) {
                console.log('无法从 pages 分支获取计数器，将使用默认值 0')
            }
            return 0
        } else {
            // 本地开发环境，使用本地文件
            const localCounterPath = path.join(__dirname, '../../', COUNTER_FILENAME)
            if (fs.existsSync(localCounterPath)) {
                const count = parseInt(fs.readFileSync(localCounterPath, 'utf8').trim(), 10)
                return isNaN(count) ? 0 : count
            }
        }
    } catch (error) {
        console.warn('读取更新计数器失败:', error.message)
    }
    
    return 0
}

/**
 * 准备更新计数器文件，以便在部署时保存到 pages 分支
 * @param {number} count 当前计数
 */
export function prepareUpdateCounter(count) {
    try {
        // 将计数器保存到项目根目录，这样会被部署到 pages 分支
        const counterPath = path.join(__dirname, '../../', COUNTER_FILENAME)
        fs.writeFileSync(counterPath, count.toString(), 'utf8')
        console.log(`更新计数器已准备好: ${count}`)
        
        // 如果在 GitHub Actions 中，确保文件会被部署
        if (process.env.GITHUB_ACTIONS === 'true') {
            // 在部署阶段，这个文件会被复制到 pages 分支
            console.log('计数器文件将在部署阶段保存到 pages 分支')
        }
    } catch (error) {
        console.error('准备更新计数器失败:', error.message)
    }
}

/**
 * 增加更新计数
 * @returns {number} 更新后的计数
 */
export function incrementUpdateCounter() {
    const currentCount = readUpdateCounter()
    const newCount = currentCount + 1
    prepareUpdateCounter(newCount)
    return newCount
}

/**
 * 重置更新计数器
 */
export function resetUpdateCounter() {
    prepareUpdateCounter(0)
    return 0
}