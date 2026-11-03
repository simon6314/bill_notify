// 帳單管理後端（綁定在「帳單」試算表上：試算表 → 擴充功能 → Apps Script）
const BILLS_SHEET = '帳單設定';
const PAY_SHEET = '繳費紀錄';
const BILL_HEADERS = ['id', '名稱', '類型', '結帳日', '繳款日', '扣款帳戶', '自動扣繳', '預設金額', '啟用', '備註'];
const PAY_HEADERS = ['月份', 'bill_id', '金額', '已繳', '更新時間'];

function doGet(e) {
  const p = (e && e.parameter) || {};
  let result;
  try {
    result = handle(p);
  } catch (err) {
    result = { ok: false, error: String(err) };
  }
  return ContentService.createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

function handle(p) {
  ensureSheets();
  const action = p.action;
  if (action === 'list') return listData(p.month);
  if (action === 'saveBill') return withLock(() => saveBill(p));
  if (action === 'deleteBill') return withLock(() => deleteBill(p.id));
  if (action === 'setPayment') return withLock(() => setPayment(p));
  return { ok: false, error: '未知的 action：' + action };
}

function withLock(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

function ss() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

function ensureSheets() {
  const book = ss();
  [[BILLS_SHEET, BILL_HEADERS], [PAY_SHEET, PAY_HEADERS]].forEach(([name, headers]) => {
    let sh = book.getSheetByName(name);
    if (!sh) sh = book.insertSheet(name);
    if (sh.getLastRow() === 0) {
      sh.getRange(1, 1, 1, headers.length).setValues([headers]);
      sh.setFrozenRows(1);
    }
  });
}

function isTrue(v) {
  return v === true || String(v).toUpperCase() === 'TRUE';
}

function listData(month) {
  const bookSh = ss().getSheetByName(BILLS_SHEET);
  const payRows = ss().getSheetByName(PAY_SHEET).getDataRange().getValues().slice(1);

  const bills = bookSh.getDataRange().getValues().slice(1)
    .filter(r => r[0] !== '')
    .map(r => ({
      id: String(r[0]),
      name: String(r[1]),
      type: String(r[2]),
      closeDay: Number(r[3]) || null,
      dueDay: Number(r[4]) || null,
      account: String(r[5] || ''),
      auto: isTrue(r[6]),
      defaultAmount: Number(r[7]) || 0,
      active: r[8] === '' ? true : isTrue(r[8]),
      note: String(r[9] || '')
    }));

  const payments = {};
  payRows.forEach(r => {
    if (String(r[0]) === month) {
      payments[String(r[1])] = { amount: Number(r[2]) || 0, paid: isTrue(r[3]) };
    }
  });
  return { ok: true, month: month, bills: bills, payments: payments };
}

function findRowById(sh, id) {
  const values = sh.getDataRange().getValues();
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][0]) === String(id)) return i + 1;
  }
  return -1;
}

function saveBill(p) {
  const sh = ss().getSheetByName(BILLS_SHEET);
  const id = p.id || Utilities.getUuid();
  const row = [
    id,
    p.name || '',
    p.type === '信用卡' ? '信用卡' : '定期',
    Number(p.closeDay) || '',
    Number(p.dueDay) || '',
    p.account || '',
    p.auto === 'true',
    Number(p.defaultAmount) || 0,
    p.active === 'false' ? false : true,
    p.note || ''
  ];
  const r = p.id ? findRowById(sh, p.id) : -1;
  if (r > 0) {
    sh.getRange(r, 1, 1, row.length).setValues([row]);
  } else {
    sh.appendRow(row);
  }
  return { ok: true, id: id };
}

function deleteBill(id) {
  const sh = ss().getSheetByName(BILLS_SHEET);
  const r = findRowById(sh, id);
  if (r > 0) sh.deleteRow(r);
  return { ok: true };
}

// 同一個月份 + 同一筆帳單只會有一列，沒有就新增
function setPayment(p) {
  const sh = ss().getSheetByName(PAY_SHEET);
  const values = sh.getDataRange().getValues();
  let r = -1;
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][0]) === p.month && String(values[i][1]) === p.id) {
      r = i + 1;
      break;
    }
  }
  const row = [p.month, p.id, Number(p.amount) || 0, p.paid === 'true', new Date()];
  if (r > 0) {
    sh.getRange(r, 1, 1, row.length).setValues([row]);
  } else {
    sh.appendRow(row);
  }
  return { ok: true };
}
