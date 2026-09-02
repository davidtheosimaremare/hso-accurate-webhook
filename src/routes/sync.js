// src/routes/sync.js
// Endpoint untuk trigger full sync manual via HTTP

const express = require('express')
const router = express.Router()
const { fullSyncHPO } = require('../services/syncHPO')
const { fullSyncHRI } = require('../services/syncHRI')
const { fullSyncHDO } = require('../services/syncHDO')

// Simple auth untuk endpoint sync
function requireSyncKey(req, res, next) {
  const key = req.headers['x-sync-key'] || req.query.key
  if (key !== process.env.WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  next()
}

/**
 * POST /sync/all — Full sync semua (HPO + HRI + HDO)
 * ?days=30 — berapa hari ke belakang (default 30)
 */
router.post('/all', requireSyncKey, async (req, res) => {
  const daysBack = parseInt(req.query.days) || parseInt(process.env.SYNC_DAYS_BACK) || 30
  console.log(`\n🚀 Full sync ALL dimulai (${daysBack} hari ke belakang)...`)
  res.json({ started: true, daysBack })

  setImmediate(async () => {
    try {
      await fullSyncHPO(daysBack)
      await fullSyncHRI(daysBack)
      await fullSyncHDO(daysBack)
      console.log(`\n🎉 Full sync ALL selesai!`)
    } catch (err) {
      console.error('❌ Full sync ALL error:', err.message)
    }
  })
})

router.post('/hpo', requireSyncKey, async (req, res) => {
  const daysBack = parseInt(req.query.days) || 30
  res.json({ started: true, type: 'HPO', daysBack })
  setImmediate(() => fullSyncHPO(daysBack))
})

router.post('/hri', requireSyncKey, async (req, res) => {
  const daysBack = parseInt(req.query.days) || 30
  res.json({ started: true, type: 'HRI', daysBack })
  setImmediate(() => fullSyncHRI(daysBack))
})

router.post('/hdo', requireSyncKey, async (req, res) => {
  const daysBack = parseInt(req.query.days) || 30
  res.json({ started: true, type: 'HDO', daysBack })
  setImmediate(() => fullSyncHDO(daysBack))
})

module.exports = router
