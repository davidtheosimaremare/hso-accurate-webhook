// src/services/syncHRI.js
// Sync Receive Item (HRI/Penerimaan Barang) dari Accurate → Supabase
// HRI yang masuk ke Hokiindo → otomatis update hokiindo_date & current_status di tabel shipments
// 100% konsisten dengan skema HSO Database dan Edge Function sync-accurate-receive-items

const supabase = require('../utils/supabase')
const { fetchHRIList, fetchHRIDetail } = require('../utils/accurate')

function formatDate(dateStr) {
  if (!dateStr) return null
  const parts = String(dateStr).split('/')
  if (parts.length === 3) return `${parts[2]}-${parts[1]}-${parts[0]}`
  if (String(dateStr).match(/^\d{4}-\d{2}-\d{2}$/)) return String(dateStr)
  return null
}

function safeFloat(val) {
  if (typeof val === 'number') return val
  if (typeof val === 'string') return parseFloat(val.replace(/,/g, '')) || 0
  return 0
}

function safeInt(val) {
  if (typeof val === 'number') return Math.floor(val)
  if (typeof val === 'string') return parseInt(val, 10) || null
  return null
}

function extractHso(note) {
  if (!note) return null
  const match = String(note).match(/(HSO\/[\w\d\/]+)/i)
  return match ? match[1] : null
}

/**
 * Map data HRI header dari Accurate ke tabel accurate_receive_items
 */
function mapHRIHeader(d) {
  const poNumber = d.purchaseOrder?.number || d.poNumber || null
  return {
    id: safeInt(d.id),
    number: d.number || 'UNKNOWN',
    vendor_id: safeInt(d.vendor?.id),
    vendor_name: d.vendor?.name || d.vendorName || null,
    trans_date: formatDate(d.transDate),
    status_name: d.statusName || d.status || null,
    branch_id: safeInt(d.branch?.id),
    po_number: poNumber,
    updated_at: new Date().toISOString(),
  }
}

/**
 * Map detail item HRI dari Accurate ke tabel accurate_receive_item_items
 */
function mapHRIItem(item, headerId, index) {
  return {
    id: safeInt(item.id),
    receive_item_id: safeInt(headerId),
    item_code: item.item?.no || item.itemNo || item.code || null,
    item_name: item.item?.name || item.itemName || null,
    quantity: safeFloat(item.quantity),
    unit_name: item.itemUnit?.name || item.unitName || 'PCS',
    detail_notes: item.detailNotes || item.notes || null,
    item_seq: safeInt(item.itemSeq ?? index),
    hso_number: extractHso(item.detailNotes || item.notes || '') || item.hsoNumber || null,
  }
}

/**
 * Update shipments saat Receive Item (HRI) masuk:
 * status -> 'Already in Hokiindo Raya', hokiindo_date -> transDate
 */
async function updateShipmentsFromHRI(docItems, headerPoNumber, transDate) {
  if (!Array.isArray(docItems) || docItems.length === 0) return 0
  const formattedDate = formatDate(transDate) || new Date().toISOString().split('T')[0]
  let totalUpdated = 0

  for (const item of docItems) {
    const itemCode = item.item?.no || item.itemNo || item.item_code
    const poNumber = item.purchaseOrder?.number || item.poNumber || item.po_number || headerPoNumber

    if (!itemCode || !poNumber) continue

    const { error, data } = await supabase
      .from('shipments')
      .update({
        current_status: 'Already in Hokiindo Raya',
        hokiindo_date: formattedDate,
        status_date: formattedDate,
        updated_at: new Date().toISOString(),
      })
      .eq('item_code', itemCode)
      .eq('hpo_number', poNumber)
      .select('id')

    if (!error && data?.length) {
      totalUpdated += data.length
      console.log(`  📦 [HRI] Shipment updated: ${poNumber} / ${itemCode} → Hokiindo (${formattedDate})`)
    }
  }

  return totalUpdated
}

/**
 * Upsert satu HRI ke Supabase dan update shipments yang terkait
 */
async function upsertHRI(accurateData) {
  const d = accurateData.d || accurateData
  if (!d?.id) return { success: false, error: 'No ID in data' }

  const header = mapHRIHeader(d)

  // 1. Upsert header
  const { error: headerErr } = await supabase
    .from('accurate_receive_items')
    .upsert(header, { onConflict: 'id' })

  if (headerErr) {
    console.error(`❌ [HRI] Header upsert error (${header.number}):`, headerErr.message)
    return { success: false, error: headerErr.message }
  }

  // 2. Clean and Insert items jika ada detailItem
  let shipmentsUpdated = 0
  if (Array.isArray(d.detailItem)) {
    // Hapus item lama untuk HRI ini agar tidak duplikat
    await supabase
      .from('accurate_receive_item_items')
      .delete()
      .eq('receive_item_id', header.id)

    if (d.detailItem.length > 0) {
      const items = d.detailItem.map((item, idx) => mapHRIItem(item, header.id, idx))
      const { error: itemsErr } = await supabase
        .from('accurate_receive_item_items')
        .insert(items)

      if (itemsErr) {
        console.error(`❌ [HRI] Items insert error (${header.number}):`, itemsErr.message)
      }
    }

    // 3. Update shipments status dan hokiindo_date
    shipmentsUpdated = await updateShipmentsFromHRI(d.detailItem, header.po_number, d.transDate)
  }

  console.log(`✅ [HRI] ${header.number} (ID: ${header.id}) synced — ${shipmentsUpdated} shipments updated`)
  return { success: true, number: header.number, id: header.id, shipmentsUpdated }
}

/**
 * Sync semua HRI dari Accurate → Supabase
 * @param {number} daysBack - Berapa hari ke belakang (default: 30)
 * @param {string} fromDate - Opsional, tanggal spesifik (YYYY-MM-DD)
 */
async function fullSyncHRI(daysBack = 30, fromDate = null) {
  const fromDateStr = fromDate || (() => {
    const d = new Date()
    d.setDate(d.getDate() - daysBack)
    return d.toISOString().split('T')[0]
  })()

  const label = fromDate ? `delta (sejak ${fromDateStr})` : `${daysBack} hari terakhir`
  console.log(`\n🔄 Sync HRI — ${label}`)

  let page = 1
  let totalSynced = 0
  let totalShipmentsUpdated = 0
  let hasMore = true
  const errors = []
  const pageSize = parseInt(process.env.SYNC_PAGE_SIZE, 10) || 50

  while (hasMore) {
    try {
      const listData = await fetchHRIList({
        page,
        pageSize,
        fromDate: fromDateStr,
      })

      const items = listData?.d || listData?.data || []
      if (!items.length) {
        hasMore = false
        break
      }

      for (const hri of items) {
        const itemDate = formatDate(hri.transDate)
        // Jika dokumen lebih lama dari batas fromDateStr, hentikan sync karena list sudah disort DESC
        if (itemDate && itemDate < fromDateStr) {
          hasMore = false
          break
        }

        try {
          const detail = await fetchHRIDetail(hri.id)
          const res = await upsertHRI(detail)
          if (res.success) {
            totalSynced++
            totalShipmentsUpdated += (res.shipmentsUpdated || 0)
          }
        } catch (err) {
          console.warn(`⚠️ Gagal sync HRI ${hri.number}:`, err.message)
          errors.push(`HRI ${hri.number}: ${err.message}`)
        }
      }

      const totalPages = listData?.pageCount || listData?.totalPage || 1
      if (hasMore) {
        hasMore = page < totalPages && items.length === pageSize
        page++
      }
    } catch (err) {
      console.error(`❌ Error saat fetch HRI list halaman ${page}:`, err.message)
      errors.push(`Page ${page}: ${err.message}`)
      hasMore = false
    }
  }

  console.log(`✅ HRI sync selesai: ${totalSynced} dokumen diproses, ${totalShipmentsUpdated} shipments diperbarui`)
  return { processed: totalSynced, updated: totalShipmentsUpdated, shipmentsUpdated: totalShipmentsUpdated, errors }
}

module.exports = {
  upsertHRI,
  fullSyncHRI,
  mapHRIHeader,
  mapHRIItem,
}
