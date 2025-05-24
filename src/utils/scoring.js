export function calculatePackageScore({
    packageInfo,
    versionInfo,
    timeInfo,
    maintainers,
    contributors,
    packageLinks
}) {
    // 质量评分 (0-1)
    const quality = calculateQualityScore({
        hasDescription: !!versionInfo.description,
        hasRepository: !!packageLinks.repository,
        hasHomepage: !!packageLinks.homepage,
        hasBugs: !!packageLinks.bugs,
        hasTypes: !!versionInfo.types || !!versionInfo.typings,
        maintainersCount: maintainers.length,
        contributorsCount: contributors.length,
        hasLicense: !!versionInfo.license
    })

    // 维护性评分 (0-1)
    const maintenance = calculateMaintenanceScore({
        lastUpdated: new Date(timeInfo.modified),
        commitFrequency: calculateCommitFrequency(timeInfo),
        maintainersCount: maintainers.length
    })

    // 流行度评分 (0-1)
    const popularity = calculatePopularityScore({
        downloadCount: packageInfo.downloads?.lastMonth || 0,
        dependentsCount: packageInfo.dependents || 0,
        starsCount: 0 // 如果有 GitHub API 可以添加
    })

    // 最终评分 (0-1)
    const final = (quality * 0.4 + maintenance * 0.35 + popularity * 0.25) * 10

    return {
        final,
        quality: quality * 10,
        popularity: popularity * 10,
        maintenance: maintenance * 10
    }
}

function calculateQualityScore({
    hasDescription,
    hasRepository,
    hasHomepage,
    hasBugs,
    hasTypes,
    maintainersCount,
    contributorsCount,
    hasLicense
}) {
    let score = 0
    if (hasDescription) score += 0.2
    if (hasRepository) score += 0.15
    if (hasHomepage) score += 0.1
    if (hasBugs) score += 0.1
    if (hasTypes) score += 0.15
    if (hasLicense) score += 0.1
    score += Math.min(maintainersCount * 0.1, 0.1)
    score += Math.min(contributorsCount * 0.05, 0.1)
    return Math.min(score, 1)
}

function calculateMaintenanceScore({
    lastUpdated,
    commitFrequency,
    maintainersCount
}) {
    const now = new Date()
    const monthsSinceUpdate = (now - lastUpdated) / (1000 * 60 * 60 * 24 * 30)

    let score = 0
    score += Math.max(0, 1 - monthsSinceUpdate / 12)
    score += Math.min(commitFrequency, 1) * 0.5
    score += Math.min(maintainersCount * 0.2, 0.5)

    return Math.min(score / 2, 1)
}

function calculatePopularityScore({
    downloadCount,
    dependentsCount,
    starsCount
}) {
    const downloadScore = Math.min(downloadCount / 1000, 1)
    const dependentsScore = Math.min(dependentsCount / 10, 1)
    const starsScore = Math.min(starsCount / 100, 1)

    return downloadScore * 0.6 + dependentsScore * 0.3 + starsScore * 0.1
}

function calculateCommitFrequency(timeInfo) {
    const versions = Object.keys(timeInfo).filter(
        (key) => !['created', 'modified'].includes(key)
    )
    if (versions.length < 2) return 0

    const firstVersion = new Date(timeInfo[versions[0]])
    const lastVersion = new Date(timeInfo[versions[versions.length - 1]])
    const months = (lastVersion - firstVersion) / (1000 * 60 * 60 * 24 * 30)

    return months === 0 ? 0 : Math.min(versions.length / months, 1)
}
