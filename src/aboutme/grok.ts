// aboutme/gpt.ts
import { Hono } from 'hono'

const gpt = new Hono()

const GROQ_API_KEY = 'REDACTED' // replace after revoking old one
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions'
const MODEL = 'llama-3.3-70b-versatile'

async function callGroq(messages: { role: string; content: string }[]) {
  const response = await fetch(GROQ_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${GROQ_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ model: MODEL, messages })
  })
  if (!response.ok) throw new Error(`Groq error: ${response.statusText}`)
  const data = await response.json()
  return data.choices[0].message.content
}

gpt.post('/chat', async (c) => {
  try {
    const { prompt, systemPrompt } = await c.req.json()
    if (!prompt) return c.json({ error: 'Prompt is required' }, 400)

    const messages = [
      { role: 'system', content: systemPrompt || 'You are a helpful AI assistant.' },
      { role: 'user', content: prompt }
    ]

    const text = await callGroq(messages)
    return c.json({ success: true, data: text })
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500)
  }
})

gpt.post('/structured', async (c) => {
  try {
    const { prompt } = await c.req.json()

    const messages = [
      { role: 'system', content: 'Respond only with valid JSON, no markdown or explanation.' },
      { role: 'user', content: prompt }
    ]

    const text = await callGroq(messages)
    return c.json({ success: true, data: JSON.parse(text) })
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500)
  }
})

export { gpt }