'use client'

import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'

// ---------------------------------------------------------------------------
// Custom OpenAI-compatible endpoint state
// ---------------------------------------------------------------------------

interface CustomEndpointState {
  base_url: string
  api_key_set: boolean
  api_key_redacted: string
}

interface EnvVarInfo {
  redacted: string
  set: boolean
}

interface Integration {
  id: string
  name: string
  category: string
  categoryLabel: string
  envVars: Record<string, EnvVarInfo>
  status: 'connected' | 'partial' | 'not_configured'
  vaultItem: string | null
  testable: boolean
  recommendation?: string | null
}

interface Category {
  id: string
  label: string
}

export function IntegrationsPanel() {
  const [integrations, setIntegrations] = useState<Integration[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [opAvailable, setOpAvailable] = useState(false)
  const [envPath, setEnvPath] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeCategory, setActiveCategory] = useState<string>('ai')

  // Edits: integration id -> env var key -> new value
  const [edits, setEdits] = useState<Record<string, string>>({})
  const [revealed, setRevealed] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null)
  const [testing, setTesting] = useState<string | null>(null) // integration id being tested
  const [pulling, setPulling] = useState<string | null>(null) // integration id being pulled
  const [pullingAll, setPullingAll] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState<{ integrationId: string; keys: string[] } | null>(null)

  // Custom OpenAI-compatible endpoint state
  const [customEndpoint, setCustomEndpoint] = useState<CustomEndpointState | null>(null)
  const [customEndpointEdits, setCustomEndpointEdits] = useState<{ base_url?: string; api_key?: string }>({})
  const [customEndpointSaving, setCustomEndpointSaving] = useState(false)
  const [customEndpointTesting, setCustomEndpointTesting] = useState(false)
  const [customEndpointRemoving, setCustomEndpointRemoving] = useState(false)
  const [revealApiKey, setRevealApiKey] = useState(false)

  const showFeedback = (ok: boolean, text: string) => {
    setFeedback({ ok, text })
    setTimeout(() => setFeedback(null), 3000)
  }

  const fetchIntegrations = useCallback(async () => {
    try {
      const res = await fetch('/api/integrations')
      if (res.status === 401 || res.status === 403) {
        setError('Admin access required')
        return
      }
      if (!res.ok) {
        setError('Failed to load integrations')
        return
      }
      const data = await res.json()
      setIntegrations(data.integrations || [])
      setCategories(data.categories || [])
      setOpAvailable(data.opAvailable ?? false)
      setEnvPath(data.envPath ?? null)
      if (data.categories?.[0]) {
        setActiveCategory(prev => {
          // Keep current if valid, otherwise default to first
          const ids = (data.categories as Category[]).map((c: Category) => c.id)
          return ids.includes(prev) ? prev : ids[0]
        })
      }
    } catch {
      setError('Failed to load integrations')
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchCustomEndpoint = useCallback(async () => {
    try {
      const res = await fetch('/api/integrations/custom-endpoint')
      if (res.ok) {
        const data = await res.json()
        setCustomEndpoint(data)
      }
    } catch {
      // silent — custom endpoint is optional
    }
  }, [])

  useEffect(() => { fetchIntegrations() }, [fetchIntegrations])
  useEffect(() => { fetchCustomEndpoint() }, [fetchCustomEndpoint])

  const handleSaveCustomEndpoint = async () => {
    if (Object.keys(customEndpointEdits).length === 0) return
    setCustomEndpointSaving(true)
    try {
      const res = await fetch('/api/integrations/custom-endpoint', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(customEndpointEdits),
      })
      const data = await res.json()
      if (res.ok) {
        showFeedback(true, 'Custom endpoint saved')
        setCustomEndpointEdits({})
        setRevealApiKey(false)
        fetchCustomEndpoint()
      } else {
        showFeedback(false, data.error || 'Failed to save')
      }
    } catch {
      showFeedback(false, 'Network error')
    } finally {
      setCustomEndpointSaving(false)
    }
  }

  const handleTestCustomEndpoint = async () => {
    setCustomEndpointTesting(true)
    try {
      const res = await fetch('/api/integrations/custom-endpoint', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'test' }),
      })
      const data = await res.json()
      if (data.ok) {
        showFeedback(true, data.detail || 'Connection successful')
      } else {
        showFeedback(false, data.detail || 'Test failed')
      }
    } catch {
      showFeedback(false, 'Network error')
    } finally {
      setCustomEndpointTesting(false)
    }
  }

  const handleRemoveCustomEndpoint = async () => {
    setCustomEndpointRemoving(true)
    try {
      const res = await fetch('/api/integrations/custom-endpoint', { method: 'DELETE' })
      if (res.ok) {
        showFeedback(true, 'Custom endpoint removed')
        setCustomEndpointEdits({})
        setRevealApiKey(false)
        fetchCustomEndpoint()
      } else {
        const data = await res.json()
        showFeedback(false, data.error || 'Failed to remove')
      }
    } catch {
      showFeedback(false, 'Network error')
    } finally {
      setCustomEndpointRemoving(false)
    }
  }

  const handleEdit = (envKey: string, value: string) => {
    setEdits(prev => ({ ...prev, [envKey]: value }))
  }

  const cancelEdit = (envKey: string) => {
    setEdits(prev => {
      const next = { ...prev }
      delete next[envKey]
      return next
    })
  }

  const toggleReveal = (envKey: string) => {
    setRevealed(prev => {
      const next = new Set(prev)
      if (next.has(envKey)) next.delete(envKey)
      else next.add(envKey)
      return next
    })
  }

  const hasChanges = Object.keys(edits).length > 0

  const handleSave = async () => {
    if (!hasChanges) return
    setSaving(true)
    try {
      const res = await fetch('/api/integrations', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vars: edits }),
      })
      const data = await res.json()
      if (res.ok) {
        showFeedback(true, `Saved ${data.count} variable${data.count === 1 ? '' : 's'}`)
        setEdits({})
        setRevealed(new Set())
        fetchIntegrations()
      } else {
        showFeedback(false, data.error || 'Failed to save')
      }
    } catch {
      showFeedback(false, 'Network error')
    } finally {
      setSaving(false)
    }
  }

  const handleDiscard = () => {
    setEdits({})
    setRevealed(new Set())
  }

  const handleRemove = async (envKeys: string[]) => {
    try {
      const res = await fetch(`/api/integrations?keys=${encodeURIComponent(envKeys.join(','))}`, {
        method: 'DELETE',
      })
      const data = await res.json()
      if (res.ok) {
        showFeedback(true, `Removed ${data.count} variable${data.count === 1 ? '' : 's'}`)
        fetchIntegrations()
      } else {
        showFeedback(false, data.error || 'Failed to remove')
      }
    } catch {
      showFeedback(false, 'Network error')
    }
  }

  const handleTest = async (integrationId: string) => {
    setTesting(integrationId)
    try {
      const res = await fetch('/api/integrations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'test', integrationId }),
      })
      const data = await res.json()
      if (data.ok) {
        showFeedback(true, data.detail || 'Connection successful')
      } else {
        showFeedback(false, data.detail || data.error || 'Test failed')
      }
    } catch {
      showFeedback(false, 'Network error')
    } finally {
      setTesting(null)
    }
  }

  const handlePull = async (integrationId: string) => {
    setPulling(integrationId)
    try {
      const res = await fetch('/api/integrations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'pull', integrationId }),
      })
      const data = await res.json()
      if (data.ok) {
        showFeedback(true, data.detail || 'Pulled from 1Password')
        fetchIntegrations()
      } else {
        showFeedback(false, data.error || 'Pull failed')
      }
    } catch {
      showFeedback(false, 'Network error')
    } finally {
      setPulling(null)
    }
  }

  const handlePullAll = async () => {
    setPullingAll(true)
    try {
      const res = await fetch('/api/integrations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'pull-all', category: activeCategory }),
      })
      const data = await res.json()
      if (data.ok) {
        showFeedback(true, data.detail || 'Pulled from 1Password')
        fetchIntegrations()
      } else {
        showFeedback(false, data.error || 'Pull failed')
      }
    } catch {
      showFeedback(false, 'Network error')
    } finally {
      setPullingAll(false)
    }
  }

  const confirmAndRemove = (integrationId: string, keys: string[]) => {
    setConfirmRemove({ integrationId, keys })
  }

  // Loading state
  if (loading) {
    return (
      <div className="p-6 flex items-center gap-2">
        <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        <span className="text-sm text-muted-foreground">Loading integrations...</span>
      </div>
    )
  }

  // Error state
  if (error) {
    return (
      <div className="p-6">
        <div className="bg-destructive/10 text-destructive rounded-lg p-4 text-sm">{error}</div>
      </div>
    )
  }

  const filteredIntegrations = integrations.filter(i => i.category === activeCategory)
  const connectedCount = integrations.filter(i => i.status === 'connected').length

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Integrations</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {connectedCount} of {integrations.length} connected
            {envPath && <span className="ml-2 font-mono text-muted-foreground/50">{envPath}</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {opAvailable && (
            <>
              <span className="text-2xs px-2 py-1 rounded bg-green-500/10 text-green-400 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                1P CLI
              </span>
              <Button
                onClick={handlePullAll}
                disabled={pullingAll}
                variant="outline"
                size="sm"
                className="flex items-center gap-1.5"
                title="Pull all vault-backed integrations in this category from 1Password"
              >
                {pullingAll ? (
                  <div className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
                ) : (
                  <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M8 2v8M5 7l3 3 3-3" />
                    <path d="M3 12v2h10v-2" />
                  </svg>
                )}
                Pull All
              </Button>
            </>
          )}
          {hasChanges && (
            <Button
              onClick={handleDiscard}
              variant="outline"
              size="sm"
            >
              Discard
            </Button>
          )}
          <Button
            onClick={handleSave}
            disabled={!hasChanges || saving}
            variant={hasChanges ? 'default' : 'secondary'}
            size="sm"
            className={!hasChanges ? 'cursor-not-allowed' : ''}
          >
            {saving ? 'Saving...' : 'Save Changes'}
          </Button>
        </div>
      </div>

      {/* Feedback */}
      {feedback && (
        <div className={`rounded-lg p-3 text-xs font-medium ${
          feedback.ok ? 'bg-green-500/10 text-green-400' : 'bg-destructive/10 text-destructive'
        }`}>
          {feedback.text}
        </div>
      )}

      {/* Category tabs */}
      <div className="flex gap-1 border-b border-border pb-px overflow-x-auto">
        {categories.map(cat => {
          const catIntegrations = integrations.filter(i => i.category === cat.id)
          const catConnected = catIntegrations.filter(i => i.status === 'connected').length
          return (
            <Button
              key={cat.id}
              onClick={() => setActiveCategory(cat.id)}
              variant="ghost"
              size="sm"
              className={`rounded-t-md rounded-b-none relative whitespace-nowrap ${
                activeCategory === cat.id
                  ? 'bg-card text-foreground border border-border border-b-card -mb-px'
                  : ''
              }`}
            >
              {cat.label}
              {catConnected > 0 && (
                <span className="ml-1.5 inline-flex items-center justify-center min-w-[16px] h-4 text-2xs rounded-full bg-green-500/15 text-green-400 px-1">
                  {catConnected}
                </span>
              )}
            </Button>
          )
        })}
      </div>

      {/* Integration cards */}
      <div className="space-y-3">
        {filteredIntegrations.map(integration => (
          <IntegrationCard
            key={integration.id}
            integration={integration}
            edits={edits}
            revealed={revealed}
            opAvailable={opAvailable}
            testing={testing === integration.id}
            pulling={pulling === integration.id}
            onEdit={handleEdit}
            onCancelEdit={cancelEdit}
            onToggleReveal={toggleReveal}
            onTest={() => handleTest(integration.id)}
            onPull={() => handlePull(integration.id)}
            onRemove={() => {
              const setKeys = Object.entries(integration.envVars)
                .filter(([, v]) => v.set)
                .map(([k]) => k)
              if (setKeys.length > 0) confirmAndRemove(integration.id, setKeys)
            }}
          />
        ))}
        {filteredIntegrations.length === 0 && (
          <div className="text-sm text-muted-foreground text-center py-8">
            No integrations in this category
          </div>
        )}

        {/* Custom OpenAI-compatible endpoint card — shown in the AI category */}
        {activeCategory === 'ai' && customEndpoint !== null && (
          <CustomEndpointCard
            endpoint={customEndpoint}
            edits={customEndpointEdits}
            revealApiKey={revealApiKey}
            saving={customEndpointSaving}
            testing={customEndpointTesting}
            removing={customEndpointRemoving}
            onChangeBaseUrl={(v) => setCustomEndpointEdits(prev => ({ ...prev, base_url: v }))}
            onChangeApiKey={(v) => setCustomEndpointEdits(prev => ({ ...prev, api_key: v }))}
            onCancelApiKeyEdit={() => setCustomEndpointEdits(prev => { const next = { ...prev }; delete next.api_key; return next })}
            onToggleReveal={() => setRevealApiKey(prev => !prev)}
            onSave={handleSaveCustomEndpoint}
            onTest={handleTestCustomEndpoint}
            onRemove={handleRemoveCustomEndpoint}
            onDiscard={() => { setCustomEndpointEdits({}); setRevealApiKey(false) }}
          />
        )}
      </div>

      {/* Unsaved changes bar */}
      {hasChanges && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 bg-card border border-border rounded-lg shadow-lg px-4 py-2.5 flex items-center gap-3 z-40">
          <div className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
          <span className="text-xs text-foreground">
            {Object.keys(edits).length} unsaved change{Object.keys(edits).length === 1 ? '' : 's'}
          </span>
          <Button
            onClick={handleDiscard}
            variant="ghost"
            size="xs"
          >
            Discard
          </Button>
          <Button
            onClick={handleSave}
            disabled={saving}
            size="xs"
          >
            {saving ? 'Saving...' : 'Save'}
          </Button>
        </div>
      )}

      {/* Remove confirmation dialog */}
      {confirmRemove && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-card border border-border rounded-lg shadow-xl p-5 max-w-sm mx-4 space-y-4">
            <h3 className="text-sm font-semibold text-foreground">Remove integration?</h3>
            <p className="text-xs text-muted-foreground">
              This will remove {confirmRemove.keys.length === 1 ? (
                <span className="font-mono text-foreground">{confirmRemove.keys[0]}</span>
              ) : (
                <span>{confirmRemove.keys.length} variables</span>
              )} from the .env file. The gateway must be restarted for changes to take effect.
            </p>
            <div className="flex justify-end gap-2">
              <Button
                onClick={() => setConfirmRemove(null)}
                variant="outline"
                size="sm"
              >
                Cancel
              </Button>
              <Button
                onClick={() => {
                  handleRemove(confirmRemove.keys)
                  setConfirmRemove(null)
                }}
                variant="destructive"
                size="sm"
              >
                Remove
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Custom OpenAI-compatible endpoint card
// ---------------------------------------------------------------------------

function CustomEndpointCard({
  endpoint,
  edits,
  revealApiKey,
  saving,
  testing,
  removing,
  onChangeBaseUrl,
  onChangeApiKey,
  onCancelApiKeyEdit,
  onToggleReveal,
  onSave,
  onTest,
  onRemove,
  onDiscard,
}: {
  endpoint: CustomEndpointState
  edits: { base_url?: string; api_key?: string }
  revealApiKey: boolean
  saving: boolean
  testing: boolean
  removing: boolean
  onChangeBaseUrl: (v: string) => void
  onChangeApiKey: (v: string) => void
  onCancelApiKeyEdit: () => void
  onToggleReveal: () => void
  onSave: () => void
  onTest: () => void
  onRemove: () => void
  onDiscard: () => void
}) {
  const hasEdits = Object.keys(edits).length > 0
  const effectiveBaseUrl = edits.base_url !== undefined ? edits.base_url : endpoint.base_url
  const isConfigured = endpoint.base_url.length > 0 || endpoint.api_key_set

  const status = isConfigured ? 'connected' : 'not_configured'
  const statusColors = {
    connected: 'bg-green-500',
    not_configured: 'bg-muted-foreground/30',
  }
  const statusLabels = {
    connected: 'Configured',
    not_configured: 'Not configured',
  }

  return (
    <div className={`bg-card border rounded-lg p-4 transition-colors ${hasEdits ? 'border-primary/50' : 'border-border'}`}>
      {/* Card header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2.5">
          <span className={`w-2 h-2 rounded-full shrink-0 ${statusColors[status]}`} />
          <span className="text-sm font-medium text-foreground">Custom OpenAI-Compatible Endpoint</span>
          <span className="text-2xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
            {statusLabels[status]}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          {isConfigured && (
            <Button
              onClick={onTest}
              disabled={testing || hasEdits}
              title="Test connection"
              variant="outline"
              size="xs"
              className="text-2xs flex items-center gap-1"
            >
              {testing ? (
                <div className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin" />
              ) : (
                <svg className="w-3 h-3" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M13 3L6 14" />
                  <polyline points="6,3 6,8 1,8" />
                  <polyline points="10,8 15,8 15,13" />
                </svg>
              )}
              Test
            </Button>
          )}
          {isConfigured && !hasEdits && (
            <Button
              onClick={onRemove}
              disabled={removing}
              title="Remove custom endpoint"
              variant="outline"
              size="xs"
              className="text-2xs hover:text-destructive hover:border-destructive/50"
            >
              {removing ? 'Removing...' : 'Remove'}
            </Button>
          )}
          {hasEdits && (
            <Button onClick={onDiscard} variant="outline" size="xs" className="text-2xs">
              Discard
            </Button>
          )}
          {hasEdits && (
            <Button onClick={onSave} disabled={saving} size="xs" className="text-2xs">
              {saving ? 'Saving...' : 'Save'}
            </Button>
          )}
        </div>
      </div>

      {/* Description */}
      <p className="text-2xs text-muted-foreground mb-3">
        Override the default OpenAI API endpoint with any OpenAI-compatible API (e.g.{' '}
        <span className="font-mono text-muted-foreground/80">https://api.fuel1.ai/v1</span>).
        When configured, this endpoint is used for OpenAI-compatible API calls.
      </p>

      {/* Fields */}
      <div className="space-y-2">
        {/* Base URL */}
        <div className="flex items-center gap-2">
          <span className="text-2xs font-mono text-muted-foreground/70 w-48 shrink-0">Base URL</span>
          <div className="flex-1 flex items-center gap-1.5">
            <input
              type="text"
              value={effectiveBaseUrl}
              onChange={e => onChangeBaseUrl(e.target.value)}
              placeholder="https://api.fuel1.ai/v1"
              className="flex-1 px-2 py-1 text-xs bg-background border border-border rounded focus:border-primary focus:outline-none font-mono"
              autoComplete="off"
              data-1p-ignore
            />
          </div>
        </div>

        {/* API Key */}
        <div className="flex items-center gap-2">
          <span className="text-2xs font-mono text-muted-foreground/70 w-48 shrink-0">API Key</span>
          <div className="flex-1 flex items-center gap-1.5">
            {edits.api_key !== undefined ? (
              <input
                type={revealApiKey ? 'text' : 'password'}
                value={edits.api_key}
                onChange={e => onChangeApiKey(e.target.value)}
                placeholder="Enter API key..."
                className="flex-1 px-2 py-1 text-xs bg-background border border-primary/50 rounded focus:border-primary focus:outline-none font-mono"
                autoComplete="off"
                data-1p-ignore
              />
            ) : endpoint.api_key_set ? (
              <span className="text-xs font-mono text-muted-foreground">{endpoint.api_key_redacted}</span>
            ) : (
              <span className="text-xs text-muted-foreground/50 italic">not set</span>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {edits.api_key !== undefined && (
              <Button
                onClick={onToggleReveal}
                title={revealApiKey ? 'Hide value' : 'Show value'}
                variant="ghost"
                size="icon-xs"
                className="w-6 h-6"
              >
                {revealApiKey ? <EyeOffIcon /> : <EyeIcon />}
              </Button>
            )}
            {edits.api_key === undefined && (
              <Button
                onClick={() => onChangeApiKey('')}
                title="Edit API key"
                variant="ghost"
                size="icon-xs"
                className="w-6 h-6"
              >
                <EditIcon />
              </Button>
            )}
            {edits.api_key !== undefined && (
              <Button
                onClick={onCancelApiKeyEdit}
                title="Cancel edit"
                variant="ghost"
                size="icon-xs"
                className="w-6 h-6 hover:text-destructive"
              >
                <XIcon />
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Integration card component
// ---------------------------------------------------------------------------

function IntegrationCard({
  integration,
  edits,
  revealed,
  opAvailable,
  testing,
  pulling,
  onEdit,
  onCancelEdit,
  onToggleReveal,
  onTest,
  onPull,
  onRemove,
}: {
  integration: Integration
  edits: Record<string, string>
  revealed: Set<string>
  opAvailable: boolean
  testing: boolean
  pulling: boolean
  onEdit: (key: string, value: string) => void
  onCancelEdit: (key: string) => void
  onToggleReveal: (key: string) => void
  onTest: () => void
  onPull: () => void
  onRemove: () => void
}) {
  const statusColors = {
    connected: 'bg-green-500',
    partial: 'bg-amber-500',
    not_configured: 'bg-muted-foreground/30',
  }

  const statusLabels = {
    connected: 'Connected',
    partial: 'Partial',
    not_configured: 'Not configured',
  }

  const hasEdits = Object.keys(integration.envVars).some(k => edits[k] !== undefined)
  const hasSetVars = Object.values(integration.envVars).some(v => v.set)

  return (
    <div className={`bg-card border rounded-lg p-4 transition-colors ${
      hasEdits ? 'border-primary/50' : 'border-border'
    }`}>
      {/* Card header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2.5">
          <span className={`w-2 h-2 rounded-full shrink-0 ${statusColors[integration.status]}`} />
          <span className="text-sm font-medium text-foreground">{integration.name}</span>
          <span className="text-2xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
            {statusLabels[integration.status]}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          {/* Pull from 1Password */}
          {integration.vaultItem && opAvailable && (
            <Button
              onClick={onPull}
              disabled={pulling}
              title="Pull from 1Password"
              variant="outline"
              size="xs"
              className="text-2xs flex items-center gap-1"
            >
              {pulling ? (
                <div className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin" />
              ) : (
                <svg className="w-3 h-3" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M8 2v8M5 7l3 3 3-3" />
                  <path d="M3 12v2h10v-2" />
                </svg>
              )}
              1P
            </Button>
          )}

          {/* Test connection */}
          {integration.testable && hasSetVars && (
            <Button
              onClick={onTest}
              disabled={testing}
              title="Test connection"
              variant="outline"
              size="xs"
              className="text-2xs flex items-center gap-1"
            >
              {testing ? (
                <div className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin" />
              ) : (
                <svg className="w-3 h-3" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M13 3L6 14" />
                  <polyline points="6,3 6,8 1,8" />
                  <polyline points="10,8 15,8 15,13" />
                </svg>
              )}
              Test
            </Button>
          )}

          {/* Remove */}
          {hasSetVars && (
            <Button
              onClick={onRemove}
              title="Remove from .env"
              variant="outline"
              size="xs"
              className="text-2xs hover:text-destructive hover:border-destructive/50"
            >
              Remove
            </Button>
          )}
        </div>
      </div>

      {/* Env var rows */}
      <div className="space-y-2">
        {Object.entries(integration.envVars).map(([envKey, info]) => {
          const isEditing = edits[envKey] !== undefined
          const isRevealed = revealed.has(envKey)

          return (
            <div key={envKey} className="flex items-center gap-2">
              <span className="text-2xs font-mono text-muted-foreground/70 w-48 truncate shrink-0" title={envKey}>
                {envKey}
              </span>

              <div className="flex-1 flex items-center gap-1.5">
                {isEditing ? (
                  <input
                    type={isRevealed ? 'text' : 'password'}
                    value={edits[envKey]}
                    onChange={e => onEdit(envKey, e.target.value)}
                    placeholder="Enter value..."
                    className="flex-1 px-2 py-1 text-xs bg-background border border-primary/50 rounded focus:border-primary focus:outline-none font-mono"
                    autoComplete="off"
                    data-1p-ignore
                  />
                ) : info.set ? (
                  <span className="text-xs font-mono text-muted-foreground">{info.redacted}</span>
                ) : (
                  <span className="text-xs text-muted-foreground/50 italic">not set</span>
                )}
              </div>

              <div className="flex items-center gap-1 shrink-0">
                {/* Reveal toggle (only when editing) */}
                {isEditing && (
                  <Button
                    onClick={() => onToggleReveal(envKey)}
                    title={isRevealed ? 'Hide value' : 'Show value'}
                    variant="ghost"
                    size="icon-xs"
                    className="w-6 h-6"
                  >
                    {isRevealed ? <EyeOffIcon /> : <EyeIcon />}
                  </Button>
                )}

                {/* Edit button */}
                {!isEditing && (
                  <Button
                    onClick={() => onEdit(envKey, '')}
                    title="Edit value"
                    variant="ghost"
                    size="icon-xs"
                    className="w-6 h-6"
                  >
                    <EditIcon />
                  </Button>
                )}

                {/* Cancel edit */}
                {isEditing && (
                  <Button
                    onClick={() => onCancelEdit(envKey)}
                    title="Cancel edit"
                    variant="ghost"
                    size="icon-xs"
                    className="w-6 h-6 hover:text-destructive"
                  >
                    <XIcon />
                  </Button>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {integration.recommendation && (
        <div className="mt-3 rounded-md border border-border/60 bg-secondary/30 px-2.5 py-2">
          <p className="text-2xs text-muted-foreground">{integration.recommendation}</p>
          {integration.id === 'x_twitter' && (
            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-2xs">
              <a
                href="https://github.com/0xNyk/xint"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline"
              >
                github.com/0xNyk/xint
              </a>
              <a
                href="https://github.com/0xNyk/xint-rs"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline"
              >
                github.com/0xNyk/xint-rs
              </a>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Inline SVG icons (matching nav-rail pattern: 16x16, stroke-based)
// ---------------------------------------------------------------------------

function EyeIcon() {
  return (
    <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z" />
      <circle cx="8" cy="8" r="2" />
    </svg>
  )
}

function EyeOffIcon() {
  return (
    <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 2l12 12" />
      <path d="M6.5 6.5a2 2 0 002.8 2.8" />
      <path d="M4.2 4.2C2.5 5.5 1 8 1 8s2.5 5 7 5c1.3 0 2.4-.4 3.4-1" />
      <path d="M11.8 11.8C13.5 10.5 15 8 15 8s-2.5-5-7-5c-.7 0-1.4.1-2 .3" />
    </svg>
  )
}

function EditIcon() {
  return (
    <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11.5 1.5l3 3L5 14H2v-3l9.5-9.5z" />
    </svg>
  )
}

function XIcon() {
  return (
    <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
  )
}
