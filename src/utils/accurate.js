// src/utils/accurate.js
// Accurate Online API client
// Auth: Bearer Token + HMAC-SHA256 Signature (X-Api-Timestamp + X-Api-Signature)

const axios = require('axios')
const crypto = require('crypto')

const BASE_URL = process.env.ACCURATE_BASE_URL || 'https://zeus.accurate.id'

/**
 * Generate HMAC-SHA256 signature untuk setiap request
 * Message = ISO timestamp saat request
 */
function buildAccurateHeaders() {
  const bearerToken = process.env.ACCURATE_BEARER_TOKEN || process.env.ACCURATE_ACCESS_TOKEN
  const secretKey = process.env.ACCURATE_SECRET_KEY || process.env.ACCURATE_SIGNATURE_SECRET

  if (!bearerToken) {
    throw new Error('ACCURATE_BEARER_TOKEN / ACCURATE_ACCESS_TOKEN tidak disetting di environment!')
  }

  const headers = {
    'Authorization': `Bearer ${bearerToken}`,
    'Content-Type': 'application/json',
  }

  if (secretKey) {
    const ts = new Date().toISOString()
    const signature = crypto
      .createHmac('sha256', secretKey)
      .update(ts)
      .digest('base64')

    headers['X-Api-Timestamp'] = ts
    headers['X-Api-Signature'] = signature
  }

  return headers
}

const accurateClient = axios.create({
  baseURL: BASE_URL,
  timeout: 35000,
})

// Inject auth headers setiap request (fresh timestamp + signature tiap call)
accurateClient.interceptors.request.use((config) => {
  const authHeaders = buildAccurateHeaders()
  config.headers = { ...config.headers, ...authHeaders }
  return config
})

// Retry dengan exponential backoff jika rate limit (429) atau server error
accurateClient.interceptors.response.use(
  (res) => res,
  async (err) => {
    const config = err.config
    if (!config || config._retryCount >= 3) return Promise.reject(err)
    const status = err.response?.status
    if (status === 429 || status >= 500) {
      config._retryCount = (config._retryCount || 0) + 1
      const delay = config._retryCount * 2000
      console.log(`⏳ Accurate API retry ${config._retryCount} setelah ${delay}ms (status ${status})`)
      await new Promise(r => setTimeout(r, delay))
      return accurateClient(config)
    }
    return Promise.reject(err)
  }
)

/**
 * Helper to convert YYYY-MM-DD to DD/MM/YYYY for Accurate API filters
 */
function toAccurateDateFormat(dateStr) {
  if (!dateStr) return null
  if (dateStr.includes('/')) return dateStr
  const parts = dateStr.split('-')
  if (parts.length === 3) {
    return `${parts[2]}/${parts[1]}/${parts[0]}`
  }
  return dateStr
}

/**
 * Ambil list HPO (Purchase Order) dari Accurate
 */
async function fetchHPOList({ page = 1, pageSize = 50, fromDate = null, keywords = null } = {}) {
  const params = {
    'fields': 'id,number,transDate,statusName,vendor,totalAmount,currency',
    'sp.page': page,
    'sp.pageSize': pageSize,
    'sp.sort': 'transDate|desc',
  }
  if (fromDate) {
    params['filter.transDateFrom'] = toAccurateDateFormat(fromDate)
  }
  if (keywords) {
    params['keywords'] = keywords
  }

  const res = await accurateClient.get('/accurate/api/purchase-order/list.do', { params })
  return res.data
}

/**
 * Ambil detail HPO berdasarkan ID
 */
async function fetchHPODetail(id) {
  const res = await accurateClient.get('/accurate/api/purchase-order/detail.do', {
    params: { id }
  })
  return res.data
}

/**
 * Ambil list HRI (Receive Item / Penerimaan Barang) dari Accurate
 */
async function fetchHRIList({ page = 1, pageSize = 50, fromDate = null, keywords = null } = {}) {
  const params = {
    'fields': 'id,number,transDate,statusName',
    'sp.page': page,
    'sp.pageSize': pageSize,
    'sp.sort': 'transDate|desc',
  }
  if (fromDate) {
    params['filter.transDateFrom'] = toAccurateDateFormat(fromDate)
  }
  if (keywords) {
    params['keywords'] = keywords
  }

  const res = await accurateClient.get('/accurate/api/receive-item/list.do', { params })
  return res.data
}

/**
 * Ambil detail HRI berdasarkan ID
 */
async function fetchHRIDetail(id) {
  const res = await accurateClient.get('/accurate/api/receive-item/detail.do', {
    params: { id }
  })
  return res.data
}

/**
 * Ambil list HDO (Delivery Order / Surat Jalan) dari Accurate
 */
async function fetchHDOList({ page = 1, pageSize = 50, fromDate = null, keywords = null } = {}) {
  const params = {
    'fields': 'id,number,transDate,statusName,customer,shipTo,driverName',
    'sp.page': page,
    'sp.pageSize': pageSize,
    'sp.sort': 'transDate|desc',
  }
  if (fromDate) {
    params['filter.transDateFrom'] = toAccurateDateFormat(fromDate)
  }
  if (keywords) {
    params['keywords'] = keywords
  }

  const res = await accurateClient.get('/accurate/api/delivery-order/list.do', { params })
  return res.data
}

/**
 * Ambil detail HDO berdasarkan ID
 */
async function fetchHDODetail(id) {
  const res = await accurateClient.get('/accurate/api/delivery-order/detail.do', {
    params: { id }
  })
  return res.data
}

module.exports = {
  fetchHPOList,
  fetchHPODetail,
  fetchHRIList,
  fetchHRIDetail,
  fetchHDOList,
  fetchHDODetail,
  toAccurateDateFormat,
}
