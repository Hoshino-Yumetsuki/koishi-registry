import { MongoClient } from 'mongodb'
import { config } from './config.js'

let client
let db

export async function connectDB() {
    try {
        client = new MongoClient(config.MONGODB_URI)
        await client.connect()
        db = client.db(config.MONGODB_DB)
        console.log('数据库连接成功')
        return db
    } catch (error) {
        console.error('数据库连接失败:', error)
        throw error
    }
}

export async function getPluginsCollection() {
    if (!db) {
        await connectDB()
    }
    return db.collection('plugins')
}

export async function closeDB() {
    if (client) {
        await client.close()
        console.log('数据库连接已关闭')
    }
}
