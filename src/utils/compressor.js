/**
 * Compresses a JSON object by removing all whitespace
 * @param {Object} data - The data object to compress
 * @returns {Promise<string>} - The compressed JSON string
 */
export async function compressJson(data) {
    try {
        // Convert data to JSON with no whitespace (no indentation, no spaces)
        // This is the most efficient way to compress JSON
        const compressedJson = JSON.stringify(data)

        return compressedJson
    } catch (error) {
        console.error('压缩JSON时出错:', error)
        // Fallback to regular JSON stringification with indentation
        return JSON.stringify(data, null, 2)
    }
}
