import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { getPluginsCollection } from './db.js'

// 获取当前文件的目录
const __dirname = path.dirname(fileURLToPath(import.meta.url))
// 计数器文件路径（本地开发环境使用）
const counterFilePath = path.join(__dirname, '../../.update-counter')

// 在数据库中存储计数器的集合名称
const COUNTER_COLLECTION = 'system_counters'
const COUNTER_ID = 'update_counter'

/**
 * 读取当前更新计数
 * @returns {Promise<number>} 当前更新计数
 */
export async function readUpdateCounter() {
    try {
        // 首先尝试从数据库读取
        const collection = await getPluginsCollection(COUNTER_COLLECTION)
        const counter = await collection.findOne({ _id: COUNTER_ID })
        
        if (counter) {
            return counter.value
        }
        
        // 如果数据库中没有，尝试从文件读取（本地开发环境）
        if (fs.existsSync(counterFilePath)) {
            const count = parseInt(fs.readFileSync(counterFilePath, 'utf8').trim(), 10)
            if (!isNaN(count)) {
                // 将文件中的计数同步到数据库
                await collection.updateOne(
                    { _id: COUNTER_ID },
                    { $set: { value: count } },
                    { upsert: true }
                )
                return count
            }
        }
    } catch (error) {
        console.warn('读取更新计数器失败:', error.message)
    }
    return 0
}

/**
 * 增加更新计数并保存
 * @returns {Promise<number>} 更新后的计数
 */
export async function incrementUpdateCounter() {
    try {
        const collection = await getPluginsCollection(COUNTER_COLLECTION)
        
        // 使用 findOneAndUpdate 原子操作增加计数
        const result = await collection.findOneAndUpdate(
            { _id: COUNTER_ID },
            { $inc: { value: 1 } },
            { upsert: true, returnDocument: 'after' }
        )
        
        const newCount = result.value || 1
        
        // 同时更新本地文件（本地开发环境）
        try {
            fs.writeFileSync(counterFilePath, newCount.toString(), 'utf8')
        } catch (fileError) {
            // 文件写入失败不影响主要功能
            console.warn('保存计数器到文件失败:', fileError.message)
        }
        
        return newCount
    } catch (error) {
        console.error('增加更新计数器失败:', error.message)
        return 1 // 出错时返回1，确保至少进行一次增量更新
    }
}

/**
 * 重置更新计数器
 */
export async function resetUpdateCounter() {
    try {
        const collection = await getPluginsCollection(COUNTER_COLLECTION)
        await collection.updateOne(
            { _id: COUNTER_ID },
            { $set: { value: 0 } },
            { upsert: true }
        )
        
        // 同时更新本地文件（本地开发环境）
        try {
            fs.writeFileSync(counterFilePath, '0', 'utf8')
        } catch (fileError) {
            // 文件写入失败不影响主要功能
            console.warn('重置计数器文件失败:', fileError.message)
        }
    } catch (error) {
        console.error('重置更新计数器失败:', error.message)
    }
}
