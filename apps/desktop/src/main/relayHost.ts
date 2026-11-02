import { app } from 'electron'
import os from 'node:os'
import path from 'node:path'
import { startRelay, type RelayHandle } from '@hive/relay'

/**
 * "Host the relay on my PC" option: runs the same relay inside Hive. Friends on the same Wi-Fi can
 * use the LAN address directly; friends elsewhere need a tunnel (see docs/relay-hosting.md).
 */
let relay: RelayHandle | null = null

function lanUrls(port: number) {
  const urls = [`ws://localhost:${port}`]
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list ?? []) if (i.family === 'IPv4' && !i.internal) urls.push(`ws://${i.address}:${port}`)
  }
  return urls
}

export async function startLocalRelay() {
  if (!relay) relay = await startRelay({ port: 4455, dataDir: path.join(app.getPath('userData'), 'relay-data'), log: (m) => console.log('[relay]', m) })
  return { port: relay.port, urls: lanUrls(relay.port) }
}

export async function stopLocalRelay() {
  await relay?.close()
  relay = null
}

export function localRelayStatus() {
  return relay ? { running: true, port: relay.port, urls: lanUrls(relay.port) } : { running: false, urls: [] }
}
