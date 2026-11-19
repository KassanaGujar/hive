import type { ChatChunk, ToolCall } from '@hive/shared'
import { loopingTail } from '@hive/models'
export { Orchestrator } from '@hive/agents'

/** How often (in characters of reply) to check for a reply stuck repeating itself. */
const LOOP_CHECK_EVERY = 400

/**
 * Drain a model stream into one result, forwarding text as it arrives.
 * A reply stuck repeating one block is cut to a single copy and the stream is closed (which aborts the request):
 * on a slow GPU such a reply ran to the 6,144-token cap and took 2.5 hours.
 */
export async function chatResultFrom(stream: AsyncGenerator<ChatChunk>, onText?: (t: string) => void) {
  let text = ''
  let toolCalls: ToolCall[] | undefined
  let tokensPerSec = 0
  let checkedAt = 0
  for await (const c of stream) {
    if (c.text) {
      text += c.text
      onText?.(c.text)
      if (text.length - checkedAt >= LOOP_CHECK_EVERY) {
        checkedAt = text.length
        const cut = loopingTail(text)
        if (cut !== null) {
          console.log(`[agents] stopped a reply that kept repeating itself (${text.length} chars, kept ${cut})`)
          return { text: text.slice(0, cut), toolCalls, tokensPerSec, stoppedLooping: true as const }
        }
      }
    }
    if (c.toolCalls) toolCalls = c.toolCalls
    if (c.tokensPerSec) tokensPerSec = c.tokensPerSec
  }
  return { text, toolCalls, tokensPerSec }
}
