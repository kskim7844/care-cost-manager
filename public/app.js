/* ─────────────────────────────────────────────────────────────
   요양비 세부관리 시스템 - app.js
───────────────────────────────────────────────────────────── */

const API = '';  // 같은 오리진

// ── 현재 상태 ──
let currentTab = 'dashboard';
let currentCostType = null;  // 'medicine'|'supplies'|'doctor'|'nursing'|'other'
let editingId = null;
let confirmCallback = null;

// ── 초기화 ──
window.addEventListener('DOMContentLoaded', () => {
  const today = new Date();
  const ym = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}`;
  document.getElementById('globalMonth').value = ym;
  document.getElementById('globalMonth').addEventListener('change', onMonthChange);
  loadDashboard();
  setDefaultDates();
});

function setDefaultDates() {
  const today = new Date();
  const ym = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}`;
  const first = ym + '-01';
  const last  = new Date(today.getFullYear(), today.getMonth()+1, 0).toISOString().slice(0,10);
  ['med','sup','doc','nur','oth'].forEach(p => {
    const f = document.getElementById(`${p}-from`);
    const t = document.getElementById(`${p}-to`);
    if(f) f.value = first;
    if(t) t.value = last;
  });
}

function onMonthChange() {
  loadDashboard();
  loadResidentSummary();
}

// ─────────────────────────────────────────────────────────────
// 탭 전환
// ─────────────────────────────────────────────────────────────
function switchTab(tab) {
  document.querySelectorAll('.tab').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
  document.querySelector(`[data-tab="${tab}"]`).classList.add('active');
  document.getElementById(`tab-${tab}`).classList.add('active');
  currentTab = tab;
  if(tab === 'dashboard') { loadDashboard(); loadResidentSummary(); }
  if(tab === 'residents') loadResidents();
  if(tab === 'medicine')  loadMedicine();
  if(tab === 'supplies')  loadSupplies();
  if(tab === 'doctor')    loadDoctor();
  if(tab === 'nursing')   loadNursing();
  if(tab === 'other')     loadOther();
}

// ─────────────────────────────────────────────────────────────
// 포맷 헬퍼
// ─────────────────────────────────────────────────────────────
const won = v => Number(v||0).toLocaleString('ko-KR') + '원';
const wonNum = v => Number(v||0).toLocaleString('ko-KR');

// ─────────────────────────────────────────────────────────────
// 대시보드
// ─────────────────────────────────────────────────────────────
async function loadDashboard() {
  const ym = document.getElementById('globalMonth').value;
  const data = await apiFetch(`/api/dashboard?year_month=${ym}`);
  document.getElementById('d-residents').textContent = data.residents;
  const keys = ['medicine','supplies','doctor','nursing','other'];
  let grand = 0;
  keys.forEach(k => {
    document.getElementById(`d-${k}-total`).textContent = wonNum(data[k]?.total);
    document.getElementById(`d-${k}-cnt`).textContent   = `${data[k]?.count}건`;
    grand += (data[k]?.total || 0);
  });
  document.getElementById('d-grand-total').textContent = won(grand);
  loadResidentSummary();
}

async function loadResidentSummary() {
  const ym   = document.getElementById('globalMonth').value;
  const rows = await apiFetch(`/api/dashboard/resident-summary?year_month=${ym}`);
  const tbody = document.getElementById('resident-summary-body');
  if (!rows.length) { tbody.innerHTML = `<tr class="empty-row"><td colspan="8">데이터 없음</td></tr>`; return; }
  tbody.innerHTML = rows.map(r => `
    <tr>
      <td>${r.resident_id}</td>
      <td><a href="javascript:void(0)" onclick='openOtherModalForResident(${JSON.stringify(r.resident_id)}, ${JSON.stringify(r.resident_name || '')})'>${r.resident_name||''}</a></td>
      <td class="amount">${wonNum(r.medicine_total)}원</td>
      <td class="amount">${wonNum(r.supplies_total)}원</td>
      <td class="amount">${wonNum(r.doctor_total)}원</td>
      <td class="amount">${wonNum(r.nursing_total)}원</td>
      <td class="amount">${wonNum(r.other_total)}원</td>
      <td class="amount">${wonNum(r.grand_total)}원</td>
    </tr>`).join('');
}

function openOtherModalForResident(id, name) {
  switchTab('other');
  openModal('other');
  document.getElementById('c-resident-id').value = id || '';
  document.getElementById('c-resident-name').value = name || '';
  document.getElementById('resident-inline-results').innerHTML = '';
  document.getElementById('c-date').value = new Date().toISOString().slice(0, 10);
}

// ─────────────────────────────────────────────────────────────
// 수급자 관리
// ─────────────────────────────────────────────────────────────
async function loadResidents() {
  const q = document.getElementById('res-search').value;
  const rows = await apiFetch(`/api/residents?q=${encodeURIComponent(q)}`);
  const tbody = document.getElementById('residents-body');
  if (!rows.length) { tbody.innerHTML = `<tr class="empty-row"><td colspan="9">수급자 없음</td></tr>`; return; }
  tbody.innerHTML = rows.map(r => `
    <tr>
      <td><strong>${r.id}</strong></td>
      <td>${r.name}</td>
      <td><span class="badge ${r.gender==='남'?'badge-m':'badge-f'}">${r.gender||''}</span></td>
      <td>${r.age||''}</td>
      <td>${r.grade||''}</td>
      <td>${r.ward||''}</td>
      <td>${r.room||''}</td>
      <td>${r.admission_date||''}</td>
      <td style="white-space:nowrap">
        <button class="btn btn-edit" onclick="editResident('${r.id}')">수정</button>
        <button class="btn btn-delete" onclick="deleteResident('${r.id}','${r.name}')">삭제</button>
      </td>
    </tr>`).join('');
}

function openResidentModal(id) {
  clearResidentForm();
  document.getElementById('resident-modal-title').textContent = id ? '수급자 수정' : '수급자 등록';
  document.getElementById('r-id').disabled = !!id;
  if (id) document.getElementById('r-id').value = id;
  openModal_('resident');
}

async function editResident(id) {
  const r = await apiFetch(`/api/residents/${id}`);
  document.getElementById('r-id').value         = r.id;
  document.getElementById('r-name').value       = r.name;
  document.getElementById('r-gender').value     = r.gender||'';
  document.getElementById('r-age').value        = r.age||'';
  document.getElementById('r-grade').value      = r.grade||'';
  document.getElementById('r-ward').value       = r.ward||'';
  document.getElementById('r-room').value       = r.room||'';
  document.getElementById('r-admission').value  = r.admission_date||'';
  document.getElementById('r-notes').value      = r.notes||'';
  openResidentModal(id);
}

async function saveResident() {
  const id   = document.getElementById('r-id').value.trim();
  const name = document.getElementById('r-name').value.trim();
  if (!name) { showToast('이름은 필수입니다.','error'); return; }
  const body = {
    id, name,
    gender:         document.getElementById('r-gender').value,
    age:            document.getElementById('r-age').value,
    grade:          document.getElementById('r-grade').value,
    ward:           document.getElementById('r-ward').value,
    room:           document.getElementById('r-room').value,
    admission_date: document.getElementById('r-admission').value,
    notes:          document.getElementById('r-notes').value,
  };
  const isEdit = document.getElementById('r-id').disabled;
  const method = isEdit ? 'PUT' : 'POST';
  const url    = isEdit ? `/api/residents/${id}` : `/api/residents`;
  const res = await apiFetch(url, method, body);
  if (res.error) { showToast(res.error,'error'); return; }
  if (!isEdit) {
    showToast(`저장되었습니다. (ID: ${res.id})`);
  } else {
    showToast('저장되었습니다.');
  }
  closeModal('resident');
  loadResidents();
  loadDashboard();
}

function deleteResident(id, name) {
  showConfirm(`${name} 수급자를 삭제하시겠습니까?`, async () => {
    await apiFetch(`/api/residents/${id}`, 'DELETE');
    showToast('삭제되었습니다.');
    loadResidents();
    loadDashboard();
  });
}

function clearResidentForm() {
  ['r-id','r-name','r-age','r-ward','r-room','r-admission','r-notes'].forEach(id => {
    document.getElementById(id).value = '';
    document.getElementById(id).disabled = false;
  });
  document.getElementById('r-gender').value = '';
  document.getElementById('r-grade').value  = '';
}

function openResidentBulkModal() {
  const fileEl = document.getElementById('resident-csv-file');
  const textEl = document.getElementById('resident-csv-text');
  if (fileEl) fileEl.value = '';
  if (textEl) textEl.value = '';
  openModal_('resident-bulk');
}

function onResidentCsvFileSelected(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const textEl = document.getElementById('resident-csv-text');
    textEl.value = String(reader.result || '');
  };
  reader.onerror = () => {
    showToast('CSV 파일 읽기에 실패했습니다.', 'error');
  };
  reader.readAsText(file, 'utf-8');
}

async function saveResidentBulk() {
  const csvText = document.getElementById('resident-csv-text').value.trim();
  if (!csvText) {
    showToast('CSV 텍스트를 입력하거나 파일을 선택하세요.', 'error');
    return;
  }

  const res = await apiFetch('/api/residents/bulk', 'POST', { csv_text: csvText });
  if (res.error) {
    showToast(res.error, 'error');
    return;
  }

  showToast(`일괄등록 완료: ${res.inserted}건 (건너뜀 ${res.skipped}건)`);
  closeModal('resident-bulk');
  loadResidents();
  loadDashboard();
}

// ─────────────────────────────────────────────────────────────
// 비용 항목 모달 (공통)
// ─────────────────────────────────────────────────────────────
const COST_CONFIG = {
  medicine: {
    label: '진료약제비',
    fields: `
      <div class="form-grid" style="margin-top:10px">
        <div class="form-group"><label>병원/의원명</label><input id="c-hospital" type="text" placeholder="OO의원"></div>
        <div class="form-group full"><label>내역</label><input id="c-description" type="text" placeholder="처방 내역"></div>
        <div class="form-group"><label>영수증번호</label><input id="c-receipt-no" type="text"></div>
      </div>`
  },
  supplies: {
    label: '의료소모품',
    fields: `
      <div class="form-grid" style="margin-top:10px">
        <div class="form-group"><label>구매처</label><input id="c-vendor" type="text"></div>
        <div class="form-group"><label>품목명</label><input id="c-item-name" type="text"></div>
        <div class="form-group"><label>수량</label><input id="c-quantity" type="number" value="1" oninput="calcAmount()"></div>
        <div class="form-group"><label>단가</label><input id="c-unit-price" type="number" value="0" oninput="calcAmount()"></div>
        <div class="form-group"><label>영수증번호</label><input id="c-receipt-no" type="text"></div>
      </div>`
  },
  doctor: {
    label: '계약의사',
    fields: `
      <div class="form-grid" style="margin-top:10px">
        <div class="form-group"><label>의사명</label><input id="c-doctor-name" type="text"></div>
        <div class="form-group"><label>방문유형</label>
          <select id="c-visit-type"><option value="">선택</option><option>정기방문</option><option>응급방문</option><option>화상진료</option><option>기타</option></select>
        </div>
        <div class="form-group"><label>방문횟수</label><input id="c-visit-count" type="number" value="1"></div>
      </div>`
  },
  nursing: {
    label: '가정간호',
    fields: `
      <div class="form-grid" style="margin-top:10px">
        <div class="form-group"><label>간호사명</label><input id="c-nurse-name" type="text"></div>
        <div class="form-group"><label>방문유형</label>
          <select id="c-visit-type"><option value="">선택</option><option>정기방문</option><option>응급방문</option><option>처치</option><option>기타</option></select>
        </div>
        <div class="form-group"><label>방문횟수</label><input id="c-visit-count" type="number" value="1"></div>
      </div>`
  },
  other: {
    label: '기타비용',
    fields: `
      <div class="form-grid" style="margin-top:10px">
        <div class="form-group"><label>분류</label>
          <select id="c-category"><option value="">선택</option><option>진료약제비</option><option>의료소모품</option><option>계약의사</option><option>가정간호</option><option>이미용</option><option>세탁</option><option>교통</option><option>문화생활</option><option>기타</option></select>
        </div>
        <div class="form-group full"><label>내역</label><input id="c-description" type="text" placeholder="세부 내역"></div>
      </div>`
  }
};

function openModal(type, id) {
  currentCostType = type;
  editingId       = id || null;
  const cfg = COST_CONFIG[type];
  document.getElementById('cost-modal-title').textContent = id ? `${cfg.label} 수정` : `${cfg.label} 추가`;
  document.getElementById('dynamic-fields').innerHTML = cfg.fields;

  const ym = document.getElementById('globalMonth').value;
  const today = new Date().toISOString().slice(0,10);
  document.getElementById('c-year-month').value = ym;
  document.getElementById('c-date').value       = today;
  document.getElementById('c-resident-id').value   = '';
  document.getElementById('c-resident-name').value = '';
  document.getElementById('c-amount').value     = '';
  document.getElementById('c-notes').value      = '';
  document.getElementById('resident-inline-results').innerHTML = '';

  if (id) loadCostForEdit(type, id);
  openModal_('cost');
}

async function loadCostForEdit(type, id) {
  const data = await apiFetch(`/api/${type}/${id}`);
  document.getElementById('c-resident-id').value   = data.resident_id;
  document.getElementById('c-date').value          = data.date;
  document.getElementById('c-year-month').value    = data.year_month;
  document.getElementById('c-amount').value        = data.amount;
  document.getElementById('c-notes').value         = data.notes||'';
  // 수급자명 조회
  try {
    const r = await apiFetch(`/api/residents/${data.resident_id}`);
    document.getElementById('c-resident-name').value = r.name;
  } catch(e){}

  // 항목별 필드 채우기
  if (type === 'medicine') {
    safeSet('c-hospital',    data.hospital);
    safeSet('c-description', data.description);
    safeSet('c-receipt-no',  data.receipt_no);
  } else if (type === 'supplies') {
    safeSet('c-vendor',      data.vendor);
    safeSet('c-item-name',   data.item_name);
    safeSet('c-quantity',    data.quantity);
    safeSet('c-unit-price',  data.unit_price);
    safeSet('c-receipt-no',  data.receipt_no);
  } else if (type === 'doctor') {
    safeSet('c-doctor-name', data.doctor_name);
    safeSet('c-visit-type',  data.visit_type);
    safeSet('c-visit-count', data.visit_count);
  } else if (type === 'nursing') {
    safeSet('c-nurse-name',  data.nurse_name);
    safeSet('c-visit-type',  data.visit_type);
    safeSet('c-visit-count', data.visit_count);
  } else if (type === 'other') {
    safeSet('c-category',    data.category);
    safeSet('c-description', data.description);
    onAmountInput();
  }
}

function safeSet(id, val) {
  const el = document.getElementById(id);
  if (el) el.value = val || '';
}

function calcAmount() {
  const qty  = parseFloat(document.getElementById('c-quantity')?.value||'1') || 1;
  const unit = parseFloat(document.getElementById('c-unit-price')?.value||'0') || 0;
  if (currentCostType === 'supplies') {
    document.getElementById('c-amount').value = qty * unit;
  }
}

function onAmountInput() {
  const el = document.getElementById('c-amount');
  if (!el) return;
  const digits = String(el.value || '').replace(/[^\d]/g, '');
  if (!digits) {
    el.value = '';
    return;
  }
  if (currentCostType === 'other') {
    el.value = Number(digits).toLocaleString('ko-KR');
    return;
  }
  el.value = digits;
}

async function saveCost() {
  const resId = document.getElementById('c-resident-id').value.trim();
  const date  = document.getElementById('c-date').value;
  const ym    = document.getElementById('c-year-month').value;
  const amt   = document.getElementById('c-amount').value;
  if (!resId||!date||!ym) { showToast('수급자, 날짜, 년월은 필수입니다.','error'); return; }

  const base = {
    resident_id: resId, date, year_month: ym,
    amount: parseInt(String(amt || '').replace(/,/g, ''), 10) || 0,
    notes: document.getElementById('c-notes').value
  };

  let body = { ...base };
  const type = currentCostType;
  if (type === 'medicine') {
    body.hospital    = gv('c-hospital');
    body.description = gv('c-description');
    body.receipt_no  = gv('c-receipt-no');
  } else if (type === 'supplies') {
    body.vendor     = gv('c-vendor');
    body.item_name  = gv('c-item-name');
    body.quantity   = parseInt(gv('c-quantity'))||1;
    body.unit_price = parseInt(gv('c-unit-price'))||0;
    body.receipt_no = gv('c-receipt-no');
  } else if (type === 'doctor') {
    body.doctor_name = gv('c-doctor-name');
    body.visit_type  = gv('c-visit-type');
    body.visit_count = parseInt(gv('c-visit-count'))||1;
  } else if (type === 'nursing') {
    body.nurse_name  = gv('c-nurse-name');
    body.visit_type  = gv('c-visit-type');
    body.visit_count = parseInt(gv('c-visit-count'))||1;
  } else if (type === 'other') {
    body.category    = gv('c-category');
    body.description = gv('c-description');
  }

  const method = editingId ? 'PUT' : 'POST';
  const url    = editingId ? `/api/${type}/${editingId}` : `/api/${type}`;
  const res    = await apiFetch(url, method, body);
  if (res.error) { showToast(res.error,'error'); return; }
  showToast('저장되었습니다.');
  closeCostModal();
  // 현재 탭 새로고침
  if (type === 'medicine')  loadMedicine();
  if (type === 'supplies')  loadSupplies();
  if (type === 'doctor')    loadDoctor();
  if (type === 'nursing')   loadNursing();
  if (type === 'other')     loadOther();
  loadDashboard();
}

function gv(id) { return document.getElementById(id)?.value || ''; }

// ─────────────────────────────────────────────────────────────
// 각 비용 항목 조회
// ─────────────────────────────────────────────────────────────
async function loadMedicine() {
  const rows = await loadCostRows('medicine', 'med');
  const tbody = document.getElementById('medicine-body');
  let total = 0;
  if (!rows.length) { tbody.innerHTML = `<tr class="empty-row"><td colspan="10">데이터 없음</td></tr>`; }
  else {
    tbody.innerHTML = rows.map((r,i) => {
      total += r.amount||0;
      return `<tr>
        <td>${i+1}</td><td>${r.resident_id}</td><td>${r.resident_name||''}</td>
        <td>${r.date}</td><td>${r.hospital||''}</td><td>${r.description||''}</td>
        <td class="amount">${wonNum(r.amount)}</td><td>${r.receipt_no||''}</td><td>${r.notes||''}</td>
        <td style="white-space:nowrap">
          <button class="btn btn-edit" onclick="openModal('medicine',${r.id})">수정</button>
          <button class="btn btn-delete" onclick="deleteCost('medicine',${r.id})">삭제</button>
        </td></tr>`;
    }).join('');
  }
  document.getElementById('medicine-total').textContent = wonNum(total);
}

async function loadSupplies() {
  const rows = await loadCostRows('supplies', 'sup');
  const tbody = document.getElementById('supplies-body');
  let total = 0;
  if (!rows.length) { tbody.innerHTML = `<tr class="empty-row"><td colspan="12">데이터 없음</td></tr>`; }
  else {
    tbody.innerHTML = rows.map((r,i) => {
      total += r.amount||0;
      return `<tr>
        <td>${i+1}</td><td>${r.resident_id}</td><td>${r.resident_name||''}</td>
        <td>${r.date}</td><td>${r.vendor||''}</td><td>${r.item_name||''}</td>
        <td>${r.quantity||1}</td><td>${wonNum(r.unit_price)}</td>
        <td class="amount">${wonNum(r.amount)}</td><td>${r.receipt_no||''}</td><td>${r.notes||''}</td>
        <td style="white-space:nowrap">
          <button class="btn btn-edit" onclick="openModal('supplies',${r.id})">수정</button>
          <button class="btn btn-delete" onclick="deleteCost('supplies',${r.id})">삭제</button>
        </td></tr>`;
    }).join('');
  }
  document.getElementById('supplies-total').textContent = wonNum(total);
}

async function loadDoctor() {
  const rows = await loadCostRows('doctor', 'doc');
  const tbody = document.getElementById('doctor-body');
  let total = 0;
  if (!rows.length) { tbody.innerHTML = `<tr class="empty-row"><td colspan="10">데이터 없음</td></tr>`; }
  else {
    tbody.innerHTML = rows.map((r,i) => {
      total += r.amount||0;
      return `<tr>
        <td>${i+1}</td><td>${r.resident_id}</td><td>${r.resident_name||''}</td>
        <td>${r.date}</td><td>${r.doctor_name||''}</td><td>${r.visit_type||''}</td>
        <td>${r.visit_count||1}</td><td class="amount">${wonNum(r.amount)}</td><td>${r.notes||''}</td>
        <td style="white-space:nowrap">
          <button class="btn btn-edit" onclick="openModal('doctor',${r.id})">수정</button>
          <button class="btn btn-delete" onclick="deleteCost('doctor',${r.id})">삭제</button>
        </td></tr>`;
    }).join('');
  }
  document.getElementById('doctor-total').textContent = wonNum(total);
}

async function loadNursing() {
  const rows = await loadCostRows('nursing', 'nur');
  const tbody = document.getElementById('nursing-body');
  let total = 0;
  if (!rows.length) { tbody.innerHTML = `<tr class="empty-row"><td colspan="10">데이터 없음</td></tr>`; }
  else {
    tbody.innerHTML = rows.map((r,i) => {
      total += r.amount||0;
      return `<tr>
        <td>${i+1}</td><td>${r.resident_id}</td><td>${r.resident_name||''}</td>
        <td>${r.date}</td><td>${r.nurse_name||''}</td><td>${r.visit_type||''}</td>
        <td>${r.visit_count||1}</td><td class="amount">${wonNum(r.amount)}</td><td>${r.notes||''}</td>
        <td style="white-space:nowrap">
          <button class="btn btn-edit" onclick="openModal('nursing',${r.id})">수정</button>
          <button class="btn btn-delete" onclick="deleteCost('nursing',${r.id})">삭제</button>
        </td></tr>`;
    }).join('');
  }
  document.getElementById('nursing-total').textContent = wonNum(total);
}

async function loadOther() {
  const rows = await loadCostRows('other', 'oth');
  const tbody = document.getElementById('other-body');
  let total = 0;
  if (!rows.length) { tbody.innerHTML = `<tr class="empty-row"><td colspan="9">데이터 없음</td></tr>`; }
  else {
    tbody.innerHTML = rows.map((r,i) => {
      total += r.amount||0;
      return `<tr>
        <td>${i+1}</td><td>${r.resident_id}</td><td><a href="javascript:void(0)" onclick='openOtherModalForResident(${JSON.stringify(r.resident_id)}, ${JSON.stringify(r.resident_name || "")})'>${r.resident_name||''}</a></td>
        <td>${r.date}</td><td>${r.category||''}</td><td>${r.description||''}</td>
        <td class="amount">${wonNum(r.amount)}</td><td>${r.notes||''}</td>
        <td style="white-space:nowrap">
          <button class="btn btn-edit" onclick="openModal('other',${r.id})">수정</button>
          <button class="btn btn-delete" onclick="deleteCost('other',${r.id})">삭제</button>
        </td></tr>`;
    }).join('');
  }
  document.getElementById('other-total').textContent = wonNum(total);
}

async function loadCostRows(type, prefix) {
  const ym      = document.getElementById('globalMonth').value;
  const resInput = document.getElementById(`${prefix}-search-res`)?.value || '';
  const from    = document.getElementById(`${prefix}-from`)?.value || '';
  const to      = document.getElementById(`${prefix}-to`)?.value || '';

  let url = `/api/${type}?year_month=${ym}`;
  if (resInput) url += `&q=${encodeURIComponent(resInput)}`;
  if (from)     url += `&date_from=${from}`;
  if (to)       url += `&date_to=${to}`;
  return apiFetch(url);
}

// ─────────────────────────────────────────────────────────────
// 삭제
// ─────────────────────────────────────────────────────────────
function deleteCost(type, id) {
  showConfirm('이 항목을 삭제하시겠습니까?', async () => {
    await apiFetch(`/api/${type}/${id}`, 'DELETE');
    showToast('삭제되었습니다.');
    if (type === 'medicine')  loadMedicine();
    if (type === 'supplies')  loadSupplies();
    if (type === 'doctor')    loadDoctor();
    if (type === 'nursing')   loadNursing();
    if (type === 'other')     loadOther();
    loadDashboard();
  });
}

// ─────────────────────────────────────────────────────────────
// 수급자 검색 (인라인)
// ─────────────────────────────────────────────────────────────
let resSearchTimer = null;
async function searchResidentInline() {
  const q = document.getElementById('c-resident-id').value.trim();
  const el = document.getElementById('resident-inline-results');
  if (!q) { el.innerHTML=''; return; }
  clearTimeout(resSearchTimer);
  resSearchTimer = setTimeout(async () => {
    const rows = await apiFetch(`/api/residents?q=${encodeURIComponent(q)}`);
    if (!rows.length) { el.innerHTML = `<div class="res-item" style="color:#999">결과 없음</div>`; return; }
    el.innerHTML = rows.slice(0,6).map(r =>
      `<div class="res-item" onclick="selectResidentInline('${r.id}','${r.name}')">${r.id} — ${r.name} (${r.grade||''})</div>`
    ).join('');
  }, 200);
}

function selectResidentInline(id, name) {
  document.getElementById('c-resident-id').value   = id;
  document.getElementById('c-resident-name').value = name;
  document.getElementById('resident-inline-results').innerHTML = '';
}

// ─────────────────────────────────────────────────────────────
// 수급자 피커 모달
// ─────────────────────────────────────────────────────────────
function openResidentPicker() { openModal_('picker'); loadPickerResidents(); }
function closePicker()         { closeModal('picker'); }

async function loadPickerResidents() {
  const q = document.getElementById('picker-search').value;
  const rows = await apiFetch(`/api/residents?q=${encodeURIComponent(q)}`);
  const tbody = document.getElementById('picker-body');
  tbody.innerHTML = rows.map(r => `
    <tr>
      <td>${r.id}</td><td>${r.name}</td><td>${r.grade||''}</td><td>${r.ward||''}</td>
      <td><button class="btn btn-pick" onclick="pickResident('${r.id}','${r.name}')">선택</button></td>
    </tr>`).join('');
}

function pickResident(id, name) {
  selectResidentInline(id, name);
  closePicker();
}

// ─────────────────────────────────────────────────────────────
// 엑셀 내보내기
// ─────────────────────────────────────────────────────────────
function exportUpload() {
  const ym = document.getElementById('globalMonth').value;
  if (!ym) { showToast('년월을 선택하세요.','error'); return; }
  window.location.href = `/api/export/upload?year_month=${ym}`;
}

function exportDetail() {
  const ym = document.getElementById('globalMonth').value;
  window.location.href = `/api/export/detail?year_month=${ym}`;
}

function exportOtherFiltered() {
  const ym   = document.getElementById('globalMonth').value || '';
  const q    = document.getElementById('oth-search-res')?.value || '';
  const from = document.getElementById('oth-from')?.value || '';
  const to   = document.getElementById('oth-to')?.value || '';

  const params = new URLSearchParams();
  if (ym) params.set('year_month', ym);
  if (q.trim()) params.set('q', q.trim());
  if (from) params.set('date_from', from);
  if (to) params.set('date_to', to);

  window.location.href = `/api/export/other?${params.toString()}`;
}

function exportResidentSummary() {
  const ym = document.getElementById('globalMonth').value;
  if (!ym) { showToast('년월을 선택하세요.','error'); return; }
  window.location.href = `/api/export/resident-summary?year_month=${ym}`;
}

// ─────────────────────────────────────────────────────────────
// 모달 유틸
// ─────────────────────────────────────────────────────────────
function openModal_(id) {
  document.getElementById(`modal-${id}`).classList.add('open');
}
function closeModal(id) {
  document.getElementById(`modal-${id}`).classList.remove('open');
}
function closeCostModal() {
  closeModal('cost');
  currentCostType = null;
  editingId = null;
}

// 확인 모달
function showConfirm(msg, cb) {
  document.getElementById('confirm-msg').textContent = msg;
  confirmCallback = cb;
  openModal_('confirm');
}
function confirmAction() {
  closeConfirm();
  if (confirmCallback) confirmCallback();
  confirmCallback = null;
}
function closeConfirm() {
  closeModal('confirm');
}

// ─────────────────────────────────────────────────────────────
// API 헬퍼
// ─────────────────────────────────────────────────────────────
async function apiFetch(url, method='GET', body=null) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' }
  };
  if (body) opts.body = JSON.stringify(body);
  try {
    const res = await fetch(url, opts);
    return await res.json();
  } catch(e) {
    showToast('서버 오류: ' + e.message, 'error');
    return {};
  }
}

// ─────────────────────────────────────────────────────────────
// 토스트
// ─────────────────────────────────────────────────────────────
let toastTimer;
function showToast(msg, type='success') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.style.background = type === 'error' ? '#dc3545' : '#198754';
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2500);
}
