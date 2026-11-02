import { startRelay } from './relay'

const port = Number(process.env.PORT ?? 4455)
const dataDir = process.env.DATA_DIR ?? './relay-data'

startRelay({ port, dataDir }).then((relay) => {
  const stop = async () => {
    await relay.close()
    process.exit(0)
  }
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
})
