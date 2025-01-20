import * as cache from '@actions/cache'
import * as core from '@actions/core'
import * as exec from '@actions/exec'
import * as io from '@actions/io'
import * as os from 'os'
import * as path from 'path'
import * as toolcache from '@actions/tool-cache'

import {
  getCacheDir,
  getCacheKeys,
  getEnvVar,
  getInstallDir,
  printConfig,
  printStats,
  zeroStats
} from './lib'

// Downloads the latest buildcache release for this OS
// accessToken is a valid github token to access APIs
// returns path to the downloaded file
export async function downloadLatest(): Promise<string> {
  // Determine correct file name
  let filename = 'buildcache-windows.tar.gz' // our default
  switch (os.platform()) {
    case 'linux':
      if (os.arch() === 'x64') {
        filename = 'buildcache-linux-intel.tar.gz'
      } else {
        filename = 'buildcache-linux-arm.tar.gz'
      }
      break
    case 'darwin':
      if (os.arch() === 'x64') {
        filename = 'buildcache-macos-intel.tar.gz'
      } else {
        filename = 'buildcache-macos-arm.tar.gz'
      }
      break
  }
  core.info(`buildcache: release file based on runner os is ${filename}`)

  const buildCacheReleaseUrl = `https://github.com/opencor/buildcache-action/releases/download/buildcache/${filename}`

  if (!buildCacheReleaseUrl) {
    throw new Error('Unable to determine release URL for buildcache')
  }
  core.info(`buildcache: installing from ${buildCacheReleaseUrl}`)
  const buildcacheReleasePath =
    await toolcache.downloadTool(buildCacheReleaseUrl)
  core.info(`buildcache: download path ${buildcacheReleasePath}`)
  return buildcacheReleasePath
}

export async function install(sourcePath: string): Promise<void> {
  const buildcacheBinFolder = (await getInstallDir()) + '/buildcache/bin'
  await io.mkdirP(buildcacheBinFolder)

  let buildcacheFolder = await toolcache.extractTar(
    sourcePath,
    buildcacheBinFolder
  )
  core.info(`buildcache: unpacked folder ${buildcacheFolder}`)

  const buildcacheBinPath = path.join(buildcacheBinFolder, 'buildcache')
  // windows has different filename and cannot do symbolic links
  if (os.platform() !== 'win32') {
    await exec.exec('ln', [
      '-s',
      buildcacheBinPath,
      path.join(buildcacheBinFolder, 'clang')
    ])
    await exec.exec('ln', [
      '-s',
      buildcacheBinPath,
      path.join(buildcacheBinFolder, 'clang++')
    ])
  }
  core.addPath(buildcacheBinFolder)
}

async function configure(): Promise<void> {
  // Set up the environment by putting our path in there
  const cacheDir = await getCacheDir()
  core.exportVariable('BUILDCACHE_DIR', cacheDir)
  core.exportVariable(
    'BUILDCACHE_MAX_CACHE_SIZE',
    getEnvVar('BUILDCACHE_MAX_CACHE_SIZE', '500000000')
  )
  core.exportVariable('BUILDCACHE_DEBUG', getEnvVar('BUILDCACHE_DEBUG', '2'))
  core.exportVariable(
    'BUILDCACHE_LOG_FILE',
    path.resolve(cacheDir, getEnvVar('BUILDCACHE_LOG_FILE', 'buildcache.log'))
  )
}

async function restore(): Promise<void> {
  const paths = [await getCacheDir()]

  // withInput restores immutable cache from previous runs, unique creates fresh upload post-run
  const { withInput, unique } = getCacheKeys()
  const restoreKeys = [withInput]

  try {
    const restoredWith = await cache.restoreCache(paths, unique, restoreKeys)
    if (restoredWith) {
      core.info(`buildcache: restored from cache key "${restoredWith}".`)
    } else {
      core.info(
        `buildcache: no cache for key ${unique} or ${withInput} - cold cache or invalid key`
      )
    }
  } catch (e) {
    core.warning(`buildcache: caching not working: ${e}`)
  }
}

async function run(): Promise<void> {
  try {
    const downloadPath = await downloadLatest()
    await install(downloadPath)
    await configure()
    await restore()
    await printConfig()
    await printStats()
    const zeroStatsFlag = core.getInput('zero_buildcache_stats')
    if (zeroStatsFlag && zeroStatsFlag === 'true') {
      core.info(
        'buildcache: zeroing stats - stats display in cleanup task will be for this run only.'
      )
      await zeroStats()
    }
  } catch (e) {
    core.error(`buildcache: failure during restore: ${e}`)
    core.setFailed(e as Error)
  }
}

run()

export default run
