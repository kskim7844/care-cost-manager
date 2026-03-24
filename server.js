const express = require('express');
const Database = require('better-sqlite3');
const cors = require('cors');
const path = require('path');
const XLSX = require('xlsx');

const app = express();
const PORT = process.env.PORT || 3000;

// DB 초기화
const db = new Database(path.join(__dirname, 'care_cost.db'));

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─────────────────────────────────────────────────────────────
// DB 스키마 생성
// ─────────────────────────────────────────────────────────────
db.exec(`
PRAGMA journal_mode=WAL;

CREATE TABLE IF NOT EXISTS residents (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  gender     TEXT,
  age        INTEGER,
  grade      TEXT,
  ward       TEXT,
  room       TEXT,
  admission_date TEXT,
  notes      TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS medical_medicine (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  resident_id  TEXT NOT NULL,
  year_month   TEXT NOT NULL,
  date         TEXT NOT NULL,
  hospital     TEXT,
  description  TEXT,
  amount       INTEGER DEFAULT 0,
  receipt_no   TEXT,
  notes        TEXT,
  created_at   TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS medical_supplies (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  resident_id  TEXT NOT NULL,
  year_month   TEXT NOT NULL,
  date         TEXT NOT NULL,
  vendor       TEXT,
  item_name    TEXT,
  quantity     INTEGER DEFAULT 1,
  unit_price   INTEGER DEFAULT 0,
  amount       INTEGER DEFAULT 0,
  receipt_no   TEXT,
  notes        TEXT,
  created_at   TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS contract_doctor (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  resident_id  TEXT NOT NULL,
  year_month   TEXT NOT NULL,
  date         TEXT NOT NULL,
  doctor_name  TEXT,
  visit_type   TEXT,
  visit_count  INTEGER DEFAULT 1,
  amount       INTEGER DEFAULT 0,
  notes        TEXT,
  created_at   TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS home_nursing (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  resident_id  TEXT NOT NULL,
  year_month   TEXT NOT NULL,
  date         TEXT NOT NULL,
  nurse_name   TEXT,
  visit_type   TEXT,
  visit_count  INTEGER DEFAULT 1,
  amount       INTEGER DEFAULT 0,
  notes        TEXT,
  created_at   TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS other_costs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  resident_id  TEXT NOT NULL,
  year_month   TEXT NOT NULL,
  date         TEXT NOT NULL,
  category     TEXT,
  description  TEXT,
  amount       INTEGER DEFAULT 0,
  receipt_no   TEXT,
  notes        TEXT,
  created_at   TEXT DEFAULT (datetime('now','localtime'))
);
`);

// ─────────────────────────────────────────────────────────────
// 공통 헬퍼
// ─────────────────────────────────────────────────────────────
const TABLE_MAP = {
  medicine:  'medical_medicine',
  supplies:  'medical_supplies',
  doctor:    'contract_doctor',
  nursing:   'home_nursing',
  other:     'other_costs'
};

function generateNextResidentId() {
  const row = db.prepare(`
    SELECT MAX(CAST(id AS INTEGER)) AS max_id
    FROM residents
    WHERE id GLOB '[0-9]*' AND id <> ''
  `).get();

  const next = (row?.max_id || 0) + 1;
  return String(next).padStart(6, '0');
}

function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === ',' && !inQuotes) {
      out.push(cur.trim());
      cur = '';
      continue;
    }
    cur += ch;
  }
  out.push(cur.trim());
  return out;
}

function normalizeHeader(header) {
  return String(header || '')
    .replace(/\uFEFF/g, '')
    .replace(/\s+/g, '')
    .toLowerCase();
}

function resolveCsvHeaderIndex(headers, aliases) {
  for (const alias of aliases) {
    const idx = headers.indexOf(alias);
    if (idx >= 0) return idx;
  }
  return -1;
}

function normalizeGrade(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  if (s === '인지지원' || s === '인지지원등급') return '인지지원등급';
  if (/^[1-5]$/.test(s)) return `${s}등급`;
  if (/^[1-5]등급$/.test(s)) return s;
  return s;
}

// ─────────────────────────────────────────────────────────────
// 수급자(입소자) API
// ─────────────────────────────────────────────────────────────
app.get('/api/residents', (req, res) => {
  const { q } = req.query;
  let rows;
  if (q) {
    rows = db.prepare(`SELECT * FROM residents WHERE id LIKE ? OR name LIKE ? ORDER BY name`).all(`%${q}%`, `%${q}%`);
  } else {
    rows = db.prepare(`SELECT * FROM residents ORDER BY name`).all();
  }
  res.json(rows);
});

app.get('/api/residents/:id', (req, res) => {
  const row = db.prepare(`SELECT * FROM residents WHERE id = ?`).get(req.params.id);
  if (!row) return res.status(404).json({ error: '수급자를 찾을 수 없습니다.' });
  res.json(row);
});

app.post('/api/residents', (req, res) => {
  const { id, name, gender, age, grade, ward, room, admission_date, notes } = req.body;
  if (!name) return res.status(400).json({ error: '이름은 필수입니다.' });
  try {
    const residentId = id?.trim() || generateNextResidentId();
    db.prepare(`INSERT INTO residents (id,name,gender,age,grade,ward,room,admission_date,notes) VALUES (?,?,?,?,?,?,?,?,?)`).run(residentId, name, gender, age||null, grade, ward, room, admission_date, notes);
    res.json({ success: true, id: residentId });
  } catch(e) {
    if (e.message.includes('UNIQUE')) return res.status(409).json({ error: '이미 존재하는 ID입니다.' });
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/residents/bulk', (req, res) => {
  const { csv_text } = req.body;
  if (!csv_text || !String(csv_text).trim()) {
    return res.status(400).json({ error: 'CSV 텍스트를 입력하세요.' });
  }

  const rawLines = String(csv_text).replace(/\r/g, '').split('\n');
  const lines = rawLines.map(v => v.trim()).filter(Boolean);
  if (!lines.length) return res.status(400).json({ error: '처리할 데이터가 없습니다.' });

  const headers = parseCsvLine(lines[0]).map(normalizeHeader);
  let idxName = resolveCsvHeaderIndex(headers, ['성명', '이름', 'name']);
  let idxGrade = resolveCsvHeaderIndex(headers, ['등급', 'grade']);
  let idxWard = resolveCsvHeaderIndex(headers, ['생활실', '층', 'ward', '동']);
  let idxRoom = resolveCsvHeaderIndex(headers, ['호실', 'room']);
  let idxGender = resolveCsvHeaderIndex(headers, ['성별', 'gender']);
  let idxAge = resolveCsvHeaderIndex(headers, ['나이', '연령', 'age']);
  let idxAdmissionDate = resolveCsvHeaderIndex(headers, ['입소일', '입소일자', 'admissiondate']);
  let idxNotes = resolveCsvHeaderIndex(headers, ['비고', '메모', 'notes']);

  let startRow = 1;
  if (idxName < 0) {
    // 헤더가 없을 때: [순번, 성명, 생활실, 등급] 순서를 기본으로 처리
    idxName = 1;
    idxWard = 2;
    idxGrade = 3;
    idxRoom = -1;
    idxGender = -1;
    idxAge = -1;
    idxAdmissionDate = -1;
    idxNotes = -1;
    startRow = 0;
  }

  const insertStmt = db.prepare(`INSERT INTO residents (id,name,gender,age,grade,ward,room,admission_date,notes) VALUES (?,?,?,?,?,?,?,?,?)`);
  const existsStmt = db.prepare(`SELECT 1 FROM residents WHERE id=?`);
  const createdIds = [];
  let skipped = 0;

  const tx = db.transaction(() => {
    for (let i = startRow; i < lines.length; i += 1) {
      const cols = parseCsvLine(lines[i]);
      const name = (cols[idxName] || '').trim();
      if (!name) { skipped += 1; continue; }

      let residentId = generateNextResidentId();
      while (existsStmt.get(residentId)) {
        residentId = String(Number(residentId) + 1).padStart(6, '0');
      }

      const gender = idxGender >= 0 ? (cols[idxGender] || '').trim() : '';
      const ageRaw = idxAge >= 0 ? (cols[idxAge] || '').trim() : '';
      const age = ageRaw ? Number(ageRaw) : null;
      const grade = idxGrade >= 0 ? normalizeGrade(cols[idxGrade]) : '';
      const ward = idxWard >= 0 ? (cols[idxWard] || '').trim() : '';
      const room = idxRoom >= 0 ? (cols[idxRoom] || '').trim() : '';
      const admissionDate = idxAdmissionDate >= 0 ? (cols[idxAdmissionDate] || '').trim() : '';
      const notes = idxNotes >= 0 ? (cols[idxNotes] || '').trim() : '';

      insertStmt.run(
        residentId,
        name,
        gender,
        Number.isFinite(age) ? age : null,
        grade,
        ward,
        room,
        admissionDate,
        notes
      );
      createdIds.push(residentId);
    }
  });

  try {
    tx();
    return res.json({
      success: true,
      inserted: createdIds.length,
      skipped,
      ids: createdIds
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

app.put('/api/residents/:id', (req, res) => {
  const { name, gender, age, grade, ward, room, admission_date, notes } = req.body;
  db.prepare(`UPDATE residents SET name=?,gender=?,age=?,grade=?,ward=?,room=?,admission_date=?,notes=? WHERE id=?`).run(name, gender, age||null, grade, ward, room, admission_date, notes, req.params.id);
  res.json({ success: true });
});

app.delete('/api/residents/:id', (req, res) => {
  db.prepare(`DELETE FROM residents WHERE id=?`).run(req.params.id);
  res.json({ success: true });
});

// ─────────────────────────────────────────────────────────────
// 비용 항목 공통 CRUD 팩토리
// ─────────────────────────────────────────────────────────────
function buildCostRoutes(slug, table, insertFn, updateFn) {
  // 목록 조회
  app.get(`/api/${slug}`, (req, res) => {
    const { resident_id, year_month, date_from, date_to, q } = req.query;
    let sql = `SELECT c.*, r.name as resident_name FROM ${table} c LEFT JOIN residents r ON c.resident_id = r.id WHERE 1=1`;
    const params = [];
    if (resident_id) { sql += ` AND c.resident_id = ?`; params.push(resident_id); }
    if (year_month)  { sql += ` AND c.year_month = ?`;  params.push(year_month); }
    if (date_from)   { sql += ` AND c.date >= ?`;       params.push(date_from); }
    if (date_to)     { sql += ` AND c.date <= ?`;       params.push(date_to); }
    if (q)           { sql += ` AND (c.description LIKE ? OR r.name LIKE ? OR c.resident_id LIKE ?)`; params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
    sql += ` ORDER BY c.date DESC, c.id DESC`;
    res.json(db.prepare(sql).all(...params));
  });

  // 단건 조회
  app.get(`/api/${slug}/:id`, (req, res) => {
    const row = db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(req.params.id);
    if (!row) return res.status(404).json({ error: '항목을 찾을 수 없습니다.' });
    res.json(row);
  });

  // 추가
  app.post(`/api/${slug}`, (req, res) => {
    try {
      const info = insertFn(req.body);
      res.json({ success: true, id: info.lastInsertRowid });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  // 수정
  app.put(`/api/${slug}/:id`, (req, res) => {
    try {
      updateFn(req.params.id, req.body);
      res.json({ success: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  // 삭제
  app.delete(`/api/${slug}/:id`, (req, res) => {
    db.prepare(`DELETE FROM ${table} WHERE id=?`).run(req.params.id);
    res.json({ success: true });
  });

  // 월별 합계
  app.get(`/api/${slug}/summary/monthly`, (req, res) => {
    const { year_month } = req.query;
    let sql = `SELECT c.resident_id, r.name as resident_name, SUM(c.amount) as total FROM ${table} c LEFT JOIN residents r ON c.resident_id=r.id`;
    const params = [];
    if (year_month) { sql += ` WHERE c.year_month=?`; params.push(year_month); }
    sql += ` GROUP BY c.resident_id ORDER BY r.name`;
    res.json(db.prepare(sql).all(...params));
  });
}

// 진료약제비
buildCostRoutes('medicine', 'medical_medicine',
  (b) => db.prepare(`INSERT INTO medical_medicine (resident_id,year_month,date,hospital,description,amount,receipt_no,notes) VALUES (?,?,?,?,?,?,?,?)`).run(b.resident_id, b.year_month, b.date, b.hospital, b.description, b.amount||0, b.receipt_no, b.notes),
  (id, b) => db.prepare(`UPDATE medical_medicine SET resident_id=?,year_month=?,date=?,hospital=?,description=?,amount=?,receipt_no=?,notes=? WHERE id=?`).run(b.resident_id, b.year_month, b.date, b.hospital, b.description, b.amount||0, b.receipt_no, b.notes, id)
);

// 의료소모품
buildCostRoutes('supplies', 'medical_supplies',
  (b) => db.prepare(`INSERT INTO medical_supplies (resident_id,year_month,date,vendor,item_name,quantity,unit_price,amount,receipt_no,notes) VALUES (?,?,?,?,?,?,?,?,?,?)`).run(b.resident_id, b.year_month, b.date, b.vendor, b.item_name, b.quantity||1, b.unit_price||0, b.amount||0, b.receipt_no, b.notes),
  (id, b) => db.prepare(`UPDATE medical_supplies SET resident_id=?,year_month=?,date=?,vendor=?,item_name=?,quantity=?,unit_price=?,amount=?,receipt_no=?,notes=? WHERE id=?`).run(b.resident_id, b.year_month, b.date, b.vendor, b.item_name, b.quantity||1, b.unit_price||0, b.amount||0, b.receipt_no, b.notes, id)
);

// 계약의사
buildCostRoutes('doctor', 'contract_doctor',
  (b) => db.prepare(`INSERT INTO contract_doctor (resident_id,year_month,date,doctor_name,visit_type,visit_count,amount,notes) VALUES (?,?,?,?,?,?,?,?)`).run(b.resident_id, b.year_month, b.date, b.doctor_name, b.visit_type, b.visit_count||1, b.amount||0, b.notes),
  (id, b) => db.prepare(`UPDATE contract_doctor SET resident_id=?,year_month=?,date=?,doctor_name=?,visit_type=?,visit_count=?,amount=?,notes=? WHERE id=?`).run(b.resident_id, b.year_month, b.date, b.doctor_name, b.visit_type, b.visit_count||1, b.amount||0, b.notes, id)
);

// 가정간호
buildCostRoutes('nursing', 'home_nursing',
  (b) => db.prepare(`INSERT INTO home_nursing (resident_id,year_month,date,nurse_name,visit_type,visit_count,amount,notes) VALUES (?,?,?,?,?,?,?,?)`).run(b.resident_id, b.year_month, b.date, b.nurse_name, b.visit_type, b.visit_count||1, b.amount||0, b.notes),
  (id, b) => db.prepare(`UPDATE home_nursing SET resident_id=?,year_month=?,date=?,nurse_name=?,visit_type=?,visit_count=?,amount=?,notes=? WHERE id=?`).run(b.resident_id, b.year_month, b.date, b.nurse_name, b.visit_type, b.visit_count||1, b.amount||0, b.notes, id)
);

// 기타비용
buildCostRoutes('other', 'other_costs',
  (b) => db.prepare(`INSERT INTO other_costs (resident_id,year_month,date,category,description,amount,receipt_no,notes) VALUES (?,?,?,?,?,?,?,?)`).run(b.resident_id, b.year_month, b.date, b.category, b.description, b.amount||0, b.receipt_no, b.notes),
  (id, b) => db.prepare(`UPDATE other_costs SET resident_id=?,year_month=?,date=?,category=?,description=?,amount=?,receipt_no=?,notes=? WHERE id=?`).run(b.resident_id, b.year_month, b.date, b.category, b.description, b.amount||0, b.receipt_no, b.notes, id)
);

// ─────────────────────────────────────────────────────────────
// 업로드용 엑셀 내보내기 (시스템 업로드 포맷)
// ─────────────────────────────────────────────────────────────
app.get('/api/export/upload', (req, res) => {
  const { year_month } = req.query;
  if (!year_month) return res.status(400).json({ error: '년월을 지정하세요.' });

  const residents = db.prepare(`SELECT * FROM residents ORDER BY name`).all();

  const rows = residents.map(r => {
    const med = db.prepare(`SELECT SUM(amount) as total FROM medical_medicine WHERE resident_id=? AND year_month=?`).get(r.id, year_month);
    const sup = db.prepare(`SELECT SUM(amount) as total FROM medical_supplies WHERE resident_id=? AND year_month=?`).get(r.id, year_month);
    const doc = db.prepare(`SELECT SUM(amount) as total FROM contract_doctor WHERE resident_id=? AND year_month=?`).get(r.id, year_month);
    const nur = db.prepare(`SELECT SUM(amount) as total FROM home_nursing WHERE resident_id=? AND year_month=?`).get(r.id, year_month);
    const oth = db.prepare(`SELECT SUM(amount) as total FROM other_costs WHERE resident_id=? AND year_month=?`).get(r.id, year_month);
    return {
      '수급자ID': r.id,
      '성명': r.name,
      '성별': r.gender || '',
      '나이': r.age || '',
      '등급': r.grade || '',
      '생활실': r.ward || '',
      '호실': r.room || '',
      '진료약제비': med?.total || 0,
      '의료소모품': sup?.total || 0,
      '계약의사': doc?.total || 0,
      '가정간호': nur?.total || 0,
      '기타비용': oth?.total || 0,
      '합계': (med?.total||0)+(sup?.total||0)+(doc?.total||0)+(nur?.total||0)+(oth?.total||0)
    };
  });

  const ws = buildSheetWithAutoWidth(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, `${year_month} 요양비`);
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

  res.setHeader('Content-Disposition', `attachment; filename="upload_${year_month}.xlsx"`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buf);
});

// ─────────────────────────────────────────────────────────────
// 세부 내역 내보내기 (항목별 전체 내역)
// ─────────────────────────────────────────────────────────────
app.get('/api/export/detail', (req, res) => {
  const { year_month } = req.query;
  const wb = XLSX.utils.book_new();
  const tables = [
    { slug:'medicine', table:'medical_medicine', label:'진료약제비', cols:['수급자ID','성명','날짜','병원/의원','내역','금액','영수증번호','비고'] },
    { slug:'supplies', table:'medical_supplies',  label:'의료소모품', cols:['수급자ID','성명','날짜','구매처','품목','수량','단가','금액','영수증번호','비고'] },
    { slug:'doctor',   table:'contract_doctor',   label:'계약의사',  cols:['수급자ID','성명','날짜','의사명','방문유형','방문횟수','금액','비고'] },
    { slug:'nursing',  table:'home_nursing',       label:'가정간호',  cols:['수급자ID','성명','날짜','간호사명','방문유형','방문횟수','금액','비고'] },
    { slug:'other',    table:'other_costs',        label:'기타비용',  cols:['수급자ID','성명','날짜','분류','내역','금액','비고'] },
  ];

  for (const t of tables) {
    let sql = `SELECT c.*, r.name as resident_name FROM ${t.table} c LEFT JOIN residents r ON c.resident_id=r.id`;
    const params = [];
    if (year_month) { sql += ` WHERE c.year_month=?`; params.push(year_month); }
    sql += ` ORDER BY c.date, c.resident_id`;
    const data = db.prepare(sql).all(...params);
    
    let rows = [];
    if (t.slug === 'medicine') {
      rows = data.map(d => ({ '수급자ID':d.resident_id,'성명':d.resident_name,'날짜':d.date,'병원/의원':d.hospital,'내역':d.description,'금액':d.amount,'영수증번호':d.receipt_no,'비고':d.notes }));
    } else if (t.slug === 'supplies') {
      rows = data.map(d => ({ '수급자ID':d.resident_id,'성명':d.resident_name,'날짜':d.date,'구매처':d.vendor,'품목':d.item_name,'수량':d.quantity,'단가':d.unit_price,'금액':d.amount,'영수증번호':d.receipt_no,'비고':d.notes }));
    } else if (t.slug === 'doctor') {
      rows = data.map(d => ({ '수급자ID':d.resident_id,'성명':d.resident_name,'날짜':d.date,'의사명':d.doctor_name,'방문유형':d.visit_type,'방문횟수':d.visit_count,'금액':d.amount,'비고':d.notes }));
    } else if (t.slug === 'nursing') {
      rows = data.map(d => ({ '수급자ID':d.resident_id,'성명':d.resident_name,'날짜':d.date,'간호사명':d.nurse_name,'방문유형':d.visit_type,'방문횟수':d.visit_count,'금액':d.amount,'비고':d.notes }));
    } else if (t.slug === 'other') {
      rows = data.map(d => ({ '수급자ID':d.resident_id,'성명':d.resident_name,'날짜':d.date,'분류':d.category,'내역':d.description,'금액':d.amount,'비고':d.notes }));
    }
    if (rows.length === 0) rows = [{}];
    const ws = buildSheetWithAutoWidth(rows);
    XLSX.utils.book_append_sheet(wb, ws, t.label);
  }

  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  const ym = year_month || 'all';
  res.setHeader('Content-Disposition', `attachment; filename="detail_${ym}.xlsx"`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buf);
});

// 기타비용 탭 조회 결과 내보내기
app.get('/api/export/other', (req, res) => {
  const { year_month, date_from, date_to, q } = req.query;
  let sql = `
    SELECT c.*, r.name AS resident_name
    FROM other_costs c
    LEFT JOIN residents r ON c.resident_id = r.id
    WHERE 1=1
  `;
  const params = [];
  if (year_month) { sql += ` AND c.year_month = ?`; params.push(year_month); }
  if (date_from)  { sql += ` AND c.date >= ?`; params.push(date_from); }
  if (date_to)    { sql += ` AND c.date <= ?`; params.push(date_to); }
  if (q)          { sql += ` AND (c.description LIKE ? OR r.name LIKE ? OR c.resident_id LIKE ?)`; params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  sql += ` ORDER BY c.date, c.id`;

  const rows = db.prepare(sql).all(...params).map(d => ({
    '수급자ID': d.resident_id,
    '성명': d.resident_name || '',
    '날짜': d.date,
    '분류': d.category || '',
    '내역': d.description || '',
    '금액': d.amount || 0,
    '비고': d.notes || ''
  }));

  const ws = buildSheetWithAutoWidth(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '기타비용');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

  const ym = year_month || 'all';
  res.setHeader('Content-Disposition', `attachment; filename="other_filtered_${ym}.xlsx"`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buf);
});

// 대시보드 통계
app.get('/api/dashboard', (req, res) => {
  const { year_month } = req.query;
  const ym = year_month || new Date().toISOString().slice(0,7);
  const result = {};
  const categoryMap = [
    { key: 'medicine', category: '진료약제비' },
    { key: 'supplies', category: '의료소모품' },
    { key: 'doctor',   category: '계약의사' },
    { key: 'nursing',  category: '가정간호' },
  ];

  for (const c of categoryMap) {
    const row = db.prepare(`
      SELECT COUNT(*) AS cnt, SUM(amount) AS total
      FROM other_costs
      WHERE year_month=? AND category=?
    `).get(ym, c.category);
    result[c.key] = { count: row?.cnt || 0, total: row?.total || 0 };
  }

  const otherRow = db.prepare(`
    SELECT COUNT(*) AS cnt, SUM(amount) AS total
    FROM other_costs
    WHERE year_month=?
      AND (
        category IS NULL
        OR TRIM(category)=''
        OR category='기타'
        OR category NOT IN ('진료약제비','의료소모품','계약의사','가정간호')
      )
  `).get(ym);
  result.other = { count: otherRow?.cnt || 0, total: otherRow?.total || 0 };

  result.residents = db.prepare(`SELECT COUNT(*) as cnt FROM residents`).get().cnt;
  res.json({ year_month: ym, ...result });
});

function getResidentSummaryRows(yearMonth) {
  return db.prepare(`
    SELECT
      c.resident_id,
      r.name AS resident_name,
      SUM(CASE WHEN c.category='진료약제비' THEN c.amount ELSE 0 END) AS medicine_total,
      SUM(CASE WHEN c.category='의료소모품' THEN c.amount ELSE 0 END) AS supplies_total,
      SUM(CASE WHEN c.category='계약의사' THEN c.amount ELSE 0 END) AS doctor_total,
      SUM(CASE WHEN c.category='가정간호' THEN c.amount ELSE 0 END) AS nursing_total,
      SUM(CASE WHEN c.category IS NULL OR TRIM(c.category)='' OR c.category='기타' OR c.category NOT IN ('진료약제비','의료소모품','계약의사','가정간호')
               THEN c.amount ELSE 0 END) AS other_total,
      SUM(c.amount) AS grand_total
    FROM other_costs c
    LEFT JOIN residents r ON c.resident_id = r.id
    WHERE c.year_month = ?
    GROUP BY c.resident_id
    ORDER BY r.name
  `).all(yearMonth);
}

function getDisplayTextWidth(v) {
  const s = String(v ?? '');
  let width = 0;
  for (const ch of s) {
    width += ch.charCodeAt(0) > 255 ? 2 : 1;
  }
  return width;
}

function buildSheetWithAutoWidth(rows) {
  const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{}]);
  const headers = rows.length ? Object.keys(rows[0]) : [];
  ws['!cols'] = headers.map((h) => {
    const maxData = rows.reduce((acc, row) => Math.max(acc, getDisplayTextWidth(row[h])), 0);
    const wch = Math.min(60, Math.max(10, Math.max(getDisplayTextWidth(h), maxData) + 2));
    return { wch };
  });
  return ws;
}

// 대시보드 - 수급자별 월 합계 (기타비용 분류 기반)
app.get('/api/dashboard/resident-summary', (req, res) => {
  const { year_month } = req.query;
  const ym = year_month || new Date().toISOString().slice(0, 7);
  const rows = getResidentSummaryRows(ym);

  res.json(rows);
});

app.get('/api/export/resident-summary', (req, res) => {
  const { year_month } = req.query;
  const ym = year_month || new Date().toISOString().slice(0, 7);
  const source = getResidentSummaryRows(ym);
  const rows = source.map((r) => ({
    '수급자ID': r.resident_id,
    '성명': r.resident_name || '',
    '진료약제비': r.medicine_total || 0,
    '의료소모품': r.supplies_total || 0,
    '계약의사': r.doctor_total || 0,
    '가정간호': r.nursing_total || 0,
    '기타': r.other_total || 0,
    '월 전체금액': r.grand_total || 0,
  }));

  const ws = buildSheetWithAutoWidth(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '수급자별월합계');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

  res.setHeader('Content-Disposition', `attachment; filename="resident_summary_${ym}.xlsx"`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buf);
});

app.listen(PORT, () => {
  console.log(`\n✅ 요양비 세부관리 시스템 실행 중`);
  console.log(`🌐 브라우저에서 열기: http://localhost:${PORT}\n`);
});
