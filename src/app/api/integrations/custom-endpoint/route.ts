import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getDatabase, logAuditEvent } from '@/lib/db'
import { mutationLimiter } from '@/lib/rate-limit'

const BASE_URL_KEY = 'ai.custom_openai_base_url'
const API_KEY_KEY = 'ai.custom_openai_api_key'
const CATEGORY = 'ai'

function getSettings(db: ReturnType<typeof getDatabase>) {
  const rows = db
    .prepare('SELECT key, value FROM settings WHERE key IN (?, ?)')
    .all(BASE_URL_KEY, API_KEY_KEY) as { key: string; value: string }[]

  const map = new Map(rows.map((r) => [r.key, r.value]))
  return {
    base_url: map.get(BASE_URL_KEY) ?? '',
    api_key: map.get(API_KEY_KEY) ?? '',
  }
}

function redactValue(value: string): string {
  if (!value) return ''
  if (value.length <= 4) return '****'
  return '****' + value.slice(-4)
}

// GET /api/integrations/custom-endpoint
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const db = getDatabase()
  const { base_url, api_key } = getSettings(db)

  return NextResponse.json({
    base_url,
    api_key_set: api_key.length > 0,
    api_key_redacted: redactValue(api_key),
  })
}

// PUT /api/integrations/custom-endpoint
// Body: { base_url?: string; api_key?: string }
export async function PUT(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  let body: { base_url?: string; api_key?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Request body required' }, { status: 400 })
  }

  if (body.base_url === undefined && body.api_key === undefined) {
    return NextResponse.json({ error: 'At least one of base_url or api_key required' }, { status: 400 })
  }

  if (body.base_url !== undefined) {
    const url = String(body.base_url).trim()
    if (url && !url.startsWith('http://') && !url.startsWith('https://')) {
      return NextResponse.json({ error: 'base_url must start with http:// or https://' }, { status: 400 })
    }
  }

  const db = getDatabase()
  const upsert = db.prepare(`
    INSERT INTO settings (key, value, description, category, updated_by, updated_at)
    VALUES (?, ?, ?, ?, ?, unixepoch())
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_by = excluded.updated_by,
      updated_at = unixepoch()
  `)

  const updated: string[] = []

  db.transaction(() => {
    if (body.base_url !== undefined) {
      upsert.run(BASE_URL_KEY, String(body.base_url).trim(), 'Custom OpenAI-compatible API base URL', CATEGORY, auth.user.username)
      updated.push('base_url')
    }
    if (body.api_key !== undefined) {
      upsert.run(API_KEY_KEY, String(body.api_key).trim(), 'Custom OpenAI-compatible API key', CATEGORY, auth.user.username)
      updated.push('api_key')
    }
  })()

  const ipAddress = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown'
  logAuditEvent({
    action: 'custom_endpoint_update',
    actor: auth.user.username,
    actor_id: auth.user.id,
    detail: { updated_fields: updated },
    ip_address: ipAddress,
  })

  return NextResponse.json({ updated, count: updated.length })
}

// DELETE /api/integrations/custom-endpoint
// Clears both base_url and api_key
export async function DELETE(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  const db = getDatabase()
  db.prepare('DELETE FROM settings WHERE key IN (?, ?)').run(BASE_URL_KEY, API_KEY_KEY)

  const ipAddress = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown'
  logAuditEvent({
    action: 'custom_endpoint_remove',
    actor: auth.user.username,
    actor_id: auth.user.id,
    detail: {},
    ip_address: ipAddress,
  })

  return NextResponse.json({ ok: true })
}

// POST /api/integrations/custom-endpoint
// Body: { action: 'test' }
export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  let body: { action: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Request body required' }, { status: 400 })
  }

  if (body.action !== 'test') {
    return NextResponse.json({ error: `Unknown action: ${body.action}` }, { status: 400 })
  }

  const db = getDatabase()
  const { base_url, api_key } = getSettings(db)

  if (!base_url) {
    return NextResponse.json({ ok: false, detail: 'Base URL not configured' })
  }

  const normalizedBase = base_url.replace(/\/+$/, '')
  const modelsUrl = `${normalizedBase}/models`

  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (api_key) {
      headers['Authorization'] = `Bearer ${api_key}`
    }

    const res = await fetch(modelsUrl, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(8000),
    })

    if (res.ok) {
      let detail = `Connected (HTTP ${res.status})`
      try {
        const data = await res.json()
        const count = Array.isArray(data?.data) ? data.data.length : null
        if (count !== null) detail = `Connected — ${count} model${count === 1 ? '' : 's'} available`
      } catch {
        // ignore JSON parse error
      }
      return NextResponse.json({ ok: true, detail })
    }

    return NextResponse.json({ ok: false, detail: `HTTP ${res.status} from ${modelsUrl}` })
  } catch (err: any) {
    return NextResponse.json({ ok: false, detail: err.message || 'Connection failed' })
  }
}
