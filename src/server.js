import express from 'express'
import cron from 'node-cron'
import { config } from './config.js'
import { checkForUpdates } from './utils/update.js'
import { loadFromDatabase } from './scanner.js'
import { compressJson } from './utils/compressor.js'

export class Server {
    constructor() {
        this.app = express()
        this.data = {
            time: '',
            total: 0,
            version: 1,
            objects: []
        }
    }

    async updateData() {
        console.log('正在从数据库更新数据...')
        try {
            const totalChanges = await checkForUpdates()
            const plugins = await loadFromDatabase()

            this.data = {
                time: new Date().toUTCString(),
                total: plugins.length,
                version: 1,
                objects: plugins
            }

            console.log(
                `数据更新完成，共发生 ${totalChanges} 处变化 (新增/更新/移除)，当前总共 ${plugins.length} 个插件`
            )
        } catch (error) {
            console.error('更新数据时出错:', error)
        }
    }

    start() {
        this.updateData()
        cron.schedule(config.SCAN_CRON, () => this.updateData())

        this.app.get('/index.json', async (_req, res) => {
            try {
                // Compress the JSON data using our utility
                const compressedJson = await compressJson(this.data)

                // Set content type and send the compressed JSON
                res.setHeader('Content-Type', 'application/json')
                res.send(compressedJson)
            } catch (error) {
                console.error('处理JSON时出错:', error)
                // Fallback to uncompressed JSON if compression fails
                res.json(this.data)
            }
        })

        this.app.listen(config.SERVER_PORT, config.SERVER_HOST, () => {
            console.log(
                `服务器启动在 http://${config.SERVER_HOST}:${config.SERVER_PORT}`
            )
            console.log(`定时任务已设置: ${config.SCAN_CRON}`)
        })
    }
}

export function startServer() {
    const server = new Server()
    server.start()
}
