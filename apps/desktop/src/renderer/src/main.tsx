import './index.css'
import './lib/monaco'
import { createRoot } from 'react-dom/client'
import { App } from './App'

createRoot(document.getElementById('root')!).render(<App />)

// Handle for automated QA scripts (tools/qa). Same access DevTools already has.
import { useStore } from './store'
import { session } from './collab/session'
import * as actions from './lib/actions'
import { monaco } from './lib/monaco'
import * as chat from './panels/ChatPanel'
import * as files from './lib/files'
;(window as unknown as Record<string, unknown>).__hive = { store: useStore, session, actions, monaco, chat, files }
