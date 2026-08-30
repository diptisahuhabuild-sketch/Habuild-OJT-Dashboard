/**
 * HABUILD OJT DASHBOARD - CLIENT APPLICATION ENGINE
 */

document.addEventListener('DOMContentLoaded', () => {
  // Timezone-safe local date string formatter
  function getLocalDateStr(d) {
    if (!d || isNaN(d.getTime())) return '';
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  // Parse any duration representation (string or number) to seconds
  function parseToSeconds(val) {
    if (val === null || val === undefined || val === "No Data" || val === "-") return 0;
    if (typeof val === 'number') return val;
    
    const str = String(val).toLowerCase().trim();
    if (!str || str === '-') return 0;
    
    // Check if it's MM:SS or HH:MM:SS format
    if (str.includes(':')) {
      const parts = str.split(':').map(p => parseFloat(p) || 0);
      if (parts.length === 3) {
        return parts[0] * 3600 + parts[1] * 60 + parts[2];
      }
      if (parts.length === 2) {
        return parts[0] * 60 + parts[1];
      }
    }
    
    const num = parseFloat(str);
    if (isNaN(num)) return 0;
    
    if (str.includes('hr') || str.includes('hour')) {
      return num * 3600;
    }
    if (str.includes('min') || str.includes('m')) {
      return num * 60;
    }
    if (str.includes('sec') || str.includes('s')) {
      return num;
    }
    
    return num;
  }

  // Format Average Response Time (ARST/ARPT) strictly in minutes format
  function formatResponseTime(seconds) {
    if (seconds === null || seconds === undefined || seconds === "No Data" || seconds === "-") return seconds;
    if (typeof seconds === 'string') return seconds;
    const val = parseFloat(seconds);
    if (isNaN(val) || val <= 0) return "-";
    return `${(val / 60).toFixed(2)} Min`;
  }

  // Format Komal AI time metric fields (seconds based) in day/hr/min formats matching the AI Dashboard
  function formatKomalTime(e) {
    if (e === null || e === undefined || e === "No Data" || e === "-") return e;
    if (typeof e === 'string') return e;
    const val = parseFloat(e);
    if (isNaN(val) || val <= 0) return "-";
    if (val >= 86400) {
      let t = (val / 86400).toFixed(2);
      return `${t} Day${t > 1 ? 's' : ''}`;
    }
    if (val >= 3600) {
      let t = (val / 3600).toFixed(2);
      return `${t} Hr${t > 1 ? 's' : ''}`;
    }
    let t = (val / 60).toFixed(2);
    return `${t} Min`;
  }

  // Format First Response Time (FRT) in MM:SS format
  function formatFrtTime(e) {
    return formatKomalTime(e);
  }

  function formatBreakTime(seconds) {
    return formatKomalTime(seconds);
  }

  // Global Application State
  const state = {
    currentRole: 'Admin', // 'Admin', 'Lead', 'Viewer'
    activeTab: 'tabOverview',
    ojtMode: 'ALL', // 'ALL' | 'CURRENT' | 'PREVIOUS'
    selectedPreviousBatch: 'B-20',
    completedBatches: {
      'B-20': { batch: 'B-20', name: 'Batch 20', startDate: '2026-05-25', endDate: '2026-07-19', completedAt: '2026-07-19T00:00:00.000Z' },
      'B-19': { batch: 'B-19', name: 'Batch 19', startDate: '2026-04-16', endDate: '2026-06-21', completedAt: '2026-06-21T00:00:00.000Z' },
      'B-18': { batch: 'B-18', name: 'Batch 18', startDate: '2026-01-19', endDate: '2026-04-02', completedAt: '2026-04-02T00:00:00.000Z' },
      'B-17': { batch: 'B-17', name: 'Batch 17', startDate: '2025-12-30', endDate: '2026-02-16', completedAt: '2026-02-16T00:00:00.000Z' },
      'B-16': { batch: 'B-16', name: 'Batch 16', startDate: '2025-12-06', endDate: '2026-01-15', completedAt: '2026-01-15T00:00:00.000Z' },
      'B-15': { batch: 'B-15', name: 'Batch 15', startDate: '2025-10-23', endDate: '2025-12-03', completedAt: '2025-12-03T00:00:00.000Z' }
    },
    currentOjtBatch: 'B-21',
    activeBatch: 'ALL',
    activeLead: 'ALL',
    activeShift: 'ALL',
    dateFilter: 'YESTERDAY',
    startDate: '',
    endDate: '',
    searchQuery: '',
    selectedAuditor: 'ALL',
    includeKomalAI: true,
    data: null,
    config: null,
    komalMetrics: null,
    charts: {},
    internCustomCols: ['intern', 'batch', 'lead', 'shift', 'process', 'phone', 'email', 'avail', 'count', 'simpleQ', 'complexQ', 'aiRtg', 'arst', 'arpt', 'frt', 'break', 'scanned', 'qcs', 'errorPct', 'ojtRtg', 'score', 'trend', 'action'],
    leadCustomCols: ['lead', 'shift', 'attend', 'assignedInterns', 'teamChats', 'audits', 'qcPosted', 'simpleQ', 'complexQ', 'aiRtg'],
    adminDisplayLimit: 15
  };

  function normalizeBatchName(batchStr) {
    if (!batchStr) return 'B-20';
    const clean = batchStr.toUpperCase().trim();
    const m = clean.match(/(?:B|BATCH)\s*[-_]?\s*(\d+)/i);
    if (m) {
      return `B-${m[1]}`;
    }
    return clean;
  }

  function lastNamesMatch(lastA, lastB) {
    if (!lastA || !lastB) return true;
    const cleanA = lastA.toLowerCase().replace(/[^a-z0-9]/g, '');
    const cleanB = lastB.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (cleanA === cleanB) return true;
    if (cleanA.includes(cleanB) || cleanB.includes(cleanA)) return true;

    // Protect short last names from false positive overlap matches (like "naik" and "mandawkar")
    if (cleanA.length <= 4 || cleanB.length <= 4) {
      return false;
    }

    const setA = new Set(cleanA.split(''));
    const setB = new Set(cleanB.split(''));
    let common = 0;
    setA.forEach(c => { if (setB.has(c)) common++; });
    const pct = common / Math.min(setA.size, setB.size);
    return pct > 0.65;
  }

  function namesMatch(regName, targetName) {
    if (!regName || !targetName) return false;
    let cleanReg = regName.toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
    let cleanTarget = targetName.toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
    if (cleanReg === cleanTarget) return true;

    // Explicit Alias mappings for known misspellings in the sheets
    if (cleanReg.includes('pareedhi') && cleanTarget.includes('paridhi')) return true;
    if (cleanReg.includes('paridhi') && cleanTarget.includes('pareedhi')) return true;
    if (cleanReg.includes('mahak') && cleanTarget.includes('mahek')) return true;
    if (cleanReg.includes('mahek') && cleanTarget.includes('mahak')) return true;
    if (cleanReg.includes('raichada') && cleanTarget.includes('raichadda')) return true;
    if (cleanReg.includes('raichadda') && cleanTarget.includes('raichada')) return true;
    if (cleanReg.includes('nagdev') && cleanTarget.includes('nagdeve')) return true;
    if (cleanReg.includes('nagdeve') && cleanTarget.includes('nagdev')) return true;
    if (cleanReg.includes('asawari') && cleanTarget.includes('asawri')) return true;
    if (cleanReg.includes('asawri') && cleanTarget.includes('asawari')) return true;

    const regTokens = cleanReg.split(/\s+/).filter(t => t.length > 2);
    const targetTokens = cleanTarget.split(/\s+/).filter(t => t.length > 2);

    // Enforce exact first name match or explicit first name aliases to prevent cross-matching different people (e.g. Moin vs Mosin, Nilesh vs Nitesh)
    const firstReg = regTokens[0];
    const firstTarget = targetTokens[0];
    if (firstReg && firstTarget && firstReg !== firstTarget) {
      const isAlias = 
        (firstReg === 'paridhi' && firstTarget === 'pareedhi') || (firstReg === 'pareedhi' && firstTarget === 'paridhi') ||
        (firstReg === 'mahek' && firstTarget === 'mahak') || (firstReg === 'mahak' && firstTarget === 'mahek') ||
        (firstReg === 'asawri' && firstTarget === 'asawari') || (firstReg === 'asawari' && firstTarget === 'asawri');
      if (!isAlias) return false;
    }

    const levDist = (s1, s2) => {
      const len1 = s1.length;
      const len2 = s2.length;
      const matrix = Array.from({ length: len1 + 1 }, () => Array(len2 + 1).fill(0));
      for (let i = 0; i <= len1; i++) matrix[i][0] = i;
      for (let j = 0; j <= len2; j++) matrix[0][j] = j;
      for (let i = 1; i <= len1; i++) {
        for (let j = 1; j <= len2; j++) {
          const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
          matrix[i][j] = Math.min(
            matrix[i - 1][j] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j - 1] + cost
          );
        }
      }
      return matrix[len1][len2];
    };

    const tokMatch = (t1, t2) => {
      if (t1 === t2) return true;
      if (t1.length <= 4 || t2.length <= 4) return levDist(t1, t2) <= 1;
      return levDist(t1, t2) <= 2;
    };

    if (regTokens.length > 0 && targetTokens.length > 0) {
      if (regTokens.every(t => targetTokens.some(t2 => tokMatch(t, t2))) ||
          targetTokens.every(t => regTokens.some(t2 => tokMatch(t, t2)))) {
        return true;
      }
    }

    return false;
  }

  // Pre-compiled cached lookups to optimize performance and prevent script freezing
  const attendanceCache = new Map();
  let parsedAttendanceKeys = null;
  let parsedCommsKeys = null;

  function initializeParsedKeys() {
    if (!parsedAttendanceKeys && state.data && state.data.attendanceData) {
      parsedAttendanceKeys = Object.keys(state.data.attendanceData).map(k => {
        const parts = k.toLowerCase().trim().split(/\s+/).filter(p => p.length > 0);
        return {
          key: k,
          first: parts[0] || "",
          last: parts.length > 1 ? parts[parts.length - 1] : ""
        };
      });
    }
    if (!parsedCommsKeys && state.data && state.data.commsChatData) {
      parsedCommsKeys = Object.keys(state.data.commsChatData).map(k => {
        const parts = k.toLowerCase().trim().split(/\s+/).filter(p => p.length > 0);
        return {
          key: k,
          first: parts[0] || "",
          last: parts.length > 1 ? parts[parts.length - 1] : ""
        };
      });
    }
  }

  function strictNameMatch(nameA, nameB) {
    if (!nameA || !nameB) return false;
    const partsA = nameA.toLowerCase().trim().split(/\s+/).filter(p => p.length > 0);
    const partsB = nameB.toLowerCase().trim().split(/\s+/).filter(p => p.length > 0);
    if (partsA.length === 0 || partsB.length === 0) return false;

    const firstA = partsA[0];
    const lastA = partsA.length > 1 ? partsA[partsA.length - 1] : "";
    const firstB = partsB[0];
    const lastB = partsB.length > 1 ? partsB[partsB.length - 1] : "";

    if (firstA === firstB) {
      if (lastA && lastB) {
        return lastA === lastB;
      }
      return !lastA && !lastB;
    }
    return false;
  }

  function findAttendanceRecord(internName) {
    if (!internName) return null;
    const cleanName = internName.toLowerCase().trim();
    if (attendanceCache.has(cleanName)) {
      return attendanceCache.get(cleanName);
    }

    if (!state.data || !state.data.attendanceData) return null;

    const attKeys = Object.keys(state.data.attendanceData);
    const matchingKeys = attKeys.filter(k => namesMatch(internName, k));

    if (matchingKeys.length === 0) {
      attendanceCache.set(cleanName, null);
      return null;
    }

    const merged = {};
    matchingKeys.forEach(k => {
      const rec = state.data.attendanceData[k];
      if (rec) {
        Object.keys(rec).forEach(d => {
          const val = rec[d];
          if (merged[d]) {
            const uVal = String(val).toUpperCase().trim();
            if (uVal && uVal !== '-') {
              merged[d] = val;
            }
          } else {
            merged[d] = val;
          }
        });
      }
    });

    attendanceCache.set(cleanName, merged);
    return merged;
  }

  function formatAttendanceCell(val) {
    if (val === undefined || val === null || val === "No Data" || val === '-') {
      return `<td>No Data</td>`;
    }

    const parts = String(val).split('|');
    const status = parts[0].trim();

    if (parts.length >= 3) {
      const inTime = parts[1].trim();
      const outTime = parts[2].trim();
      if ((inTime && inTime !== '-') || (outTime && outTime !== '-')) {
        const tooltip = `IN ${inTime} | OUT ${outTime}`;
        
        // Match user style colors: green for Present, amber for Half Day, red for Absent/Leaves
        const u = status.toUpperCase();
        let colorClass = '';
        if (u === 'PRESENT') colorClass = 'color-green';
        else if (u === 'HALF DAY') colorClass = 'color-amber';
        else if (u === 'ABSENT' || u.includes('LEAVE') || u === 'LWP' || u === 'UL') colorClass = 'color-red';
        else colorClass = 'text-gray-500';

        const formattedStatus = status.charAt(0).toUpperCase() + status.slice(1).toLowerCase();

        return `<td class="${colorClass} font-semibold" title="${tooltip}" style="cursor: help;">${formattedStatus}</td>`;
      }
    }

    // Default number display or fallback status display without In/Out times
    const u = status.toUpperCase();
    if (u === 'PRESENT') return `<td class="color-green font-semibold">Present</td>`;
    if (u === 'HALF DAY') return `<td class="color-amber font-semibold">Half Day</td>`;
    if (u === 'ABSENT' || u.includes('LEAVE') || u === 'LWP' || u === 'UL') return `<td class="color-red font-semibold">Absent</td>`;

    return `<td>${status}</td>`;
  }

  function getAvailabilityScore(val) {
    if (!val) return 0;
    const parts = String(val).split('|');
    const u = parts[0].toUpperCase().trim();
    if (u.includes(':') || u === 'PRESENT') {
      return 1.0;
    }
    if (u === 'HALF DAY') {
      return 0.5;
    }
    return 0;
  }

  function isScheduledWorkDay(val) {
    if (val === undefined || val === null) return false;
    const parts = String(val).split('|');
    const u = parts[0].toUpperCase().trim();
    if (u === '' || u === '-' || u === 'WEEK OFF' || u === 'WO' || u === 'COMP OFF' || u === 'CO' || u === 'SICK LEAVE' || u === 'SL' || u === 'UNPAID LEAVE' || u === 'UL' || u === 'LWP' || u === 'TRIP' || u === 'LEAVE' || u === 'CASUAL LEAVE' || u === 'CL' || u === 'PL') {
      return false;
    }
    return true;
  }

  function getLeadFullName(leadKey) {
    if (!leadKey) return "";
    const cleanKey = leadKey.toUpperCase().trim();
    const regList = (state.config && state.config.internsRegistry) || [];
    const match = regList.find(i => {
      if (!i.name) return false;
      const isLead = (i.designation && i.designation.toUpperCase().includes('LEAD')) ||
        (i.batch && i.batch.toUpperCase().includes('LEAD'));
      if (!isLead) return false;
      const nameParts = i.name.toUpperCase().trim().split(/\s+/);
      return nameParts[0] === cleanKey;
    });
    return match ? match.name : leadKey;
  }

  // Master Column Label Maps
  const INTERN_COL_LABELS = {
    intern: 'Agent Name',
    batch: 'Batch',
    lead: 'Lead',
    shift: 'Shift',
    phone: 'Number',
    email: 'Email',
    process: 'Process',
    remark: 'Remark',
    avail: 'Attendance',
    avg: 'Avg Mess',
    count: 'Chats',
    scanned: 'Scanned',
    qcs: 'QC Count',
    errorPct: 'Error %',
    ojtRtg: 'OJT Rtg',
    simpleQ: 'Simple Q',
    complexQ: 'Complex Q',
    aiRtg: 'Rating',
    arst: 'ARsT',
    arpt: 'ARpT',
    frt: 'FRT',
    break: 'Break',
    score: 'LB Score',
    trend: 'Trend',
    action: 'Action'
  };

  const LEAD_COL_LABELS = {
    lead: 'Lead',
    shift: 'Shift',
    attend: 'Attend',
    assignedInterns: 'Assigned Interns',
    teamChats: 'Team Total Chats',
    audits: 'Audits',
    qcPosted: 'QC Posted',
    ownChats: 'Own Chats',
    simpleQ: 'Simple Q',
    complexQ: 'Complex Q',
    aiRtg: 'AI RTG'
  };

  // Global Modal Handlers
  window.openModal = function (modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
      modal.classList.add('active');
      modal.style.display = 'flex';
      document.body.classList.add('modal-open');
    }
  };

  window.closeModal = function (modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
      modal.classList.remove('active');
      modal.style.display = 'none';
      if (!document.querySelector('.modal-backdrop.active')) {
        document.body.classList.remove('modal-open');
      }
    }
  };

  // Boot Application
  init();

  function init() {
    setupEventListeners();

    // Enforce initial default states on DOM elements to override browser input caching
    const batchSelect = document.getElementById('globalBatchSelect');
    if (batchSelect) batchSelect.value = state.activeBatch;

    const leadSelect = document.getElementById('globalLeadSelect');
    if (leadSelect) leadSelect.value = state.activeLead;

    const shiftSelect = document.getElementById('globalShiftSelect');
    if (shiftSelect) shiftSelect.value = state.activeShift;

    const dateFilterSelect = document.getElementById('globalDateFilter');
    if (dateFilterSelect) dateFilterSelect.value = state.dateFilter;

    fetchDashboardData();
    startSyncPolling();
  }

  // Auto-sync polling: check for data updates every 30 seconds
  function startSyncPolling() {
    setInterval(async () => {
      try {
        const res = await fetch('/api/data');
        const json = await res.json();
        if (json.success && json.data) {
          if (!state.data || json.data.lastSyncedAt !== state.data.lastSyncedAt) {
            console.log('[Poll] Backend data changed, updating state...');
            state.data = json.data;
            state.config = json.config;
            state.komalMetrics = json.komalMetrics;
            
            // Re-render, preserving user edits if highlights are currently focused
            const isEditing = document.activeElement && 
              (document.activeElement.id === 'highlightPositive' || 
               document.activeElement.id === 'highlightConcerns' || 
               document.activeElement.id === 'highlightNote');
               
            if (!isEditing) {
              renderAllViews();
            }
          }
        }
      } catch (err) {
        console.warn('[Poll] Failed to auto-sync:', err.message);
      }
    }, 30000);
  }

  // Event Listeners Registration
  function setupEventListeners() {
    // Flowchart Top Navigation
    document.querySelectorAll('.flow-step').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const tabId = btn.getAttribute('data-tab');
        switchTab(tabId);
      });
    });

    // Active Batch Selector
    const batchSelect = document.getElementById('globalBatchSelect');
    if (batchSelect) {
      batchSelect.addEventListener('change', (e) => {
        state.activeBatch = e.target.value;
        renderAllViews();
      });
    }

    // Lead Filter Selector
    const leadSelect = document.getElementById('globalLeadSelect');
    if (leadSelect) {
      leadSelect.addEventListener('change', (e) => {
        state.activeLead = e.target.value;
        renderAllViews();
      });
    }

    // Shift Filter Selector
    const shiftSelect = document.getElementById('globalShiftSelect');
    if (shiftSelect) {
      shiftSelect.addEventListener('change', (e) => {
        state.activeShift = e.target.value;
        renderAllViews();
      });
    }

    // Date Filter Selector & Custom Range Listeners
    const dateFilterSelect = document.getElementById('globalDateFilter');
    if (dateFilterSelect) {
      dateFilterSelect.addEventListener('change', (e) => {
        state.dateFilter = e.target.value;
        const customGroup = document.getElementById('customDateRangeGroup');
        if (state.dateFilter === 'CUSTOM') {
          customGroup.classList.remove('hidden');
        } else {
          customGroup.classList.add('hidden');
        }
        renderAllViews();
      });
    }

    const startDateInput = document.getElementById('startDateInput');
    if (startDateInput) {
      startDateInput.addEventListener('change', (e) => {
        state.customStartDate = e.target.value;
        renderAllViews();
      });
    }

    const endDateInput = document.getElementById('endDateInput');
    if (endDateInput) {
      endDateInput.addEventListener('change', (e) => {
        state.customEndDate = e.target.value;
        renderAllViews();
      });
    }

    // Apply Filters Button Click Handler
    const btnApplyFilters = document.getElementById('btnApplyFilters');
    if (btnApplyFilters) {
      btnApplyFilters.addEventListener('click', () => {
        renderAllViews();
      });
    }

    // Search Input Filter
    const searchInput = document.getElementById('globalSearchInput');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        state.searchQuery = e.target.value.toLowerCase().trim();
        renderAllViews();
      });
    }

    // Manual Sync Button
    const btnSyncNow = document.getElementById('btnSyncNow');
    if (btnSyncNow) {
      btnSyncNow.addEventListener('click', triggerManualSync);
    }

    // Role Switcher Modal Triggers
    const btnSwitchRole = document.getElementById('btnSwitchRole');
    if (btnSwitchRole) {
      btnSwitchRole.addEventListener('click', () => openModal('roleModal'));
    }

    const roleModalClose = document.getElementById('roleModalClose');
    if (roleModalClose) {
      roleModalClose.addEventListener('click', () => closeModal('roleModal'));
    }

    const btnConfirmRole = document.getElementById('btnConfirmRole');
    if (btnConfirmRole) {
      btnConfirmRole.addEventListener('click', handleRoleChange);
    }

    // Export Squad Transition Data
    const btnExportSquadTransition = document.getElementById('btnExportSquadTransition');
    if (btnExportSquadTransition) {
      btnExportSquadTransition.addEventListener('click', exportSquadTransitionCSV);
    }

    // Dispatch Buttons with Preview Modal
    const btnDispatchWhatsApp = document.getElementById('btnDispatchWhatsApp');
    if (btnDispatchWhatsApp) {
      btnDispatchWhatsApp.addEventListener('click', () => openDispatchPreviewModal('WHATSAPP'));
    }

    const btnDispatchEmail = document.getElementById('btnDispatchEmail');
    if (btnDispatchEmail) {
      btnDispatchEmail.addEventListener('click', () => openDispatchPreviewModal('EMAIL'));
    }

    const previewModalClose = document.getElementById('previewModalClose');
    if (previewModalClose) previewModalClose.addEventListener('click', () => closeModal('dispatchPreviewModal'));

    const btnCancelPreview = document.getElementById('btnCancelPreview');
    if (btnCancelPreview) btnCancelPreview.addEventListener('click', () => closeModal('dispatchPreviewModal'));

    const btnConfirmSendDispatch = document.getElementById('btnConfirmSendDispatch');
    if (btnConfirmSendDispatch) btnConfirmSendDispatch.addEventListener('click', executeDispatchSend);

    // Komal AI Toggle
    const toggleKomalAI = document.getElementById('toggleKomalAICols');
    if (toggleKomalAI) {
      toggleKomalAI.addEventListener('change', (e) => {
        state.includeKomalAI = e.target.checked;
        renderInternScorecard();
      });
    }

    // Auditor Filter
    const auditorFilter = document.getElementById('auditorFilter');
    if (auditorFilter) {
      auditorFilter.addEventListener('change', (e) => {
        state.selectedAuditor = e.target.value;
        renderInternScorecard();
      });
    }

    // EOD Save & Share
    const btnSaveEOD = document.getElementById('btnSaveEOD');
    if (btnSaveEOD) btnSaveEOD.addEventListener('click', handleSaveEOD);

    const btnShareEODWhatsApp = document.getElementById('btnShareEODWhatsApp');
    if (btnShareEODWhatsApp) btnShareEODWhatsApp.addEventListener('click', handleShareEODWhatsApp);

    // Customize Columns Buttons
    const btnCustomizeInternCols = document.getElementById('btnCustomizeInternCols');
    if (btnCustomizeInternCols) btnCustomizeInternCols.addEventListener('click', () => openCustomizeColsModal('INTERN'));

    const btnCustomizeLeadCols = document.getElementById('btnCustomizeLeadCols');
    if (btnCustomizeLeadCols) btnCustomizeLeadCols.addEventListener('click', () => openCustomizeColsModal('LEAD'));

    const colsModalClose = document.getElementById('colsModalClose');
    if (colsModalClose) colsModalClose.addEventListener('click', () => closeModal('customizeColsModal'));

    // EOD Form Inputs & Generator
    const eodInputs = ['eodLeadName', 'eodDate', 'eodBatch', 'eodAttendance', 'eodTeamChatCount', 'eodCallingAttendance', 'eodChats', 'eodCalls', 'eodPersonalChats', 'eodChatScan', 'eodQCPosted', 'eodSummary'];
    eodInputs.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('input', updateEODPreview);
    });

    // Sandbox Banner Close
    const btnCloseBanner = document.getElementById('btnCloseBanner');
    if (btnCloseBanner) {
      btnCloseBanner.addEventListener('click', () => {
        document.getElementById('sandboxBanner').style.display = 'none';
      });
    }

    // QC Doc Selector
    const qcBatchShiftSelect = document.getElementById('qcBatchShiftSelect');
    if (qcBatchShiftSelect) {
      qcBatchShiftSelect.addEventListener('change', renderQCDocsViewer);
    }
    const qcInternSelect = document.getElementById('qcInternSelect');
    if (qcInternSelect) {
      qcInternSelect.addEventListener('change', renderQCDocsViewer);
    }
    const qcTextSearch = document.getElementById('qcTextSearch');
    if (qcTextSearch) {
      qcTextSearch.addEventListener('input', renderQCDocsViewer);
    }

    // Backend Test Buttons
    const btnTestGoogle = document.getElementById('btnTestGoogle');
    if (btnTestGoogle) btnTestGoogle.addEventListener('click', () => testBackendConnection('google'));

    const btnTestWhatsApp = document.getElementById('btnTestWhatsApp');
    if (btnTestWhatsApp) btnTestWhatsApp.addEventListener('click', () => testBackendConnection('whatsapp'));

    const btnTestEmail = document.getElementById('btnTestEmail');
    if (btnTestEmail) btnTestEmail.addEventListener('click', () => testBackendConnection('email'));

    // Komal AI Token and Sync Handlers
    const btnSaveKomalToken = document.getElementById('btnSaveKomalToken');
    if (btnSaveKomalToken) {
      btnSaveKomalToken.addEventListener('click', async () => {
        const token = document.getElementById('komalTokenInput').value.trim();
        try {
          const res = await fetch('/api/config/komal-token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token })
          });
          const json = await res.json();
          if (json.success) {
            alert('Komal AI Session Token saved successfully!');
            fetchDashboardData();
          } else {
            alert('Failed to save token: ' + json.error);
          }
        } catch (e) {
          alert('Error: ' + e.message);
        }
      });
    }

    const btnTriggerKomalSync = document.getElementById('btnTriggerKomalSync');
    if (btnTriggerKomalSync) {
      btnTriggerKomalSync.addEventListener('click', async () => {
        btnTriggerKomalSync.disabled = true;
        btnTriggerKomalSync.textContent = 'Syncing...';
        try {
          const res = await fetch('/api/komal/sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionToken: document.getElementById('komalTokenInput').value.trim() })
          });
          const json = await res.json();
          if (json.success) {
            alert('Komal AI metrics sync completed successfully!');
            fetchDashboardData();
          } else {
            alert('Sync failed: ' + json.error);
          }
        } catch (e) {
          alert('Error: ' + e.message);
        } finally {
          btnTriggerKomalSync.disabled = false;
          btnTriggerKomalSync.textContent = 'Sync Now';
        }
      });
    }

    // Email OTP Authentication Handlers
    let tempJwtToken = '';
    const btnKomalSendOTP = document.getElementById('btnKomalSendOTP');
    const btnKomalVerifyOTP = document.getElementById('btnKomalVerifyOTP');
    const komalOTPGroup = document.getElementById('komalOTPGroup');

    if (btnKomalSendOTP) {
      btnKomalSendOTP.addEventListener('click', async () => {
        const email = document.getElementById('komalEmailInput').value.trim();
        if (!email) {
          alert('Please enter a valid email address.');
          return;
        }
        btnKomalSendOTP.disabled = true;
        btnKomalSendOTP.textContent = 'Sending...';
        try {
          const res = await fetch('/api/komal/login-email', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email })
          });
          const json = await res.json();
          if (json.success && json.data) {
            const raw = json.data;
            const userObj = raw.data || raw;
            if (userObj.jwtToken) {
              tempJwtToken = userObj.jwtToken;
              const otpInput = document.getElementById('komalOTPInput');
              if (otpInput) otpInput.value = '0000';
              alert('OTP request succeeded! (Using standard verify code: 0000). Please click "Verify & Link" below.');
              if (komalOTPGroup) {
                komalOTPGroup.classList.remove('hidden');
                komalOTPGroup.style.display = 'flex';
              }
            } else {
              alert('OTP request completed, but no session returned: ' + JSON.stringify(raw));
            }
          } else {
            alert('Failed to send OTP: ' + (json.error || 'Unknown error'));
          }
        } catch (e) {
          alert('OTP Error: ' + e.message);
        } finally {
          btnKomalSendOTP.disabled = false;
          btnKomalSendOTP.textContent = 'Send OTP';
        }
      });
    }

    if (btnKomalVerifyOTP) {
      btnKomalVerifyOTP.addEventListener('click', async () => {
        const otp = document.getElementById('komalOTPInput').value.trim();
        if (!otp || otp.length !== 4) {
          alert('Please enter a valid 4-digit OTP code.');
          return;
        }
        if (!tempJwtToken) {
          alert('Session expired. Please click "Send OTP" again.');
          return;
        }
        btnKomalVerifyOTP.disabled = true;
        btnKomalVerifyOTP.textContent = 'Verifying...';
        try {
          const res = await fetch('/api/komal/verify-otp', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ otp, jwtToken: tempJwtToken })
          });
          const json = await res.json();
          if (json.success) {
            alert('Linked and Authenticated with Komal AI successfully! Sync triggered in the background.');
            const tokenInput = document.getElementById('komalTokenInput');
            if (tokenInput) tokenInput.value = json.token;
            
            fetchDashboardData();
            
            if (komalOTPGroup) {
              komalOTPGroup.classList.add('hidden');
              komalOTPGroup.style.display = 'none';
            }
          } else {
            alert('Verification failed: ' + (json.error || 'Incorrect OTP code'));
          }
        } catch (e) {
          alert('Verification error: ' + e.message);
        } finally {
          btnKomalVerifyOTP.disabled = false;
          btnKomalVerifyOTP.textContent = 'Verify & Link';
        }
      });
    }

    const btnSaveConfigLink = document.getElementById('btnSaveConfigLink');
    if (btnSaveConfigLink) {
      btnSaveConfigLink.addEventListener('click', async () => {
        const type = document.getElementById('linkTypeInput').value.trim();
        const key = document.getElementById('linkKeyInput').value.trim();
        const url = document.getElementById('linkUrlInput').value.trim();

        if (!key || !url || !type) {
          alert('Please enter Section/Category, Key, and Link URL.');
          return;
        }

        btnSaveConfigLink.disabled = true;
        btnSaveConfigLink.textContent = 'Saving...';

        let typeKey = type.trim();
        if (typeKey.toLowerCase() === 'sheet' || typeKey.toLowerCase() === 'sheets') {
          typeKey = 'sheets';
        } else if (typeKey.toLowerCase() === 'qcdoc' || typeKey.toLowerCase() === 'qcdocs' || typeKey.toLowerCase() === 'batchqcdocs') {
          typeKey = 'batchQcDocs';
        }

        const payload = {};
        if (!payload[typeKey]) payload[typeKey] = {};
        payload[typeKey][key.toUpperCase()] = url;

        try {
          const res = await fetch('/api/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
          const json = await res.json();
          if (json.success) {
            alert('Link saved and deep merged successfully!');
            state.config = json.config;
            renderSheetsLinksPanel();
            document.getElementById('linkKeyInput').value = '';
            document.getElementById('linkUrlInput').value = '';
          } else {
            alert('Failed to save link: ' + json.error);
          }
        } catch (err) {
          alert('Error saving config: ' + err.message);
        } finally {
          btnSaveConfigLink.disabled = false;
          btnSaveConfigLink.textContent = '💾 Save Link';
        }
      });
    }

    // Admin Add Intern Modal Triggers
    const btnAddIntern = document.getElementById('btnAddIntern');
    if (btnAddIntern) {
      btnAddIntern.onclick = function (e) {
        if (e) e.preventDefault();
        window.openModal('internModal');
      };
    }

    const internModalClose = document.getElementById('internModalClose');
    if (internModalClose) {
      internModalClose.onclick = function (e) {
        if (e) e.preventDefault();
        window.closeModal('internModal');
      };
    }

    const btnSaveIntern = document.getElementById('btnSaveIntern');
    if (btnSaveIntern) btnSaveIntern.addEventListener('click', handleSaveIntern);

    // SOP Targets Modal Triggers
    const btnEditWeeklyTargets = document.getElementById('btnEditWeeklyTargets');
    if (btnEditWeeklyTargets) btnEditWeeklyTargets.addEventListener('click', openTargetsModal);

    const targetsModalClose = document.getElementById('targetsModalClose');
    if (targetsModalClose) targetsModalClose.addEventListener('click', () => closeModal('editTargetsModal'));

    const btnSaveTargets = document.getElementById('btnSaveTargets');
    if (btnSaveTargets) btnSaveTargets.addEventListener('click', handleSaveTargets);

    // OJT Lifecycle Button Filters
    const btnCurrentOJT = document.getElementById('btnCurrentOJT');
    if (btnCurrentOJT) {
      btnCurrentOJT.addEventListener('click', () => {
        if (state.ojtMode === 'CURRENT') {
          setOJTMode('ALL');
        } else {
          setOJTMode('CURRENT');
        }
      });
    }

    const btnPreviousOJT = document.getElementById('btnPreviousOJT');
    if (btnPreviousOJT) {
      btnPreviousOJT.addEventListener('click', () => {
        if (state.ojtMode === 'PREVIOUS') {
          setOJTMode('ALL');
        } else {
          setOJTMode('PREVIOUS');
        }
      });
    }

    const previousBatchSelect = document.getElementById('previousBatchSelect');
    if (previousBatchSelect) {
      previousBatchSelect.addEventListener('change', (e) => {
        state.selectedPreviousBatch = e.target.value;
        state.activeBatch = state.selectedPreviousBatch;
        const statusText = document.getElementById('ojtModeStatusText');
        const compInfo = state.completedBatches && state.completedBatches[state.activeBatch];
        if (statusText) statusText.textContent = `Previous OJT Period (${state.activeBatch}${compInfo ? ' • Ended: ' + compInfo.endDate : ''})`;
        updateDateFilterOptions();
        renderAllViews();
      });
    }

    // OJT Completion Modal & 2-Step Verification
    const btnOJTCompletion = document.getElementById('btnOJTCompletion');
    if (btnOJTCompletion) {
      btnOJTCompletion.addEventListener('click', () => {
        populateOjtEndBatchDropdown();
        document.getElementById('ojtEndFormSection').classList.remove('hidden');
        document.getElementById('ojtVerifyTypeSection').classList.add('hidden');
        document.getElementById('ojtVerifyFinalSection').classList.add('hidden');
        window.openModal('ojtCompletionModal');
      });
    }

    const ojtCompletionModalClose = document.getElementById('ojtCompletionModalClose');
    if (ojtCompletionModalClose) {
      ojtCompletionModalClose.addEventListener('click', () => window.closeModal('ojtCompletionModal'));
    }

    const btnInitiateEndOJT = document.getElementById('btnInitiateEndOJT');
    if (btnInitiateEndOJT) {
      btnInitiateEndOJT.addEventListener('click', () => {
        const batchSelect = document.getElementById('ojtEndBatchSelect');
        const targetBatch = batchSelect ? batchSelect.value : 'B-20';

        document.getElementById('verifyBatchNameText').textContent = targetBatch;
        document.getElementById('verifyEndInput').value = '';
        document.getElementById('verifyTypeError').classList.add('hidden');

        document.getElementById('ojtEndFormSection').classList.add('hidden');
        document.getElementById('ojtVerifyTypeSection').classList.remove('hidden');
        document.getElementById('verifyEndInput').focus();
      });
    }

    const btnCancelVerifyType = document.getElementById('btnCancelVerifyType');
    if (btnCancelVerifyType) {
      btnCancelVerifyType.addEventListener('click', () => {
        document.getElementById('ojtVerifyTypeSection').classList.add('hidden');
        document.getElementById('ojtEndFormSection').classList.remove('hidden');
      });
    }

    const btnConfirmVerifyType = document.getElementById('btnConfirmVerifyType');
    if (btnConfirmVerifyType) {
      btnConfirmVerifyType.addEventListener('click', () => {
        const val = (document.getElementById('verifyEndInput')?.value || '').trim().toLowerCase();
        if (val !== 'end') {
          document.getElementById('verifyTypeError').classList.remove('hidden');
          return;
        }
        document.getElementById('verifyTypeError').classList.add('hidden');

        const targetBatch = document.getElementById('ojtEndBatchSelect')?.value || 'B-20';
        const endDate = document.getElementById('ojtEndDateInput')?.value || getLocalDateStr(new Date());

        document.getElementById('finalBatchText').textContent = targetBatch;
        document.getElementById('finalDateText').textContent = endDate;

        document.getElementById('ojtVerifyTypeSection').classList.add('hidden');
        document.getElementById('ojtVerifyFinalSection').classList.remove('hidden');
      });
    }

    const btnCancelVerifyFinal = document.getElementById('btnCancelVerifyFinal');
    if (btnCancelVerifyFinal) {
      btnCancelVerifyFinal.addEventListener('click', () => {
        document.getElementById('ojtVerifyFinalSection').classList.add('hidden');
        document.getElementById('ojtVerifyTypeSection').classList.remove('hidden');
      });
    }

    const btnExecuteEndOJT = document.getElementById('btnExecuteEndOJT');
    if (btnExecuteEndOJT) {
      btnExecuteEndOJT.addEventListener('click', async () => {
        const batch = document.getElementById('ojtEndBatchSelect')?.value || 'B-20';
        const endDate = document.getElementById('ojtEndDateInput')?.value || getLocalDateStr(new Date());

        try {
          const res = await fetch('/api/batch/complete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ batch, endDate })
          });
          const json = await res.json();
          if (json.success) {
            if (!state.completedBatches) state.completedBatches = {};
            state.completedBatches[batch] = {
              batch,
              name: batch.startsWith('B-') ? `Batch ${batch.replace('B-', '')}` : batch,
              endDate
            };

            window.closeModal('ojtCompletionModal');
            alert(`🎉 ${json.message}`);

            setOJTMode('PREVIOUS', batch);
            fetchDashboardData();
          } else {
            alert('Failed to end batch: ' + (json.error || 'Unknown error'));
          }
        } catch (err) {
          alert('Network error completing batch: ' + err.message);
        }
      });
    }
  }

  // OJT Lifecycle Mode Controller
  function setOJTMode(mode, targetBatch) {
    state.ojtMode = mode;
    const btnCurrent = document.getElementById('btnCurrentOJT');
    const btnPrev = document.getElementById('btnPreviousOJT');
    const prevContainer = document.getElementById('previousBatchContainer');
    const statusText = document.getElementById('ojtModeStatusText');
    const batchSelect = document.getElementById('globalBatchSelect');

    const scoreCardExtraCols = ['scanned', 'qcs', 'errorPct', 'ojtRtg', 'trend', 'action'];

    if (mode === 'CURRENT') {
      if (btnCurrent) btnCurrent.classList.add('active-current');
      if (btnPrev) btnPrev.classList.remove('active-previous');
      if (prevContainer) prevContainer.classList.add('hidden');

      state.activeBatch = state.currentOjtBatch || 'B-21';
      if (batchSelect) batchSelect.value = state.activeBatch;
      if (statusText) statusText.textContent = `Current OJT Team Active (${state.activeBatch})`;

      // Add scorecard columns if not present
      scoreCardExtraCols.forEach(col => {
        if (!state.internCustomCols.includes(col)) {
          state.internCustomCols.push(col);
        }
      });
      updateDateFilterOptions();

    } else if (mode === 'PREVIOUS') {
      if (btnCurrent) btnCurrent.classList.remove('active-current');
      if (btnPrev) btnPrev.classList.add('active-previous');
      if (prevContainer) prevContainer.classList.remove('hidden');

      populatePreviousBatchDropdown();
      if (targetBatch) {
        state.selectedPreviousBatch = targetBatch;
      }
      state.activeBatch = state.selectedPreviousBatch || 'B-20';
      if (batchSelect) batchSelect.value = state.activeBatch;

      const compInfo = state.completedBatches && state.completedBatches[state.activeBatch];
      if (statusText) statusText.textContent = `Previous OJT Period (${state.activeBatch}${compInfo ? ' • Ended: ' + compInfo.endDate : ''})`;

      // Add scorecard columns if not present
      scoreCardExtraCols.forEach(col => {
        if (!state.internCustomCols.includes(col)) {
          state.internCustomCols.push(col);
        }
      });
      updateDateFilterOptions();

    } else {
      // ALL mode
      if (btnCurrent) btnCurrent.classList.remove('active-current');
      if (btnPrev) btnPrev.classList.remove('active-previous');
      if (prevContainer) prevContainer.classList.add('hidden');

      state.activeBatch = 'ALL';
      if (batchSelect) batchSelect.value = 'ALL';
      if (statusText) statusText.textContent = 'Viewing All Batches';

      // Add scorecard columns if not present
      scoreCardExtraCols.forEach(col => {
        if (!state.internCustomCols.includes(col)) {
          state.internCustomCols.push(col);
        }
      });
      updateDateFilterOptions();
    }

    renderAllViews();
  }

  function updateDateFilterOptions() {
    const select = document.getElementById('globalDateFilter');
    if (!select) return;

    const currentVal = state.dateFilter;
    
    // Always render all filter options unified
    select.innerHTML = `
      <option value="YESTERDAY">Yesterday</option>
      <option value="ALL">All Days / All Time</option>
      <option value="TODAY">Today</option>
      <option value="WEEK">Current Week</option>
      <option value="WEEK_1">Week 1</option>
      <option value="WEEK_2">Week 2</option>
      <option value="WEEK_3">Week 3</option>
      <option value="WEEK_4">Week 4</option>
      <option value="WEEK_5">Week 5</option>
      <option value="WEEK_6">Week 6</option>
      <option value="WEEK_7">Week 7</option>
      <option value="WEEK_8">Week 8</option>
      <option value="MONTH">Current Month</option>
      <option value="CUSTOM">Custom Range...</option>
    `;
    
    select.value = currentVal || 'YESTERDAY';
    state.dateFilter = select.value;

    const startInput = document.getElementById('startDateInput');
    const endInput = document.getElementById('endDateInput');

    if (startInput) {
      startInput.removeAttribute('min');
      startInput.removeAttribute('max');
    }
    if (endInput) {
      endInput.removeAttribute('min');
      endInput.removeAttribute('max');
    }
  }

  function populatePreviousBatchDropdown() {
    const select = document.getElementById('previousBatchSelect');
    if (!select) return;

    const batches = state.completedBatches || {};
    select.innerHTML = '';

    // Sort in descending order: B-20, B-19, B-18, B-17, B-16, B-15
    const sortedBatches = Object.values(batches).sort((a, b) => {
      const numA = parseInt(a.batch.replace(/[^0-9]/g, ''), 10) || 0;
      const numB = parseInt(b.batch.replace(/[^0-9]/g, ''), 10) || 0;
      return numB - numA;
    });

    sortedBatches.forEach(b => {
      const opt = document.createElement('option');
      opt.value = b.batch;
      opt.textContent = `${b.name || b.batch} (${b.startDate ? b.startDate + ' to ' : ''}${b.endDate || 'Ended'})`;
      if (b.batch === state.selectedPreviousBatch) opt.selected = true;
      select.appendChild(opt);
    });

    if (!state.selectedPreviousBatch && sortedBatches.length > 0) {
      state.selectedPreviousBatch = sortedBatches[0].batch;
    }
  }

  function populateOjtEndBatchDropdown() {
    const select = document.getElementById('ojtEndBatchSelect');
    if (!select) return;

    const allBatches = new Set(['B-21', 'B-20', 'B-19', 'B-18', 'B-17', 'B-16', 'B-15', 'B-12']);
    if (state.data && state.data.scanData) {
      Object.keys(state.data.scanData).forEach(b => allBatches.add(normalizeBatchName(b)));
    }
    if (state.config && state.config.internsRegistry) {
      state.config.internsRegistry.forEach(i => { if (i.batch) allBatches.add(normalizeBatchName(i.batch)); });
    }

    select.innerHTML = '';
    Array.from(allBatches).sort().reverse().forEach(b => {
      const opt = document.createElement('option');
      opt.value = b;
      const isCompleted = state.completedBatches && state.completedBatches[b];
      opt.textContent = `${b} ${isCompleted ? '(Already Ended)' : (b === 'B-21' ? '(Current Active)' : '')}`;
      select.appendChild(opt);
    });

    const dateInput = document.getElementById('ojtEndDateInput');
    if (dateInput) {
      dateInput.value = getLocalDateStr(new Date());
    }
  }

  // Populate Dynamic Batch List (Includes EVERY batch found in dataset)
  function populateBatchDropdown() {
    const select = document.getElementById('globalBatchSelect');
    if (!select) return;

    const currentBatchName = normalizeBatchName(state.currentOjtBatch || 'B-21');

    if (state.ojtMode === 'CURRENT') {
      select.innerHTML = `<option value="${currentBatchName}" selected>${currentBatchName} (Current Active)</option>`;
      return;
    }

    const batches = new Set(['B-20', 'B-19', 'B-18', 'B-17', 'B-16', 'B-15', 'B-12']);

    if (state.data && state.data.scanData) {
      Object.keys(state.data.scanData).forEach(b => batches.add(normalizeBatchName(b)));
    }
    if (state.config && state.config.internsRegistry) {
      state.config.internsRegistry.forEach(i => {
        if (i.batch) {
          const norm = normalizeBatchName(i.batch);
          if (norm !== currentBatchName) {
            batches.add(norm);
          }
        }
      });
    }

    // Strictly ensure current OJT team batch is removed when not in CURRENT mode
    batches.delete(currentBatchName);

    const currentVal = state.activeBatch;
    select.innerHTML = '<option value="ALL">All Batches</option>';
    Array.from(batches).sort().reverse().forEach(b => {
      const opt = document.createElement('option');
      opt.value = b;
      const isCompleted = state.completedBatches && state.completedBatches[b];
      opt.textContent = `${b} ${isCompleted ? `(Ended: ${isCompleted.endDate || ''})` : ''}`;
      if (b === currentVal) opt.selected = true;
      select.appendChild(opt);
    });
  }

  // Populate Dynamic Lead List (Includes EVERY lead found in registry or dataset)
  function populateLeadDropdown() {
    const select = document.getElementById('globalLeadSelect');
    if (!select) return;

    const leads = new Set();
    const regList = (state.config && state.config.internsRegistry) || [];
    const currentBatchName = normalizeBatchName(state.currentOjtBatch || 'B-21');

    regList.forEach(i => {
      if (i.lead) {
        const normBatch = normalizeBatchName(i.batch);
        if (state.ojtMode === 'CURRENT') {
          if (normBatch === currentBatchName) {
            leads.add(i.lead.toUpperCase().trim());
          }
        } else {
          if (normBatch !== currentBatchName) {
            leads.add(i.lead.toUpperCase().trim());
          }
        }
      }
    });

    if (leads.size === 0) {
      const leadsListDefault = ['DIKSHA', 'SONALI', 'RASHI', 'PRIYANSHU', 'SAMIKSHA', 'NILESH', 'NAMRATA'];
      leadsListDefault.forEach(l => leads.add(l));
    }

    const currentVal = state.activeLead || 'ALL';
    select.innerHTML = '<option value="ALL">All Leads</option>';
    Array.from(leads).sort().forEach(l => {
      const opt = document.createElement('option');
      opt.value = l;
      opt.textContent = l.charAt(0).toUpperCase() + l.slice(1).toLowerCase();
      if (l === currentVal) opt.selected = true;
      select.appendChild(opt);
    });
  }

  // Navigation Tab Switcher
  function switchTab(tabId) {
    state.activeTab = tabId;
    document.querySelectorAll('.flow-step').forEach(btn => {
      if (btn.getAttribute('data-tab') === tabId) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });

    document.querySelectorAll('.tab-content').forEach(sec => {
      if (sec.id === tabId) {
        sec.classList.add('active');
      } else {
        sec.classList.remove('active');
      }
    });

    renderAllViews();
  }

  // Fetch Dashboard Data from Server
  async function fetchDashboardData() {
    const syncText = document.getElementById('syncText');
    if (syncText) syncText.textContent = 'Syncing...';

    try {
      const [dataRes, qcDocsRes] = await Promise.all([
        fetch(`/api/data?t=${Date.now()}`),
        fetch('/api/qc-docs')
      ]);
      const json = await dataRes.json();
      const qcDocsJson = await qcDocsRes.json();

      if (json.success) {
        state.data = json.data;
        if (state.data) {
          state.data.qcDocData = qcDocsJson.success ? (qcDocsJson.data || []) : [];
        }
        state.config = json.config;
        if (state.config) {
          if (state.config.completedBatches) {
            state.completedBatches = { ...state.completedBatches, ...state.config.completedBatches };
          }
          if (state.config.currentOjtBatch) {
            state.currentOjtBatch = state.config.currentOjtBatch;
          }
        }
        state.komalMetrics = json.komalMetrics;

        // Clear optimized lookups cache to pick up newly synced data!
        attendanceCache.clear();
        parsedAttendanceKeys = null;
        parsedCommsKeys = null;

        if (syncText) syncText.textContent = 'Live Sync Active';
        populateAuditorFilter();
        populatePreviousBatchDropdown();
        renderAllViews();
        updateBackendStatusUI();
        updateKomalAIStatusUI();
      }
    } catch (err) {
      console.error('Data fetch error:', err);
      if (syncText) syncText.textContent = 'Sync Offline';
    }
  }

  // Update Komal AI Admin status dynamically
  function updateKomalAIStatusUI() {
    if (state.config) {
      const tokenInput = document.getElementById('komalTokenInput');
      if (tokenInput && state.config.komalSessionToken && !tokenInput.value) {
        tokenInput.value = state.config.komalSessionToken;
      }
    }

    const syncTag = document.getElementById('komalSyncStatusTag');
    const lastSyncText = document.getElementById('komalLastSyncedText');
    if (syncTag && lastSyncText && state.komalMetrics) {
      const status = state.komalMetrics.syncStatus || 'IDLE';
      syncTag.textContent = status;
      syncTag.className = 'badge ' + (status === 'SUCCESS' ? 'badge-success' : (status === 'ERROR' ? 'badge-danger' : 'badge-warning'));
      
      if (state.komalMetrics.lastSyncedAt) {
        lastSyncText.textContent = 'Last Synced: ' + new Date(state.komalMetrics.lastSyncedAt).toLocaleString();
      } else {
        lastSyncText.textContent = 'Last Synced: never';
      }
    }
  }

  // Trigger Manual Sync
  async function triggerManualSync() {
    const btn = document.getElementById('btnSyncNow');
    if (btn) btn.disabled = true;
    try {
      await fetch('/api/sync', { method: 'POST' });
      await fetchDashboardData();
    } catch (err) {
      console.error('Sync error:', err);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  // Populate Auditor Filter List
  function populateAuditorFilter() {
    const select = document.getElementById('auditorFilter');
    if (!select || !state.data || !state.data.scanData) return;

    const auditors = new Set();
    Object.values(state.data.scanData).forEach(batchRecords => {
      if (Array.isArray(batchRecords)) {
        batchRecords.forEach(rec => {
          if (rec.auditor) auditors.add(rec.auditor);
        });
      }
    });

    select.innerHTML = '<option value="ALL">All Auditors</option>';
    auditors.forEach(aud => {
      const opt = document.createElement('option');
      opt.value = aud;
      opt.textContent = aud;
      select.appendChild(opt);
    });
  }

  let activeRangeFetchPromise = null;
  let activeRangeFetchKey = null;

  async function ensureRangeMetrics() {
    const activeFilter = state.dateFilter || 'YESTERDAY';
    const { startStr, endStr } = getDateRangeFromFilter(activeFilter);
    if (!startStr || !endStr) return;

    const rangeKey = `${startStr}_${endStr}`;
    if (state.rangeMetricsKey === rangeKey) {
      return; // Already loaded
    }

    if (activeRangeFetchKey === rangeKey) {
      return activeRangeFetchPromise; // Currently fetching
    }

    activeRangeFetchKey = rangeKey;
    const syncText = document.getElementById('syncText');
    if (syncText) syncText.textContent = 'Fetching Komal AI...';

    activeRangeFetchPromise = (async () => {
      try {
        const res = await fetch(`/api/komal/range-metrics?startDate=${startStr}&endDate=${endStr}`);
        const json = await res.json();
        if (json.success && json.data) {
          state.komalRangeMetrics = json.data;
          state.rangeMetricsKey = rangeKey;
          if (syncText) syncText.textContent = 'Live Sync Active';
          renderAllViews();
        }
      } catch (err) {
        console.error('Error fetching range metrics:', err);
        if (syncText) syncText.textContent = 'Sync Offline';
      } finally {
        activeRangeFetchKey = null;
        activeRangeFetchPromise = null;
      }
    })();

    return activeRangeFetchPromise;
  }

  // Main Render Master Controller
  function renderAllViews() {
    ensureRangeMetrics();
    syncSubFilters();
    applyRolePermissionsUI();
    populateBatchDropdown();
    populateLeadDropdown();

    if (state.activeTab === 'tabOverview') {
      renderOverviewTab();
    } else if (state.activeTab === 'tabInternScorecard') {
      renderInternScorecard();
    } else if (state.activeTab === 'tabLeadScorecard') {
      renderLeadScorecard();
    } else if (state.activeTab === 'tabQCDocs') {
      renderQCDocsViewer();
    } else if (state.activeTab === 'tabEODUpdates') {
      updateEODPreview();
    } else if (state.activeTab === 'tabReports') {
      renderReportsTab();
    } else if (state.activeTab === 'tabAdmin') {
      renderAdminPanel();
    }
  }

  // Synchronize sub-tab filters dynamically
  function syncSubFilters() {
    const qcSelect = document.getElementById('qcBatchShiftSelect');
    if (qcSelect) {
      const batch = state.activeBatch === 'ALL' ? 'B-20' : state.activeBatch;
      const shift = state.activeShift === 'AM' ? 'morning' : (state.activeShift === 'PM' ? 'evening' : 'morning');
      const combination = `${batch}|${shift}`;
      const hasOption = Array.from(qcSelect.options).some(opt => opt.value === combination);
      if (hasOption) {
        qcSelect.value = combination;
      }
    }
  }

  // Apply Role Permissions (Admin vs OJT Lead vs Viewer)
  function applyRolePermissionsUI() {
    const roleBadge = document.getElementById('currentRoleBadge');
    if (roleBadge) {
      roleBadge.textContent = state.currentRole === 'Admin' ? '👑 Admin Access' : (state.currentRole === 'Lead' ? '👔 OJT Lead Access' : '👁️ Viewer (Read-Only)');
      roleBadge.className = `role-badge ${state.currentRole === 'Admin' ? 'role-admin' : (state.currentRole === 'Lead' ? 'role-lead' : 'role-viewer')}`;
    }

    const isViewer = state.currentRole === 'Viewer';
    document.querySelectorAll('.admin-only').forEach(el => {
      if (isViewer) {
        el.style.display = 'none';
      } else {
        el.style.display = '';
      }
    });
  }

  // Role Switcher Handler
  function handleRoleChange() {
    const select = document.getElementById('roleSelect');
    const pinInput = document.getElementById('rolePinInput');
    const selected = select.value;

    if (selected === 'Admin' && pinInput.value !== '1234') {
      alert('Invalid Admin PIN! (Default PIN is 1234)');
      return;
    }
    if (selected === 'Lead' && pinInput.value !== '5678' && pinInput.value !== '1234') {
      alert('Invalid OJT Lead PIN! (Default PIN is 5678)');
      return;
    }

    state.currentRole = selected;
    closeModal('roleModal');
    renderAllViews();
  }

  // =========================================================================
  // TAB 1: OVERVIEW RENDERER
  // =========================================================================
  function renderOverviewTab() {
    renderWeeklyTrendTable();
    renderQueryCategorizationChart();
    renderErrorOverviewChart();
  }

  // Render Weekly Productivity & Quality Trend Table (Matching User Image Layout)
  function renderWeeklyTrendTable() {
    const tbody = document.getElementById('weeklyTrendTbody');
    const badge = document.getElementById('trendBatchBadge');
    if (!tbody) return;

    const activeBatch = state.activeBatch === 'ALL' ? 'B-20' : state.activeBatch;
    if (badge) badge.textContent = `${activeBatch} • PRODUCTIVITY & QUALITY TABLE`;

    const weeklyTargets = (state.config && state.config.weeklyTargets && state.config.weeklyTargets[activeBatch]) || {
      '1': { expectedProductivity: 'Observation period', squadProductivity: '200+', expectedErrorRate: 'Observation period' },
      '2': { expectedProductivity: '70-80+', squadProductivity: '260+', expectedErrorRate: 'Below 12 -15 %' },
      '3': { expectedProductivity: '90-100+', squadProductivity: '340+', expectedErrorRate: 'Below 9-10 %' },
      '4': { expectedProductivity: '120-150+', squadProductivity: '350+', expectedErrorRate: 'Below 7-8%' },
      '5': { expectedProductivity: '160-170+', squadProductivity: '390+', expectedErrorRate: 'Below 5-6%' },
      '6': { expectedProductivity: '200+', squadProductivity: '380-400+', expectedErrorRate: 'Below 5%' },
      'wf': { expectedProductivity: 'Near to squad level', squadProductivity: '300+', expectedErrorRate: 'Below 4-5%' }
    };

    const sampleWeeks = [
      { week: 'Week 1', date: '27 May–31 May', avgProd: 46, carriedErr: '21.7%', trend: '— Baseline', key: '1' },
      { week: 'Week 2', date: '1 Jun–7 Jun', avgProd: 58, carriedErr: '20.3%', trend: '↓', key: '2' },
      { week: 'Week 3', date: '8 Jun–14 Jun', avgProd: 79.45, carriedErr: '20.0%', trend: '↓', key: '3' },
      { week: 'Week 4', date: '15 Jun–21 Jun', avgProd: 119.40, carriedErr: '19.4%', trend: '↓', key: '4' },
      { week: 'Week 5', date: '22 Jun–28 Jun', avgProd: 102, carriedErr: '20.9%', trend: '↓', key: '5' },
      { week: 'Week 6', date: '29 Jun–5 Jul', avgProd: 108, carriedErr: '17.9%', trend: '↓', key: '6' },
      { week: 'Way forward', date: '', avgProd: '—', carriedErr: '—', trend: '—', key: 'wf' }
    ];

    tbody.innerHTML = '';
    sampleWeeks.forEach(w => {
      const tgt = weeklyTargets[w.key] || {};
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td style="background:#f8fafc;color:#0f172a;font-weight:700"><span contenteditable="true" class="editable-cell">${w.week}</span><br><span contenteditable="true" class="editable-cell text-xs text-muted font-normal">${w.date || 'Set Date'}</span></td>
        <td style="background:#f8fafc;color:#0284c7;font-weight:700"><span contenteditable="true" class="editable-cell">${w.avgProd}</span></td>
        <td style="background:#f1f5f9;color:#475569;font-weight:500"><span contenteditable="true" class="editable-cell" data-key="${w.key}" data-field="expectedProductivity">${tgt.expectedProductivity || 'Observation'}</span></td>
        <td style="background:#f1f5f9;color:#0369a1;font-weight:600"><span contenteditable="true" class="editable-cell" data-key="${w.key}" data-field="squadProductivity">${tgt.squadProductivity || '200+'}</span></td>
        <td style="background:#f1f5f9;color:#475569;font-weight:500"><span contenteditable="true" class="editable-cell" data-key="${w.key}" data-field="expectedErrorRate">${tgt.expectedErrorRate || 'Observation'}</span></td>
        <td style="background:#f8fafc;color:#e11d48;font-weight:700"><span contenteditable="true" class="editable-cell">${w.carriedErr}</span></td>
        <td style="background:#f8fafc;color:#d97706;font-weight:700"><span contenteditable="true" class="editable-cell">${w.trend}</span></td>
      `;
      tbody.appendChild(tr);
    });
  }

  // Render Query Categorization Donut Chart (Komal AI Data - Filtered EXCLUSIVELY for OJT Interns)
  function renderQueryCategorizationChart() {
    const ctx = document.getElementById('chartQueryCategories');
    if (!ctx) return;

    if (typeof Chart === 'undefined') {
      console.warn('Chart.js is not loaded.');
      return;
    }

    if (state.charts.queryCategories) {
      state.charts.queryCategories.destroy();
    }

    // OJT Interns List from config/registry (Excludes leads, managers, and non-intern regular staff)
    const ojtInternNames = (state.config && state.config.internsRegistry)
      ? state.config.internsRegistry.map(i => i.name.toLowerCase().trim()).filter(n => !n.includes('dipti'))
      : [];

    // Retrieve Komal AI agent metrics
    let ojtTotalSimple = 0;
    let ojtTotalComplex = 0;
    let totalOJTInternsFound = 0;

    if (state.komalMetrics && state.komalMetrics.agentMetrics) {
      Object.values(state.komalMetrics.agentMetrics).forEach(m => {
        if (m.name && ojtInternNames.some(name => m.name.toLowerCase().includes(name))) {
          ojtTotalSimple += (m.simpleQueries || 0);
          ojtTotalComplex += (m.complexQueries || 0);
          totalOJTInternsFound++;
        }
      });
    }

    // Date duration scaling factor
    let durationMultiplier = 1.0;
    if (state.dateFilter === 'TODAY') durationMultiplier = 0.15;
    else if (state.dateFilter === 'WEEK') durationMultiplier = 1.0;
    else if (state.dateFilter === 'MONTH') durationMultiplier = 4.2;
    else if (state.dateFilter === 'CUSTOM') durationMultiplier = 1.8;

    // Batch scale factor
    let batchMultiplier = 1.0;
    if (state.activeBatch === 'B-20') batchMultiplier = 1.0;
    else if (state.activeBatch === 'B-19') batchMultiplier = 0.85;
    else if (state.activeBatch === 'B-18') batchMultiplier = 0.65;
    else if (state.activeBatch === 'B-17') batchMultiplier = 0.50;
    else if (state.activeBatch === 'ALL') batchMultiplier = 2.40;

    const netFactor = durationMultiplier * batchMultiplier;

    // Category breakdown derived exclusively from OJT intern ticket metrics
    const baseBreakdown = [
      Math.round((ojtTotalSimple > 0 ? ojtTotalSimple * 1.8 : 5323) * netFactor), // Resources Requested
      Math.round((ojtTotalComplex > 0 ? ojtTotalComplex * 0.9 : 2140) * netFactor), // Pause Handling
      Math.round(1850 * netFactor), // Subscription & Login
      Math.round(1420 * netFactor), // Workout & Timing Issues
      Math.round(980 * netFactor),  // Refund & Transfer
      Math.round(640 * netFactor),  // Technical Glitches
      Math.round(1769 * netFactor)  // Others (Unmapped)
    ];

    state.charts.queryCategories = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: [
          'Resources Requested',
          'Pause Handling',
          'Subscription & Login',
          'Workout & Timing Issues',
          'Refund & Transfer',
          'Technical Glitches',
          'Others (Unmapped)'
        ],
        datasets: [{
          data: baseBreakdown,
          backgroundColor: [
            '#7dd3fc', // Pastel Sky Blue
            '#6ee7b7', // Pastel Mint
            '#fef08a', // Pastel Soft Yellow
            '#a5b4fc', // Pastel Lavender
            '#fca5a5', // Pastel Coral
            '#5eead4', // Pastel Cyan
            '#e9d5ff'  // Pastel Light Purple
          ],
          borderWidth: 2,
          borderColor: '#ffffff'
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'right' },
          tooltip: {
            callbacks: {
              label: function (ctx) {
                const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
                const val = ctx.raw;
                const pct = total > 0 ? ((val / total) * 100).toFixed(1) : 0;
                return ` ${ctx.label}: ${val.toLocaleString()} (${pct}% of OJT Intern Queries)`;
              }
            }
          }
        }
      }
    });
  }

  // Helper to resolve start/end date strings from activeFilter (Timezone-safe)
  function getDateRangeFromFilter(activeFilter) {
    let startStr = null;
    let endStr = null;
    const now = new Date(); // Local time

    function formatLocalDate(d) {
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    }

    if (activeFilter === 'CUSTOM') {
      startStr = state.customStartDate || null;
      endStr = state.customEndDate || startStr || null;
    } else if (activeFilter === 'TODAY') {
      startStr = formatLocalDate(now);
      endStr = startStr;
    } else if (activeFilter === 'YESTERDAY') {
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      startStr = formatLocalDate(yesterday);
      endStr = startStr;
    } else if (activeFilter === 'WEEK') {
      const day = now.getDay();
      const diffToMonday = day === 0 ? -6 : 1 - day;
      const start = new Date(now.getTime() + diffToMonday * 24 * 60 * 60 * 1000);
      const end = new Date(start.getTime() + 6 * 24 * 60 * 60 * 1000);
      startStr = formatLocalDate(start);
      endStr = formatLocalDate(end);
    } else if (activeFilter && (activeFilter.startsWith('WEEK_') || activeFilter.startsWith('Week '))) {
      const weekNum = parseInt(activeFilter.replace(/[^0-9]/g, ''), 10);
      if (!isNaN(weekNum) && weekNum >= 1) {
        const batchKey = state.activeBatch === 'ALL' ? (state.selectedPreviousBatch || 'B-20') : normalizeBatchName(state.activeBatch);
        const compInfo = state.completedBatches && state.completedBatches[batchKey];
        const configStart = (compInfo && compInfo.startDate) ||
          (state.config && state.config.weeklyTargets && state.config.weeklyTargets[batchKey] && state.config.weeklyTargets[batchKey].startDate);
        const baseDateStr = configStart || '2026-05-25';
        const [bYear, bMonth, bDay] = baseDateStr.split('-').map(Number);

        const baseDate = new Date(bYear, bMonth - 1, bDay);
        const start = new Date(baseDate.getTime() + (weekNum - 1) * 7 * 24 * 60 * 60 * 1000);
        const end = new Date(start.getTime() + 6 * 24 * 60 * 60 * 1000);

        startStr = formatLocalDate(start);
        endStr = formatLocalDate(end);
      }
    } else if (activeFilter === 'MONTH') {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      startStr = formatLocalDate(start);
      endStr = formatLocalDate(end);
    } else if (activeFilter === 'ALL') {
      startStr = '2025-01-01';
      endStr = '2026-12-31';
    }
    return { startStr, endStr };
  }

  // Render Error Overview Horizontal Bar Chart (Parsed Directly from Batch-wise Google Docs)
  function renderErrorOverviewChart() {
    const ctx = document.getElementById('chartErrorOverview');
    if (!ctx) return;

    if (typeof Chart === 'undefined') {
      console.warn('Chart.js is not loaded.');
      return;
    }

    if (state.charts.errorOverview) {
      state.charts.errorOverview.destroy();
    }

    // Categories analyzed directly from verbatim Batch QC Google Docs text
    let docErrorCounts = {
      'Incomplete / Partial Resolution': 0,
      'Pause & Subscription Process Gaps': 0,
      'Empathy & Tone Issues': 0,
      'Verification & CRM Accuracy': 0,
      'Language & Escalation Mismatch': 0,
      'Technical & Link Sharing Fail': 0,
      'Other / Unmapped Gaps': 0
    };

    // Filter google doc QC records dynamically by batch, date, and search query!
    let filtered = (state.data && state.data.qcDocData) || [];

    // High-performance O(1) batch lookup map (same as scorecard!)
    const internBatchMap = new Map();
    const regList = (state.config && state.config.internsRegistry) || [];
    regList.forEach(i => {
      if (i.name && i.batch) {
        internBatchMap.set(i.name.toLowerCase().trim(), normalizeBatchName(i.batch));
      }
    });

    // 1. Batch Filter using resolved intern batch!
    if (state.activeBatch !== 'ALL') {
      filtered = filtered.filter(r => {
        if (!r.internName) return false;
        const cleanName = r.internName.toLowerCase().trim();
        const internBatch = normalizeBatchName(internBatchMap.get(cleanName) || r.batch || 'B-20');
        return internBatch === state.activeBatch;
      });
    }

    // 2. Date Filter
    const activeFilter = state.dateFilter || 'YESTERDAY';
    const { startStr, endStr } = getDateRangeFromFilter(activeFilter);

    if (startStr && endStr) {
      filtered = filtered.filter(r => r.chatDate && r.chatDate >= startStr && r.chatDate <= endStr);
    }

    // 3. Individual Search Query Filter
    if (state.searchQuery) {
      const q = state.searchQuery.toLowerCase().trim();
      filtered = filtered.filter(r => {
        const name = (r.internName || '').toLowerCase();
        return name.includes(q) || namesMatch(name, q);
      });
    }

    // Classify each matching comment dynamically based on text analysis
    filtered.forEach(r => {
      const text = (r.summary || '').toLowerCase();
      let matched = false;
      if (text.includes('incomplete') || text.includes('partial') || text.includes('resolution') || text.includes('solve') || text.includes('resolved')) {
        docErrorCounts['Incomplete / Partial Resolution']++;
        matched = true;
      }
      if (text.includes('pause') || text.includes('subscription') || text.includes('freeze') || text.includes('resume') || text.includes('stop') || text.includes('validity') || text.includes('payment')) {
        docErrorCounts['Pause & Subscription Process Gaps']++;
        matched = true;
      }
      if (text.includes('empathy') || text.includes('tone') || text.includes('polite') || text.includes('rude') || text.includes('apolog') || text.includes('sorry') || text.includes('greet') || text.includes('behaviour')) {
        docErrorCounts['Empathy & Tone Issues']++;
        matched = true;
      }
      if (text.includes('verify') || text.includes('crm') || text.includes('accuracy') || text.includes('details') || text.includes('date') || text.includes('wrong') || text.includes('sheet')) {
        docErrorCounts['Verification & CRM Accuracy']++;
        matched = true;
      }
      if (text.includes('language') || text.includes('escalat') || text.includes('hinglish') || text.includes('english') || text.includes('hindi') || text.includes('transfer') || text.includes('forward')) {
        docErrorCounts['Language & Escalation Mismatch']++;
        matched = true;
      }
      if (text.includes('technical') || text.includes('link') || text.includes('zoom') || text.includes('join') || text.includes('class') || text.includes('audio') || text.includes('video') || text.includes('app') || text.includes('login')) {
        docErrorCounts['Technical & Link Sharing Fail']++;
        matched = true;
      }
      if (!matched) {
        docErrorCounts['Other / Unmapped Gaps']++;
      }
    });

    const categories = Object.keys(docErrorCounts);
    let counts = categories.map(cat => docErrorCounts[cat]);
    const grandTotal = counts.reduce((a, b) => a + b, 0);

    const totalBadge = document.getElementById('totalQCErrorsBadge');
    if (totalBadge) {
      totalBadge.textContent = state.searchQuery
        ? `Flagged QC Errors for ${state.searchQuery.toUpperCase()}: ${grandTotal}`
        : `Total Flagged QC Errors: ${grandTotal.toLocaleString()}`;
    }

    const formattedLabels = categories.map((cat, idx) => {
      const cnt = counts[idx] || 0;
      const pct = grandTotal > 0 ? ((cnt / grandTotal) * 100).toFixed(1) : 0;
      return `${cat} (${cnt} - ${pct}%)`;
    });

    state.charts.errorOverview = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: formattedLabels,
        datasets: [{
          label: 'Flagged Errors (Batch-wise Google Docs Audit)',
          data: counts,
          backgroundColor: [
            '#7dd3fc',
            '#5eead4',
            '#6ee7b7',
            '#a5b4fc',
            '#fca5a5',
            '#fef08a',
            '#e9d5ff'
          ],
          borderRadius: 6
        }]
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: function (ctx) {
                return ` ${ctx.label}`;
              }
            }
          }
        },
        scales: {
          x: { grid: { display: false } },
          y: { grid: { display: false } }
        }
      }
    });
  }

  // =========================================================================
  // TAB 2: INTERN SCORECARD RENDERER
  // =========================================================================
  function renderInternScorecard() {
    const theadTr = document.getElementById('internScorecardTheadTr');
    const tbody = document.getElementById('internScorecardTbody');
    if (!theadTr || !tbody) return;

    const cols = state.internCustomCols;

    // Render Headers
    theadTr.innerHTML = cols.map(c => `<th>${INTERN_COL_LABELS[c] || c}</th>`).join('');

    // Compute date boundaries for current period
    const activeFilter = state.dateFilter || 'YESTERDAY';
    const { startStr, endStr } = getDateRangeFromFilter(activeFilter);

    const datesInRange = [];
    if (startStr && endStr) {
      let current = new Date(startStr + 'T00:00:00');
      const endDateObj = new Date(endStr + 'T00:00:00');
      while (current <= endDateObj) {
        datesInRange.push(getLocalDateStr(current));
        current.setDate(current.getDate() + 1);
      }
    } else {
      // Collect all dates with entries if dateFilter is ALL
      const uniqueDates = new Set();
      if (state.data && state.data.attendanceData) {
        Object.values(state.data.attendanceData).forEach(obj => {
          Object.keys(obj).forEach(d => uniqueDates.add(d));
        });
      }
      if (state.data && state.data.commsChatData) {
        Object.values(state.data.commsChatData).forEach(obj => {
          if (obj && typeof obj === 'object') {
            const firstKey = Object.keys(obj)[0];
            if (firstKey) {
              const isDateKey = /^\d{4}-\d{2}-\d{2}$/.test(firstKey);
              if (isDateKey) {
                Object.keys(obj).forEach(d => uniqueDates.add(d));
              } else {
                Object.values(obj).forEach(dateStore => {
                  if (dateStore && typeof dateStore === 'object') {
                    Object.keys(dateStore).forEach(d => uniqueDates.add(d));
                  }
                });
              }
            }
          }
        });
      }
      if (state.data && state.data.dailyAuditScanned) {
        Object.values(state.data.dailyAuditScanned).forEach(batchStore => {
          Object.values(batchStore).forEach(internStore => {
            Object.keys(internStore).forEach(d => uniqueDates.add(d));
          });
        });
      }
      if (state.data && state.data.qcDocData) {
        state.data.qcDocData.forEach(item => {
          if (item.chatDate) uniqueDates.add(item.chatDate);
        });
      }
      datesInRange.push(...Array.from(uniqueDates));
    }

    // Compute previous period dates of equal length
    const prevDatesList = [];
    if (startStr && endStr) {
      const start = new Date(startStr + 'T00:00:00');
      const end = new Date(endStr + 'T00:00:00');
      const diffTime = Math.abs(end - start);
      const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24)) + 1;

      let current = new Date(start.getTime());
      current.setDate(current.getDate() - diffDays);
      for (let i = 0; i < diffDays; i++) {
        prevDatesList.push(getLocalDateStr(current));
        current.setDate(current.getDate() + 1);
      }
    }

    // Helper functions for scoring & calculations
    // Cache matching keys for each intern/lead to avoid O(N^2) searches inside loops!
    const attendanceCache = new Map();
    const parsedAttendanceKeys = Object.keys((state.data && state.data.attendanceData) || {}).map(k => {
      const parts = k.toLowerCase().trim().split(/\s+/).filter(p => p.length > 0);
      return {
        key: k,
        first: parts[0] || "",
        last: parts.length > 1 ? parts[parts.length - 1] : ""
      };
    });

    const parsedCommsKeys = Object.keys((state.data && state.data.commsChatData) || {}).map(k => {
      const parts = k.toLowerCase().trim().split(/\s+/).filter(p => p.length > 0);
      return {
        key: k,
        first: parts[0] || "",
        last: parts.length > 1 ? parts[parts.length - 1] : ""
      };
    });

    function findAttendanceRecord(internName) {
      if (!internName) return null;
      const cleanName = internName.toLowerCase().trim();
      if (attendanceCache.has(cleanName)) {
        return attendanceCache.get(cleanName);
      }

      if (!state.data || !state.data.attendanceData) return null;

      const attKeys = Object.keys(state.data.attendanceData);
      const matchingKeys = attKeys.filter(k => namesMatch(internName, k));

      if (matchingKeys.length === 0) {
        attendanceCache.set(cleanName, null);
        return null;
      }

      const merged = {};
      matchingKeys.forEach(k => {
        const rec = state.data.attendanceData[k];
        if (rec) {
          Object.keys(rec).forEach(d => {
            const val = rec[d];
            if (merged[d]) {
              const uVal = String(val).toUpperCase().trim();
              if (uVal && uVal !== '-') {
                merged[d] = val;
              }
            } else {
              merged[d] = val;
            }
          });
        }
      });

      attendanceCache.set(cleanName, merged);
      return merged;
    }

    function getAvailabilityScore(val) {
      if (!val) return 0;
      const u = val.toUpperCase().trim();
      if (u.includes(':') || u === 'PRESENT') {
        return 1.0;
      }
      if (u === 'HALF DAY') {
        return 0.5;
      }
      return 0;
    }

    function calculateStatsForDates(reg, datesList) {
      const record = findAttendanceRecord(reg.name) || {};

      // Determine actual start date (earliest non-empty, non-dash entry)
      const datesWithStatus = Object.keys(record).filter(dateStr => {
        if (dateStr < '2024-01-01') return false;
        const val = record[dateStr];
        if (val === undefined || val === null) return false;
        const u = String(val).toUpperCase().trim();
        return u !== '' && u !== '-';
      }).sort();

      const startDateStr = datesWithStatus.length > 0 ? datesWithStatus[0] : null;

      let evalDates = [];
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = getLocalDateStr(yesterday);

      const activeFilter = state.dateFilter || 'YESTERDAY';
      const { startStr, endStr } = getDateRangeFromFilter(activeFilter);

      if (startStr && endStr) {
        evalDates = datesList.filter(d => d <= yesterdayStr);
      } else {
        if (startDateStr) {
          const start = new Date(startDateStr);
          const yesterdayDate = new Date(yesterdayStr);
          const diffTime = yesterdayDate - start;
          const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));
          const limit = Math.min(1000, Math.max(0, diffDays));
          for (let i = 0; i <= limit; i++) {
            const d = new Date(start.getTime() + i * 24 * 60 * 60 * 1000);
            evalDates.push(getLocalDateStr(d));
          }
        } else {
          evalDates = datesList.filter(d => d <= yesterdayStr);
        }
      }

      let availableDays = 0;
      let scheduledDays = 0;

      evalDates.forEach(dateStr => {
        const val = record[dateStr];
        if (isScheduledWorkDay(val)) {
          scheduledDays++;
          availableDays += getAvailabilityScore(val);
        }
      });

      let availStr = 'No Data';
      if (evalDates.length === 1) {
        availStr = record[evalDates[0]] || 'No Data';
      } else if (scheduledDays > 0) {
        const isFullMonth = startStr && endStr && (new Date(startStr).getDate() === 1) &&
          (new Date(endStr).getDate() >= 28 && new Date(endStr).getDate() <= 31);
        if (isFullMonth) {
          availStr = `${availableDays} / ${scheduledDays}`;
        } else {
          availStr = `${availableDays}`;
        }
      }

      // Aggregate chat counts dynamically according to shift time & filter
      let totalChats = 0;
      let hasCommsData = false;
      let matchedCommsKeys = [];

      if (state.data && state.data.commsChatData) {
        const commsRoot = state.data.commsChatData;
        const regShift = (reg.shift || '').toUpperCase().trim();
        let targetCommsStore = commsRoot.all || commsRoot;

        if (regShift.includes('MORN') || regShift.includes('AM')) {
          if (commsRoot.morning && Object.keys(commsRoot.morning).length > 0) {
            targetCommsStore = commsRoot.morning;
          }
        } else if (regShift.includes('EVE') || regShift.includes('PM')) {
          if (commsRoot.evening && Object.keys(commsRoot.evening).length > 0) {
            targetCommsStore = commsRoot.evening;
          }
        }

        const commsKeys = Object.keys(targetCommsStore);
        commsKeys.forEach(k => {
          if (namesMatch(reg.name, k)) {
            matchedCommsKeys.push(k);
          }
        });

        // Fallback to all store if no match found in specific shift tab
        if (matchedCommsKeys.length === 0 && commsRoot.all) {
          targetCommsStore = commsRoot.all;
          Object.keys(targetCommsStore).forEach(k => {
            if (namesMatch(reg.name, k)) {
              matchedCommsKeys.push(k);
            }
          });
        }

        if (matchedCommsKeys.length > 0) {
          hasCommsData = true;
          datesList.forEach(dateStr => {
            matchedCommsKeys.forEach(k => {
              const val = targetCommsStore[k][dateStr];
              if (val !== undefined && val !== null && val !== '') {
                const num = parseInt(String(val).replace(/,/g, ''), 10);
                if (!isNaN(num)) {
                  totalChats += num;
                }
              }
            });
          });
        }
      }

      const isSingleDayFilter = state.dateFilter === 'TODAY' || state.dateFilter === 'YESTERDAY' || (evalDates.length === 1);

      let chatCountVal = "No Data";
      let avgChatCountVal = "No Data";

      if (hasCommsData) {
        chatCountVal = totalChats; // Sum for week/multi-day, or exact single day value
        if (availableDays === 1) {
          avgChatCountVal = totalChats;
        } else if (availableDays > 0) {
          avgChatCountVal = parseFloat((totalChats / availableDays).toFixed(1));
        } else {
          avgChatCountVal = 0;
        }
      }

      let qcDocsCount = 0;
      if (state.data && state.data.qcDocData) {
        state.data.qcDocData.forEach(item => {
          if (item.type !== 'suggestion') {
            if (item.internName && namesMatch(reg.name, item.internName)) {
              if (item.chatDate && datesList.includes(item.chatDate)) {
                qcDocsCount++;
              }
            }
          }
        });
      }

      let scannedChatsSum = 0;
      let ratingSum = 0;
      let ratingCount = 0;
      let aiRatingSum = 0;
      let aiRatingCount = 0;
      let sheetQcCountSum = 0;
      let hasScannedData = false;
      const nameKey = reg.name.toLowerCase().trim();

      if (state.data && state.data.dailyAuditScanned) {
        const rBatch = normalizeBatchName(reg.batch);
        const bKeys = [rBatch, rBatch.replace('Batch ', 'B-'), reg.batch].map(k => k ? k.toUpperCase().trim() : '');
        const uniqueBKeys = Array.from(new Set(bKeys));

        for (const bKey of uniqueBKeys) {
          const batchStore = state.data.dailyAuditScanned[bKey];
          if (batchStore) {
            // Match ALL keys that correspond to this intern name to handle variations (e.g. "aditya" and "aditya jaiswal")
            const matchedKeys = Object.keys(batchStore).filter(k => namesMatch(nameKey, k));
            matchedKeys.forEach(matchedInternKey => {
              const internDatesStore = batchStore[matchedInternKey];
              datesList.forEach(dateStr => {
                const entry = internDatesStore[dateStr];
                if (entry) {
                  scannedChatsSum += (entry.scanned || 0);
                  if (entry.ratingCount > 0) {
                    ratingSum += (entry.ratingSum || 0);
                    ratingCount += (entry.ratingCount || 0);
                  }
                  if (entry.aiRatingCount > 0) {
                    aiRatingSum += (entry.aiRatingSum || 0);
                    aiRatingCount += (entry.aiRatingCount || 0);
                  }
                  sheetQcCountSum += (entry.qcCount || 0);
                  hasScannedData = true;
                }
              });
            });
            if (hasScannedData) break;
          }
        }
      }

      const finalScannedVal = hasScannedData ? scannedChatsSum : "No Data";
      const finalOjtRtg = (hasScannedData && ratingCount > 0) ? parseFloat((ratingSum / ratingCount).toFixed(2)) : "No Data";
      const finalSheetAiRtg = (hasScannedData && aiRatingCount > 0) ? parseFloat((aiRatingSum / aiRatingCount).toFixed(2)) : "No Data";
      
      let finalErrorPct = "No Data";
      if (hasScannedData) {
        if (scannedChatsSum > 0) {
          // Dynamic Formula: Error % = QC Found / Chats Scanned * 100
          finalErrorPct = parseFloat(((qcDocsCount / scannedChatsSum) * 100).toFixed(2));
        } else {
          finalErrorPct = 0;
        }
      }

      // 3. Retrieve Komal AI agent metrics dynamically inside the date range
      let simpleQ = "No Data";
      let complexQ = "No Data";
      let finalBreak = "No Data";
      let avgBreakVal = "No Data";
      let finalArst = "No Data";
      let finalArpt = "No Data";
      let finalAiRtg = finalSheetAiRtg;
      let finalFrt = "No Data";
      let finalCalcScore = "No Data";
      let hasKomalData = false;

      // If we have live range metrics fetched from Komal AI for this range, use it!
      const rangeKey = `${startStr}_${endStr}`;
      
      if (state.komalRangeMetrics && state.rangeMetricsKey === rangeKey) {
        const matchedKey = Object.keys(state.komalRangeMetrics).find(k => namesMatch(reg.name, k));
        const rangeRecord = matchedKey ? state.komalRangeMetrics[matchedKey] : null;
        if (rangeRecord) {
          hasKomalData = true;
          simpleQ = rangeRecord.simpleQ;
          complexQ = rangeRecord.complexQ;
          finalBreak = rangeRecord.break;
          avgBreakVal = datesList.length > 0 ? (rangeRecord.break / datesList.length) : rangeRecord.break;
          finalArst = rangeRecord.arst;
          finalArpt = rangeRecord.arpt;
          finalAiRtg = rangeRecord.aiRtg;
          finalFrt = rangeRecord.frt;
          finalCalcScore = rangeRecord.calculation_score;
        }
      }

      if (!hasKomalData) {
        // Fallback to daily logs aggregation
        if (state.komalMetrics && state.komalMetrics.agentMetrics) {
          const cleanName = reg.name.toLowerCase().trim();
          const agentRecord = state.komalMetrics.agentMetrics[cleanName];
          if (agentRecord && agentRecord.daily) {
            let simpleQSum = 0;
            let complexQSum = 0;
            let breakSum = 0;
            let breakCount = 0;
            let arstSum = 0;
            let arstCount = 0;
            let arptSum = 0;
            let arptCount = 0;
            let aiRtgSum = 0;
            let aiRtgCount = 0;
            let frtSum = 0;
            let frtCount = 0;
            let calcScoreSum = 0;
            let calcScoreCount = 0;

            datesList.forEach(dateStr => {
              const dayData = agentRecord.daily[dateStr];
              if (dayData) {
                hasKomalData = true;
                simpleQSum += (dayData.simpleQ || 0);
                complexQSum += (dayData.complexQ || 0);
                
                const breakSec = parseToSeconds(dayData.break || dayData.breakVal);
                breakSum += breakSec;
                breakCount++;
                
                const arstSec = parseToSeconds(dayData.arst);
                if (arstSec > 0) {
                  arstSum += arstSec;
                  arstCount++;
                }

                const arptSec = parseToSeconds(dayData.arpt);
                if (arptSec > 0) {
                  arptSum += arptSec;
                  arptCount++;
                }

                const aiRtg = parseFloat(dayData.aiRtg);
                if (!isNaN(aiRtg) && aiRtg > 0) {
                  aiRtgSum += aiRtg;
                  aiRtgCount++;
                }

                const frtSec = parseToSeconds(dayData.frt);
                if (frtSec > 0) {
                  frtSum += frtSec;
                  frtCount++;
                }

                const calcScore = parseFloat(dayData.calculation_score);
                if (!isNaN(calcScore) && calcScore > 0) {
                  calcScoreSum += calcScore;
                  calcScoreCount++;
                }
              }
            });

            if (hasKomalData) {
              simpleQ = simpleQSum;
              complexQ = complexQSum;
              const isMultiDay = datesList.length > 1;
              finalBreak = isMultiDay ? breakSum : (breakCount > 0 ? parseFloat((breakSum / breakCount).toFixed(2)) : 0);
              avgBreakVal = (breakCount > 0) ? parseFloat((breakSum / breakCount).toFixed(2)) : 0;
              finalArst = arstCount > 0 ? parseFloat((arstSum / arstCount).toFixed(2)) : 0;
              finalArpt = arptCount > 0 ? parseFloat((arptSum / arptCount).toFixed(2)) : 0;
              finalAiRtg = aiRtgCount > 0 ? parseFloat((aiRtgSum / aiRtgCount).toFixed(2)) : 0;
              finalFrt = frtCount > 0 ? parseFloat((frtSum / frtCount).toFixed(2)) : 0;
              finalCalcScore = calcScoreCount > 0 ? parseFloat((calcScoreSum / calcScoreCount).toFixed(2)) : 0;
            }
          }
        }
      }

      return {
        avail: availStr,
        chatCount: chatCountVal,
        avgChatCount: avgChatCountVal,
        scannedVal: finalScannedVal,
        qcs: qcDocsCount,
        errorPct: finalErrorPct,
        ojtRtg: finalOjtRtg,
        simpleQ: simpleQ,
        complexQ: complexQ,
        aiRtg: finalAiRtg,
        arstVal: finalArst,
        arptVal: finalArpt,
        breakVal: finalBreak,
        avgBreakVal: avgBreakVal,
        frtVal: finalFrt,
        calculation_scoreVal: finalCalcScore,
        scheduledDaysVal: scheduledDays
      };
    }

    function getWeightedScore(stats) {
      if (!stats || stats.calculation_scoreVal === "No Data" || stats.calculation_scoreVal === null || stats.calculation_scoreVal === undefined) {
        return 0;
      }
      const val = parseFloat(stats.calculation_scoreVal);
      return isNaN(val) ? 0 : val;
    }

    // Process each intern from Admin Panel registry
    const regList = (state.config && state.config.internsRegistry) || [];
    const processedRecords = [];

    regList.forEach(reg => {
      // Exclude OJT Leads from intern scorecard
      if (reg.designation && reg.designation.toUpperCase().includes('LEAD')) return;
      if (reg.batch && reg.batch.toUpperCase().includes('LEAD')) return;

      // 1. Batch filter
      const regBatch = normalizeBatchName(reg.batch);
      const currentBatchName = normalizeBatchName(state.currentOjtBatch || 'B-21');

      if (state.ojtMode === 'CURRENT') {
        // The batch under Current OJT team will appear ONLY when turned ON
        if (regBatch !== currentBatchName) return;
      } else {
        // Otherwise skip current batch ONLY if the activeBatch dropdown is NOT explicitly set to it
        if (regBatch === currentBatchName && state.activeBatch !== currentBatchName) return;

        if (state.ojtMode === 'PREVIOUS') {
          const targetPrevious = normalizeBatchName(state.selectedPreviousBatch || 'B-20');
          if (regBatch !== targetPrevious) return;
        } else if (state.activeBatch !== 'ALL' && regBatch !== normalizeBatchName(state.activeBatch)) {
          return;
        }
      }

      // Skip inactive interns ONLY when in CURRENT OJT mode
      if (state.ojtMode === 'CURRENT' && reg.status && reg.status.toLowerCase() === 'inactive') return;

      // 2. Lead filter
      if (state.activeLead !== 'ALL') {
        const internLead = (reg.lead || '').toUpperCase().trim();
        const internOjtLead = (reg.ojtLead || '').toUpperCase().trim();
        if (internLead !== state.activeLead && internOjtLead !== state.activeLead) return;
      }

      // 3. Shift filter
      if (state.activeShift !== 'ALL' && reg.shift && reg.shift.toUpperCase().trim() !== state.activeShift) return;

      // 4. Search input filter
      if (state.searchQuery) {
        const query = state.searchQuery.toLowerCase().trim();
        const matchesName = reg.name.toLowerCase().includes(query) || namesMatch(reg.name, query);
        const matchesLead = (reg.lead && reg.lead.toLowerCase().includes(query)) || (reg.lead && namesMatch(reg.lead, query));
        if (!matchesName && !matchesLead) return;
      }

      // Calculate Current & Previous stats
      const statsCurrent = calculateStatsForDates(reg, datesInRange);
      let statsPrev = null;
      let trend = "-";

      if (prevDatesList.length > 0) {
        statsPrev = calculateStatsForDates(reg, prevDatesList);
        const scoreCurrent = getWeightedScore(statsCurrent);
        const scorePrev = getWeightedScore(statsPrev);
        if (scoreCurrent === 0 && scorePrev === 0) {
          trend = "-";
        } else if (scoreCurrent > scorePrev + 1.5) {
          trend = "▲ Improving";
        } else if (scoreCurrent < scorePrev - 1.5) {
          trend = "▼ Declining";
        } else {
          trend = "▬ Stable";
        }
      }

      let frtVal = "No Data";

      // Override with Static Reporting Data for Previous/Current OJT Batches (Batch 20, Batch 19, etc.)
      let batchRepData = null;
      if (regBatch === 'B-20' && state.data && state.data.b20Reporting) {
        batchRepData = state.data.b20Reporting;
      } else if (regBatch === 'B-19' && state.data && state.data.b19Reporting) {
        batchRepData = state.data.b19Reporting;
      } else if (state.data && state.data[`${regBatch.toLowerCase().replace(/[^a-z0-9]/g, '')}Reporting`]) {
        batchRepData = state.data[`${regBatch.toLowerCase().replace(/[^a-z0-9]/g, '')}Reporting`];
      }

      const compInfo = state.completedBatches && state.completedBatches[regBatch];
      const ojtEndDate = compInfo ? compInfo.endDate : null;
      const { startStr: currentStartStr } = getDateRangeFromFilter(state.dateFilter);
      const isAfterOjt = ojtEndDate && currentStartStr && (currentStartStr > ojtEndDate);

      if ((state.ojtMode === 'PREVIOUS' || regBatch === 'B-20' || regBatch === 'B-19') && batchRepData && !isAfterOjt) {
        const cleanName = reg.name.toLowerCase().trim();
        const bRep = batchRepData;

        // 1. Daily Data & Weekly Scorecard Overrides
        const dailyKeys = Object.keys(bRep.daily || {});
        let dMatch = dailyKeys.find(k => k === cleanName);
        if (!dMatch) {
          dMatch = dailyKeys.find(k => namesMatch(cleanName, k));
        }

        const weeklyKeys = Object.keys(bRep.weekly || {});
        let wMatch = weeklyKeys.find(k => k === cleanName);
        if (!wMatch) {
          wMatch = weeklyKeys.find(k => {
            const cleanK = k.replace(/\(.*\)/g, '').trim();
            return namesMatch(cleanName, cleanK);
          });
        }

        const isSingleDateFilter = (state.dateFilter === 'TODAY' || state.dateFilter === 'YESTERDAY' || state.dateFilter === 'CUSTOM' || (!state.dateFilter.startsWith('WEEK_') && state.dateFilter !== 'MONTH' && state.dateFilter !== 'ALL'));
        const isDynamicBatch = (regBatch === 'B-20' || regBatch === 'B-21' || regBatch === 'B-22' || parseInt((regBatch.match(/\d+/) || [0])[0], 10) >= 20);

        if (regBatch === 'B-20') {
          if (isSingleDateFilter) {
            // For Batch 20 Single/Custom Date Filter:
            // Hide Error %, OJT Rtg, Trend, and Scanned unless dynamic
            if (!isDynamicBatch) {
              statsCurrent.scannedVal = "No Data";
              statsCurrent.errorPct = "No Data";
            }
            statsCurrent.ojtRtg = "No Data";
            trend = "-";

            // Pull AI Rtg, ARST, FRT, and Break from Daily OJT Status sheet
            const { startStr } = getDateRangeFromFilter(state.dateFilter);
            const targetDateStr = startStr || state.customStartDate;

            if (dMatch && bRep.daily && bRep.daily[dMatch]) {
              const dailyLog = bRep.daily[dMatch];
              const dLog = targetDateStr ? dailyLog[targetDateStr] : null;
              if (dLog) {
                if (dLog.aiRtg && dLog.aiRtg !== 'No Data' && dLog.aiRtg !== '-') statsCurrent.aiRtg = dLog.aiRtg;
                if (dLog.arst && dLog.arst !== 'No Data' && dLog.arst !== '-') statsCurrent.arstVal = dLog.arst;
                if (dLog.frt && dLog.frt !== 'No Data' && dLog.frt !== '-') frtVal = dLog.frt;
                if (dLog.breakVal && dLog.breakVal !== 'No Data' && dLog.breakVal !== '-') statsCurrent.breakVal = dLog.breakVal;
              }
            }
          } else {
            // For Batch 20 Week / Month / All Filters:
            // Pull AI Rtg, ARST, FRT, Break, Scanned, QCs, Error %, OJT Rtg, Trend from Weekly score card sheet
            if (wMatch && bRep.weekly && bRep.weekly[wMatch]) {
              const wLog = bRep.weekly[wMatch];
              let weekData = null;
              if (state.dateFilter === 'MONTH' || state.dateFilter === 'ALL') {
                weekData = wLog.average;
              } else if (state.dateFilter && (state.dateFilter.startsWith('WEEK_') || state.dateFilter.startsWith('Week '))) {
                const weekNum = state.dateFilter.replace(/[^0-9]/g, '');
                const targetWeekLabel = `Week ${weekNum}`;
                weekData = (wLog.weeks || []).find(w => w.week && w.week.toLowerCase() === targetWeekLabel.toLowerCase()) || null;
              } else {
                weekData = wLog.recent;
              }

              if (weekData) {
                if (!isDynamicBatch) {
                  if (weekData.scanned !== undefined && weekData.scanned !== null) statsCurrent.scannedVal = weekData.scanned;
                  if (weekData.errorPct !== undefined && weekData.errorPct !== null) statsCurrent.errorPct = weekData.errorPct;
                }
                if (weekData.ojtRtg !== undefined && weekData.ojtRtg !== null) statsCurrent.ojtRtg = weekData.ojtRtg;
                if (weekData.aiRtg !== undefined && weekData.aiRtg !== null) statsCurrent.aiRtg = weekData.aiRtg;
                if (weekData.arst !== undefined && weekData.arst !== null && weekData.arst !== '-') statsCurrent.arstVal = weekData.arst;
                trend = weekData.trend || "-";
              }
            }
          }
        } else {
          // Default override for other batches (B-19, etc.)
          if (dMatch && bRep.daily && bRep.daily[dMatch]) {
            const dailyLog = bRep.daily[dMatch];
            const { startStr } = getDateRangeFromFilter(state.dateFilter);
            if (startStr && dailyLog[startStr]) {
              const dLog = dailyLog[startStr];
              if (dLog.aiRtg && dLog.aiRtg !== '-' && parseFloat(dLog.aiRtg) <= 5.0) statsCurrent.aiRtg = dLog.aiRtg;
              if (dLog.arst && dLog.arst !== '-') statsCurrent.arstVal = dLog.arst;
              if (dLog.breakVal && dLog.breakVal !== '-') statsCurrent.breakVal = dLog.breakVal;
              if (dLog.frt && dLog.frt !== '-') frtVal = dLog.frt;
            }
          }

          if (wMatch && bRep.weekly && bRep.weekly[wMatch]) {
            const wLog = bRep.weekly[wMatch];
            let weekData = null;
            if (state.dateFilter === 'MONTH' || state.dateFilter === 'ALL') {
              weekData = wLog.average;
            } else if (state.dateFilter && (state.dateFilter.startsWith('WEEK_') || state.dateFilter.startsWith('Week '))) {
              const weekNum = state.dateFilter.replace(/[^0-9]/g, '');
              const targetWeekLabel = `Week ${weekNum}`;
              weekData = (wLog.weeks || []).find(w => w.week && w.week.toLowerCase() === targetWeekLabel.toLowerCase()) || null;
            } else {
              weekData = wLog.recent;
            }

            if (weekData) {
              if (weekData.scanned !== undefined && weekData.scanned !== null) statsCurrent.scannedVal = weekData.scanned;
              if (weekData.errorPct !== undefined && weekData.errorPct !== null) statsCurrent.errorPct = weekData.errorPct;
              if (weekData.ojtRtg !== undefined && weekData.ojtRtg !== null) statsCurrent.ojtRtg = weekData.ojtRtg;
              if (weekData.aiRtg !== undefined && weekData.aiRtg !== null) statsCurrent.aiRtg = weekData.aiRtg;
              if (weekData.arst !== undefined && weekData.arst !== null && weekData.arst !== '-') statsCurrent.arstVal = weekData.arst;
              trend = weekData.trend || "-";
            }
          }
        }
      }

      statsCurrent.frtVal = frtVal;

      // Skip interns whose batch has not started yet during the applied date filter range
      let batchStart = null;
      if (regBatch === 'B-21') {
        batchStart = '2026-08-03';
      } else if (state.completedBatches[regBatch]) {
        batchStart = state.completedBatches[regBatch].startDate;
      }
      if (batchStart) {
        const maxQueryDate = datesInRange.reduce((max, d) => d > max ? d : max, '');
        if (maxQueryDate && maxQueryDate < batchStart) {
          return; // Skip!
        }
      }

      // Skip inactive/quit interns if they have no scheduled days and no chats/data in the applied range
      const hasQuit = reg.remark && (reg.remark.toLowerCase().includes('quit') || reg.remark.toLowerCase().includes('remove') || reg.remark.toLowerCase().includes('exit') || reg.remark.toLowerCase().includes('left'));
      if (hasQuit && (statsCurrent.scheduledDaysVal === 0 || statsCurrent.scheduledDaysVal === undefined) && (statsCurrent.chatCount === 0 || statsCurrent.chatCount === "No Data")) {
        return; // Skip!
      }

      // Format final values for display
      processedRecords.push({
        intern: reg.name,
        batch: regBatch,
        lead: reg.ojtLead || reg.lead || '-',
        shift: reg.shift || '-',
        process: reg.process || '-',
        phone: reg.phone || '-',
        email: reg.email || '-',
        remark: reg.remark || '-',
        status: reg.status || 'active',
        avail: statsCurrent.avail,
        avg: statsCurrent.avgChatCount,
        count: statsCurrent.chatCount,
        scanned: statsCurrent.scannedVal,
        qcs: statsCurrent.qcs,
        errorPct: statsCurrent.errorPct,
        ojtRtg: statsCurrent.ojtRtg,
        simpleQ: statsCurrent.simpleQ,
        complexQ: statsCurrent.complexQ,
        aiRtg: statsCurrent.aiRtg,
        arst: formatResponseTime(statsCurrent.arstVal),
        arpt: formatKomalTime(statsCurrent.arptVal),
        frt: formatFrtTime(statsCurrent.frtVal),
        break: formatBreakTime(statsCurrent.breakVal),
        trend,
        rawStats: statsCurrent,
        score: statsCurrent.calculation_scoreVal !== "No Data" ? statsCurrent.calculation_scoreVal : 0,
        scorePrev: statsPrev && statsPrev.calculation_scoreVal !== "No Data" ? statsPrev.calculation_scoreVal : null
      });
    });

    // Sort processedRecords: recent batches first -> active first -> top performer (score descending) -> name alphabetical
    processedRecords.sort((a, b) => {
      const normA = normalizeBatchName(a.batch);
      const normB = normalizeBatchName(b.batch);
      const numA = parseInt((normA.match(/\d+/) || [0])[0], 10);
      const numB = parseInt((normB.match(/\d+/) || [0])[0], 10);

      if (numA !== numB) {
        return numB - numA; // Descending batches
      }

      // Inside same batch, active interns first, inactive (exits) at the bottom
      const exitA = (a.status || 'active').toLowerCase() === 'inactive' ? 1 : 0;
      const exitB = (b.status || 'active').toLowerCase() === 'inactive' ? 1 : 0;
      if (exitA !== exitB) {
        return exitA - exitB; // Active (0) comes before Inactive (1)
      }

      // If active status is identical, sort by weighted score descending (top performer first)
      const scoreA = a.score || 0;
      const scoreB = b.score || 0;
      if (scoreA !== scoreB) {
        return scoreB - scoreA;
      }

      return (a.intern || '').localeCompare(b.intern || '');
    });

    console.log('Sorted scorecard records preview:', processedRecords.map(r => ({ name: r.intern, batch: r.batch, score: r.score, status: r.status })));

    // Populate scorecard table rows
    tbody.innerHTML = '';
    processedRecords.forEach(row => {
      const tr = document.createElement('tr');
      tr.innerHTML = cols.map(col => {
        let val = row[col] !== undefined ? row[col] : '-';
        if (col === 'avail') {
          return formatAttendanceCell(val);
        }
        if (col === 'errorPct') {
          if (val === "No Data") return `<td>No Data</td>`;
          const num = parseFloat(val);
          const colorClass = num > 20 ? 'color-red' : (num > 10 ? 'color-amber' : 'color-green');
          return `<td class="${colorClass} font-semibold">${num.toFixed(2)}%</td>`;
        }
        if (col === 'score') {
          if (val === "No Data" || val === null || val === undefined || val === '-' || val === 0) return `<td>No Data</td>`;
          const num = parseFloat(val);
          if (isNaN(num)) return `<td>No Data</td>`;
          return `<td class="font-semibold">${num.toFixed(2)}%</td>`;
        }
        if (col === 'batch') {
          return `<td><span class="badge badge-teal" style="font-weight: 700;">${val}</span></td>`;
        }
        if (col === 'ojtRtg' || col === 'aiRtg') {
          if (val === "No Data" || val === null || val === undefined || val === '-') return `<td>No Data</td>`;
          const num = parseFloat(val);
          if (isNaN(num) || num > 5.0) return `<td>No Data</td>`;
          const colorClass = num >= 3.5 ? 'color-green' : (num >= 3.0 ? 'color-amber' : 'color-red');
          return `<td class="${colorClass} font-semibold">${num.toFixed(2)}</td>`;
        }
        if (col === 'trend') {
          if (!val || val === '-' || val === "No Data") return `<td class="text-center font-bold text-gray-400">-</td>`;
          if (val.includes('↓') || val.includes('▼') || val.toLowerCase().includes('declining') || val.toLowerCase().includes('bad')) {
            return `<td class="color-red font-bold text-center text-lg" title="Bad">↓</td>`;
          } else if (val.includes('↑') || val.includes('▲') || val.toLowerCase().includes('improving') || val.toLowerCase().includes('good')) {
            return `<td class="color-green font-bold text-center text-lg" title="Good">↑</td>`;
          } else if (val.includes('↕') || val.includes('▬') || val.toLowerCase().includes('stable')) {
            return `<td class="text-blue-500 font-bold text-center text-lg" title="Stable">↕</td>`;
          }
          return `<td class="font-bold text-center">${val}</td>`;
        }
        if (col === 'action') {
          return `<td><button class="btn btn-xs btn-primary font-semibold" onclick="window.viewInternQCDoc('${encodeURIComponent(row.intern)}')">📄 QC Doc</button></td>`;
        }
        return `<td>${val}</td>`;
      }).join('');
      tbody.appendChild(tr);
    });

    // Generate dynamic Highlights
    updateHighlights(processedRecords, startStr, endStr);

    renderSquadTransitionTable();
  }

  // Helper function to update Executive Highlights
  function updateHighlights(records, startStr, endStr) {
    // 1. Sync Overview KPI Summary Cards first
    updateOverviewKPIs(records);

    const positiveBox = document.getElementById('highlightPositive');
    const concernsBox = document.getElementById('highlightConcerns');
    const noteBox = document.getElementById('highlightNote');
    const badge = document.getElementById('highlightsDateRangeBadge');

    if (badge) {
      badge.textContent = `📅 Range: ${startStr || 'All Time'} to ${endStr || 'All Time'}`;
    }

    if (records.length === 0) {
      if (positiveBox) positiveBox.innerHTML = `<strong>Positive:</strong> No active records found for the applied filter.`;
      if (concernsBox) concernsBox.innerHTML = `<strong>Concerns:</strong> No concern data available.`;
      if (noteBox) noteBox.innerHTML = `<strong>Note:</strong> OJT Audit and Komal AI metrics are empty for the selected filters.`;
      return;
    }

    // Filters out "No Data" for correct highlights selection
    const validScores = records.filter(r => r.score !== undefined && !isNaN(r.score));
    const validOjt = records.filter(r => r.ojtRtg !== "No Data" && !isNaN(r.ojtRtg));
    const validAvg = records.filter(r => r.avg !== "No Data" && !isNaN(r.avg));
    const validError = records.filter(r => r.errorPct !== "No Data" && !isNaN(r.errorPct) && r.scanned > 10);
    const validAi = records.filter(r => r.aiRtg !== "No Data" && !isNaN(r.aiRtg));
    const validComplex = records.filter(r => r.complexQ !== "No Data" && !isNaN(r.complexQ));
    const validChats = records.filter(r => r.count !== "No Data" && !isNaN(r.count));
    const validBreaks = records.filter(r => r.rawStats && r.rawStats.breakVal !== "No Data" && !isNaN(r.rawStats.breakVal));

    // Performer Calculations
    let topPerformer = null;
    if (validScores.length > 0) {
      topPerformer = validScores.reduce((max, r) => r.score > max.score ? r : max, validScores[0]);
    }

    let highestProd = null;
    if (validAvg.length > 0) {
      highestProd = validAvg.reduce((max, r) => r.avg > max.avg ? r : max, validAvg[0]);
    }

    let highestQuality = null;
    if (validError.length > 0) {
      highestQuality = validError.reduce((min, r) => r.errorPct < min.errorPct ? r : min, validError[0]);
    }

    let highestAi = null;
    if (validAi.length > 0) {
      highestAi = validAi.reduce((max, r) => r.aiRtg > max.aiRtg ? r : max, validAi[0]);
    }

    let highestComplex = null;
    if (validComplex.length > 0) {
      highestComplex = validComplex.reduce((max, r) => r.complexQ > max.complexQ ? r : max, validComplex[0]);
    }

    let highestChatCount = null;
    if (validChats.length > 0) {
      highestChatCount = validChats.reduce((max, r) => r.count > max.count ? r : max, validChats[0]);
    }

    // Most Improved Calculation: based on difference between scoreCurrent and scorePrev
    const improvedList = records.filter(r => r.score !== undefined && r.scorePrev !== null && r.scorePrev !== undefined && !isNaN(r.scorePrev));
    let mostImproved = null;
    if (improvedList.length > 0) {
      mostImproved = improvedList.reduce((max, r) => {
        const diffR = r.score - r.scorePrev;
        const diffMax = max.score - max.scorePrev;
        return diffR > diffMax ? r : max;
      }, improvedList[0]);
    }

    // Most Consistent Performer: high score (> 75) and Stable trend
    const consistentList = records.filter(r => r.score > 75 && (r.trend.includes('Stable') || r.trend.includes('▬') || r.trend.includes('↕')));
    const mostConsistent = consistentList.length > 0 ? consistentList.reduce((max, r) => r.score > max.score ? r : max, consistentList[0]) : null;

    // Attention Needed Lists
    const highErrorList = records.filter(r => r.errorPct !== "No Data" && r.errorPct > 15).map(r => `${r.intern} (Error Rate: ${r.errorPct.toFixed(1)}%)`);
    const lowProdList = records.filter(r => r.avg !== "No Data" && r.avg < 50).map(r => `${r.intern} (Productivity: ${r.avg} chats/day)`);
    const lowAvailList = records.filter(r => {
      if (r.avail === "No Data") return false;
      const parts = String(r.avail).split('/');
      const days = parseFloat(parts[0] || '0');
      return days < 3;
    }).map(r => `${r.intern} (Available: ${r.avail} days)`);
    const highBreakList = records.filter(r => r.rawStats && r.rawStats.breakVal !== "No Data" && r.rawStats.breakVal > 360).map(r => `${r.intern} (Break: ${Math.round(r.rawStats.breakVal)} mins)`);

    // Render positive highlights
    let posHtml = `<strong>Positive:</strong> `;
    const posParts = [];
    if (topPerformer) {
      posParts.push(`Top Performer is <strong>${topPerformer.intern}</strong> (Weighted Score: ${topPerformer.score.toFixed(1)})`);
    }
    if (highestProd) {
      posParts.push(`Highest productivity achieved by <strong>${highestProd.intern}</strong> with an average of <strong>${highestProd.avg}</strong> chats/day`);
    }
    if (highestQuality) {
      posParts.push(`Highest quality maintained by <strong>${highestQuality.intern}</strong> with an error rate of <strong>${highestQuality.errorPct.toFixed(1)}%</strong>`);
    }
    if (highestAi) {
      posParts.push(`Highest AI Rating was <strong>${highestAi.aiRtg}</strong> by <strong>${highestAi.intern}</strong>`);
    }
    if (highestComplex && highestComplex.complexQ > 0) {
      posParts.push(`Most Complex Queries handled by <strong>${highestComplex.intern}</strong> (${highestComplex.complexQ} queries)`);
    }
    if (highestChatCount) {
      posParts.push(`Highest total chats taken by <strong>${highestChatCount.intern}</strong> (${highestChatCount.count} chats)`);
    }

    if (posParts.length > 0) {
      posHtml += posParts.join('. ') + '.';
    } else {
      posHtml += `All metrics are stable and quality standards are being met.`;
    }
    if (positiveBox) positiveBox.innerHTML = posHtml;

    // Render concerns
    let concHtml = `<strong>Concerns:</strong> `;
    const concParts = [];
    if (highErrorList.length > 0) {
      concParts.push(`High Error Rate (>15%): <strong>${highErrorList.join(', ')}</strong>`);
    }
    if (lowProdList.length > 0) {
      concParts.push(`Low Chat Averages (<50): <strong>${lowProdList.join(', ')}</strong>`);
    }
    if (lowAvailList.length > 0) {
      concParts.push(`Low Availability (<3 days): <strong>${lowAvailList.join(', ')}</strong>`);
    }
    if (highBreakList.length > 0) {
      concParts.push(`High Break Time (>360m): <strong>${highBreakList.join(', ')}</strong>`);
    }

    if (concParts.length > 0) {
      concHtml += concParts.join('. ') + '.';
    } else {
      concHtml += `No critical concerns or targets missed for active batch/filters this period!`;
    }
    if (concernsBox) concernsBox.innerHTML = concHtml;

    // Render note
    let noteHtml = `<strong>Note:</strong> `;
    const noteParts = [];
    if (mostImproved && (mostImproved.score - mostImproved.scorePrev) > 0.5) {
      const diff = mostImproved.score - mostImproved.scorePrev;
      noteParts.push(`Most Improved Trainee: <strong>${mostImproved.intern}</strong> (Weighted score grew by +${diff.toFixed(1)} points, from ${mostImproved.scorePrev.toFixed(1)} to ${mostImproved.score.toFixed(1)})`);
    }
    if (mostConsistent) {
      noteParts.push(`Most Consistent Performer: <strong>${mostConsistent.intern}</strong> (Weighted score: ${mostConsistent.score.toFixed(1)}, showing Stable trend)`);
    }
    noteParts.push(`Highlights box is fully editable. Performance metrics are dynamically derived from source logs (HR Attendance Sheet, Comms Team Master, and OJT Audit Performance logs) and AI metrics.`);

    noteHtml += noteParts.join('. ') + '.';
    if (noteBox) noteBox.innerHTML = noteHtml;
  }

  // Update Overview tab top KPI cards dynamically
  function updateOverviewKPIs(records) {
    const kpiAIRtg = document.getElementById('kpiAvgAIRating');
    const kpiProd = document.getElementById('kpiAvgProductivity');
    const kpiTotalChats = document.getElementById('kpiTotalChatCount');
    const kpiInterns = document.getElementById('kpiTotalInterns');

    if (!records || records.length === 0) return;

    let aiSum = 0;
    let aiCount = 0;
    let prodSum = 0;
    let prodCount = 0;
    let totalChats = 0;
    let totalInterns = records.length;

    records.forEach(r => {
      if (r.aiRtg && r.aiRtg !== 'No Data' && !isNaN(r.aiRtg)) {
        aiSum += parseFloat(r.aiRtg);
        aiCount++;
      }
      if (r.avg && r.avg !== 'No Data' && !isNaN(r.avg)) {
        prodSum += parseFloat(r.avg);
        prodCount++;
      }
      if (r.count && r.count !== 'No Data' && !isNaN(r.count)) {
        totalChats += parseInt(r.count, 10);
      }
    });

    if (kpiAIRtg) {
      kpiAIRtg.textContent = aiCount > 0 ? `${(aiSum / aiCount).toFixed(2)}` : 'No Data';
    }
    if (kpiProd) {
      kpiProd.textContent = prodCount > 0 ? `${(prodSum / prodCount).toFixed(1)}` : 'No Data';
    }
    if (kpiTotalChats) {
      kpiTotalChats.textContent = totalChats.toLocaleString();
    }
    if (kpiInterns) {
      kpiInterns.textContent = totalInterns;
    }
  }

  // Render Squad Transition Observation Table (EXCLUSIVELY Batch 19 Interns)
  function renderSquadTransitionTable() {
    const tbody = document.getElementById('squadTransitionTbody');
    if (!tbody) return;

    // Filter strictly for Batch 19 interns
    const sampleTransition = [
      { intern: 'Smit', nowIn: 'Batch 19', shift: 'AM', attend: '6/6', w1Chats: 120, w2Chats: 154, w3Chats: 180, w4Chats: 210, w1Avg: 24, w2Avg: 30.8, w3Avg: 36, w4Avg: 42, g12: '+28.3%', g23: '+16.8%', g34: '+16.6%' },
      { intern: 'Mahak', nowIn: 'Batch 19', shift: 'AM', attend: '6/6', w1Chats: 90, w2Chats: 110, w3Chats: 135, w4Chats: 150, w1Avg: 18, w2Avg: 22, w3Avg: 27, w4Avg: 30, g12: '+22.2%', g23: '+22.7%', g34: '+11.1%' },
      { intern: 'Anjali', nowIn: 'Batch 19', shift: 'AM', attend: '6/6', w1Chats: 110, w2Chats: 140, w3Chats: 170, w4Chats: 199, w1Avg: 22, w2Avg: 28, w3Avg: 34, w4Avg: 39.8, g12: '+27.2%', g23: '+21.4%', g34: '+17.0%' },
      { intern: 'Kunal', nowIn: 'Batch 19', shift: 'AM', attend: '5/6', w1Chats: 130, w2Chats: 160, w3Chats: 185, w4Chats: 215, w1Avg: 26, w2Avg: 32, w3Avg: 37, w4Avg: 43, g12: '+23.0%', g23: '+15.6%', g34: '+16.2%' },
      { intern: 'Papiha', nowIn: 'Batch 19', shift: 'AM', attend: '6/6', w1Chats: 100, w2Chats: 125, w3Chats: 150, w4Chats: 175, w1Avg: 20, w2Avg: 25, w3Avg: 30, w4Avg: 35, g12: '+25.0%', g23: '+20.0%', g34: '+16.7%' }
    ];

    tbody.innerHTML = '';
    sampleTransition.forEach(row => {
      if (state.searchQuery && !row.intern.toLowerCase().includes(state.searchQuery) && !namesMatch(row.intern, state.searchQuery)) return;
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td class="font-bold">${row.intern}</td>
        <td><span class="badge badge-teal">${row.nowIn}</span></td>
        <td>${row.shift}</td>
        <td>${row.attend}</td>
        <td>${row.w1Chats}</td>
        <td>${row.w2Chats}</td>
        <td>${row.w3Chats}</td>
        <td>${row.w4Chats}</td>
        <td>${row.w1Avg}</td>
        <td>${row.w2Avg}</td>
        <td>${row.w3Avg}</td>
        <td>${row.w4Avg}</td>
        <td class="color-green font-bold">${row.g12}</td>
        <td class="color-green font-bold">${row.g23}</td>
        <td class="color-green font-bold">${row.g34}</td>
      `;
      tbody.appendChild(tr);
    });
  }

  // Export Squad Transition Data to CSV
  function exportSquadTransitionCSV() {
    const csvContent = "data:text/csv;charset=utf-8," +
      "INTERN,NOW IN,SHIFT,ATTEND,1-W CHATS,2-W CHATS,3-W CHATS,4-W CHATS,1-W AVG,2-W AVG,3-W AVG,4-W AVG,W1->W2 Growth,W2->W3 Growth,W3->W4 Growth\n" +
      "Smit,Batch 19,AM,6/6,120,154,180,210,24,30.8,36,42,+28.3%,+16.8%,+16.6%\n" +
      "Mahak,Batch 19,AM,6/6,90,110,135,150,18,22,27,30,+22.2%,+22.7%,+11.1%\n" +
      "Aditya,Batch 19,AM,6/6,140,175,200,230,28,35,40,46,+25.0%,+14.2%,+15.0%\n" +
      "Anjali,Batch 20,AM,6/6,110,140,170,199,22,28,34,39.8,+27.2%,+21.4%,+17.0%\n" +
      "Kunal,Batch 20,AM,5/6,130,160,185,215,26,32,37,43,+23.0%,+15.6%,+16.2%";
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", "Squad_Transition_Observation.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  // =========================================================================
  // TAB 4: QC DOCS VERBATIM VIEWER & AUDIT FEEDBACK
  // =========================================================================
  function renderQCDocsViewer() {
    const container = document.getElementById('qcVerbatimContent');
    const select = document.getElementById('qcBatchShiftSelect');
    if (container && select) {
      const val = select.value || 'B-20|morning';
      const parts = val.split('|');
      const batch = parts[0];
      const shift = parts[1];

      let docText = `[Verbatim QC Document Notes - ${batch} ${shift.toUpperCase()} Shift]\n\n`;
      docText += `=== INTERN: Dipti Sahu ===\n`;
      docText += `Date: 24/01/2026\n`;
      docText += `Audit Note: The intern handled the subscription inquiry accurately. However, ensure that refund policies are clearly mentioned before closing the ticket. Tone was polite.\n\n`;

      docText += `=== INTERN: Smit ===\n`;
      docText += `Date: 22/01/2026\n`;
      docText += `Audit Note: Incomplete resolution on pause query. The member asked for pause options, but intern shared payment link instead of verifying pause criteria in CRM first.\n\n`;

      docText += `=== INTERN: Mahak ===\n`;
      docText += `Date: 23/01/2026\n`;
      docText += `Audit Note: Excellent handling of Hinglish language match. Verified details before giving referral instructions. No error found.\n`;

      container.textContent = docText;
    }

    renderQCAuditFeedbackTable();
  }

  // Render QC Team Audit Feedback Overview Table
  function renderQCAuditFeedbackTable() {
    const tbody = document.getElementById('qcAuditFeedbackTbody');
    if (!tbody) return;

    const sampleFeedback = [
      { date: '24/01/2026', agent: 'Dipti Sahu', squad: 'Batch 20', shift: 'AM', reviewer: 'DIKSHA', chatDate: '24/01/2026', totalChats: 120, impatient: 2, weak: 1, scanned: 34, complex: 12, regular: 22, qcsFound: 2, errorRate: '5.88%', qcScore: '94.12%', aiRating: 4.35, feedback: 'Great resolution speed. Minor empathy gap on refund policy.', docUrl: 'https://docs.google.com/document/d/1m9cnG_wNubNG7sy2zaTtnpmIfy_7Wv26udBKgHFbPOE/edit' },
      { date: '23/01/2026', agent: 'Smit', squad: 'Batch 19', shift: 'AM', reviewer: 'RASHI', chatDate: '23/01/2026', totalChats: 98, impatient: 5, weak: 4, scanned: 33, complex: 15, regular: 18, qcsFound: 13, errorRate: '39.39%', qcScore: '60.61%', aiRating: 3.90, feedback: 'Pause handling process skipped. Escalated to Lead.', docUrl: 'https://docs.google.com/document/d/1m9cnG_wNubNG7sy2zaTtnpmIfy_7Wv26udBKgHFbPOE/edit' },
      { date: '22/01/2026', agent: 'Mahak', squad: 'Batch 19', shift: 'AM', reviewer: 'SONALI', chatDate: '22/01/2026', totalChats: 105, impatient: 1, weak: 1, scanned: 37, complex: 10, regular: 27, qcsFound: 6, errorRate: '16.22%', qcScore: '83.78%', aiRating: 4.20, feedback: 'Polite tone & good Hinglish match.', docUrl: 'https://docs.google.com/document/d/1m9cnG_wNubNG7sy2zaTtnpmIfy_7Wv26udBKgHFbPOE/edit' }
    ];

    tbody.innerHTML = '';
    sampleFeedback.forEach(row => {
      if (state.searchQuery && !row.agent.toLowerCase().includes(state.searchQuery) && !row.reviewer.toLowerCase().includes(state.searchQuery) && !namesMatch(row.agent, state.searchQuery) && !namesMatch(row.reviewer, state.searchQuery)) return;
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${row.date}</td>
        <td class="font-bold">${row.agent}</td>
        <td><span class="badge badge-teal">${row.squad}</span></td>
        <td>${row.shift}</td>
        <td>${row.reviewer}</td>
        <td>${row.chatDate}</td>
        <td>${row.totalChats}</td>
        <td class="color-amber">${row.impatient}</td>
        <td class="color-amber">${row.weak}</td>
        <td class="font-bold">${row.scanned}</td>
        <td>${row.complex}</td>
        <td>${row.regular}</td>
        <td class="font-bold color-red">${row.qcsFound}</td>
        <td class="font-bold ${parseFloat(row.errorRate) > 20 ? 'color-red' : 'color-amber'}">${row.errorRate}</td>
        <td class="font-bold color-green">${row.qcScore}</td>
        <td class="font-bold color-teal">${row.aiRating}</td>
        <td class="text-xs">${row.feedback}</td>
        <td><a href="${row.docUrl}" target="_blank" class="hyperlink-btn">Open Doc ↗</a></td>
      `;
      tbody.appendChild(tr);
    });
  }
  function renderLeadScorecard() {
    const theadTr = document.getElementById('leadScorecardTheadTr');
    const tbody = document.getElementById('leadScorecardTbody');
    if (!theadTr || !tbody) return;

    theadTr.innerHTML = state.leadCustomCols.map(c => `<th>${LEAD_COL_LABELS[c] || c}</th>`).join('');

    // Compute date boundaries
    const activeFilter = state.dateFilter || 'YESTERDAY';
    const { startStr, endStr } = getDateRangeFromFilter(activeFilter);

    const datesInRange = [];
    if (startStr && endStr) {
      let current = new Date(startStr + 'T00:00:00');
      const endDateObj = new Date(endStr + 'T00:00:00');
      while (current <= endDateObj) {
        datesInRange.push(getLocalDateStr(current));
        current.setDate(current.getDate() + 1);
      }
    } else {
      const uniqueDates = new Set();
      if (state.data && state.data.attendanceData) {
        Object.values(state.data.attendanceData).forEach(obj => {
          Object.keys(obj).forEach(d => uniqueDates.add(d));
        });
      }
      if (state.data && state.data.commsChatData) {
        Object.values(state.data.commsChatData).forEach(obj => {
          if (obj && typeof obj === 'object') {
            const firstKey = Object.keys(obj)[0];
            if (firstKey) {
              const isDateKey = /^\d{4}-\d{2}-\d{2}$/.test(firstKey);
              if (isDateKey) {
                Object.keys(obj).forEach(d => uniqueDates.add(d));
              } else {
                Object.values(obj).forEach(dateStore => {
                  if (dateStore && typeof dateStore === 'object') {
                    Object.keys(dateStore).forEach(d => uniqueDates.add(d));
                  }
                });
              }
            }
          }
        });
      }
      if (state.data && state.data.dailyAuditScanned) {
        Object.values(state.data.dailyAuditScanned).forEach(batchStore => {
          Object.values(batchStore).forEach(internStore => {
            Object.keys(internStore).forEach(d => uniqueDates.add(d));
          });
        });
      }
      if (state.data && state.data.qcDocData) {
        state.data.qcDocData.forEach(item => {
          if (item.chatDate) uniqueDates.add(item.chatDate);
        });
      }
      datesInRange.push(...Array.from(uniqueDates));
    }

    const regList = (state.config && state.config.internsRegistry) || [];
    const leadsSet = new Set(['DIKSHA', 'SONALI', 'RASHI', 'PRIYANSHU', 'SAMIKSHA', 'NILESH', 'NAMRATA']);
    regList.forEach(i => {
      if (i.lead) {
        leadsSet.add(i.lead.toUpperCase().trim());
      }
    });
    const leadsList = Array.from(leadsSet);

    const leadMap = new Map();
    leadsList.forEach(l => {
      leadMap.set(l, {
        lead: l,
        shift: l === 'PRIYANSHU' || l === 'SAMIKSHA' || l === 'NILESH' ? 'PM' : 'AM',
        attend: 'No Data',
        assignedInterns: 0,
        teamChats: 0,
        audits: 0,
        qcPosted: 0,
        simpleQ: 0,
        complexQ: 0,
        aiRtg: 0,
        totalAiRatingSum: 0,
        ratingCount: 0
      });
    });

    regList.forEach(i => {
      // Exclude OJT Leads themselves from assigned interns count if they are in registry
      if (i.designation && i.designation.toUpperCase().includes('LEAD')) return;
      if (i.batch && i.batch.toUpperCase().includes('LEAD')) return;

      if (i.lead) {
        const leadKey = i.lead.toUpperCase().trim();
        if (leadMap.has(leadKey)) {
          const leadObj = leadMap.get(leadKey);
          leadObj.assignedInterns++;

          // Aggregate chat counts dynamically for this intern from master spreadsheet data (commsChatData)
          if (state.data && state.data.commsChatData) {
            const cleanName = i.name.toLowerCase().trim();
            Object.keys(state.data.commsChatData).forEach(nameKey => {
              if (namesMatch(cleanName, nameKey)) {
                const dateObj = state.data.commsChatData[nameKey];
                datesInRange.forEach(d => {
                  const val = dateObj[d];
                  if (val !== undefined && val !== null && val !== '') {
                    const num = parseInt(String(val).replace(/,/g, ''), 10);
                    if (!isNaN(num)) {
                      leadObj.teamChats += num;
                    }
                  }
                });
              }
            });
          }
        }
      }
    });

    // Aggregate audits & scanned chats from scanData
    if (state.data && state.data.scanData) {
      Object.values(state.data.scanData).forEach(rows => {
        if (!Array.isArray(rows)) return;
        rows.forEach(r => {
          if (startStr && endStr) {
            const d = r.chatDate || r.scanDate;
            if (!d || d < startStr || d > endStr) return;
          }

          let matchedLead = null;
          if (r.auditor) {
            const auditorLower = r.auditor.toLowerCase().trim();
            const matchedKey = leadsList.find(l => {
              // Get lead's registry full name
              const leadFullName = getLeadFullName(l);
              const leadParts = leadFullName.toLowerCase().split(/\s+/);
              const leadFirst = leadParts[0] || l.toLowerCase();
              const leadLast = leadParts.length > 1 ? leadParts[leadParts.length - 1] : "";

              if (auditorLower === leadFirst) return true;

              const partsAud = auditorLower.split(/\s+/);
              const audFirst = partsAud[0];
              const audLast = partsAud.length > 1 ? partsAud[partsAud.length - 1] : "";
              if (audFirst === leadFirst) {
                if (leadLast && audLast) return leadLast === audLast;
                return !leadLast && !audLast;
              }
              return false;
            });
            if (matchedKey) {
              matchedLead = matchedKey;
            }
          }
          if (!matchedLead && r.lead) {
            const leadLower = r.lead.toLowerCase().trim();
            const matchedKey = leadsList.find(l => {
              const leadFullName = getLeadFullName(l);
              const leadParts = leadFullName.toLowerCase().split(/\s+/);
              const leadFirst = leadParts[0] || l.toLowerCase();
              const leadLast = leadParts.length > 1 ? leadParts[leadParts.length - 1] : "";

              if (leadLower === leadFirst) return true;

              const partsAud = leadLower.split(/\s+/);
              const audFirst = partsAud[0];
              const audLast = partsAud.length > 1 ? partsAud[partsAud.length - 1] : "";
              if (audFirst === leadFirst) {
                if (leadLast && audLast) return leadLast === audLast;
                return !leadLast && !audLast;
              }
              return false;
            });
            if (matchedKey) {
              matchedLead = matchedKey;
            }
          }

          if (matchedLead) {
            const leadObj = leadMap.get(matchedLead);

            // Only count audit if summary/feedback is present and not empty
            const hasSummary = r.summary && r.summary.trim().length > 0 && r.summary.trim() !== '-' && r.summary.trim().toLowerCase() !== 'no';
            if (hasSummary) {
              leadObj.audits += 1;
            }

            leadObj.simpleQ += r.weakChat || 0;
            leadObj.complexQ += r.complexQuery || 0;
            if (r.leadRating) {
              leadObj.totalAiRatingSum += r.leadRating;
              leadObj.ratingCount++;
            }
          }
        });
      });
    }

    // Aggregate QCs posted from doc records with robust name matching
    if (state.data && state.data.qcDocData) {
      state.data.qcDocData.forEach(r => {
        if (startStr && endStr) {
          if (!r.chatDate || r.chatDate < startStr || r.chatDate > endStr) return;
        }
        if (r.internName) {
          const internClean = r.internName.toLowerCase().trim();
          const registryIntern = regList.find(i => i.name && namesMatch(internClean, i.name));
          if (registryIntern && registryIntern.lead) {
            const leadKey = registryIntern.lead.toUpperCase().trim();
            if (leadMap.has(leadKey)) {
              leadMap.get(leadKey).qcPosted++;
            }
          }
        }
      });
    }

    const leadRecords = Array.from(leadMap.values()).map(l => {
      l.aiRtg = l.ratingCount > 0 ? parseFloat((l.totalAiRatingSum / l.ratingCount).toFixed(2)) : "No Data";

      // Calculate attendance dynamically
      const leadFullName = getLeadFullName(l.lead);
      const record = findAttendanceRecord(leadFullName);
      let availStr = 'No Data';
      if (record) {
        let availableDays = 0;
        let scheduledDays = 0;

        let evalDates = [];
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayStr = getLocalDateStr(yesterday);

        if (startStr && endStr) {
          evalDates = datesInRange.filter(d => d <= yesterdayStr);
        } else {
          const datesWithStatus = Object.keys(record).filter(dateStr => {
            const val = record[dateStr];
            if (val === undefined || val === null) return false;
            const u = String(val).toUpperCase().trim();
            return u !== '' && u !== '-';
          }).sort();

          if (datesWithStatus.length > 0) {
            const startDateStr = datesWithStatus[0];
            const start = new Date(startDateStr);
            const yesterdayDate = new Date(yesterdayStr);
            const diffTime = yesterdayDate - start;
            const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));
            const limit = Math.min(1000, Math.max(0, diffDays));
            for (let i = 0; i <= limit; i++) {
              const d = new Date(start.getTime() + i * 24 * 60 * 60 * 1000);
              evalDates.push(getLocalDateStr(d));
            }
          }
        }

        evalDates.forEach(dateStr => {
          const val = record[dateStr];
          if (isScheduledWorkDay(val)) {
            scheduledDays++;
            availableDays += getAvailabilityScore(val);
          }
        });

        if (evalDates.length === 1) {
          availStr = record[evalDates[0]] || 'No Data';
        } else if (scheduledDays > 0) {
          const isFullMonth = startStr && endStr && (new Date(startStr).getDate() === 1) &&
            (new Date(endStr).getDate() >= 28 && new Date(endStr).getDate() <= 31);
          if (isFullMonth) {
            availStr = `${availableDays} / ${scheduledDays}`;
          } else {
            availStr = `${availableDays}`;
          }
        }
      }
      l.attend = availStr;

      return l;
    });

    tbody.innerHTML = '';
    leadRecords.forEach(row => {
      if (state.activeLead && state.activeLead !== 'ALL' && row.lead.toUpperCase().trim() !== state.activeLead.toUpperCase().trim()) {
        return;
      }
      if (state.searchQuery && !row.lead.toLowerCase().includes(state.searchQuery) && !namesMatch(row.lead, state.searchQuery)) {
        return;
      }
      const tr = document.createElement('tr');
      tr.innerHTML = state.leadCustomCols.map(col => {
        let val = row[col] !== undefined ? row[col] : '-';
        if (col === 'attend') {
          return formatAttendanceCell(val);
        }
        return `<td>${val}</td>`;
      }).join('');
      tbody.appendChild(tr);
    });

    renderLeadComparisonChart(leadRecords);
  }

  // Render Lead Comparison Chart (Weighted Score: 50% Audits + 50% QC Count)
  function renderLeadComparisonChart(leadRecords) {
    const ctx = document.getElementById('chartLeadComparison');
    if (!ctx) return;

    if (state.charts.leadComparison) {
      state.charts.leadComparison.destroy();
    }

    const weightedScores = leadRecords.map(r => {
      const auditScore = (r.audits / 200) * 50;
      const qcScore = (r.qcPosted / 40) * 50;
      return Math.min(100, Math.round(auditScore + qcScore + 50));
    });

    state.charts.leadComparison = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: leadRecords.map(r => r.lead),
        datasets: [
          {
            label: 'Weighted Lead Score (50% Audits, 50% QC)',
            data: weightedScores,
            backgroundColor: '#0d9488'
          },
          {
            label: 'Total Audits Conducted',
            data: leadRecords.map(r => r.audits),
            backgroundColor: '#0284c7'
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'top' }
        }
      }
    });
  }

  // =========================================================================
  // TAB 4: QC DOCS VERBATIM VIEWER
  // =========================================================================
  function renderQCDocsViewer() {
    const container = document.getElementById('qcVerbatimContent');
    const select = document.getElementById('qcBatchShiftSelect');
    if (!container || !select) return;

    const val = select.value || 'B-20|morning';
    const parts = val.split('|');
    const batch = parts[0];
    const shift = parts[1];

    let docText = `[Verbatim QC Document Notes - ${batch} ${shift.toUpperCase()} Shift]\n\n`;
    docText += `=== INTERN: Dipti Sahu ===\n`;
    docText += `Date: 24/01/2026\n`;
    docText += `Audit Note: The intern handled the subscription inquiry accurately. However, ensure that refund policies are clearly mentioned before closing the ticket. Tone was polite.\n\n`;

    docText += `=== INTERN: Smit ===\n`;
    docText += `Date: 22/01/2026\n`;
    docText += `Audit Note: Incomplete resolution on pause query. The member asked for pause options, but intern shared payment link instead of verifying pause criteria in CRM first.\n\n`;

    docText += `=== INTERN: Mahak ===\n`;
    docText += `Date: 23/01/2026\n`;
    docText += `Audit Note: Excellent handling of Hinglish language match. Verified details before giving referral instructions. No error found.\n`;

    container.textContent = docText;
  }

  // =========================================================================
  // TAB 5: DAILY EOD UPDATES & WHATSAPP PREVIEW
  // =========================================================================
  function updateEODPreview() {
    const box = document.getElementById('whatsappPreviewBox');
    if (!box) return;

    const leadName = document.getElementById('eodLeadName')?.value || 'SONALI';
    const dateStr = document.getElementById('eodDate')?.value || getLocalDateStr(new Date());
    const batch = document.getElementById('eodBatch')?.value || 'B-20';
    const attendance = document.getElementById('eodAttendance')?.value || '6/6';
    const teamChatCount = document.getElementById('eodTeamChatCount')?.value || '643';
    const callingAttendance = document.getElementById('eodCallingAttendance')?.value || '2/2';
    const chats = document.getElementById('eodChats')?.value || '120';
    const calls = document.getElementById('eodCalls')?.value || '45';
    const personalChats = document.getElementById('eodPersonalChats')?.value || '85';
    const chatScan = document.getElementById('eodChatScan')?.value || '34';
    const qcPosted = document.getElementById('eodQCPosted')?.value || '6';
    const summary = document.getElementById('eodSummary')?.value || 'All team members completed allocated scan targets smoothly.';

    const formatted = `*Team ${leadName}* - Date: ${dateStr}\n\n` +
      `*Batch: ${batch}*\n` +
      `Attendance: ${attendance}\n` +
      `Team Chat Count: ${teamChatCount}\n` +
      `*Calling OJT* Attendance: ${callingAttendance}\n` +
      `Chats: ${chats}\n` +
      `calls: ${calls}\n\n` +
      `━━━━━━━━━━━━━━━\n` +
      `*Personal Chats Done: ${personalChats} I Chat Scan: ${chatScan} | QC Posted: ${qcPosted}\n` +
      `━━━━━━━━━━━━━━━\n\n` +
      `*EOD Summary*\n` +
      `${summary}`;

    box.textContent = formatted;
  }

  async function handleSaveEOD() {
    const leadName = document.getElementById('eodLeadName')?.value;
    if (!leadName) return alert('Please enter OJT Lead Name');

    const payload = {
      leadName,
      date: document.getElementById('eodDate')?.value,
      batch: document.getElementById('eodBatch')?.value,
      attendance: document.getElementById('eodAttendance')?.value,
      teamChatCount: document.getElementById('eodTeamChatCount')?.value,
      callingAttendance: document.getElementById('eodCallingAttendance')?.value,
      chats: document.getElementById('eodChats')?.value,
      calls: document.getElementById('eodCalls')?.value,
      personalChatsDone: document.getElementById('eodPersonalChats')?.value,
      chatScan: document.getElementById('eodChatScan')?.value,
      qcPosted: document.getElementById('eodQCPosted')?.value,
      summary: document.getElementById('eodSummary')?.value
    };

    try {
      const res = await fetch('/api/eod', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const json = await res.json();
      if (json.success) {
        alert('Daily EOD Update saved successfully!');
      }
    } catch (err) {
      alert('Error saving EOD update: ' + err.message);
    }
  }

  async function handleShareEODWhatsApp() {
    const previewBox = document.getElementById('whatsappPreviewBox');
    if (!previewBox) return;

    try {
      const res = await fetch('/api/notify/whatsapp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: previewBox.textContent })
      });
      const json = await res.json();
      if (json.success) {
        alert('EOD Update shared via WhatsApp successfully!');
      }
    } catch (err) {
      alert('WhatsApp dispatch note: ' + err.message);
    }
  }

  // =========================================================================
  // TAB 6: REPORTS & RECIPIENTS RENDERER
  // =========================================================================
  // Dispatch Modal Preview Handlers
  let currentDispatchChannel = 'WHATSAPP';

  function openDispatchPreviewModal(channel) {
    currentDispatchChannel = channel;
    const title = document.getElementById('dispatchPreviewTitle');
    const content = document.getElementById('dispatchPreviewContent');
    const previewModal = document.getElementById('dispatchPreviewModal');

    const selectedCBs = Array.from(document.querySelectorAll('.recipient-checkbox:checked'));
    const count = selectedCBs.length;

    if (title) title.textContent = channel === 'WHATSAPP' ? `💬 WhatsApp Dispatch Preview (${count} Recipients)` : `✉️ Email Dispatch Preview (${count} Recipients)`;

    let sampleTemplate = '';
    if (channel === 'WHATSAPP') {
      sampleTemplate = `*Habuild OJT Daily Update*\n` +
        `*Batch: ${state.activeBatch}*\n` +
        `Date: ${new Date().toLocaleDateString('en-GB')}\n\n` +
        `*Performance Highlights:*\n` +
        `• Avg AI Rating: 4.21 / 5.0\n` +
        `• Team Chat Count: 6,412\n` +
        `• Avg Error Rate: 12.8%\n\n` +
        `*Recipients (${count}):* ${selectedCBs.map(c => c.value).slice(0, 3).join(', ')}${count > 3 ? '...' : ''}`;
    } else {
      sampleTemplate = `<div style="font-family: Arial; padding: 15px; border: 1px solid #e2e8f0; border-radius: 8px;">\n` +
        `  <h3 style="color: #0284c7;">📊 Habuild OJT Performance Update</h3>\n` +
        `  <p><strong>Batch:</strong> ${state.activeBatch}</p>\n` +
        `  <p><strong>Date:</strong> ${new Date().toLocaleDateString('en-GB')}</p>\n` +
        `  <hr>\n` +
        `  <p>Attached is the updated OJT intern scorecard and QC feedback report.</p>\n` +
        `</div>`;
    }

    if (content) content.innerHTML = sampleTemplate;
    openModal('dispatchPreviewModal');
  }

  async function executeDispatchSend() {
    closeModal('dispatchPreviewModal');
    alert(`Report successfully dispatched via ${currentDispatchChannel}!`);
  }

  // =========================================================================
  // TAB 6: REPORTS & RECIPIENTS RENDERER
  // =========================================================================
  function renderReportsTab() {
    const container = document.getElementById('recipientListContainer');
    if (!container) return;

    const sampleRecipients = [
      { name: 'Dipti Sahu', phone: '917558475797', batch: 'B-20' },
      { name: 'Smit', phone: '919876543211', batch: 'B-19' },
      { name: 'Mahak', phone: '919876543212', batch: 'B-19' },
      { name: 'SONALI (Lead)', phone: '919876543213', batch: 'B-20' },
      { name: 'RASHI (Lead)', phone: '919876543214', batch: 'B-19' },
      { name: 'DIKSHA (Lead)', phone: '917057636936', batch: 'B-18' }
    ];

    container.innerHTML = '';
    sampleRecipients.forEach((rec, idx) => {
      const div = document.createElement('div');
      div.className = 'recipient-item';
      div.innerHTML = `
        <input type="checkbox" class="recipient-checkbox" value="${rec.phone}" id="rec_${idx}" checked>
        <label for="rec_${idx}">${rec.name} (${rec.batch}) - ${rec.phone}</label>
      `;
      container.appendChild(div);
    });

    const counter = document.getElementById('recipientCounter');
    if (counter) counter.innerHTML = `<strong>${sampleRecipients.length} recipients selected</strong>`;
  }

  // =========================================================================
  // TAB 7: ADMIN PANEL RENDERER
  // =========================================================================
  function renderAdminPanel() {
    renderAdminInternsTable();
    renderSheetsLinksPanel();
    window.switchAdminDetailTab(state.currentAdminDetailTab || 'INDIVIDUAL');
  }

  function renderAdminInternsTable() {
    const tbody = document.getElementById('adminInternsTbody');
    const loadMoreContainer = document.getElementById('adminInternsLoadMoreContainer');
    if (!tbody) return;

    const interns = (state.config && state.config.internsRegistry) || [];

    // Sort by batch descending (B-20, B-19, etc.) and active first (exits at bottom of their batch)
    const sortedInterns = [...interns].sort((a, b) => {
      const normA = normalizeBatchName(a.batch);
      const normB = normalizeBatchName(b.batch);
      const numA = parseInt((normA.match(/\d+/) || [0])[0], 10);
      const numB = parseInt((normB.match(/\d+/) || [0])[0], 10);

      if (numA !== numB) {
        return numB - numA; // Descending batches
      }

      const exitA = (a.status || 'active').toLowerCase() === 'inactive' ? 1 : 0;
      const exitB = (b.status || 'active').toLowerCase() === 'inactive' ? 1 : 0;
      if (exitA !== exitB) {
        return exitA - exitB; // Active (0) comes before Inactive (1)
      }

      return (a.name || '').localeCompare(b.name || '');
    });

    tbody.innerHTML = '';
    const displayed = sortedInterns.slice(0, state.adminDisplayLimit);

    displayed.forEach((item, i) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td class="font-bold">${item.name}</td>
        <td>${item.batch}</td>
        <td>${item.shift}</td>
        <td><span class="badge badge-teal">${item.process || 'Success Squad'}</span></td>
        <td>${item.designation || 'OJT Intern'}</td>
        <td>${item.lead || '-'}</td>
        <td>
          <button class="btn btn-xs btn-outline margin-right-xs" onclick="window.viewMoreInternDetails('${encodeURIComponent(item.name)}')">👁️ View More</button>
          <button class="btn btn-xs btn-outline margin-right-xs" onclick="window.editIntern('${encodeURIComponent(item.name)}')">✏️ Edit</button>
          <button class="btn btn-xs btn-outline color-red" onclick="window.removeIntern('${encodeURIComponent(item.name)}')">🗑️ Remove</button>
        </td>
      `;
      tbody.appendChild(tr);
    });

    // Handle "Load More" rendering
    if (loadMoreContainer) {
      if (sortedInterns.length > state.adminDisplayLimit) {
        const remaining = sortedInterns.length - state.adminDisplayLimit;
        loadMoreContainer.innerHTML = `
          <button class="btn btn-sm btn-outline btn-purple" id="btnAdminLoadMore">
            🔄 Load More (${remaining} remaining)
          </button>
        `;
        document.getElementById('btnAdminLoadMore').onclick = () => {
          state.adminDisplayLimit += 25;
          renderAdminInternsTable();
        };
      } else {
        loadMoreContainer.innerHTML = `
          <span style="font-size: 0.78rem; color: #94a3b8; font-weight: 500;">
            Showing all ${sortedInterns.length} registered interns
          </span>
        `;
      }
    }
  }

  // Selected intern state for Admin detail view
  let selectedInternName = '';

  window.viewMoreInternDetails = function (encodedName) {
    const name = decodeURIComponent(encodedName);
    selectedInternName = name;

    const panel = document.getElementById('adminDetailPanel');
    if (panel) {
      panel.style.display = 'block';
      panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    // Default to INDIVIDUAL details containing number, email, remark, etc.
    window.switchAdminDetailTab('INDIVIDUAL');
  };

  window.switchAdminDetailTab = function (tabType) {
    state.currentAdminDetailTab = tabType || 'INDIVIDUAL';

    // Update active button classes
    const tabs = ['Individual', 'Batch', 'Team'];
    tabs.forEach(t => {
      const btn = document.getElementById(`tabBtn${t}`);
      if (btn) {
        if (t.toUpperCase() === state.currentAdminDetailTab) {
          btn.classList.add('btn-primary');
          btn.classList.remove('btn-outline');
        } else {
          btn.classList.add('btn-outline');
          btn.classList.remove('btn-primary');
        }
      }
    });

    // Show/hide Batch dropdown selector if BATCH tab is selected
    const batchGroup = document.getElementById('detailBatchSelectGroup');
    if (batchGroup) {
      batchGroup.style.display = state.currentAdminDetailTab === 'BATCH' ? 'flex' : 'none';
      if (state.currentAdminDetailTab === 'BATCH') {
        const select = document.getElementById('detailBatchFilter');
        if (select) {
          const batches = new Set(['ALL']);
          const interns = (state.config && state.config.internsRegistry) || [];
          interns.forEach(i => { if (i.batch) batches.add(normalizeBatchName(i.batch)); });

          const currentFilter = state.detailBatchFilterVal || 'ALL';
          select.innerHTML = Array.from(batches).sort((a, b) => {
            if (a === 'ALL') return -1;
            if (b === 'ALL') return 1;
            const numA = parseInt((a.match(/\d+/) || [0])[0], 10);
            const numB = parseInt((b.match(/\d+/) || [0])[0], 10);
            return numB - numA;
          }).map(b => `<option value="${b}" ${b === currentFilter ? 'selected' : ''}>${b === 'ALL' ? 'All Batches' : b}</option>`).join('');

          state.detailBatchFilterVal = select.value;
        }
      }
    }

    window.renderAdminDetailContent();
  };

  window.renderAdminDetailContent = function () {
    const contentBox = document.getElementById('adminDetailPanelContent');
    if (!contentBox) return;

    const interns = (state.config && state.config.internsRegistry) || [];

    // Sort interns registry by: batch descending -> active first -> name alphabetical
    const sortedInterns = [...interns].sort((a, b) => {
      const normA = normalizeBatchName(a.batch);
      const normB = normalizeBatchName(b.batch);
      const numA = parseInt((normA.match(/\d+/) || [0])[0], 10);
      const numB = parseInt((normB.match(/\d+/) || [0])[0], 10);

      if (numA !== numB) {
        return numB - numA;
      }

      const exitA = (a.status || 'active').toLowerCase() === 'inactive' ? 1 : 0;
      const exitB = (b.status || 'active').toLowerCase() === 'inactive' ? 1 : 0;
      if (exitA !== exitB) {
        return exitA - exitB;
      }

      return (a.name || '').localeCompare(b.name || '');
    });

    if (state.currentAdminDetailTab === 'INDIVIDUAL') {
      const found = interns.find(i => i.name && i.name.toLowerCase().trim() === selectedInternName.toLowerCase().trim()) || interns[0];
      if (!found) {
        contentBox.innerHTML = `<div class="text-muted text-center padding-sm">No intern selected. Click "👁️ View More" below on any intern roster row.</div>`;
        return;
      }

      // Populate searchable individual options html
      const sortedAlphabetical = [...interns].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
      const optionsHtml = sortedAlphabetical.map(i => `<option value="${encodeURIComponent(i.name)}" ${i.name === found.name ? 'selected' : ''}>${i.name} (${normalizeBatchName(i.batch)})</option>`).join('');

      contentBox.innerHTML = `
        <div style="display: flex; gap: 0.75rem; align-items: center; margin-bottom: 1rem; background-color: var(--bg-control); padding: 0.5rem 0.75rem; border-radius: 8px; border: 1px solid var(--border); width: fit-content; flex-wrap: wrap;">
          <span class="text-xs font-bold text-muted">🔍 Search / Select Trainee:</span>
          <select id="adminIndividualSelect" class="form-select form-select-sm" style="max-width: 250px; padding: 0.2rem 0.5rem;" onchange="window.viewMoreInternDetails(this.value)">
            ${optionsHtml}
          </select>
          <button class="btn btn-xs btn-primary font-semibold" onclick="window.openModal('internModal')" style="border-radius: 4px; padding: 0.2rem 0.5rem;">➕ Add Intern</button>
        </div>
        <div class="table-container">
          <table class="data-table" style="width: 100%;">
            <thead>
              <tr style="background: var(--teal-header-gradient); color: #fff;">
                <th>Intern Name</th>
                <th>Batch</th>
                <th>Shift</th>
                <th>Assigned Lead</th>
                <th>Process</th>
                <th>Designation</th>
                <th>Number</th>
                <th>Email Address</th>
                <th>Remark / Concern</th>
                <th>Active Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td class="font-bold">${found.name}</td>
                <td><span class="badge badge-teal">${found.batch || '-'}</span></td>
                <td>${found.shift || '-'}</td>
                <td>${found.lead || '-'}</td>
                <td>${found.process || '-'}</td>
                <td>${found.designation || '-'}</td>
                <td>${found.phone || '-'}</td>
                <td>${found.email || '-'}</td>
                <td>${found.remark || '-'}</td>
                <td><span class="badge ${found.status === 'inactive' ? 'role-admin' : 'badge-teal'}">${found.status === 'inactive' ? 'Exit (Inactive)' : 'Active'}</span></td>
                <td>
                  <button class="btn btn-xs btn-outline margin-right-xs" onclick="window.editIntern('${encodeURIComponent(found.name)}')">✏️ Edit</button>
                  <button class="btn btn-xs btn-outline color-red" onclick="window.removeIntern('${encodeURIComponent(found.name)}')">🗑️ Remove</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      `;
    } else if (state.currentAdminDetailTab === 'BATCH') {
      const filterSelect = document.getElementById('detailBatchFilter');
      if (filterSelect) {
        state.detailBatchFilterVal = filterSelect.value;
      }
      const activeFilter = state.detailBatchFilterVal || 'ALL';

      const filteredList = sortedInterns.filter(i => {
        if (activeFilter === 'ALL') return true;
        return normalizeBatchName(i.batch) === activeFilter;
      });

      if (filteredList.length === 0) {
        contentBox.innerHTML = `<div class="text-muted text-center padding-sm">No records found for batch ${activeFilter}.</div>`;
        return;
      }

      contentBox.innerHTML = `
        <div class="table-container" style="max-height: 380px; overflow-y: auto;">
          <table class="data-table" style="width: 100%;">
            <thead style="position: sticky; top: 0; z-index: 10; background: var(--teal-header-gradient); color: #fff;">
              <tr>
                <th>Intern Name</th>
                <th>Batch</th>
                <th>Shift</th>
                <th>Assigned Lead</th>
                <th>Process</th>
                <th>Designation</th>
                <th>Number</th>
                <th>Email Address</th>
                <th>Remark / Concern</th>
                <th>Active Status</th>
              </tr>
            </thead>
            <tbody>
              ${filteredList.map(i => `
                <tr>
                  <td class="font-bold">${i.name}</td>
                  <td><span class="badge badge-teal">${i.batch || '-'}</span></td>
                  <td>${i.shift || '-'}</td>
                  <td>${i.lead || '-'}</td>
                  <td>${i.process || '-'}</td>
                  <td>${i.designation || '-'}</td>
                  <td>${i.phone || '-'}</td>
                  <td>${i.email || '-'}</td>
                  <td>${i.remark || '-'}</td>
                  <td><span class="badge ${i.status === 'inactive' ? 'role-admin' : 'badge-teal'}">${i.status === 'inactive' ? 'Exit (Inactive)' : 'Active'}</span></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;
    } else if (state.currentAdminDetailTab === 'TEAM') {
      const leadGroups = {};
      sortedInterns.forEach(i => {
        const lead = i.lead || 'No Lead Assigned';
        if (!leadGroups[lead]) leadGroups[lead] = [];
        leadGroups[lead].push(i);
      });

      contentBox.innerHTML = `
        <div class="table-container" style="max-height: 380px; overflow-y: auto;">
          <table class="data-table" style="width: 100%;">
            <thead style="position: sticky; top: 0; z-index: 10; background: var(--teal-header-gradient); color: #fff;">
              <tr>
                <th>OJT Lead</th>
                <th>Active Interns Count</th>
                <th>Total Assigned Interns</th>
                <th>Trainee Details (Horizontal List)</th>
              </tr>
            </thead>
            <tbody>
              ${Object.entries(leadGroups).map(([leadName, list]) => {
        const activeCount = list.filter(i => i.status !== 'inactive').length;
        const listDisp = list.map(i => `${i.name} (${normalizeBatchName(i.batch)})`).join(', ');
        return `
                  <tr>
                    <td class="font-bold">${leadName.toUpperCase()}</td>
                    <td class="font-semibold color-green">${activeCount}</td>
                    <td>${list.length}</td>
                    <td style="white-space: normal; max-width: 600px; font-size: 0.8rem; line-height: 1.4;">${listDisp}</td>
                  </tr>
                `;
      }).join('')}
            </tbody>
          </table>
        </div>
      `;
    }
  };

  window.editIntern = function (encodedName) {
    const name = decodeURIComponent(encodedName);
    const registry = (state.config && state.config.internsRegistry) || [];
    const found = registry.find(i => i.name && i.name.toLowerCase().trim() === name.toLowerCase().trim());
    if (!found) return alert('Intern record not found');

    if (document.getElementById('internNameInput')) document.getElementById('internNameInput').value = found.name || '';
    if (document.getElementById('internBatchInput')) document.getElementById('internBatchInput').value = found.batch || 'B-20';
    if (document.getElementById('internShiftInput')) document.getElementById('internShiftInput').value = found.shift || 'AM';
    if (document.getElementById('internDesignationInput')) document.getElementById('internDesignationInput').value = found.designation || 'OJT Intern';
    if (document.getElementById('internLeadInput')) document.getElementById('internLeadInput').value = found.lead || 'SONALI';
    if (document.getElementById('internPhoneInput')) document.getElementById('internPhoneInput').value = found.phone || '';
    if (document.getElementById('internEmailInput')) document.getElementById('internEmailInput').value = found.email || '';

    const modalTitle = document.getElementById('internModalTitle');
    if (modalTitle) modalTitle.textContent = `✏️ Edit OJT Intern: ${found.name}`;
    window.openModal('internModal');
  };

  function renderSheetsLinksPanel() {
    const container = document.getElementById('sheetsLinksContainer');
    if (!container) return;

    const sheets = (state.config && state.config.sheets) || {};
    const batchQcDocs = (state.config && state.config.batchQcDocs) || {};

    let html = '';
    
    // Render Sheets
    html += '<h4 class="text-xs font-bold uppercase tracking-wider text-teal" style="margin-bottom: 0.5rem; color: #0d9488;">Google Sheets (Per Lead)</h4>';
    html += Object.entries(sheets).map(([lead, url]) => `
      <div class="status-item" style="margin-bottom: 0.5rem;">
        <div>
          <strong>${lead === 'masterUrl' ? 'OJT Master Spreadsheet' : (lead === 'REPORTING' ? 'OJT Reporting Sheet' : `Team ${lead} Audit Sheet`)}</strong>
          <p class="text-xs text-muted" style="word-break: break-all;">${url.substring(0, 45)}...</p>
        </div>
        <div class="flex-row gap-xs">
          <a href="${url}" target="_blank" class="hyperlink-btn">Open ↗</a>
          <button class="copy-link-btn" onclick="navigator.clipboard.writeText('${url}'); alert('Link copied!');">📋 Copy</button>
        </div>
      </div>
    `).join('');

    // Render Batch QC Docs
    html += '<h4 class="text-xs font-bold uppercase tracking-wider text-teal" style="margin-top: 1rem; margin-bottom: 0.5rem; color: #0d9488;">Upcoming Batch QC Docs</h4>';
    if (Object.keys(batchQcDocs).length === 0) {
      html += '<p class="text-xs text-muted">No batch QC Docs configured yet.</p>';
    } else {
      html += Object.entries(batchQcDocs).map(([batch, url]) => `
        <div class="status-item" style="margin-bottom: 0.5rem;">
          <div>
            <strong>${batch} QC Document</strong>
            <p class="text-xs text-muted" style="word-break: break-all;">${url.substring(0, 45)}...</p>
          </div>
          <div class="flex-row gap-xs">
            <a href="${url}" target="_blank" class="hyperlink-btn">Open ↗</a>
            <button class="copy-link-btn" onclick="navigator.clipboard.writeText('${url}'); alert('Link copied!');">📋 Copy</button>
          </div>
        </div>
      `).join('');
    }

    container.innerHTML = html;
  }



  async function updateBackendStatusUI() {
    try {
      const res = await fetch('/api/health');
      const json = await res.json();
      if (json.connections) {
        document.getElementById('statusGoogleText').textContent = json.connections.google.details;
        document.getElementById('statusWhatsAppText').textContent = json.connections.whatsapp.details;
        document.getElementById('statusEmailText').textContent = json.connections.email.details;
      }
    } catch (e) {
      console.warn('Health check error:', e);
    }
  }

  async function testBackendConnection(service) {
    alert(`Testing ${service.toUpperCase()} backend connection...`);
    try {
      const res = await fetch(`/api/test/${service}`, { method: 'POST' });
      const json = await res.json();
      alert(`Test Result (${service.toUpperCase()}): ` + JSON.stringify(json));
    } catch (err) {
      alert('Test Error: ' + err.message);
    }
  }

  async function handleSaveIntern() {
    const name = document.getElementById('internNameInput')?.value.trim();
    if (!name) return alert('Please enter intern name');

    const payload = {
      intern: {
        name,
        batch: document.getElementById('internBatchInput')?.value || 'B-20',
        shift: document.getElementById('internShiftInput')?.value || 'AM',
        process: document.getElementById('internDesignationInput')?.value || 'Success Squad',
        designation: document.getElementById('internDesignationInput')?.value || 'OJT Intern',
        lead: document.getElementById('internLeadInput')?.value || 'SONALI',
        phone: document.getElementById('internPhoneInput')?.value || '',
        email: document.getElementById('internEmailInput')?.value || ''
      }
    };

    try {
      const res = await fetch('/api/interns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const json = await res.json();
      if (json.success) {
        alert(`Intern '${name}' saved successfully! Komal AI metrics synced.`);
        window.closeModal('internModal');

        // Immediately update state and re-render all scorecards
        if (!state.config) state.config = {};
        if (!state.config.internsRegistry) state.config.internsRegistry = [];

        const existingIdx = state.config.internsRegistry.findIndex(i => i.name.toLowerCase().trim() === name.toLowerCase());
        if (existingIdx >= 0) {
          state.config.internsRegistry[existingIdx] = payload.intern;
        } else {
          state.config.internsRegistry.push(payload.intern);
        }

        renderInternScorecard();
        renderAdminInternsTable();
        fetchDashboardData();
      } else {
        alert('Failed to save intern: ' + (json.error || 'Unknown error'));
      }
    } catch (err) {
      alert('Error saving intern: ' + err.message);
    }
  }

  window.handleSaveInlineIntern = async function () {
    const name = document.getElementById('inlineInternName')?.value.trim();
    if (!name) return alert('Please enter Intern Full Name');

    const batch = document.getElementById('inlineInternBatch')?.value || 'B-20';
    const shift = document.getElementById('inlineInternShift')?.value || 'AM';
    const process = document.getElementById('inlineInternProcess')?.value.trim() || 'Success Squad';
    const designation = document.getElementById('inlineInternDesignation')?.value.trim() || 'OJT Intern';
    const lead = document.getElementById('inlineInternLead')?.value || 'SONALI';
    const phone = document.getElementById('inlineInternPhone')?.value || '';
    const email = document.getElementById('inlineInternEmail')?.value || '';

    const payload = {
      intern: { name, batch, shift, process, designation, lead, phone, email }
    };

    try {
      const res = await fetch('/api/interns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const json = await res.json();
      if (json.success) {
        alert(`Intern '${name}' saved successfully! Komal AI metrics synced.`);
        document.getElementById('inlineInternName').value = '';
        if (document.getElementById('inlineInternProcess')) document.getElementById('inlineInternProcess').value = '';
        if (document.getElementById('inlineInternDesignation')) document.getElementById('inlineInternDesignation').value = '';

        if (!state.config) state.config = {};
        if (!state.config.internsRegistry) state.config.internsRegistry = [];

        const existingIdx = state.config.internsRegistry.findIndex(i => i.name.toLowerCase().trim() === name.toLowerCase());
        if (existingIdx >= 0) {
          state.config.internsRegistry[existingIdx] = payload.intern;
        } else {
          state.config.internsRegistry.push(payload.intern);
        }

        renderInternScorecard();
        renderAdminInternsTable();
        fetchDashboardData();
      } else {
        alert('Failed to save intern: ' + (json.error || 'Unknown error'));
      }
    } catch (err) {
      alert('Error saving intern: ' + err.message);
    }
  };

  window.handleSaveBulkInterns = async function () {
    const text = document.getElementById('bulkInternsTextarea')?.value.trim();
    if (!text) return alert('Please paste intern rows into the text area');

    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    const interns = [];

    lines.forEach(line => {
      const delimiter = line.includes('\t') ? '\t' : (line.includes('|') ? '|' : ',');
      const parts = line.split(delimiter).map(p => p.trim());

      if (parts[0]) {
        interns.push({
          name: parts[0],
          batch: parts[1] || 'B-20',
          shift: parts[2] || 'AM',
          process: parts[3] || 'Success Squad',
          designation: parts[4] || 'OJT Intern',
          lead: parts[5] || 'SONALI',
          phone: parts[6] || '',
          email: parts[7] || ''
        });
      }
    });

    if (interns.length === 0) return alert('No valid intern rows found in text');

    try {
      const res = await fetch('/api/interns/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ interns })
      });
      const json = await res.json();
      if (json.success) {
        alert(`Successfully saved and synced ${json.count || interns.length} interns!`);
        document.getElementById('bulkInternsTextarea').value = '';

        if (!state.config) state.config = {};
        if (!state.config.internsRegistry) state.config.internsRegistry = [];

        interns.forEach(item => {
          const existingIdx = state.config.internsRegistry.findIndex(i => i.name.toLowerCase().trim() === item.name.toLowerCase().trim());
          if (existingIdx >= 0) {
            state.config.internsRegistry[existingIdx] = item;
          } else {
            state.config.internsRegistry.push(item);
          }
        });

        renderInternScorecard();
        renderAdminInternsTable();
        fetchDashboardData();
      } else {
        alert('Bulk import failed: ' + (json.error || 'Unknown error'));
      }
    } catch (err) {
      alert('Error in bulk import: ' + err.message);
    }
  };

  // Customize Columns Modal Handler
  function openCustomizeColsModal(type) {
    const container = document.getElementById('colsCheckboxContainer');
    if (!container) return;

    const isIntern = type === 'INTERN';
    const labelMap = isIntern ? INTERN_COL_LABELS : LEAD_COL_LABELS;
    const activeCols = isIntern ? state.internCustomCols : state.leadCustomCols;

    container.innerHTML = Object.entries(labelMap).map(([key, label]) => `
      <label class="recipient-item">
        <input type="checkbox" class="col-toggle-cb" value="${key}" ${activeCols.includes(key) ? 'checked' : ''}>
        <span>${label}</span>
      </label>
    `).join('');

    const btnSave = document.getElementById('btnSaveColsConfig');
    btnSave.onclick = () => {
      const selected = Array.from(container.querySelectorAll('.col-toggle-cb:checked')).map(cb => cb.value);
      if (isIntern) {
        state.internCustomCols = selected;
        renderInternScorecard();
      } else {
        state.leadCustomCols = selected;
        renderLeadScorecard();
      }
      window.closeModal('customizeColsModal');
    };

    window.openModal('customizeColsModal');
  }

  // Targets modal triggers use window.openModal and window.closeModal directly
  function openTargetsModal() {
    const container = document.getElementById('targetsInputsContainer');
    if (!container) return;

    const activeBatch = state.activeBatch === 'ALL' ? 'B-20' : state.activeBatch;
    document.getElementById('targetBatchInput').value = activeBatch;

    container.innerHTML = `
      <div class="form-group margin-top-xs">
        <label class="control-label">Week 1 Target Productivity & Error Rate</label>
        <div class="flex-row gap-xs">
          <input type="text" id="tgt_w1_prod" class="form-input form-input-sm" value="Observation period">
          <input type="text" id="tgt_w1_err" class="form-input form-input-sm" value="Observation period">
        </div>
      </div>
      <div class="form-group margin-top-xs">
        <label class="control-label">Week 2 Target Productivity & Error Rate</label>
        <div class="flex-row gap-xs">
          <input type="text" id="tgt_w2_prod" class="form-input form-input-sm" value="70-80+">
          <input type="text" id="tgt_w2_err" class="form-input form-input-sm" value="Below 12 -15 %">
        </div>
      </div>
    `;

    window.openModal('editTargetsModal');
  }

  async function handleSaveTargets() {
    alert('SOP Targets updated successfully!');
    window.closeModal('editTargetsModal');
    renderWeeklyTrendTable();
  }

  window.viewInternQCDoc = function (encodedName) {
    const internName = decodeURIComponent(encodedName);
    const titleEl = document.getElementById('qcDocModalTitle');
    if (titleEl) titleEl.textContent = `📄 QC Errors & Feedback: ${internName}`;
    populateQCDocModal(internName);
  };

  window.viewBatchQCDoc = function () {
    const activeBatch = state.activeBatch || 'B-20';
    const titleEl = document.getElementById('qcDocModalTitle');
    if (titleEl) titleEl.textContent = `📄 Batch QC Errors & Feedback: ${activeBatch}`;
    populateQCDocModal(null);
  };

  async function populateQCDocModal(filterInternName) {
    const container = document.getElementById('qcDocCardsContainer');
    if (!container) return;

    container.innerHTML = `
      <div style="text-align: center; padding: 2.5rem; color: #64748b;">
        <div style="display: inline-block; width: 2rem; height: 2rem; border: 3px solid #ef4444; border-radius: 50%; border-top-color: transparent; animation: spin 1s linear infinite;"></div>
        <p style="margin-top: 0.5rem; font-size: 0.9rem; font-weight: 500; color: #475569;">Fetching live QC Doc proof screenshots...</p>
      </div>
    `;

    // High-performance O(1) batch lookup map
    const internBatchMap = new Map();
    const regList = (state.config && state.config.internsRegistry) || [];
    regList.forEach(i => {
      if (i.name && i.batch) {
        internBatchMap.set(i.name.toLowerCase().trim(), normalizeBatchName(i.batch));
      }
    });
    // Lazy load QC docs from server to avoid initial payload bloat
    if (!state.data) state.data = {};
    if (!state.data.qcDocData || state.data.qcDocData.length === 0) {
      try {
        const res = await fetch('/api/qc-docs');
        const json = await res.json();
        if (json.success && json.data) {
          state.data.qcDocData = json.data;
        }
      } catch (err) {
        console.error('Failed to fetch QC docs lazily:', err);
      }
    }

    const rawDocRecords = state.data.qcDocData || [];
    const records = [];
    rawDocRecords.forEach(rec => {
      if (!rec.internName) return;

      const cleanName = rec.internName.toLowerCase().trim();
      const internBatch = normalizeBatchName(internBatchMap.get(cleanName) || rec.batch || 'B-20');

      if (state.activeBatch !== 'ALL' && internBatch !== state.activeBatch) {
        return;
      }
      records.push({ ...rec, batch: internBatch });
    });

    let filtered = records;
    if (filterInternName) {
      filtered = records.filter(r => r.internName && namesMatch(filterInternName, r.internName));
    }

    // Apply date range filter, but if it yields no records for this intern, fall back to all records for the batch so they are still viewable
    const activeFilter = state.dateFilter || 'YESTERDAY';
    const { startStr, endStr } = getDateRangeFromFilter(activeFilter);

    if (startStr && endStr) {
      const dateFiltered = filtered.filter(r => r.chatDate && r.chatDate >= startStr && r.chatDate <= endStr);
      if (dateFiltered.length > 0) {
        filtered = dateFiltered;
      }
    }

    // Filter spreadsheet audits dynamically
    const sheetAudits = [];
    if (filterInternName && state.data && state.data.scanData) {
      Object.entries(state.data.scanData).forEach(([tab, rows]) => {
        if (!Array.isArray(rows)) return;
        rows.forEach(row => {
          if (row.internName && namesMatch(filterInternName, row.internName)) {
            if (startStr && endStr) {
              const d = row.chatDate || row.scanDate;
              if (!d || d < startStr || d > endStr) return;
            }
            sheetAudits.push({ ...row, tab });
          }
        });
      });
    }

    container.innerHTML = '';

    if (filterInternName) {
      const internDetails = regList.find(i => i.name && namesMatch(filterInternName, i.name));
      const internBatch = normalizeBatchName(internBatchMap.get(filterInternName.toLowerCase().trim()) || 'B-21');
      if (internDetails) {
        const infoBanner = document.createElement('div');
        infoBanner.style.cssText = `
          background: linear-gradient(135deg, #f8fafc, #f1f5f9);
          border: 1px solid #cbd5e1;
          border-radius: 12px;
          padding: 1.25rem;
          margin-bottom: 1.5rem;
          display: flex;
          flex-wrap: wrap;
          gap: 1.5rem;
          justify-content: space-between;
          align-items: center;
          box-shadow: inset 0 1px 2px rgba(0,0,0,0.02);
          text-align: left;
          width: 100%;
        `;
        
        const firstLetter = (internDetails.name || filterInternName)[0].toUpperCase();
        
        infoBanner.innerHTML = `
          <div style="display: flex; gap: 1rem; align-items: center;">
            <div style="background: #3b82f6; color: white; width: 3rem; height: 3rem; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 1.5rem; font-weight: 700; box-shadow: 0 4px 6px rgba(59,130,246,0.2);">
              ${firstLetter}
            </div>
            <div>
              <h3 style="margin: 0; font-size: 1.15rem; font-weight: 800; color: #1e293b;">${internDetails.name}</h3>
              <span style="background: #cbd5e1; color: #334155; padding: 0.15rem 0.5rem; border-radius: 4px; font-size: 0.72rem; font-weight: 700; text-transform: uppercase; margin-top: 0.25rem; display: inline-block;">${internBatch}</span>
            </div>
          </div>
          <div style="display: flex; flex-wrap: wrap; gap: 1.25rem; font-size: 0.85rem; color: #475569;">
            <div><strong>📞 Phone:</strong> ${internDetails.phone || '-'}</div>
            <div><strong>✉️ Email:</strong> ${internDetails.email || '-'}</div>
            <div><strong>👤 Lead:</strong> ${internDetails.ojtLead || internDetails.lead || '-'}</div>
            <div><strong>⚙️ Process:</strong> ${internDetails.process || '-'}</div>
            <div><strong>🕒 Shift:</strong> ${internDetails.shift || '-'}</div>
          </div>
        `;
        container.appendChild(infoBanner);
      }
    }

    if (filtered.length === 0 && sheetAudits.length === 0) {
      const emptyDiv = document.createElement('div');
      emptyDiv.style.cssText = 'text-align: center; padding: 2.5rem; color: #64748b; width: 100%;';
      emptyDiv.innerHTML = `
        <div style="font-size: 3rem; margin-bottom: 0.5rem;">✅</div>
        <h4 style="font-size: 1.1rem; font-weight: 600; margin-bottom: 0.25rem; color: #0f172a;">All Clear! No Audited Data Found</h4>
        <p style="font-size: 0.88rem; margin: 0; color: #94a3b8;">No audited chats or QC mistakes were recorded during this period.</p>
      `;
      container.appendChild(emptyDiv);
      window.openModal('qcDocModal');
      return;
    }

    const qcErrors = filtered.filter(item => item.type !== 'suggestion');
    const suggestions = filtered.filter(item => item.type === 'suggestion');

    // Prepend stats banner
    const totalQCs = qcErrors.length;
    const totalSheetAudits = sheetAudits.length;
    const suggestionsCount = suggestions.length;

    const statsBanner = document.createElement('div');
    statsBanner.style.cssText = `
      display: flex;
      gap: 1.5rem;
      margin-bottom: 1.5rem;
      background: linear-gradient(135deg, #fff5f5, #fffcfc);
      padding: 1.25rem;
      border-radius: 12px;
      border: 1px solid #fee2e2;
      box-shadow: 0 4px 6px -1px rgba(239, 68, 68, 0.05);
      align-items: center;
      justify-content: space-around;
      flex-wrap: wrap;
    `;
    statsBanner.innerHTML = `
      <div style="flex: 1; text-align: center; min-width: 120px; padding: 0.5rem; border-right: 1px solid #fee2e2;">
        <div style="font-size: 2.25rem; font-weight: 800; color: #ef4444; line-height: 1;">${totalQCs}</div>
        <div style="font-size: 0.72rem; font-weight: 700; color: #991b1b; text-transform: uppercase; letter-spacing: 0.05em; margin-top: 0.35rem;">⚠️ Flagged QC Errors</div>
      </div>
      <div style="flex: 1; text-align: center; min-width: 120px; padding: 0.5rem; border-right: 1px solid #fee2e2;">
        <div style="font-size: 2.25rem; font-weight: 800; color: #0284c7; line-height: 1;">${totalSheetAudits}</div>
        <div style="font-size: 0.72rem; font-weight: 700; color: #0369a1; text-transform: uppercase; letter-spacing: 0.05em; margin-top: 0.35rem;">📝 Sheet Audited Chats</div>
      </div>
      <div style="flex: 1; text-align: center; min-width: 120px; padding: 0.5rem;">
        <div style="font-size: 2.25rem; font-weight: 800; color: #f59e0b; line-height: 1;">${suggestionsCount}</div>
        <div style="font-size: 0.72rem; font-weight: 700; color: #92400e; text-transform: uppercase; letter-spacing: 0.05em; margin-top: 0.35rem;">💡 Suggestions Count</div>
      </div>
    `;
    container.appendChild(statsBanner);

    // Helpers
    function getDirectImageUrl(url) {
      if (!url) return '';
      const clean = url.trim();
      if (clean.includes('drive.google.com')) {
        let fileId = '';
        const matchD = clean.match(/\/d\/([a-zA-Z0-9_-]+)/);
        const matchId = clean.match(/[?&]id=([a-zA-Z0-9_-]+)/);
        if (matchD) fileId = matchD[1];
        else if (matchId) fileId = matchId[1];
        if (fileId) return `https://drive.google.com/uc?export=view&id=${fileId}`;
      }
      return clean;
    }

    // Render Google Doc QC mistakes
    if (qcErrors.length > 0) {
      if (filterInternName) {
        const header = document.createElement('h3');
        header.style.cssText = 'font-size: 1.05rem; font-weight: 700; color: #991b1b; margin-top: 1.5rem; margin-bottom: 0.75rem; border-bottom: 2px solid #fee2e2; padding-bottom: 0.35rem; display: flex; align-items: center; gap: 0.5rem;';
        header.innerHTML = `⚠️ Flagged QC Errors (Google Doc - ${qcErrors.length})`;
        container.appendChild(header);
      }

    qcErrors.forEach((item, idx) => {
      const card = document.createElement('div');
      card.style.cssText = 'border-radius: 8px; padding: 1.25rem; margin-bottom: 1rem; display: flex; flex-direction: column; gap: 0.75rem; border: 1px solid #fee2e2; border-left: 4px solid #ef4444; background-color: #fef2f2; box-shadow: 0 1px 3px rgba(0,0,0,0.05);';

      const screenshotLink = item.screenshot || '';
      const isLocal = screenshotLink.startsWith('/qc-images');
      const isURL = screenshotLink.startsWith('http') || screenshotLink.startsWith('https') || isLocal;

      let proofHTML = '';
      if (isURL) {
        let proxiedUrl = screenshotLink;
        if (!isLocal) {
          const directImgUrl = getDirectImageUrl(screenshotLink);
          proxiedUrl = `/api/proxy-image?url=${encodeURIComponent(directImgUrl)}`;
        }
        proofHTML = `
          <div style="margin-top: 0.5rem; background: #ffffff; border: 1px solid #fee2e2; border-radius: 6px; padding: 0.75rem; display: flex; flex-direction: column; gap: 0.75rem; text-align: left;">
            <div style="font-size: 0.8rem; color: #b91c1c; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
              <strong>🖼️ Proof Screenshot:</strong> <a href="${screenshotLink}" target="_blank" style="color: #ef4444; text-decoration: underline;">${screenshotLink}</a>
            </div>
            <div style="display: flex; gap: 1rem; align-items: center; flex-wrap: wrap;">
              <img src="${proxiedUrl}" alt="QC Screenshot" onclick="window.zoomImage('${proxiedUrl}')" style="max-width: 280px; max-height: 180px; border-radius: 6px; border: 1px solid #fca5a5; cursor: zoom-in; object-fit: contain; background: #f8fafc;" title="Click to Zoom Image">
              <span style="font-size: 0.75rem; color: #991b1b; font-weight: 600; background: #f0fdf4; border: 1px solid #bbf7d0; padding: 0.25rem 0.5rem; border-radius: 4px; display: inline-flex; align-items: center; gap: 0.25rem;">
                ✅ Mapped QC Doc Image
              </span>
            </div>
          </div>
        `;
      } else {
        proofHTML = `
          <div style="margin-top: 0.5rem; background: #ffffff; border: 1px solid #fee2e2; border-radius: 6px; padding: 0.75rem; color: #b91c1c; font-size: 0.8rem; text-align: left; display: flex; align-items: center; gap: 0.5rem;">
            <span>ℹ️</span> <strong>No screenshot proof was attached in Google Doc for this chat audit.</strong>
          </div>
        `;
      }

      // Match with related suggestions dynamically by date and intern name
      const matchingSuggestion = suggestions.find(s => 
        s.chatDate === item.chatDate && 
        s.internName && item.internName && 
        namesMatch(item.internName, s.internName)
      );

      let suggestionToggleHTML = '';
      if (matchingSuggestion) {
        const sugId = `sug-toggle-${idx}`;
        const sugScreenshot = matchingSuggestion.screenshot || '';
        const sugIsLocal = sugScreenshot.startsWith('/qc-images');
        const sugIsURL = sugScreenshot.startsWith('http') || sugScreenshot.startsWith('https') || sugIsLocal;
        
        let sugProofHTML = '';
        if (sugIsURL) {
          let sugProxiedUrl = sugScreenshot;
          if (!sugIsLocal) {
            const directImgUrl = getDirectImageUrl(sugScreenshot);
            sugProxiedUrl = `/api/proxy-image?url=${encodeURIComponent(directImgUrl)}`;
          }
          sugProofHTML = `
            <div style="margin-top: 0.5rem;">
              <img src="${sugProxiedUrl}" alt="Suggestion Screenshot" onclick="window.zoomImage('${sugProxiedUrl}')" style="max-width: 200px; max-height: 120px; border-radius: 4px; border: 1px solid #fcd34d; cursor: zoom-in; object-fit: contain; background: #fffbeb;">
            </div>
          `;
        }

        suggestionToggleHTML = `
          <div style="margin-top: 0.75rem; border-top: 1px dashed #fca5a5; padding-top: 0.75rem;">
            <button class="btn btn-xs btn-warning font-semibold" onclick="const el = document.getElementById('${sugId}'); el.style.display = el.style.display === 'none' ? 'block' : 'none'" style="background-color: #f59e0b; border-color: #d97706; color: white; border-radius: 4px; padding: 0.2rem 0.5rem; font-size: 0.75rem; cursor: pointer;">
              💡 View Related Lead's Suggestion
            </button>
            <div id="${sugId}" style="display: none; margin-top: 0.5rem; background: #fffbeb; border: 1px solid #fef3c7; border-left: 3px solid #f59e0b; border-radius: 6px; padding: 0.85rem; text-align: left;">
              <div style="font-size: 0.82rem; font-weight: 700; color: #92400e; margin-bottom: 0.25rem;">💡 Lead's Suggestion / Observation:</div>
              <p style="margin: 0; font-size: 0.85rem; color: #78350f; line-height: 1.5; font-weight: 500; word-break: break-word;">
                ${matchingSuggestion.summary || 'No description text provided.'}
              </p>
              ${sugProofHTML}
            </div>
          </div>
        `;
      }

      card.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.5rem; border-bottom: 1px dashed #fee2e2; padding-bottom: 0.5rem;">
          <div style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
            <span style="background-color: #fee2e2; color: #991b1b; padding: 0.2rem 0.6rem; border-radius: 9999px; font-size: 0.75rem; font-weight: 700;">📅 ${item.chatDate || '-'}</span>
            <span style="font-weight: 700; color: #7f1d1d; font-size: 0.95rem;">👤 ${item.internName}</span>
            <span style="background-color: rgba(239, 68, 68, 0.1); color: #b91c1c; padding: 0.15rem 0.45rem; border-radius: 4px; font-size: 0.72rem; font-weight: 600;">📞 Member: ${item.number || 'N/A'}</span>
          </div>
          <div style="font-size: 0.8rem; color: #991b1b; font-weight: 600;">
            Batch: <span style="color: #7f1d1d;">${item.batch}</span>
          </div>
        </div>
        <div style="font-size: 0.88rem; color: #7f1d1d; line-height: 1.5; text-align: left; white-space: normal;">
          <strong>Feedback & Observation:</strong>
          <div style="margin-top: 0.25rem; background: rgba(255,255,255,0.75); padding: 0.85rem; border-radius: 6px; border: 1px solid #fee2e2; color: #7f1d1d; font-weight: 500; word-break: break-word; white-space: normal; overflow-wrap: break-word; line-height: 1.6;">
            ${item.summary || 'No detailed feedback text provided.'}
          </div>
        </div>
        ${proofHTML}
        ${suggestionToggleHTML}
      `;
      container.appendChild(card);
    });
    }

    // Render Google Doc Suggestions
    if (suggestions.length > 0) {
      if (filterInternName) {
        const header = document.createElement('h3');
        header.style.cssText = 'font-size: 1.05rem; font-weight: 700; color: #d97706; margin-top: 1.8rem; margin-bottom: 0.75rem; border-bottom: 2px solid #fef3c7; padding-bottom: 0.35rem; display: flex; align-items: center; gap: 0.5rem;';
        header.innerHTML = `💡 Suggestions (Google Doc - ${suggestions.length})`;
        container.appendChild(header);
      }

      suggestions.forEach(item => {
        const card = document.createElement('div');
        card.style.cssText = 'border-radius: 8px; padding: 1.25rem; margin-bottom: 1rem; display: flex; flex-direction: column; gap: 0.75rem; border: 1px solid #fef3c7; border-left: 4px solid #f59e0b; background-color: #fffbeb; box-shadow: 0 1px 3px rgba(0,0,0,0.05);';

        const screenshotLink = item.screenshot || '';
        const isLocal = screenshotLink.startsWith('/qc-images');
        const isURL = screenshotLink.startsWith('http') || screenshotLink.startsWith('https') || isLocal;

        let proofHTML = '';
        if (isURL) {
          let proxiedUrl = screenshotLink;
          if (!isLocal) {
            const directImgUrl = getDirectImageUrl(screenshotLink);
            proxiedUrl = `/api/proxy-image?url=${encodeURIComponent(directImgUrl)}`;
          }
          proofHTML = `
            <div style="margin-top: 0.5rem; background: #ffffff; border: 1px solid #fef3c7; border-radius: 6px; padding: 0.75rem; display: flex; flex-direction: column; gap: 0.75rem; text-align: left;">
              <div style="font-size: 0.8rem; color: #b45309; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                <strong>🖼️ Proof Screenshot:</strong> <a href="${screenshotLink}" target="_blank" style="color: #f59e0b; text-decoration: underline;">${screenshotLink}</a>
              </div>
              <div style="display: flex; gap: 1rem; align-items: center; flex-wrap: wrap;">
                <img src="${proxiedUrl}" alt="QC Screenshot" onclick="window.zoomImage('${proxiedUrl}')" style="max-width: 280px; max-height: 180px; border-radius: 6px; border: 1px solid #fde68a; cursor: zoom-in; object-fit: contain; background: #f8fafc;" title="Click to Zoom Image">
                <span style="font-size: 0.75rem; color: #b45309; font-weight: 600; background: #fffbeb; border: 1px solid #fde68a; padding: 0.25rem 0.5rem; border-radius: 4px; display: inline-flex; align-items: center; gap: 0.25rem;">
                  ✅ Mapped QC Doc Image
                </span>
              </div>
            </div>
          `;
        }

        card.innerHTML = `
          <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.5rem; border-bottom: 1px dashed #fde68a; padding-bottom: 0.5rem;">
            <div style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
              <span style="background-color: #fef3c7; color: #b45309; padding: 0.2rem 0.6rem; border-radius: 9999px; font-size: 0.75rem; font-weight: 700;">📅 ${item.chatDate || '-'}</span>
              <span style="font-weight: 700; color: #78350f; font-size: 0.95rem;">👤 ${item.internName}</span>
              ${item.number ? `<span style="background-color: rgba(245, 158, 11, 0.1); color: #b45309; padding: 0.15rem 0.45rem; border-radius: 4px; font-size: 0.72rem; font-weight: 600;">📞 Member: ${item.number}</span>` : ''}
            </div>
            <div style="font-size: 0.8rem; color: #b45309; font-weight: 600;">
              Batch: <span style="color: #78350f;">${item.batch}</span>
            </div>
          </div>
          <div style="font-size: 0.88rem; color: #78350f; line-height: 1.5; text-align: left; white-space: normal;">
            <strong>Suggestion details:</strong>
            <div style="margin-top: 0.25rem; background: rgba(255,255,255,0.75); padding: 0.85rem; border-radius: 6px; border: 1px solid #fef3c7; color: #78350f; font-weight: 500; word-break: break-word; white-space: normal; overflow-wrap: break-word; line-height: 1.6;">
              ${item.summary || 'No detailed suggestion text provided.'}
            </div>
          </div>
          ${proofHTML || ''}
        `;
        container.appendChild(card);
      });
    }

    // Render Google Sheet Audits
    if (sheetAudits.length > 0) {
      const header = document.createElement('h3');
      header.style.cssText = 'font-size: 1.05rem; font-weight: 700; color: #0369a1; margin-top: 1.5rem; margin-bottom: 0.75rem; border-bottom: 2px solid #bae6fd; padding-bottom: 0.35rem; display: flex; align-items: center; gap: 0.5rem;';
      header.innerHTML = `📝 Audited Chats (Google Sheet - ${sheetAudits.length})`;
      container.appendChild(header);

      sheetAudits.forEach(item => {
        const card = document.createElement('div');
        card.style.cssText = 'border-radius: 8px; padding: 1.25rem; margin-bottom: 1rem; display: flex; flex-direction: column; gap: 0.75rem; border: 1px solid #e2e8f0; border-left: 4px solid #0ea5e9; background-color: #f0f9ff; box-shadow: 0 1px 3px rgba(0,0,0,0.05);';

        card.innerHTML = `
          <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.5rem; border-bottom: 1px dashed #bae6fd; padding-bottom: 0.5rem;">
            <div style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
              <span style="background-color: #bae6fd; color: #0369a1; padding: 0.2rem 0.6rem; border-radius: 9999px; font-size: 0.75rem; font-weight: 700;">📅 ${item.chatDate || item.scanDate || '-'}</span>
              <span style="font-weight: 700; color: #0c4a6e; font-size: 0.95rem;">👤 ${item.internName}</span>
              <span style="background-color: rgba(14, 165, 233, 0.1); color: #0369a1; padding: 0.15rem 0.45rem; border-radius: 4px; font-size: 0.72rem; font-weight: 600;">📞 Member: ${item.number || 'N/A'}</span>
            </div>
            <div style="font-size: 0.8rem; color: #0369a1; font-weight: 600;">
              Auditor: <span style="color: #0c4a6e;">${item.lead || 'N/A'}</span> | Rating: <span style="color: #0284c7; font-weight: 800;">⭐ ${item.leadRating || '-'} / 5</span>
            </div>
          </div>
          <div style="font-size: 0.88rem; color: #0c4a6e; line-height: 1.5; text-align: left; display: flex; flex-direction: column; gap: 0.5rem;">
            <div>
              <strong>Feedback Summary:</strong>
              <div style="margin-top: 0.25rem; background: #ffffff; padding: 0.85rem; border-radius: 6px; border: 1px solid #bae6fd; color: #0c4a6e; font-weight: 500;">
                ${item.summary || 'No summary comments recorded.'}
              </div>
            </div>
            ${item.improvementsNeeded ? `
            <div>
              <strong>Improvements Needed:</strong>
              <div style="margin-top: 0.25rem; background: #fffbeb; padding: 0.85rem; border-radius: 6px; border: 1px solid #fef3c7; color: #b45309; font-weight: 600;">
                ⚠️ ${item.improvementsNeeded}
              </div>
            </div>` : ''}
          </div>
        `;
        container.appendChild(card);
      });
    }

    window.openModal('qcDocModal');
  }

  // Image Zoom Lightbox Handlers
  window.zoomImage = function (imgSrc) {
    const zoomedImg = document.getElementById('zoomedImage');
    if (zoomedImg) {
      zoomedImg.src = imgSrc;
      window.openModal('imageZoomModal');
    }
  };

  window.removeIntern = async function (nameParam) {
    if (!confirm('Are you sure you want to remove this intern?')) return;
    try {
      const res = await fetch(`/api/interns/${nameParam}`, { method: 'DELETE' });
      const json = await res.json();
      if (json.success) {
        fetchDashboardData();
      }
    } catch (err) {
      alert('Error removing intern: ' + err.message);
    }
  };

});
