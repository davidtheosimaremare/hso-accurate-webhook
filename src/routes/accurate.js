// src/routes/accurate.js
// Route proxy Accurate Online API — pengganti Supabase Edge Functions
// Dipanggil dari HSO frontend via VITE_ACCURATE_SYNC_URL/accurate/...
// Server berjalan di hso-sync.hokiindo.co.id (Indonesia) untuk kecepatan maksimal

const express = require('express')
const router = express.Router()
const axios = require('axios')
const crypto = require('crypto')
const supabase = require('../utils/supabase')

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

// ─── Middleware: API Key Auth dari HSO ───────────────────────────────────────
const HSO_PROXY_KEY = process.env.HSO_PROXY_API_KEY

function requireProxyKey(req, res, next) {
  if (!HSO_PROXY_KEY) return next()

  const keyFromHeader = req.headers['x-hso-proxy-key']
  const keyFromBody = req.body?.proxyKey

  if (keyFromHeader !== HSO_PROXY_KEY && keyFromBody !== HSO_PROXY_KEY) {
    return res.status(401).json({ s: false, error: 'Unauthorized: Invalid HSO Proxy Key' })
  }

  next()
}

// ─── 1. DETAIL SALES ORDER / DOKUMEN ─────────────────────────────────────────
// POST /accurate/detail-so atau POST /accurate/accurate-detail-so
router.post(['/detail-so', '/accurate-detail-so'], requireProxyKey, async (req, res) => {
  const { id, type } = req.body || {}
  const moduleType = type || 'sales-order'

  if (!id) {
    return res.json({ s: false, error: 'ID wajib dikirim!' })
  }

  try {
    const reqId = String(id).trim()
    const isNumeric = !isNaN(Number(reqId)) && !reqId.includes('.') && !reqId.includes('/') && !reqId.includes('-')

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
          timeout: 60000,
        })

        const data = response.data
        if (data?.s && data?.d) {
          jsonDoc = data
          break
        }
      } catch (fetchErr) {
        console.warn(`[detail-so] Candidate ${paramStr} notice:`, fetchErr.message)
      }
    }

    if (!jsonDoc?.s || !jsonDoc?.d) {
      return res.json({ s: false, error: `Dokumen ${moduleType} tidak ditemukan atau Accurate error` })
    }

    const docData = jsonDoc.d

    if (docData.id) {
      try {
        const attUrl = `${BASE_API}/accurate/api/attachment/list.do?transactionId=${docData.id}&transactionType=SO`
        const attRes = await axios.get(attUrl, {
          headers: buildHeaders(),
          timeout: 4000,
        })
        if (attRes.data?.s && Array.isArray(attRes.data?.d)) {
          docData.attachments = attRes.data.d
        }
      } catch {
        // Attachment opsional
      }
    }

    return res.json({ s: true, d: docData })

  } catch (err) {
    console.error('[detail-so] Error:', err.message)
    return res.json({ s: false, error: err.message })
  }
})

// ─── 2. LIST SALES ORDER ─────────────────────────────────────────────────────
router.post(['/list-so', '/accurate-list-so'], requireProxyKey, async (req, res) => {
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
        const response = await axios.get(url, { headers: buildHeaders(), timeout: 15000 })
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
        console.warn(`[list-so] Page ${page} notice:`, fetchErr.message)
        hasMore = false
      }
    }

    return res.json({ s: true, d: allData })

  } catch (err) {
    console.error('[list-so] Error:', err.message)
    return res.json({ s: false, error: err.message })
  }
})

// ─── 3. LIST SALES QUOTATION (SQ) ───────────────────────────────────────────
router.post(['/list-sq', '/accurate-list-sq'], requireProxyKey, async (req, res) => {
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
        console.warn(`[list-sq] Page ${page} notice:`, fetchErr.message)
        hasMore = false
      }
    }

    return res.json({ s: true, d: allData })

  } catch (err) {
    console.error('[list-sq] Error:', err.message)
    return res.json({ s: false, error: err.message })
  }
})

// ─── 4. LIST DELIVERY ORDER (DO) ────────────────────────────────────────────
router.post(['/list-do', '/accurate-list-do'], requireProxyKey, async (req, res) => {
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
        console.warn(`[list-do] Page ${page} notice:`, fetchErr.message)
        hasMore = false
      }
    }

    return res.json({ s: true, d: allData })
  } catch (err) {
    console.error('[list-do] Error:', err.message)
    return res.json({ s: false, error: err.message })
  }
})

// ─── 5. LIST SALES INVOICE (SI) ─────────────────────────────────────────────
router.post(['/list-si', '/accurate-list-si'], requireProxyKey, async (req, res) => {
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
        console.warn(`[list-si] Page ${page} notice:`, fetchErr.message)
        hasMore = false
      }
    }

    return res.json({ s: true, d: allData })
  } catch (err) {
    console.error('[list-si] Error:', err.message)
    return res.json({ s: false, error: err.message })
  }
})

// ─── 6. LIST PURCHASE ORDER (PO) ────────────────────────────────────────────
router.post(['/list-po', '/accurate-list-po', '/list-all-po', '/accurate-list-all-po'], requireProxyKey, async (req, res) => {
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
        console.warn(`[list-po] Page ${page} notice:`, fetchErr.message)
        hasMore = false
      }
    }

    return res.json({ s: true, d: allData })
  } catch (err) {
    console.error('[list-po] Error:', err.message)
    return res.json({ s: false, error: err.message })
  }
})

// ─── 7. TRACKING SALES ORDER ────────────────────────────────────────────────
router.post(['/list-tracking-so', '/accurate-list-tracking-so'], requireProxyKey, async (req, res) => {
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

// ─── 8. CETAK DOKUMEN (PRINT PDF) ────────────────────────────────────────────
router.post(['/print-doc', '/accurate-print-doc'], requireProxyKey, async (req, res) => {
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

// ─── 9. KELOLA & BUAT HPB (PURCHASE REQUISITION) ─────────────────────────────
// Pengganti: supabase/functions/accurate-create-hpb
router.post(['/create-hpb', '/accurate-create-hpb'], requireProxyKey, async (req, res) => {
  const { action, number, items, id, soNumber } = req.body || {}

  try {
    const headers = buildHeaders()

    // A. Cari HPB berdasarkan HSO Number
    if (action === 'find-hpb-by-so') {
      if (!soNumber) return res.json({ s: false, error: 'soNumber wajib ditentukan!' })

      const listUrl = `${BASE_API}/accurate/api/purchase-requisition/list.do?fields=id,number,transDate,statusName&sp.pageSize=100&sp.sort=transDate|desc`
      const r = await axios.get(listUrl, { headers, timeout: 15000 })
      const prList = r.data?.d || []

      const activePrs = prList.filter(pr => {
        const s = (pr.statusName || '').toLowerCase()
        return s.includes('draft') || s.includes('outstanding') || s.includes('partial') || s.includes('menunggu') || s.includes('sebagian')
      })

      const matches = []
      await Promise.all(activePrs.map(async pr => {
        try {
          const detailUrl = `${BASE_API}/accurate/api/purchase-requisition/detail.do?id=${pr.id}`
          const dres = await axios.get(detailUrl, { headers, timeout: 10000 })
          const detailItems = dres.data?.d?.detailItem || []
          for (const item of detailItems) {
            const note = (item.detailNotes || '').trim()
            if (note.toLowerCase().includes(soNumber.toLowerCase())) {
              matches.push({
                itemCode: item.item?.no,
                hpbNumber: pr.number,
                hpbId: pr.id,
                statusName: pr.statusName
              })
            }
          }
        } catch {}
      }))

      return res.json({ s: true, matches })
    }

    // B. List Semua HPB
    if (action === 'list-hpb') {
      let allData = []
      let page = 1
      let hasMore = true
      while (hasMore) {
        const listUrl = `${BASE_API}/accurate/api/purchase-requisition/list.do?fields=id,number,transDate,description,statusName&sp.page=${page}&sp.pageSize=100&sp.sort=transDate|desc`
        const r = await axios.get(listUrl, { headers, timeout: 15000 })
        const items = r.data?.d || []
        allData = allData.concat(items)
        if (items.length < 100 || page >= 10) { hasMore = false } else { page++ }
      }
      return res.json({ s: true, d: allData })
    }

    // C. Detail HPB
    if (action === 'detail-hpb') {
      if (!id) return res.json({ s: false, error: 'ID HPB wajib ditentukan!' })
      const detailUrl = `${BASE_API}/accurate/api/purchase-requisition/detail.do?id=${id}`
      const r = await axios.get(detailUrl, { headers, timeout: 15000 })
      return res.json({ s: true, d: r.data?.d })
    }

    // D. Dapatkan Nomor HPB Berikutnya
    if (action === 'get-next-number') {
      const listUrl = `${BASE_API}/accurate/api/purchase-requisition/list.do?fields=number,transDate&sp.pageSize=100&sp.sort=number|desc`
      const r = await axios.get(listUrl, { headers, timeout: 15000 })
      const prList = r.data?.d || []

      const now = new Date()
      const year4 = now.getFullYear()
      const year2 = String(year4).substring(2)
      const monthVal = String(now.getMonth() + 1).padStart(2, '0')

      let lastNum = 0
      let paddingLength = 4
      let yearFormat = '2'

      for (const pr of prList) {
        const prNum = pr.number
        if (!prNum) continue
        const match2 = prNum.match(new RegExp(`^HPB/(\\d{2})/${monthVal}/(\\d+)$`, 'i'))
        const match4 = prNum.match(new RegExp(`^HPB/(\\d{4})/${monthVal}/(\\d+)$`, 'i'))
        if (match2) {
          const seq = parseInt(match2[2])
          if (seq > lastNum) { lastNum = seq; paddingLength = match2[2].length; yearFormat = '2' }
        } else if (match4) {
          const seq = parseInt(match4[2])
          if (seq > lastNum) { lastNum = seq; paddingLength = match4[2].length; yearFormat = '4' }
        }
      }

      const nextSeq = lastNum + 1
      const seqStr = String(nextSeq).padStart(paddingLength, '0')
      const yearStr = yearFormat === '4' ? String(year4) : year2
      const proposedNumber = `HPB/${yearStr}/${monthVal}/${seqStr}`

      return res.json({ s: true, proposedNumber })
    }

    // E. Buat Dokumen HPB Baru di Accurate
    if (action === 'create-hpb') {
      if (!number) return res.json({ s: false, error: 'Nomor HPB wajib ditentukan!' })
      if (!items || !Array.isArray(items) || items.length === 0) {
        return res.json({ s: false, error: 'Daftar item tidak boleh kosong!' })
      }

      const now = new Date()
      const nowStr = `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`

      const detailItem = items.map(item => ({
        itemNo: item.item_code,
        quantity: item.qty_to_order,
        detailNotes: item.so_number
      }))

      const savePayload = {
        transDate: nowStr,
        number: number,
        description: `Dibuat otomatis dari HSO Tracker untuk: ${items.map(i => i.item_code).join(', ')}`,
        detailItem: detailItem
      }

      const saveUrl = `${BASE_API}/accurate/api/purchase-requisition/save.do`
      const r = await axios.post(saveUrl, savePayload, { headers, timeout: 25000 })
      const json = r.data

      if (!json.s) {
        return res.json({ s: false, error: json.d || 'Gagal menyimpan transaksi HPB ke Accurate' })
      }

      // Hapus item dari purchase_cart di Supabase jika ada itemIds
      try {
        const itemIds = items.map(i => i.id).filter(Boolean)
        if (itemIds.length > 0) {
          await supabase.from('purchase_cart').delete().in('id', itemIds)
        }
      } catch (dbErr) {
        console.warn('[create-hpb] Notice cleaning purchase_cart:', dbErr.message)
      }

      return res.json({
        s: true,
        message: `HPB ${number} berhasil dibuat di Accurate!`,
        accurateResponse: json.r
      })
    }

    return res.json({ s: false, error: 'Action HPB tidak valid!' })

  } catch (err) {
    console.error('[create-hpb] Error:', err.message)
    return res.json({ s: false, error: err.message })
  }
})

// ─── 10. CEK STOK BARANG & HISTORI (STOCK AVAILABILITY) ───────────────────────
// Pengganti: supabase/functions/get-stock-availability
router.post(['/get-stock-availability', '/stock-availability'], requireProxyKey, async (req, res) => {
  const { item_code } = req.body || {}

  if (!item_code) {
    return res.json({ s: false, error: 'Kode barang (item_code) wajib ditentukan!' })
  }

  try {
    const headers = buildHeaders()

    // 1. Ambil detail barang dari Accurate
    const itemUrl = `${BASE_API}/accurate/api/item/list.do?fields=id,no,name,unit,quantity,availableToSell&filter.no.op=EQUAL&filter.no.val=${encodeURIComponent(item_code)}`
    const itemRes = await axios.get(itemUrl, { headers, timeout: 15000 })
    let itemData = itemRes.data?.d?.[0]

    // Fallback: jika belum temu, coba START_WITH
    if (!itemData) {
      const fallbackUrl = `${BASE_API}/accurate/api/item/list.do?fields=id,no,name,unit,quantity,availableToSell&filter.no.op=START_WITH&filter.no.val=${encodeURIComponent(item_code)}&sp.pageSize=5`
      const fbRes = await axios.get(fallbackUrl, { headers, timeout: 15000 })
      itemData = fbRes.data?.d?.[0]
    }

    if (!itemData) {
      return res.json({ s: false, message: `Barang dengan kode ${item_code} tidak ditemukan di Accurate!` })
    }

    const item_no = itemData.no || item_code
    const stock_warehouse = Number(itemData.quantity || 0)
    const available_to_sell = Number(itemData.availableToSell !== undefined ? itemData.availableToSell : itemData.quantity || 0)

    return res.json({
      s: true,
      item: {
        id: itemData.id,
        item_no: item_no,
        item_name: itemData.name,
        unit: itemData.unit?.name || 'Pcs',
        stock_warehouse: stock_warehouse,
        available_to_sell: available_to_sell,
      }
    })

  } catch (err) {
    console.error('[stock-availability] Error:', err.message)
    return res.json({ s: false, error: err.message })
  }
})

// ─── 11. SINKRONISASI HDO (DELIVERY ORDER) ───────────────────────────────────
// Pengganti: supabase/functions/accurate-sync-hdo
router.post(['/sync-hdo', '/accurate-sync-hdo'], requireProxyKey, async (req, res) => {
  const { doNumbers } = req.body || {}

  if (!doNumbers || !Array.isArray(doNumbers) || doNumbers.length === 0) {
    return res.json({ s: true, d: [], doDetails: [] })
  }

  try {
    const headers = buildHeaders()

    const promises = doNumbers.map(async doNum => {
      try {
        const url = `${BASE_API}/accurate/api/delivery-order/detail.do?number=${encodeURIComponent(doNum)}`
        const r = await axios.get(url, { headers, timeout: 15000 })
        return r.data?.d
      } catch (e) {
        return null
      }
    })

    const results = await Promise.all(promises)
    const validResults = results.filter(Boolean)

    const itemMapping = []
    const doDetails = []

    validResults.forEach(doDetail => {
      if (doDetail && doDetail.detailItem) {
        doDetails.push({
          number: doDetail.number,
          date: doDetail.transDate || doDetail.transDateView,
          status: doDetail.statusName || 'Approved',
          items: doDetail.detailItem.map(item => ({
            code: item.item?.no || '',
            name: item.item?.name || item.detailName || '',
            note: item.detailNotes || '',
            qty_shipped: item.quantity || 0,
            unit: item.itemUnit?.name || 'Pcs'
          }))
        })

        doDetail.detailItem.forEach(item => {
          if (item.item && item.item.no) {
            itemMapping.push({
              itemCode: item.item.no,
              note: item.detailNotes || '',
              doNumber: doDetail.number,
              doDate: doDetail.transDate
            })
          }
        })
      }
    })

    return res.json({ s: true, d: itemMapping, doDetails })

  } catch (err) {
    console.error('[sync-hdo] Error:', err.message)
    return res.json({ s: false, error: err.message })
  }
})

// ─── 12. SINKRONISASI HPO (PURCHASE ORDER TO SHIPMENTS) ──────────────────────
// Pengganti: supabase/functions/accurate-sync-hpo
router.post(['/sync-hpo', '/accurate-sync-hpo'], requireProxyKey, async (req, res) => {
  const { soId, soNumber, items } = req.body || {}

  if (!soId || !soNumber) {
    return res.json({ s: false, error: 'soId dan soNumber wajib dikirim!' })
  }

  try {
    const headers = buildHeaders()
    const searchKeyword = soNumber

    const listUrl = `${BASE_API}/accurate/api/purchase-order/list.do?fields=id,number,transDate,statusName&keywords=${encodeURIComponent(searchKeyword)}&sp.pageSize=100&sp.sort=transDate|desc`
    const listRes = await axios.get(listUrl, { headers, timeout: 15000 })
    const poList = listRes.data?.d || []

    if (poList.length === 0) {
      return res.json({
        s: true,
        message: `Tidak ada PO ditemukan untuk ${soNumber}`,
        stats: { totalPOsFound: 0, updated: 0 },
        items: []
      })
    }

    const itemCodesSet = new Set(items || [])
    const matchingItems = []

    for (const po of poList) {
      try {
        const detailUrl = `${BASE_API}/accurate/api/purchase-order/detail.do?id=${po.id}`
        const dres = await axios.get(detailUrl, { headers, timeout: 15000 })
        const fullPo = dres.data?.d
        const poItems = fullPo?.detailItem || []

        poItems.forEach(item => {
          const itemCode = item.item?.no || ''
          const description = item.detailNotes || ''
          const hasHsoRef = description.toUpperCase().includes(soNumber.toUpperCase())
          const isMatching = itemCodesSet.size === 0 || itemCodesSet.has(itemCode)

          if (hasHsoRef && isMatching && itemCode) {
            matchingItems.push({
              poNumber: po.number,
              itemCode: itemCode,
              quantity: item.quantity || 0
            })
          }
        })
      } catch (poErr) {
        console.warn(`[sync-hpo] Notice reading PO ${po.id}:`, poErr.message)
      }
    }

    return res.json({
      s: true,
      message: `Ditemukan ${matchingItems.length} item PO terkait ${soNumber}`,
      stats: { totalPOsFound: poList.length, matchingItems: matchingItems.length },
      items: matchingItems
    })

  } catch (err) {
    console.error('[sync-hpo] Error:', err.message)
    return res.json({ s: false, error: err.message })
  }
})

// ─── 13. BUAT PENYESUAIAN HARGA (SELLING PRICE ADJUSTMENT) ───────────────────
// Pengganti: supabase/functions/accurate-create-spa
router.post(['/create-spa', '/accurate-create-spa'], requireProxyKey, async (req, res) => {
  const body = req.body || {}
  const rawItems = Array.isArray(body.items) ? body.items : (body.item ? [body.item] : [])

  if (rawItems.length === 0) {
    return res.json({ success: false, error: 'Daftar barang (items) tidak boleh kosong!' })
  }

  const userEmail = body.userEmail || 'Sales Team'
  const priceCategoryName = body.priceCategoryName || 'Umum'
  const now = new Date()
  const todayStr = `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`

  const validItems = rawItems
    .filter(it => it && (it.sku || it.item_no) && Number(it.price) > 0)
    .map(it => ({
      sku: (it.sku || it.item_no || '').trim().toUpperCase(),
      price: Number(it.price),
      defaultPrice: Number(it.defaultPrice || it.base_price || it.old_price || 0),
      itemName: it.itemName || it.item_name || ''
    }))

  if (validItems.length === 0) {
    return res.json({ success: false, error: 'Tidak ada barang valid dengan harga > 0!' })
  }

  try {
    const headers = buildHeaders()
    const MAX_ITEMS = 1000
    const processedDocuments = []
    let itemQueue = [...validItems]

    while (itemQueue.length > 0) {
      const chunk = itemQueue.slice(0, MAX_ITEMS)
      itemQueue = itemQueue.slice(MAX_ITEMS)

      const docIndex = processedDocuments.length + 1
      const description = `Penyesuaian Harga Siemens HSO Dokumen ${docIndex} (${chunk.length} item) — ${todayStr}`

      const payload = {
        transDate: todayStr,
        priceCategoryName: priceCategoryName,
        salesAdjustmentType: 'ITEM_PRICE_TYPE',
        description,
        detailItem: chunk.map(c => ({
          itemNo: c.sku,
          price: c.price,
          priceCategoryName: priceCategoryName
        }))
      }

      const saveUrl = `${BASE_API}/accurate/api/sellingprice-adjustment/save.do`
      const r = await axios.post(saveUrl, payload, { headers, timeout: 35000 })
      const json = r.data

      if (!json.s) {
        throw new Error(json.d || 'Gagal menyimpan Penyesuaian Harga ke Accurate')
      }

      processedDocuments.push({
        action: 'CREATED_NEW',
        id: json.r?.id,
        number: json.r?.number || `SPA.${todayStr.replace(/\//g, '')}.${json.r?.id || 'NEW'}`,
        itemCount: chunk.length,
        items: chunk
      })
    }

    const primaryDocNumber = processedDocuments[0]?.number || 'SPA.HSO'

    // Update table accurate_items di Supabase
    const nowIso = new Date().toISOString()
    for (const it of validItems) {
      try {
        await supabase
          .from('accurate_items')
          .update({
            unit_price: it.price,
            updated_at: nowIso,
          })
          .eq('item_no', it.sku)
      } catch {}
    }

    return res.json({
      success: true,
      message: `Berhasil menyesuaikan harga ${validItems.length} produk di Accurate Online!`,
      documents: processedDocuments,
      totalItemsProcessed: validItems.length,
      primaryDocNumber
    })

  } catch (err) {
    console.error('[create-spa] Error:', err.message)
    return res.json({ success: false, error: err.message })
  }
})

// ─── 14. SYNC ACCURATE DELIVERY ORDERS (DOs) ─────────────────────────────────
router.all(['/sync-accurate-dos', '/sync-dos'], requireProxyKey, async (req, res) => {
  const { fullSyncHDO } = require('../services/syncHDO')
  try {
    const result = await fullSyncHDO(15)
    return res.json({ success: true, processed: result?.processed || 0, hasMore: false, errors: result?.errors || [] })
  } catch (err) {
    return res.json({ success: false, error: err.message, processed: 0, hasMore: false })
  }
})

// ─── 15. SYNC ACCURATE RECEIVE ITEMS (HRI) ──────────────────────────────────
router.all(['/sync-accurate-receive-items', '/sync-receive-items'], requireProxyKey, async (req, res) => {
  const { fullSyncHRI } = require('../services/syncHRI')
  try {
    const result = await fullSyncHRI(15)
    return res.json({ success: true, processed: result?.processed || 0, hasMore: false, errors: result?.errors || [] })
  } catch (err) {
    return res.json({ success: false, error: err.message, processed: 0, hasMore: false })
  }
})

// ─── 16. SYNC ACCURATE PURCHASE ORDERS (HPO) ────────────────────────────────
router.all(['/sync-accurate-pos', '/sync-pos'], requireProxyKey, async (req, res) => {
  const { fullSyncHPO } = require('../services/syncHPO')
  try {
    const result = await fullSyncHPO(15)
    return res.json({ success: true, processed: result?.processed || 0, hasMore: false, errors: result?.errors || [] })
  } catch (err) {
    return res.json({ success: false, error: err.message, processed: 0, hasMore: false })
  }
})

// ─── 17. SYNC ACCURATE PO SINGLE ────────────────────────────────────────────
router.all(['/sync-accurate-po-single', '/sync-po-single'], requireProxyKey, async (req, res) => {
  const { poId } = req.body || req.query || {}
  const { fetchHPODetail } = require('../utils/accurate')
  const { upsertHPO } = require('../services/syncHPO')
  try {
    if (!poId) return res.json({ success: false, error: 'poId wajib dikirim' })
    const detail = await fetchHPODetail(Number(poId))
    const result = await upsertHPO(detail)
    return res.json({ success: true, ...result })
  } catch (err) {
    return res.json({ success: false, error: err.message })
  }
})

module.exports = router
