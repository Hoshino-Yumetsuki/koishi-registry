import { getPluginsCollection, closeDB } from './utils/db.js'
import { fetchKoishiPlugins } from './utils/fetcher.js'
import fs from 'fs/promises'
import { checkForUpdates } from './utils/update.js'
import { compressJson } from './utils/compressor.js'

export async function saveToFile(data, filename = 'public/index.json') {
    const output = {
        time: new Date().toUTCString(),
        total: data.length,
        version: 1,
        objects: data
    }

    // Compress the JSON data using our utility
    const compressedJson = await compressJson(output)

    await fs.mkdir('public', { recursive: true })
    await fs.writeFile(filename, compressedJson, 'utf-8')
    console.log(`数据已保存到文件: ${filename}`)
}

export async function saveToDatabase(plugins) {
    const collection = await getPluginsCollection()

    for (const plugin of plugins) {
        await collection.updateOne(
            { 'package.name': plugin.package.name },
            { $set: plugin },
            { upsert: true }
        )
    }
}

export async function loadFromDatabase() {
    const collection = await getPluginsCollection()
    return await collection.find({}).toArray()
}

export async function scanOnly() {
    console.log('开始扫描插件数据...')
    try {
        const collection = await getPluginsCollection()
        const existingCount = await collection.countDocuments()

        // 无论是否增量更新，都直接调用 checkForUpdates
        // checkForUpdates 内部会根据配置判断是否清空数据库或执行增量逻辑
        console.log('执行更新/扫描...')
        const updatedCount = await checkForUpdates()
        const allPlugins = await loadFromDatabase()
        await saveToFile(allPlugins)
        console.log(
            `更新完成，更新了 ${updatedCount} 个插件，总共 ${allPlugins.length} 个插件`
        )
    } catch (error) {
        console.error('扫描插件数据时出错:', error)
    } finally {
        await closeDB()
    }
}

