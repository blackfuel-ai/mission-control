/**
 * Custom OpenAI-compatible endpoint configuration.
 *
 * The base URL and API key are stored in the settings table so they persist
 * across restarts and are available server-side without requiring env var changes.
 */

import { getDatabase } from './db'

const BASE_URL_KEY = 'ai.custom_openai_base_url'
const API_KEY_KEY = 'ai.custom_openai_api_key'

export interface CustomEndpointConfig {
  base_url: string
  api_key: string
}

/**
 * Returns the custom OpenAI-compatible endpoint config from the settings table.
 * Returns empty strings when not configured.
 */
export function getCustomEndpointConfig(): CustomEndpointConfig {
  try {
    const db = getDatabase()
    const rows = db
      .prepare('SELECT key, value FROM settings WHERE key IN (?, ?)')
      .all(BASE_URL_KEY, API_KEY_KEY) as { key: string; value: string }[]

    const map = new Map(rows.map((r) => [r.key, r.value]))
    return {
      base_url: map.get(BASE_URL_KEY) ?? '',
      api_key: map.get(API_KEY_KEY) ?? '',
    }
  } catch {
    return { base_url: '', api_key: '' }
  }
}

/**
 * Returns true when a custom OpenAI-compatible endpoint has been configured.
 */
export function hasCustomEndpoint(): boolean {
  const { base_url } = getCustomEndpointConfig()
  return base_url.length > 0
}
