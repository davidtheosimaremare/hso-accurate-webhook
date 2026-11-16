// src/routes/accurate.js
// Route proxy Accurate Online API — pengganti Supabase Edge Functions
// Dipanggil dari HSO frontend via VITE_ACCURATE_SYNC_URL/accurate/...
//
// Endpoints:
//   POST /accurate/detail-so    → pengganti accurate-detail-so
//   POST /accurate/list-so      → pengganti accurate-list-so
//   POST /accurate/list-sq      → pengganti accurate-list-sq
//   POST /accurate/list-do      → pengganti accurate-list-do
//   POST /accurate/list-si      → pengganti accurate-list-si
//   POST /accurate/list-po      → pengganti accurate-list-po
//   POST /accurate/list-tracking-so → pengganti accurate-list-tracking-so
//   POST /accurate/print-doc    → pengganti accurate-print-doc

const express = require('express')
const router = express.Router()
const axios = require('axios')
const crypto = require('crypto')

const BASE_API = process.env.ACCURATE_BASE_URL || 'https://zeus.accurate.id'

// ─── Helper: Build Accurate Auth Headers ─────────────────────────────────────
function buildHeaders() {
  const token = process.env.ACCURATE_BEARER_TOKEN || process.env.ACCURATE_ACCESS_TOKEN
  const secret = process.env.ACCURATE_SECRET_KEY || process.env.ACCURATE_SIGNATURE_SECRET

  if (!token) throw new Error('ACCURATE_ACCESS_TOKEN tidak disetting!')

  const headers = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
  }

  if (secret) {
    const ts = new Date().toISOString()
    const sig = crypto.createHmac('sha256', secret).update(ts).digest('base64')
    headers['X-Api-Timestamp'] = ts
    headers['X-Api-Signature'] = sig
  }

  return headers
}

// ─── Middleware: Simple API Key Auth dari HSO ─────────────────────────────────
// Validasi bahwa request datang dari HSO (bukan public)
const HSO_PROXY_KEY = process.env.HSO_PROXY_API_KEY

function requireProxyKey(req, res, next) {
  if (!HSO_PROXY_KEY) return next() // Jika tidak disetting, bypass (dev mode)

  const keyFromHeader = req.headers['x-hso-proxy-key']
  const keyFromBody = req.body?.proxyKey

  if (keyFromHeader !== HSO_PROXY_KEY && keyFromBody !== HSO_PROXY_KEY) {
    return res.status(401).json({ s: false, error: 'Unauthorized: Invalid HSO Proxy Key' })
  }

  next()
}

// ─── POST /accurate/detail-so ─────────────────────────────────────────────────
// Pengganti: supabase/functions/accurate-detail-so
router.post('/detail-so', requireProxyKey, async (req, res) => {
  const { id, type } = req.body || {}
  const moduleType = type || 'sales-order'

  if (!id) {
    return res.json({ s: false, error: 'ID wajib dikirim!' })
  }

  try {
    const reqId = String(id).trim()
    const isNumeric = !isNaN(Number(reqId)) && !reqId.includes('.') && !reqId.includes('/') && !reqId.includes('-')

    // Bangun kandidat parameter query
    const candidates = []
    if (isNumeric) {
      candidates.push(`id=${encodeURIComponent(reqId)}`)
    } else {
      candidates.push(`number=${encodeURIComponent(reqId)}`)
      if (reqId.includes('-')) {
        candidates.push(`number=${encodeURIComponent(reqId.replace(/-/g, '/'))}`)
      }
      candidates.push(`id=${encodeURIComponent(reqId)}`)
    }

    let jsonDoc = null

    for (const paramStr of candidates) {
      try {
        const url = `${BASE_API}/accurate/api/${moduleType}/detail.do?${paramStr}`
        const response = await axios.get(url, {
          headers: buildHeaders(),
          timeout: 60000, // 60 detik — cukup untuk Accurate compile relasi item
        })

        const data = response.data
        if (data?.s && data?.d) {
          jsonDoc = data
          break
        }
      } catch (fetchErr) {
        console.warn(`[detail-so] Candidate ${paramStr} gagal:`, fetchErr.message)
      }
    }

    if (!jsonDoc?.s || !jsonDoc?.d) {
      return res.json({ s: false, error: `Dokumen ${moduleType} tidak ditemukan atau Accurate error` })
    }

    const docData = jsonDoc.d

    // Fetch attachments (opsional, cepat)
    if (docData.id) {
      try {
        const attUrl = `${BASE_API}/accurate/api/attachment/list.do?transactionId=${docData.id}&transactionType=SO`
        const attRes = await axios.get(attUrl, {
          headers: buildHeaders(),
          timeout: 5000,
        })
        if (attRes.data?.s && Array.isArray(attRes.data?.d)) {
          docData.attachments = attRes.data.d
        }
      } catch {
        // Attachment opsional, abaikan error
      }
    }

    return res.json({ s: true, d: docData })

  } catch (err) {
    console.error('[detail-so] Error:', err.message)
    return res.json({ s: false, error: err.message })
  }
})

// ─── POST /accurate/list-so ───────────────────────────────────────────────────
// Pengganti: supabase/functions/accurate-list-so
router.post('/list-so', requireProxyKey, async (req, res) => {
  const {
    fields = 'id,number,transDate,customer,totalAmount,statusName,percentShipped',
    limit = 2000,
    sort = 'transDate|desc',
    filterNumber = null,
  } = req.body || {}

  try {
    let allData = []
    let page = 1
    const pageSize = 100
    let hasMore = true

    while (hasMore) {
      let url = `${BASE_API}/accurate/api/sales-order/list.do?fields=${fields}&sp.page=${page}&sp.pageSize=${pageSize}&sp.sort=${sort}`

      if (filterNumber) {
        url += `&filter.number.op=EQUAL&filter.number.val=${encodeURIComponent(filterNumber)}`
      }

      try {
        const response = await axios.get(url, {
          headers: buildHeaders(),
          timeout: 15000,
        })

        const json = response.data

        if (json?.d && Array.isArray(json.d)) {
          allData = allData.concat(json.d)

          if (filterNumber || allData.length >= limit || json.d.length < pageSize || page >= 20) {
            hasMore = false
            if (allData.length > limit) allData = allData.slice(0, limit)
          } else {
            page++
          }
        } else {
          hasMore = false
        }
      } catch (fetchErr) {
        console.warn(`[list-so] Page ${page} gagal:`, fetchErr.message)
        hasMore = false
      }
    }

    return res.json({ s: true, d: allData })

  } catch (err) {
    console.error('[list-so] Error:', err.message)
    return res.json({ s: false, error: err.message })
  }
})

// ─── POST /accurate/list-sq ───────────────────────────────────────────────────
// Pengganti: supabase/functions/accurate-list-sq (Sales Quotation)
router.post('/list-sq', requireProxyKey, async (req, res) => {
  const {
    fields = 'id,number,transDate,customer,totalAmount,statusName',
    limit = 500,
    sort = 'transDate|desc',
    filterNumber = null,
  } = req.body || {}

  try {
    let allData = []
    let page = 1
    const pageSize = 100
    let hasMore = true

    while (hasMore) {
      let url = `${BASE_API}/accurate/api/sales-quotation/list.do?fields=${fields}&sp.page=${page}&sp.pageSize=${pageSize}&sp.sort=${sort}`

      if (filterNumber) {
        url += `&filter.number.op=EQUAL&filter.number.val=${encodeURIComponent(filterNumber)}`
      }

      try {
        const response = await axios.get(url, { headers: buildHeaders(), timeout: 15000 })
        const json = response.data

        if (json?.d && Array.isArray(json.d)) {
          allData = allData.concat(json.d)
          if (filterNumber || allData.length >= limit || json.d.length < pageSize || page >= 10) {
            hasMore = false
            if (allData.length > limit) allData = allData.slice(0, limit)
          } else {
            page++
          }
        } else {
          hasMore = false
        }
      } catch (fetchErr) {
        console.warn(`[list-sq] Page ${page} gagal:`, fetchErr.message)
        hasMore = false
      }
    }

    return res.json({ s: true, d: allData })

  } catch (err) {
    console.error('[list-sq] Error:', err.message)
    return res.json({ s: false, error: err.message })
  }
})

// ─── POST /accurate/list-do ───────────────────────────────────────────────────
// Pengganti: supabase/functions/accurate-list-do (Delivery Order)
router.post('/list-do', requireProxyKey, async (req, res) => {
  const { fields, limit = 500, sort = 'transDate|desc', filterNumber, fromDate } = req.body || {}
  const fieldsParam = fields || 'id,number,transDate,customer,statusName,shipTo,driverName'

  try {
    let allData = []
    let page = 1
    const pageSize = 100
    let hasMore = true

    while (hasMore) {
      let url = `${BASE_API}/accurate/api/delivery-order/list.do?fields=${fieldsParam}&sp.page=${page}&sp.pageSize=${pageSize}&sp.sort=${sort}`
      if (filterNumber) url += `&filter.number.op=EQUAL&filter.number.val=${encodeURIComponent(filterNumber)}`
      if (fromDate) url += `&filter.transDateFrom=${fromDate}`

      try {
        const response = await axios.get(url, { headers: buildHeaders(), timeout: 15000 })
        const json = response.data
        if (json?.d && Array.isArray(json.d)) {
          allData = allData.concat(json.d)
          if (filterNumber || allData.length >= limit || json.d.length < pageSize || page >= 10) {
            hasMore = false
            if (allData.length > limit) allData = allData.slice(0, limit)
          } else { page++ }
        } else { hasMore = false }
      } catch (fetchErr) {
        console.warn(`[list-do] Page ${page} gagal:`, fetchErr.message)
        hasMore = false
      }
    }

    return res.json({ s: true, d: allData })
  } catch (err) {
    console.error('[list-do] Error:', err.message)
    return res.json({ s: false, error: err.message })
  }
})

// ─── POST /accurate/list-si ───────────────────────────────────────────────────
// Pengganti: supabase/functions/accurate-list-si (Sales Invoice)
router.post('/list-si', requireProxyKey, async (req, res) => {
  const { fields, limit = 500, sort = 'transDate|desc', filterNumber } = req.body || {}
  const fieldsParam = fields || 'id,number,transDate,customer,totalAmount,statusName,dueDate'

  try {
    let allData = []
    let page = 1
    const pageSize = 100
    let hasMore = true

    while (hasMore) {
      let url = `${BASE_API}/accurate/api/sales-invoice/list.do?fields=${fieldsParam}&sp.page=${page}&sp.pageSize=${pageSize}&sp.sort=${sort}`
      if (filterNumber) url += `&filter.number.op=EQUAL&filter.number.val=${encodeURIComponent(filterNumber)}`

      try {
        const response = await axios.get(url, { headers: buildHeaders(), timeout: 15000 })
        const json = response.data
        if (json?.d && Array.isArray(json.d)) {
          allData = allData.concat(json.d)
          if (filterNumber || allData.length >= limit || json.d.length < pageSize || page >= 10) {
            hasMore = false
            if (allData.length > limit) allData = allData.slice(0, limit)
          } else { page++ }
        } else { hasMore = false }
      } catch (fetchErr) {
        console.warn(`[list-si] Page ${page} gagal:`, fetchErr.message)
        hasMore = false
      }
    }

    return res.json({ s: true, d: allData })
  } catch (err) {
    console.error('[list-si] Error:', err.message)
    return res.json({ s: false, error: err.message })
  }
})

// ─── POST /accurate/list-po ───────────────────────────────────────────────────
router.post('/list-po', requireProxyKey, async (req, res) => {
  const { fields, limit = 500, sort = 'transDate|desc', filterNumber, fromDate } = req.body || {}
  const fieldsParam = fields || 'id,number,transDate,vendor,totalAmount,statusName'

  try {
    let allData = []
    let page = 1
    const pageSize = 100
    let hasMore = true

    while (hasMore) {
      let url = `${BASE_API}/accurate/api/purchase-order/list.do?fields=${fieldsParam}&sp.page=${page}&sp.pageSize=${pageSize}&sp.sort=${sort}`
      if (filterNumber) url += `&filter.number.op=EQUAL&filter.number.val=${encodeURIComponent(filterNumber)}`
      if (fromDate) url += `&filter.transDateFrom=${fromDate}`

      try {
        const response = await axios.get(url, { headers: buildHeaders(), timeout: 15000 })
        const json = response.data
        if (json?.d && Array.isArray(json.d)) {
          allData = allData.concat(json.d)
          if (filterNumber || allData.length >= limit || json.d.length < pageSize || page >= 10) {
            hasMore = false
            if (allData.length > limit) allData = allData.slice(0, limit)
          } else { page++ }
        } else { hasMore = false }
      } catch (fetchErr) {
        console.warn(`[list-po] Page ${page} gagal:`, fetchErr.message)
        hasMore = false
      }
    }

    return res.json({ s: true, d: allData })
  } catch (err) {
    console.error('[list-po] Error:', err.message)
    return res.json({ s: false, error: err.message })
  }
})

// ─── POST /accurate/list-tracking-so ─────────────────────────────────────────
router.post('/list-tracking-so', requireProxyKey, async (req, res) => {
  const { fields, sort = 'transDate|desc', filterNumber } = req.body || {}
  const fieldsParam = fields || 'id,number,transDate,customer,statusName,percentShipped'

  try {
    let url = `${BASE_API}/accurate/api/sales-order/list.do?fields=${fieldsParam}&sp.page=1&sp.pageSize=100&sp.sort=${sort}`
    if (filterNumber) url += `&filter.number.op=EQUAL&filter.number.val=${encodeURIComponent(filterNumber)}`

    const response = await axios.get(url, { headers: buildHeaders(), timeout: 15000 })
    return res.json({ s: true, d: response.data?.d || [] })
  } catch (err) {
    console.error('[list-tracking-so] Error:', err.message)
    return res.json({ s: false, error: err.message })
  }
})

// ─── POST /accurate/print-doc ─────────────────────────────────────────────────
// Pengganti: supabase/functions/accurate-print-doc
router.post('/print-doc', requireProxyKey, async (req, res) => {
  const { id, type = 'sales-order' } = req.body || {}

  if (!id) return res.json({ s: false, error: 'ID dokumen wajib dikirim!' })

  try {
    const url = `${BASE_API}/accurate/api/${type}/print.do?id=${id}`
    const response = await axios.get(url, {
      headers: buildHeaders(),
      timeout: 30000,
      responseType: 'arraybuffer',
    })

    res.set({
      'Content-Type': response.headers['content-type'] || 'application/pdf',
      'Content-Disposition': `inline; filename="${type}-${id}.pdf"`,
    })
    return res.send(response.data)
  } catch (err) {
    console.error('[print-doc] Error:', err.message)
    return res.json({ s: false, error: err.message })
  }
})

module.exports = router

