// src/routes/dashboard.js
// Visual web dashboard for HSO Accurate Sync Server (Clean Minimalist White with Geist Font & Menu Navigation)

const express = require('express')
const router = express.Router()
const syncTracker = require('../utils/syncTracker')

router.get(['/', '/dashboard'], (req, res) => {
  const status = syncTracker.getStatus()
  const recentLogs = syncTracker.getRecentLogs(50)

  const html = `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>HSO Accurate Sync Engine</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/geist@1.3.1/dist/fonts/geist-sans/style.css">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/geist@1.3.1/dist/fonts/geist-mono/style.css">
  <style>
    body {
      font-family: 'Geist Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background-color: #fafafa;
      color: #18181b;
    }
    .font-mono {
      font-family: 'Geist Mono', monospace;
    }
    .card {
      background: #ffffff;
      border: 1px solid #e4e4e7;
    }
    .nav-btn-active {
      background-color: #18181b;
      color: #ffffff;
    }
    .nav-btn-inactive {
      background-color: #ffffff;
      color: #52525b;
      border: 1px solid #e4e4e7;
    }
    .nav-btn-inactive:hover {
      background-color: #f4f4f5;
      color: #18181b;
    }
    .subtab-active {
      background-color: #18181b;
      color: #ffffff;
    }
    .subtab-inactive {
      background-color: #f4f4f5;
      color: #71717a;
    }
    .subtab-inactive:hover {
      background-color: #e4e4e7;
      color: #18181b;
    }
  </style>
</head>
<body class="min-h-screen antialiased p-4 md:p-8">
  <div class="max-w-6xl mx-auto space-y-6">
    
    <!-- Top Header & Menu Navigation -->
    <header class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-zinc-200">
      <div>
        <h1 class="text-xl font-semibold text-zinc-900 tracking-tight">HSO Accurate Sync</h1>
        <p class="text-xs text-zinc-500 mt-0.5">Accurate Online ➔ Supabase Background & Scheduled Sync</p>
      </div>

      <!-- Button Menu Bar -->
      <div class="flex items-center flex-wrap gap-2">
        <div class="flex items-center space-x-1.5 p-1 rounded-xl bg-zinc-100 border border-zinc-200 text-xs">
          <button onclick="setMenu('dashboard')" id="menu-btn-dashboard" class="nav-btn-active px-3.5 py-1.5 rounded-lg font-medium transition-all">
            Dashboard & Log
          </button>
          <button onclick="setMenu('recent')" id="menu-btn-recent" class="nav-btn-inactive px-3.5 py-1.5 rounded-lg font-medium transition-all">
            Data Terupdate
          </button>
        </div>

        <button onclick="refreshAll()" class="p-2 rounded-xl border border-zinc-200 bg-white hover:bg-zinc-50 text-zinc-600 transition-colors" title="Segarkan Data">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        </button>
      </div>
    </header>

    <!-- VIEW 1: MAIN DASHBOARD & LOGS (DEFAULT) -->
    <div id="view-dashboard" class="space-y-6">
      
      <!-- Summary Statistics Grid -->
      <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div class="card p-4 rounded-xl">
          <span class="text-xs font-medium text-zinc-500">Total Sync Hari Ini</span>
          <div class="mt-2 flex items-baseline justify-between">
            <span class="text-2xl font-semibold text-zinc-900" id="stat-runs">${status.today?.totalRuns || 0}</span>
            <span class="text-[11px] font-medium text-zinc-500 font-mono">putaran</span>
          </div>
          <p class="text-[11px] text-zinc-400 mt-1">Delta 5m + Full per jam</p>
        </div>

        <div class="card p-4 rounded-xl">
          <span class="text-xs font-medium text-zinc-500">Dokumen Diproses</span>
          <div class="mt-2 flex items-baseline justify-between">
            <span class="text-2xl font-semibold text-zinc-900" id="stat-processed">${status.today?.processed || 0}</span>
            <span class="text-[11px] font-medium text-zinc-500 font-mono">dokumen</span>
          </div>
          <p class="text-[11px] text-zinc-400 mt-1">HPO, HRI & HDO</p>
        </div>

        <div class="card p-4 rounded-xl">
          <span class="text-xs font-medium text-zinc-500">Shipment Diperbarui</span>
          <div class="mt-2 flex items-baseline justify-between">
            <span class="text-2xl font-semibold text-zinc-900" id="stat-updated">${status.today?.updated || 0}</span>
            <span class="text-[11px] font-medium text-zinc-500 font-mono">status</span>
          </div>
          <p class="text-[11px] text-zinc-400 mt-1">Already in Hokiindo</p>
        </div>

        <div class="card p-4 rounded-xl">
          <span class="text-xs font-medium text-zinc-500">Terakhir Sync</span>
          <div class="mt-2 flex items-baseline justify-between">
            <span class="text-base font-semibold text-zinc-900 font-mono" id="stat-last-time">
              ${status.lastSync?.time ? new Date(status.lastSync.time).toLocaleTimeString('id-ID') : '-'}
            </span>
            <span class="text-[10px] font-medium px-1.5 py-0.5 rounded bg-zinc-100 text-zinc-700 font-mono uppercase" id="stat-last-status">
              ${status.lastSync?.status || 'IDLE'}
            </span>
          </div>
          <p class="text-[11px] text-zinc-400 mt-1 truncate" id="stat-last-details">
            ${status.lastSync ? `${status.lastSync.target} (${status.lastSync.durationMs}ms)` : 'Menunggu jadwal'}
          </p>
        </div>
      </div>

      <!-- Action Buttons -->
      <div class="card p-5 rounded-xl space-y-3">
        <div class="flex items-center justify-between">
          <div>
            <h2 class="text-sm font-semibold text-zinc-900">Jalankan Sinkronisasi Manual</h2>
            <p class="text-xs text-zinc-500">Trigger proses sync langsung via URL kapan saja</p>
          </div>
          <span id="sync-spinner" class="hidden text-xs text-zinc-600 flex items-center space-x-2">
            <svg class="animate-spin h-3.5 w-3.5 text-zinc-900" viewBox="0 0 24 24" fill="none">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path>
            </svg>
            <span class="font-mono">Menjalankan...</span>
          </span>
        </div>

        <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5 pt-1">
          <button onclick="triggerSync('/sync/delta')" class="p-2.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-white text-xs font-medium text-center transition-colors">
            Delta Sync (Hari Ini)
          </button>

          <button onclick="triggerSync('/sync/all?days=30')" class="p-2.5 rounded-lg bg-zinc-100 hover:bg-zinc-200 border border-zinc-200 text-zinc-900 text-xs font-medium text-center transition-colors">
            Full Sync (30 Hari)
          </button>

          <button onclick="triggerSync('/sync/hri?days=14')" class="p-2.5 rounded-lg bg-zinc-100 hover:bg-zinc-200 border border-zinc-200 text-zinc-900 text-xs font-medium text-center transition-colors">
            Sync HRI (Penerimaan)
          </button>

          <button onclick="triggerSync('/sync/hpo?days=14')" class="p-2.5 rounded-lg bg-zinc-100 hover:bg-zinc-200 border border-zinc-200 text-zinc-900 text-xs font-medium text-center transition-colors">
            Sync HPO (Pesanan)
          </button>

          <button onclick="triggerSync('/sync/hdo?days=14')" class="p-2.5 rounded-lg bg-zinc-100 hover:bg-zinc-200 border border-zinc-200 text-zinc-900 text-xs font-medium text-center transition-colors col-span-2 sm:col-span-1">
            Sync HDO (Surat Jalan)
          </button>
        </div>

        <div id="sync-result-box" class="hidden p-3 rounded-lg border text-xs font-mono"></div>
      </div>

      <!-- Activity Logs Table -->
      <div class="card p-5 rounded-xl space-y-4">
        <div class="flex items-center justify-between">
          <div>
            <h2 class="text-sm font-semibold text-zinc-900">Riwayat Sinkronisasi (Log Aktivitas)</h2>
            <p class="text-xs text-zinc-500">Mencatat delta sync 5 menit, sync 1 jam, dan pemicu manual</p>
          </div>
          <span class="text-[11px] text-zinc-400 font-mono">Auto-update 5s</span>
        </div>

        <div class="overflow-x-auto">
          <table class="w-full text-left text-xs">
            <thead>
              <tr class="border-b border-zinc-200 text-zinc-500 font-medium">
                <th class="py-2.5 px-3">Waktu (WIB)</th>
                <th class="py-2.5 px-3">Tipe</th>
                <th class="py-2.5 px-3">Target</th>
                <th class="py-2.5 px-3">Status</th>
                <th class="py-2.5 px-3">Dokumen</th>
                <th class="py-2.5 px-3">Shipments</th>
                <th class="py-2.5 px-3">Durasi</th>
              </tr>
            </thead>
            <tbody id="logs-table-body" class="divide-y divide-zinc-100 font-mono text-zinc-800">
              ${renderLogRows(recentLogs)}
            </tbody>
          </table>
        </div>
      </div>

    </div>

    <!-- VIEW 2: DATA TERUPDATE (ACCESSED VIA BUTTON MENU) -->
    <div id="view-recent" class="hidden space-y-6">
      
      <div class="card p-5 rounded-xl space-y-4">
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-zinc-200 pb-3">
          <div>
            <h2 class="text-sm font-semibold text-zinc-900">Data Terupdate di Database Supabase</h2>
            <p class="text-xs text-zinc-500">Daftar item dan dokumen yang baru saja tersinkron</p>
          </div>

          <!-- Sub-tabs -->
          <div class="flex items-center space-x-1.5 overflow-x-auto text-xs font-medium">
            <button onclick="switchSubTab('shipments')" id="subtab-btn-shipments" class="subtab-active px-3 py-1.5 rounded-lg transition-colors">
              Shipments (<span id="count-shipments">0</span>)
            </button>
            <button onclick="switchSubTab('hri')" id="subtab-btn-hri" class="subtab-inactive px-3 py-1.5 rounded-lg transition-colors">
              Penerimaan HRI (<span id="count-hri">0</span>)
            </button>
            <button onclick="switchSubTab('hdo')" id="subtab-btn-hdo" class="subtab-inactive px-3 py-1.5 rounded-lg transition-colors">
              Surat Jalan HDO (<span id="count-hdo">0</span>)
            </button>
            <button onclick="switchSubTab('hpo')" id="subtab-btn-hpo" class="subtab-inactive px-3 py-1.5 rounded-lg transition-colors">
              Pesanan HPO (<span id="count-hpo">0</span>)
            </button>
          </div>
        </div>

        <!-- Subtab 1: Shipments -->
        <div id="subtab-content-shipments" class="overflow-x-auto">
          <table class="w-full text-left text-xs">
            <thead>
              <tr class="border-b border-zinc-200 text-zinc-500 font-medium">
                <th class="py-2.5 px-3">SO ID</th>
                <th class="py-2.5 px-3">No. HPO</th>
                <th class="py-2.5 px-3">Item SKU Code</th>
                <th class="py-2.5 px-3">Status Logistik</th>
                <th class="py-2.5 px-3">Tgl Masuk Hokiindo</th>
                <th class="py-2.5 px-3">Waktu Update</th>
              </tr>
            </thead>
            <tbody id="table-shipments-body" class="divide-y divide-zinc-100 font-mono text-zinc-800">
              <tr><td colspan="6" class="py-6 text-center text-zinc-400 font-sans">Memuat data shipments...</td></tr>
            </tbody>
          </table>
        </div>

        <!-- Subtab 2: HRI -->
        <div id="subtab-content-hri" class="hidden overflow-x-auto">
          <table class="w-full text-left text-xs">
            <thead>
              <tr class="border-b border-zinc-200 text-zinc-500 font-medium">
                <th class="py-2.5 px-3">No. HRI</th>
                <th class="py-2.5 px-3">Vendor</th>
                <th class="py-2.5 px-3">Tgl Transaksi</th>
                <th class="py-2.5 px-3">Status Accurate</th>
                <th class="py-2.5 px-3">Waktu Update</th>
              </tr>
            </thead>
            <tbody id="table-hri-body" class="divide-y divide-zinc-100 font-mono text-zinc-800">
              <tr><td colspan="5" class="py-6 text-center text-zinc-400 font-sans">Memuat data HRI...</td></tr>
            </tbody>
          </table>
        </div>

        <!-- Subtab 3: HDO -->
        <div id="subtab-content-hdo" class="hidden overflow-x-auto">
          <table class="w-full text-left text-xs">
            <thead>
              <tr class="border-b border-zinc-200 text-zinc-500 font-medium">
                <th class="py-2.5 px-3">No. HDO</th>
                <th class="py-2.5 px-3">Customer</th>
                <th class="py-2.5 px-3">Tgl Kirim</th>
                <th class="py-2.5 px-3">Status Accurate</th>
                <th class="py-2.5 px-3">Waktu Update</th>
              </tr>
            </thead>
            <tbody id="table-hdo-body" class="divide-y divide-zinc-100 font-mono text-zinc-800">
              <tr><td colspan="5" class="py-6 text-center text-zinc-400 font-sans">Memuat data HDO...</td></tr>
            </tbody>
          </table>
        </div>

        <!-- Subtab 4: HPO -->
        <div id="subtab-content-hpo" class="hidden overflow-x-auto">
          <table class="w-full text-left text-xs">
            <thead>
              <tr class="border-b border-zinc-200 text-zinc-500 font-medium">
                <th class="py-2.5 px-3">No. HPO</th>
                <th class="py-2.5 px-3">Vendor</th>
                <th class="py-2.5 px-3">Tgl PO</th>
                <th class="py-2.5 px-3">Status Accurate</th>
                <th class="py-2.5 px-3">Waktu Update</th>
              </tr>
            </thead>
            <tbody id="table-hpo-body" class="divide-y divide-zinc-100 font-mono text-zinc-800">
              <tr><td colspan="5" class="py-6 text-center text-zinc-400 font-sans">Memuat data HPO...</td></tr>
            </tbody>
          </table>
        </div>
      </div>

    </div>

  </div>

  <script>
    let activeMenu = 'dashboard';
    let currentSubTab = 'shipments';

    function setMenu(menu) {
      activeMenu = menu;
      const btnDashboard = document.getElementById('menu-btn-dashboard');
      const btnRecent = document.getElementById('menu-btn-recent');
      const viewDashboard = document.getElementById('view-dashboard');
      const viewRecent = document.getElementById('view-recent');

      if (menu === 'dashboard') {
        btnDashboard.className = 'nav-btn-active px-3.5 py-1.5 rounded-lg font-medium transition-all';
        btnRecent.className = 'nav-btn-inactive px-3.5 py-1.5 rounded-lg font-medium transition-all';
        viewDashboard.classList.remove('hidden');
        viewRecent.classList.add('hidden');
      } else {
        btnDashboard.className = 'nav-btn-inactive px-3.5 py-1.5 rounded-lg font-medium transition-all';
        btnRecent.className = 'nav-btn-active px-3.5 py-1.5 rounded-lg font-medium transition-all';
        viewDashboard.classList.add('hidden');
        viewRecent.classList.remove('hidden');
        loadRecentData();
      }
    }

    function switchSubTab(tab) {
      currentSubTab = tab;
      const tabs = ['shipments', 'hri', 'hdo', 'hpo'];
      tabs.forEach(t => {
        const btn = document.getElementById('subtab-btn-' + t);
        const content = document.getElementById('subtab-content-' + t);
        if (t === tab) {
          btn.className = 'subtab-active px-3 py-1.5 rounded-lg transition-colors';
          content.classList.remove('hidden');
        } else {
          btn.className = 'subtab-inactive px-3 py-1.5 rounded-lg transition-colors';
          content.classList.add('hidden');
        }
      });
    }

    function formatTime(isoStr) {
      if (!isoStr) return '-';
      const d = new Date(isoStr);
      return d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) + ', ' +
             d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short' });
    }

    function getBadge(status) {
      if (status === 'success') return '<span class="px-2 py-0.5 rounded bg-zinc-100 text-zinc-800 font-medium text-[10px]">OK</span>';
      if (status === 'warning') return '<span class="px-2 py-0.5 rounded bg-zinc-100 text-zinc-700 font-medium text-[10px]">WARN</span>';
      if (status === 'error') return '<span class="px-2 py-0.5 rounded bg-zinc-100 text-red-600 font-medium text-[10px]">ERR</span>';
      return '<span class="px-2 py-0.5 rounded bg-zinc-100 text-zinc-600 font-medium text-[10px]">SYNC</span>';
    }

    function getTypeBadge(type) {
      if (type === 'DELTA_5M') return '<span class="text-zinc-900 font-medium">DELTA 5M</span>';
      if (type === 'HOURLY') return '<span class="text-zinc-600 font-medium">HOURLY</span>';
      if (type === 'NIGHTLY_DEEP') return '<span class="text-zinc-600 font-medium">NIGHTLY</span>';
      return '<span class="text-zinc-900 font-medium">MANUAL</span>';
    }

    function renderLogRows(logs) {
      if (!logs || logs.length === 0) {
        return '<tr><td colspan="7" class="py-6 text-center text-zinc-400 font-sans">Belum ada riwayat sync</td></tr>';
      }
      return logs.map(l => \`
        <tr class="hover:bg-zinc-50 transition-colors">
          <td class="py-2.5 px-3 text-zinc-600">\${formatTime(l.startTime)}</td>
          <td class="py-2.5 px-3">\${getTypeBadge(l.type)}</td>
          <td class="py-2.5 px-3 font-semibold text-zinc-900">\${l.target}</td>
          <td class="py-2.5 px-3">\${getBadge(l.status)}</td>
          <td class="py-2.5 px-3 text-zinc-700">\${l.itemsProcessed || 0}</td>
          <td class="py-2.5 px-3 \${(l.itemsUpdated || 0) > 0 ? 'text-zinc-900 font-semibold' : 'text-zinc-400'}">\${l.itemsUpdated || 0}</td>
          <td class="py-2.5 px-3 text-zinc-500">\${l.durationMs || 0}ms</td>
        </tr>
      \`).join('');
    }

    async function loadRecentData() {
      try {
        const res = await fetch('/sync/recent-data');
        const data = await res.json();
        if (data.status === 'ok') {
          // 1. Shipments
          const ships = data.recentShipments || [];
          document.getElementById('count-shipments').innerText = ships.length;
          document.getElementById('table-shipments-body').innerHTML = ships.length === 0 
            ? '<tr><td colspan="6" class="py-6 text-center text-zinc-400 font-sans">Tidak ada shipment baru</td></tr>'
            : ships.map(s => \`
              <tr class="hover:bg-zinc-50 transition-colors">
                <td class="py-2.5 px-3 text-zinc-500 font-medium">\${s.so_id || '-'}</td>
                <td class="py-2.5 px-3 font-semibold text-zinc-900">\${s.hpo_number || '-'}</td>
                <td class="py-2.5 px-3 text-zinc-800">\${s.item_code || '-'}</td>
                <td class="py-2.5 px-3"><span class="px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 font-medium text-[10px]">\${s.current_status || '-'}</span></td>
                <td class="py-2.5 px-3 font-medium text-zinc-700">\${s.hokiindo_date || '-'}</td>
                <td class="py-2.5 px-3 text-zinc-400 text-[11px]">\${formatTime(s.updated_at)}</td>
              </tr>
            \`).join('');

          // 2. HRI
          const hri = data.recentHRI || [];
          document.getElementById('count-hri').innerText = hri.length;
          document.getElementById('table-hri-body').innerHTML = hri.length === 0
            ? '<tr><td colspan="5" class="py-6 text-center text-zinc-400 font-sans">Tidak ada dokumen HRI</td></tr>'
            : hri.map(h => \`
              <tr class="hover:bg-zinc-50 transition-colors">
                <td class="py-2.5 px-3 font-semibold text-zinc-900">\${h.number || '-'}</td>
                <td class="py-2.5 px-3 text-zinc-800">\${h.vendor_name || '-'}</td>
                <td class="py-2.5 px-3 text-zinc-600">\${h.trans_date || '-'}</td>
                <td class="py-2.5 px-3"><span class="px-2 py-0.5 rounded bg-zinc-100 text-zinc-700 text-[10px] font-medium">\${h.status_name || '-'}</span></td>
                <td class="py-2.5 px-3 text-zinc-400 text-[11px]">\${formatTime(h.updated_at)}</td>
              </tr>
            \`).join('');

          // 3. HDO
          const hdo = data.recentHDO || [];
          document.getElementById('count-hdo').innerText = hdo.length;
          document.getElementById('table-hdo-body').innerHTML = hdo.length === 0
            ? '<tr><td colspan="5" class="py-6 text-center text-zinc-400 font-sans">Tidak ada dokumen HDO</td></tr>'
            : hdo.map(d => \`
              <tr class="hover:bg-zinc-50 transition-colors">
                <td class="py-2.5 px-3 font-semibold text-zinc-900">\${d.number || '-'}</td>
                <td class="py-2.5 px-3 text-zinc-800">\${d.customer_name || '-'}</td>
                <td class="py-2.5 px-3 text-zinc-600">\${d.trans_date || '-'}</td>
                <td class="py-2.5 px-3"><span class="px-2 py-0.5 rounded bg-zinc-100 text-zinc-700 text-[10px] font-medium">\${d.status_name || '-'}</span></td>
                <td class="py-2.5 px-3 text-zinc-400 text-[11px]">\${formatTime(d.updated_at)}</td>
              </tr>
            \`).join('');

          // 4. HPO
          const hpo = data.recentHPO || [];
          document.getElementById('count-hpo').innerText = hpo.length;
          document.getElementById('table-hpo-body').innerHTML = hpo.length === 0
            ? '<tr><td colspan="5" class="py-6 text-center text-zinc-400 font-sans">Tidak ada dokumen HPO</td></tr>'
            : hpo.map(p => \`
              <tr class="hover:bg-zinc-50 transition-colors">
                <td class="py-2.5 px-3 font-semibold text-zinc-900">\${p.number || '-'}</td>
                <td class="py-2.5 px-3 text-zinc-800">\${p.vendor_name || '-'}</td>
                <td class="py-2.5 px-3 text-zinc-600">\${p.trans_date || '-'}</td>
                <td class="py-2.5 px-3"><span class="px-2 py-0.5 rounded bg-zinc-100 text-zinc-700 text-[10px] font-medium">\${p.status_name || '-'}</span></td>
                <td class="py-2.5 px-3 text-zinc-400 text-[11px]">\${formatTime(p.updated_at)}</td>
              </tr>
            \`).join('');
        }
      } catch (err) {
        console.warn('Load recent data error:', err);
      }
    }

    async function refreshData() {
      try {
        const res = await fetch('/sync/logs?limit=50');
        const data = await res.json();
        if (data.status === 'ok') {
          const s = data.summary;
          document.getElementById('stat-runs').innerText = s.today?.totalRuns || 0;
          document.getElementById('stat-processed').innerText = s.today?.processed || 0;
          document.getElementById('stat-updated').innerText = s.today?.updated || 0;
          if (s.lastSync) {
            document.getElementById('stat-last-time').innerText = new Date(s.lastSync.time).toLocaleTimeString('id-ID');
            document.getElementById('stat-last-status').innerText = s.lastSync.status || 'IDLE';
            document.getElementById('stat-last-details').innerText = s.lastSync.target + ' (' + s.lastSync.durationMs + 'ms)';
          }
          document.getElementById('logs-table-body').innerHTML = renderLogRows(data.logs);
        }
      } catch (e) {
        console.warn('Refresh logs error:', e);
      }
    }

    async function refreshAll() {
      if (activeMenu === 'dashboard') {
        await refreshData();
      } else {
        await loadRecentData();
      }
    }

    async function triggerSync(url) {
      const spinner = document.getElementById('sync-spinner');
      const resultBox = document.getElementById('sync-result-box');
      spinner.classList.remove('hidden');
      resultBox.classList.add('hidden');

      try {
        const res = await fetch(url);
        const data = await res.json();
        resultBox.classList.remove('hidden');
        if (data.success) {
          resultBox.className = 'p-3 rounded-lg bg-zinc-50 border border-zinc-200 text-zinc-800 text-xs font-mono';
          resultBox.innerHTML = '✓ <strong>Sync Berhasil:</strong> ' + (data.processed || 0) + ' dokumen diproses, ' + (data.updated || 0) + ' shipments terupdate (' + data.durationMs + 'ms)';
        } else {
          resultBox.className = 'p-3 rounded-lg bg-red-50 border border-red-200 text-red-800 text-xs font-mono';
          resultBox.innerHTML = '✕ <strong>Sync Gagal:</strong> ' + (data.error || 'Terjadi kesalahan');
        }
        await refreshAll();
      } catch (err) {
        resultBox.classList.remove('hidden');
        resultBox.className = 'p-3 rounded-lg bg-red-50 border border-red-200 text-red-800 text-xs font-mono';
        resultBox.innerHTML = '✕ <strong>Request Error:</strong> ' + err.message;
      } finally {
        spinner.classList.add('hidden');
      }
    }

    // Initial load & Auto-refresh every 5 seconds
    refreshAll();
    setInterval(refreshAll, 5000);
  </script>
</body>
</html>`

  res.send(html)
})

function renderLogRows(logs) {
  if (!logs || logs.length === 0) {
    return '<tr><td colspan="7" class="py-6 text-center text-zinc-400 font-sans">Belum ada riwayat sync</td></tr>'
  }
  return logs.map(l => {
    const statusBadge = l.status === 'success' 
      ? '<span class="px-2 py-0.5 rounded bg-zinc-100 text-zinc-800 font-medium text-[10px]">OK</span>'
      : (l.status === 'warning'
        ? '<span class="px-2 py-0.5 rounded bg-zinc-100 text-zinc-700 font-medium text-[10px]">WARN</span>'
        : (l.status === 'error'
          ? '<span class="px-2 py-0.5 rounded bg-zinc-100 text-red-600 font-medium text-[10px]">ERR</span>'
          : '<span class="px-2 py-0.5 rounded bg-zinc-100 text-zinc-600 font-medium text-[10px]">SYNC</span>'))

    const typeBadge = l.type === 'DELTA_5M'
      ? '<span class="text-zinc-900 font-medium">DELTA 5M</span>'
      : (l.type === 'HOURLY'
        ? '<span class="text-zinc-600 font-medium">HOURLY</span>'
        : (l.type === 'NIGHTLY_DEEP'
          ? '<span class="text-zinc-600 font-medium">NIGHTLY</span>'
          : '<span class="text-zinc-900 font-medium">MANUAL</span>'))

    const dateStr = l.startTime 
      ? `${new Date(l.startTime).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}, ${new Date(l.startTime).toLocaleDateString('id-ID', { day: '2-digit', month: 'short' })}`
      : '-'

    return `
      <tr class="hover:bg-zinc-50 transition-colors">
        <td class="py-2.5 px-3 text-zinc-600">${dateStr}</td>
        <td class="py-2.5 px-3">${typeBadge}</td>
        <td class="py-2.5 px-3 font-semibold text-zinc-900">${l.target}</td>
        <td class="py-2.5 px-3">${statusBadge}</td>
        <td class="py-2.5 px-3 text-zinc-700">${l.itemsProcessed || 0}</td>
        <td class="py-2.5 px-3 ${(l.itemsUpdated || 0) > 0 ? 'text-zinc-900 font-semibold' : 'text-zinc-400'}">${l.itemsUpdated || 0}</td>
        <td class="py-2.5 px-3 text-zinc-500">${l.durationMs || 0}ms</td>
      </tr>
    `
  }).join('')
}

module.exports = router
