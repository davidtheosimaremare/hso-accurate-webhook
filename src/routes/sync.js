// src/routes/sync.js
// Endpoint untuk trigger sync manual via URL (GET/POST) dan inspect logs

const express = require('express')
const router = express.Router()
const { fullSyncHPO, upsertHPO } = require('../services/syncHPO')
const { fullSyncHRI, upsertHRI } = require('../services/syncHRI')
const { fullSyncHDO, upsertHDO } = require('../services/syncHDO')
const { fetchHPODetail, fetchHRIDetail, fetchHDODetail } = require('../utils/accurate')
const syncTracker = require('../utils/syncTracker')

/**
 * Helper to run sync and record to SyncTracker
 */
async function executeSyncTask(type, target, syncFn, isAsync = false, res = null) {
  const logId = syncTracker.logStart(type, target)
  const startTime = Date.now()

  const runTask = async () => {
    try {
      const result = await syncFn()
      syncTracker.logEnd(logId, result)
      return { success: true, logId, durationMs: Date.now() - startTime, ...result }
    } catch (err) {
      console.error(`❌ [${type}][${target}] Error:`, err.message)
      syncTracker.logEnd(logId, { error: err.message, processed: 0, updated: 0 })
      return { success: false, logId, durationMs: Date.now() - startTime, error: err.message }
    }
  }

  if (isAsync) {
    if (res) {
      res.json({
        success: true,
        message: `Sync ${target} (${type}) sedang berjalan di background...`,
        logId,
        startedAt: new Date().toISOString(),
      })
    }
    setImmediate(runTask)
    return null
  }

  const result = await runTask()
  if (res) {
    res.json(result)
  }
  return result
}

// ==========================================
// 1. STATUS & LOGS APIs
// ==========================================

/**
 * GET /sync/status — Live status tracker
 */
router.get('/status', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    ...syncTracker.getStatus(),
  })
})

/**
 * GET /sync/logs — History data sync per menit / per hari
 */
router.get('/logs', (req, res) => {
  const limit = parseInt(req.query.limit, 10) || 100
  res.json({
    status: 'ok',
    summary: syncTracker.getStatus(),
    logs: syncTracker.getRecentLogs(limit),
  })
})

/**
 * GET /sync/recent-data — Ringkasan data yang baru saja terupdate di Supabase
 */
router.get('/recent-data', async (req, res) => {
  const supabase = require('../utils/supabase')
  try {
    const [ships, hri, hpo, hdo] = await Promise.all([
      supabase.from('shipments').select('id, so_id, hpo_number, item_code, current_status, hokiindo_date, updated_at').order('updated_at', { ascending: false }).limit(10),
      supabase.from('accurate_receive_items').select('id, number, vendor_name, trans_date, status_name, updated_at').order('updated_at', { ascending: false }).limit(8),
      supabase.from('accurate_purchase_orders').select('id, number, vendor_name, trans_date, status_name, updated_at').order('updated_at', { ascending: false }).limit(8),
      supabase.from('accurate_delivery_orders').select('id, number, customer_name, trans_date, status_name, updated_at').order('updated_at', { ascending: false }).limit(8),
    ])

    res.json({
      status: 'ok',
      recentShipments: ships.data || [],
      recentHRI: hri.data || [],
      recentHPO: hpo.data || [],
      recentHDO: hdo.data || [],
    })
  } catch (err) {
    res.status(500).json({ status: 'error', error: err.message })
  }
})

// ==========================================
// 2. TRIGGER SYNC VIA URL (GET & POST)
// ==========================================

/**
 * GET / POST /sync/delta — Sync data hari ini (cepat, per-menit / delta)
 */
async function handleDeltaSync(req, res) {
  const isAsync = req.query.async === 'true'
  const today = new Date().toISOString().split('T')[0]

  await executeSyncTask('DELTA_5M', 'ALL', async () => {
    console.log(`\n⚡ [SYNC-NOW] Delta Sync Hari Ini (${today}) dimulai...`)
    const hriRes = await fullSyncHRI(1, today)
    const hpoRes = await fullSyncHPO(1, today)
    const hdoRes = await fullSyncHDO(1, today)

    return {
      processed: (hriRes.processed || 0) + (hpoRes.processed || 0) + (hdoRes.processed || 0),
      updated: (hriRes.updated || 0) + (hpoRes.updated || 0) + (hdoRes.updated || 0),
      shipmentsUpdated: hriRes.shipmentsUpdated || 0,
      details: { hri: hriRes, hpo: hpoRes, hdo: hdoRes },
      errors: [...(hriRes.errors || []), ...(hpoRes.errors || []), ...(hdoRes.errors || [])],
    }
  }, isAsync, res)
}
router.get('/delta', handleDeltaSync)
router.post('/delta', handleDeltaSync)

/**
 * GET / POST /sync/all — Full sync semua dokumen (HRI + HPO + HDO)
 * Query: ?days=30 (default 30), ?async=false
 */
async function handleSyncAll(req, res) {
  const daysBack = parseInt(req.query.days, 10) || parseInt(process.env.SYNC_DAYS_BACK, 10) || 30
  const isAsync = req.query.async === 'true'

  await executeSyncTask('MANUAL_URL', 'ALL', async () => {
    console.log(`\n🚀 [SYNC-NOW] Full Sync ALL dimulai (${daysBack} hari ke belakang)...`)
    const hriRes = await fullSyncHRI(daysBack)
    const hpoRes = await fullSyncHPO(daysBack)
    const hdoRes = await fullSyncHDO(daysBack)

    return {
      processed: (hriRes.processed || 0) + (hpoRes.processed || 0) + (hdoRes.processed || 0),
      updated: (hriRes.updated || 0) + (hpoRes.updated || 0) + (hdoRes.updated || 0),
      shipmentsUpdated: hriRes.shipmentsUpdated || 0,
      details: { hri: hriRes, hpo: hpoRes, hdo: hdoRes },
      errors: [...(hriRes.errors || []), ...(hpoRes.errors || []), ...(hdoRes.errors || [])],
    }
  }, isAsync, res)
}
router.get('/all', handleSyncAll)
router.post('/all', handleSyncAll)

/**
 * GET / POST /sync/hri — Sync Receive Items & Shipments
 */
async function handleSyncHri(req, res) {
  const daysBack = parseInt(req.query.days, 10) || 30
  const fromDate = req.query.fromDate || null
  const isAsync = req.query.async === 'true'

  await executeSyncTask('MANUAL_URL', 'HRI', async () => {
    return fullSyncHRI(daysBack, fromDate)
  }, isAsync, res)
}
router.get('/hri', handleSyncHri)
router.post('/hri', handleSyncHri)

/**
 * GET / POST /sync/hpo — Sync Purchase Orders
 */
async function handleSyncHpo(req, res) {
  const daysBack = parseInt(req.query.days, 10) || 30
  const fromDate = req.query.fromDate || null
  const isAsync = req.query.async === 'true'

  await executeSyncTask('MANUAL_URL', 'HPO', async () => {
    return fullSyncHPO(daysBack, fromDate)
  }, isAsync, res)
}
router.get('/hpo', handleSyncHpo)
router.post('/hpo', handleSyncHpo)

/**
 * GET / POST /sync/hdo — Sync Delivery Orders
 */
async function handleSyncHdo(req, res) {
  const daysBack = parseInt(req.query.days, 10) || 30
  const fromDate = req.query.fromDate || null
  const isAsync = req.query.async === 'true'

  await executeSyncTask('MANUAL_URL', 'HDO', async () => {
    return fullSyncHDO(daysBack, fromDate)
  }, isAsync, res)
}
router.get('/hdo', handleSyncHdo)
router.post('/hdo', handleSyncHdo)

// ==========================================
// 3. SINGLE DOCUMENT SYNC BY ID
// ==========================================

router.get('/hpo/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10)
  try {
    const detail = await fetchHPODetail(id)
    const result = await upsertHPO(detail)
    res.json({ success: true, ...result })
  } catch (err) {
    res.status(500).json({ success: false, error: err.message })
  }
})

router.get('/hri/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10)
  try {
    const detail = await fetchHRIDetail(id)
    const result = await upsertHRI(detail)
    res.json({ success: true, ...result })
  } catch (err) {
    res.status(500).json({ success: false, error: err.message })
  }
})

router.get('/hdo/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10)
  try {
    const detail = await fetchHDODetail(id)
    const result = await upsertHDO(detail)
    res.json({ success: true, ...result })
  } catch (err) {
    res.status(500).json({ success: false, error: err.message })
  }
})

module.exports = router
