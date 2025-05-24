import { startServer } from './server.js'
import { scanOnly } from './scanner.js'

const isServerMode = process.argv.includes('--server')

if (isServerMode) {
    startServer()
} else {
    scanOnly()
}
