// src/routes/webhook.js
// Endpoint untuk menerima webhook dari Accurate Online

const express = require('express')
const router = express.Router()
const { upsertHPO } = require('../services/syncHPO')
const { upsertHRI } = require('../services/syncHRI')
const { upsertHDO } = require('../services/syncHDO')
const { fetchHPODetail, fetchHRIDetail, fetchHDODetail } = require('../utils/accurate')

// Middleware verifikasi webhook secret (opsional, tambahkan jika Accurate mengirim header auth)
function verifyWebhookSecret(req, res, next) {
  const secret = req.headers['x-webhook-secret'] || req.query.secret
  const expectedSecret = process.env.WEBHOOK_SECRET
  if (expectedSecret && secret !== expectedSecret) {
    console.warn('⚠️ Webhook ditolak — secret tidak cocok')
    return res.status(401).json({ error: 'Unauthorized' })
  }
  next()
}

/**
 * POST /webhook/accurate
 * Menerima semua jenis webhook dari Accurate Online
 * 
 * Payload Accurate biasanya:
 * {
 *   "event": "purchase_order.created" | "receive_item.created" | "delivery_order.created" | dll,
 *   "data": { "id": 12345, ... }
 * }
 */
router.post('/accurate', verifyWebhookSecret, async (req, res) => {
  const { event, data } = req.body

  if (!event || !data?.id) {
    return res.status(400).json({ error: 'Invalid payload: missing event or data.id' })
  }

  const docId = data.id
  console.log(`\n📩 Webhook diterima: ${event} | ID: ${docId}`)

  // Respond 200 dulu ke Accurate agar tidak timeout
  res.status(200).json({ received: true, event, id: docId })

  // Proses async setelah response
  setImmediate(async () => {
    try {
      // HPO events
      if (event.includes('purchase_order') || event.includes('hpo')) {
        const detail = await fetchHPODetail(docId)
        await upsertHPO(detail)
      }
      // HRI events
      else if (event.includes('receive_item') || event.includes('hri') || event.includes('penerimaan_barang')) {
        const detail = await fetchHRIDetail(docId)
        await upsertHRI(detail)
      }
      // HDO events
      else if (event.includes('delivery_order') || event.includes('hdo') || event.includes('surat_jalan')) {
        const detail = await fetchHDODetail(docId)
        await upsertHDO(detail)
      }
      else {
        console.log(`ℹ️ Event tidak ditangani: ${event}`)
      }
    } catch (err) {
      console.error(`❌ Error proses webhook ${event}:`, err.message)
    }
  })
})

/**
 * POST /webhook/hpo/:id — Trigger manual sync satu HPO
 */
router.post('/hpo/:id', verifyWebhookSecret, async (req, res) => {
  const id = parseInt(req.params.id)
  console.log(`\n🔁 Manual sync HPO id: ${id}`)
  try {
    const detail = await fetchHPODetail(id)
    const result = await upsertHPO(detail)
    res.json({ success: true, ...result })
  } catch (err) {
    console.error('❌ Manual HPO sync error:', err.message)
    res.status(500).json({ success: false, error: err.message })
  }
})

/**
 * POST /webhook/hri/:id — Trigger manual sync satu HRI
 */
router.post('/hri/:id', verifyWebhookSecret, async (req, res) => {
  const id = parseInt(req.params.id)
  console.log(`\n🔁 Manual sync HRI id: ${id}`)
  try {
    const detail = await fetchHRIDetail(id)
    const result = await upsertHRI(detail)
    res.json({ success: true, ...result })
  } catch (err) {
    console.error('❌ Manual HRI sync error:', err.message)
    res.status(500).json({ success: false, error: err.message })
  }
})

/**
 * POST /webhook/hdo/:id — Trigger manual sync satu HDO
 */
router.post('/hdo/:id', verifyWebhookSecret, async (req, res) => {
  const id = parseInt(req.params.id)
  console.log(`\n🔁 Manual sync HDO id: ${id}`)
  try {
    const detail = await fetchHDODetail(id)
    const result = await upsertHDO(detail)
    res.json({ success: true, ...result })
  } catch (err) {
    console.error('❌ Manual HDO sync error:', err.message)
    res.status(500).json({ success: false, error: err.message })
  }
})

module.exports = router
