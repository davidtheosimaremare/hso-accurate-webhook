// src/index.js — Entry point HSO Accurate Webhook Server
require('dotenv').config()

const express = require('express')
const cors = require('cors')
const cron = require('node-cron')

const webhookRoutes = require('./routes/webhook')
const syncRoutes = require('./routes/sync')
const { fullSyncHPO } = require('./services/syncHPO')
const { fullSyncHRI } = require('./services/syncHRI')
const { fullSyncHDO } = require('./services/syncHDO')

const app = express()
const PORT = process.env.PORT || 3001

// ===========================
// Middleware
// ===========================
app.use(cors())
app.use(express.json({ limit: '5mb' }))
app.use(express.urlencoded({ extended: true }))

// Request logger
app.use((req, res, next) => {
  if (req.path !== '/health') {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`)
  }
  next()
})

// ===========================
// Routes
// ===========================
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'hso-accurate-webhook',
    timestamp: new Date().toISOString(),
  })
})

app.use('/webhook', webhookRoutes)
app.use('/sync', syncRoutes)

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: `Route ${req.path} tidak ditemukan` })
})

// Error handler
app.use((err, req, res, next) => {
  console.error('💥 Unhandled error:', err.message)
  res.status(500).json({ error: 'Internal server error' })
})

// ===========================
// Cron Jobs — Auto Sync
// ===========================

// Setiap 1 jam: sync HRI (prioritas — update hokiindo_date)
cron.schedule('0 * * * *', async () => {
  console.log('\n⏰ [CRON] Hourly sync HRI dimulai...')
  try {
    await fullSyncHRI(2) // 2 hari ke belakang untuk efisiensi
  } catch (err) {
    console.error('❌ [CRON] HRI sync error:', err.message)
  }
})

// Setiap 1 jam (offset 15 menit): sync HPO
cron.schedule('15 * * * *', async () => {
  console.log('\n⏰ [CRON] Hourly sync HPO dimulai...')
  try {
    await fullSyncHPO(2)
  } catch (err) {
    console.error('❌ [CRON] HPO sync error:', err.message)
  }
})

// Setiap 1 jam (offset 30 menit): sync HDO
cron.schedule('30 * * * *', async () => {
  console.log('\n⏰ [CRON] Hourly sync HDO dimulai...')
  try {
    await fullSyncHDO(2)
  } catch (err) {
    console.error('❌ [CRON] HDO sync error:', err.message)
  }
})

// Setiap hari jam 02:00: full sync 30 hari (deep sync malam hari)
cron.schedule('0 2 * * *', async () => {
  const days = parseInt(process.env.SYNC_DAYS_BACK) || 30
  console.log(`\n🌙 [CRON] Nightly deep sync (${days} hari) dimulai...`)
  try {
    await fullSyncHPO(days)
    await fullSyncHRI(days)
    await fullSyncHDO(days)
    console.log('\n✅ [CRON] Nightly deep sync selesai!')
  } catch (err) {
    console.error('❌ [CRON] Nightly sync error:', err.message)
  }
})

// ===========================
// Start Server
// ===========================
app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════╗
║   HSO Accurate Webhook Server          ║
║   Port: ${PORT}                           ║
╠════════════════════════════════════════╣
║   POST /webhook/accurate  ← dari Accurate
║   POST /webhook/hpo/:id   ← manual HPO
║   POST /webhook/hri/:id   ← manual HRI
║   POST /webhook/hdo/:id   ← manual HDO
║   POST /sync/all          ← full sync
║   GET  /health            ← status check
╠════════════════════════════════════════╣
║   Cron: HRI tiap jam (menit 0)         ║
║   Cron: HPO tiap jam (menit 15)        ║
║   Cron: HDO tiap jam (menit 30)        ║
║   Cron: Deep sync tiap hari jam 02:00  ║
╚════════════════════════════════════════╝
  `)
})
