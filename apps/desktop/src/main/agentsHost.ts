import type { ChatChunk, ToolCall } from '@hive/shared'
export { Orchestrator } from '@hive/agents'

/** Drain a model stream into one result, forwarding text as it arrives. */
export async function chatResultFrom(stream: AsyncGenerator<ChatChunk>, onText?: (t: string) => void) {
  let text = ''
  let toolCalls: ToolCall[] | undefined
  let tokensPerSec = 0
  for await (const c of stream) {
    if (c.text) {
      text += c.text
      onText?.(c.text)
    }
    if (c.toolCalls) toolCalls = c.toolCalls
    if (c.tokensPerSec) tokensPerSec = c.tokensPerSec
  }
  return { text, toolCalls, tokensPerSec }
}
