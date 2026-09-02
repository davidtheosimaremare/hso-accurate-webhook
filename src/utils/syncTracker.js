// src/utils/syncTracker.js
// In-memory & DB activity tracker for all sync runs

const supabase = require('./supabase')

class SyncTracker {
  constructor() {
    this.logs = [] // Array of { id, type, target, status, startTime, endTime, durationMs, itemsProcessed, itemsUpdated, errors, details }
    this.maxLogs = 300 // Keep last 300 runs in memory
    this.isSyncing = false
    this.activeTask = null
    this.totalRunsCount = 0
  }

  logStart(type, target) {
    this.isSyncing = true
    this.activeTask = { type, target, startedAt: new Date().toISOString() }
    this.totalRunsCount++

    const logEntry = {
      id: `sync_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
      type, // 'DELTA_5M' | 'HOURLY' | 'NIGHTLY_DEEP' | 'MANUAL_URL' | 'WEBHOOK'
      target, // 'ALL' | 'HRI' | 'HPO' | 'HDO'
      status: 'running', // 'running' | 'success' | 'warning' | 'error'
      startTime: new Date().toISOString(),
      endTime: null,
      durationMs: 0,
      itemsProcessed: 0,
      itemsUpdated: 0,
      errors: [],
      details: null,
    }

    this.logs.unshift(logEntry)
    if (this.logs.length > this.maxLogs) {
      this.logs.pop()
    }

    return logEntry.id
  }

  logEnd(id, result = {}) {
    this.isSyncing = false
    this.activeTask = null

    const log = this.logs.find(l => l.id === id)
    if (!log) return

    log.endTime = new Date().toISOString()
    log.durationMs = Math.max(0, new Date(log.endTime).getTime() - new Date(log.startTime).getTime())
    log.itemsProcessed = result.processed || result.itemsProcessed || 0
    log.itemsUpdated = result.updated || result.itemsUpdated || result.shipmentsUpdated || 0
    log.errors = result.errors || (result.error ? [result.error] : [])
    log.details = result.details || null

    if (log.errors.length > 0 && log.itemsProcessed === 0) {
      log.status = 'error'
    } else if (log.errors.length > 0) {
      log.status = 'warning'
    } else {
      log.status = 'success'
    }

    // Try logging to Supabase accurate_sync_logs table asynchronously (fail-safe)
    this.persistToSupabase(log).catch(() => {})
  }

  async persistToSupabase(log) {
    try {
      await supabase.from('accurate_sync_logs').insert({
        sync_type: log.type,
        target_doc: log.target,
        status: log.status,
        items_processed: log.itemsProcessed,
        items_updated: log.itemsUpdated,
        duration_ms: log.durationMs,
        errors: log.errors.length > 0 ? log.errors.join('; ') : null,
        started_at: log.startTime,
        completed_at: log.endTime,
      })
    } catch {
      // Non-fatal if table does not exist
    }
  }

  getStatus() {
    const today = new Date().toISOString().split('T')[0]
    const todayLogs = this.logs.filter(l => l.startTime && l.startTime.startsWith(today))

    const totalProcessedToday = todayLogs.reduce((sum, l) => sum + (l.itemsProcessed || 0), 0)
    const totalUpdatedToday = todayLogs.reduce((sum, l) => sum + (l.itemsUpdated || 0), 0)
    const totalErrorsToday = todayLogs.filter(l => l.status === 'error' || l.status === 'warning').length

    const lastLog = this.logs[0] || null

    return {
      isSyncing: this.isSyncing,
      activeTask: this.activeTask,
      totalRunsCount: this.totalRunsCount,
      today: {
        date: today,
        totalRuns: todayLogs.length,
        processed: totalProcessedToday,
        updated: totalUpdatedToday,
        errors: totalErrorsToday,
      },
      lastSync: lastLog ? {
        id: lastLog.id,
        type: lastLog.type,
        target: lastLog.target,
        status: lastLog.status,
        time: lastLog.startTime,
        durationMs: lastLog.durationMs,
        processed: lastLog.itemsProcessed,
        updated: lastLog.itemsUpdated,
      } : null,
    }
  }

  getRecentLogs(limit = 100) {
    return this.logs.slice(0, limit)
  }
}

const syncTracker = new SyncTracker()
module.exports = syncTracker
