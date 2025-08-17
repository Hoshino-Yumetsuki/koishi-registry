import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

// 获取当前文件的目录
const __dirname = path.dirname(fileURLToPath(import.meta.url))
// 计数器文件路径
const counterFilePath = path.join(__dirname, '../../.update-counter')

/**
 * 读取当前更新计数
 * @returns {number} 当前更新计数
 */
export function readUpdateCounter() {
    try {
        if (fs.existsSync(counterFilePath)) {
            const count = parseInt(fs.readFileSync(counterFilePath, 'utf8').trim(), 10)
            return isNaN(count) ? 0 : count
        }
    } catch (error) {
        console.warn('读取更新计数器失败:', error.message)
    }
    return 0
}

/**
 * 增加更新计数并保存
 * @returns {number} 更新后的计数
 */
export function incrementUpdateCounter() {
    const currentCount = readUpdateCounter()
    const newCount = currentCount + 1
    try {
        fs.writeFileSync(counterFilePath, newCount.toString(), 'utf8')
        return newCount
    } catch (error) {
        console.error('保存更新计数器失败:', error.message)
        return currentCount
    }
}

/**
 * 重置更新计数器
 */
export function resetUpdateCounter() {
    try {
        fs.writeFileSync(counterFilePath, '0', 'utf8')
    } catch (error) {
        console.error('重置更新计数器失败:', error.message)
    }
}