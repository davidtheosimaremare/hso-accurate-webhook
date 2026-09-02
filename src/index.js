// src/index.js — Entry point HSO Accurate Background Sync Engine
require('dotenv').config()

const express = require('express')
const cors = require('cors')
const cron = require('node-cron')

const dashboardRoutes = require('./routes/dashboard')
const syncRoutes = require('./routes/sync')
const { fullSyncHPO } = require('./services/syncHPO')
const { fullSyncHRI } = require('./services/syncHRI')
const { fullSyncHDO } = require('./services/syncHDO')
const syncTracker = require('./utils/syncTracker')

const app = express()
const PORT = process.env.PORT || 3001

// ===========================
// Middleware
// ===========================
app.use(cors({ origin: '*' }))
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true }))

// Request logger
app.use((req, res, next) => {
  if (req.path !== '/health' && req.path !== '/sync/status' && req.path !== '/sync/logs') {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`)
  }
  next()
})

// ===========================
// Routes
// ===========================
app.use('/', dashboardRoutes)
app.use('/sync', syncRoutes)

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'hso-accurate-sync',
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
    syncStatus: syncTracker.getStatus(),
  })
})

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: `Route ${req.path} tidak ditemukan` })
})

// Global Error handler
app.use((err, req, res, next) => {
  console.error('💥 Unhandled server error:', err.message)
  res.status(500).json({ error: 'Internal server error', details: err.message })
})

// ===========================
// Cron Jobs — Scheduled Sync
// ===========================

// ── 1. DELTA SYNC (Tiap 5 Menit) ──────────────────────────────────────────
// Mengambil transaksi yang dibuat / diupdate hari ini (cepat & ringan)
cron.schedule('*/5 * * * *', async () => {
  if (syncTracker.isSyncing) {
    console.log('⏳ [DELTA] Sync sebelumnya masih berjalan, lewati putaran ini...')
    return
  }

  const logId = syncTracker.logStart('DELTA_5M', 'ALL')
  const today = new Date().toISOString().split('T')[0]
  console.log(`\n⚡ [DELTA] Sync 5-menit dimulai (${today})...`)

  try {
    // 1. Sync HRI (update status shipments di HSO)
    const hriRes = await fullSyncHRI(1, today)

    // 2. Sync HPO (update purchase orders)
    await new Promise(r => setTimeout(r, 2000))
    const hpoRes = await fullSyncHPO(1, today)

    // 3. Sync HDO (update surat jalan)
    await new Promise(r => setTimeout(r, 2000))
    const hdoRes = await fullSyncHDO(1, today)

    const totalProcessed = (hriRes.processed || 0) + (hpoRes.processed || 0) + (hdoRes.processed || 0)
    const totalUpdated = (hriRes.updated || 0) + (hpoRes.updated || 0) + (hdoRes.updated || 0)

    syncTracker.logEnd(logId, {
      processed: totalProcessed,
      updated: totalUpdated,
      shipmentsUpdated: hriRes.shipmentsUpdated || 0,
      errors: [...(hriRes.errors || []), ...(hpoRes.errors || []), ...(hdoRes.errors || [])],
    })

    console.log(`⚡ [DELTA] Sync 5-menit selesai! (${totalProcessed} doc, ${hriRes.shipmentsUpdated || 0} shipments updated)`)
  } catch (err) {
    console.error('❌ [DELTA] Sync error:', err.message)
    syncTracker.logEnd(logId, { error: err.message, processed: 0, updated: 0 })
  }
})

// ── 2. HOURLY SYNC (Tiap 1 Jam) ───────────────────────────────────────────
// Safety net: sync data 2 hari terakhir untuk antisipasi delay posting
cron.schedule('0 * * * *', async () => {
  const logId = syncTracker.logStart('HOURLY', 'HRI')
  console.log('\n⏰ [HOURLY] Sync HRI (2 hari terakhir) dimulai...')
  try {
    const res = await fullSyncHRI(2)
    syncTracker.logEnd(logId, res)
  } catch (err) {
    console.error('❌ [HOURLY] HRI error:', err.message)
    syncTracker.logEnd(logId, { error: err.message })
  }
})

cron.schedule('15 * * * *', async () => {
  const logId = syncTracker.logStart('HOURLY', 'HPO')
  console.log('\n⏰ [HOURLY] Sync HPO (2 hari terakhir) dimulai...')
  try {
    const res = await fullSyncHPO(2)
    syncTracker.logEnd(logId, res)
  } catch (err) {
    console.error('❌ [HOURLY] HPO error:', err.message)
    syncTracker.logEnd(logId, { error: err.message })
  }
})

cron.schedule('30 * * * *', async () => {
  const logId = syncTracker.logStart('HOURLY', 'HDO')
  console.log('\n⏰ [HOURLY] Sync HDO (2 hari terakhir) dimulai...')
  try {
    const res = await fullSyncHDO(2)
    syncTracker.logEnd(logId, res)
  } catch (err) {
    console.error('❌ [HOURLY] HDO error:', err.message)
    syncTracker.logEnd(logId, { error: err.message })
  }
})

// ── 3. NIGHTLY DEEP SYNC (Tiap Hari Jam 02:00) ───────────────────────────
// Deep sync 30 hari data historis
cron.schedule('0 2 * * *', async () => {
  const days = parseInt(process.env.SYNC_DAYS_BACK, 10) || 30
  const logId = syncTracker.logStart('NIGHTLY_DEEP', 'ALL')
  console.log(`\n🌙 [DEEP] Nightly deep sync (${days} hari) dimulai...`)

  try {
    const hriRes = await fullSyncHRI(days)
    await new Promise(r => setTimeout(r, 5000))
    const hpoRes = await fullSyncHPO(days)
    await new Promise(r => setTimeout(r, 5000))
    const hdoRes = await fullSyncHDO(days)

    const totalProcessed = (hriRes.processed || 0) + (hpoRes.processed || 0) + (hdoRes.processed || 0)
    const totalUpdated = (hriRes.updated || 0) + (hpoRes.updated || 0) + (hdoRes.updated || 0)

    syncTracker.logEnd(logId, {
      processed: totalProcessed,
      updated: totalUpdated,
      shipmentsUpdated: hriRes.shipmentsUpdated || 0,
      errors: [...(hriRes.errors || []), ...(hpoRes.errors || []), ...(hdoRes.errors || [])],
    })

    console.log(`\n✅ [DEEP] Nightly deep sync selesai (${totalProcessed} dokumen)!`)
  } catch (err) {
    console.error('❌ [DEEP] Nightly sync error:', err.message)
    syncTracker.logEnd(logId, { error: err.message, processed: 0, updated: 0 })
  }
})

// ===========================
// Start Server
// ===========================
app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════════════════╗
║         HSO ACCURATE SYNC ENGINE RUNNING                 ║
║         Port: ${PORT}                                         ║
╠══════════════════════════════════════════════════════════╣
║  🌐 Web Dashboard  : http://localhost:${PORT}/               ║
║  ⚡ Delta Sync URL : http://localhost:${PORT}/sync/delta      ║
║  🚀 Full Sync URL  : http://localhost:${PORT}/sync/all        ║
║  📦 Sync HRI URL   : http://localhost:${PORT}/sync/hri        ║
║  📑 Sync HPO URL   : http://localhost:${PORT}/sync/hpo        ║
║  🚚 Sync HDO URL   : http://localhost:${PORT}/sync/hdo        ║
║  📊 Live Logs API  : http://localhost:${PORT}/sync/logs       ║
║  💓 Health Check   : http://localhost:${PORT}/health          ║
╠══════════════════════════════════════════════════════════╣
║  ⏰ Cron Delta Sync : Setiap 5 Menit                     ║
║  ⏰ Cron Hourly     : Setiap 1 Jam (Staggered)           ║
║  ⏰ Cron Deep Sync  : Setiap Hari Jam 02:00 (30 Hari)    ║
╚══════════════════════════════════════════════════════════╝
  `)
})
