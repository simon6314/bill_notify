// 帳單管理後端（綁定在「帳單」試算表上：試算表 → 擴充功能 → Apps Script）
const BILLS_SHEET = '帳單設定';
const PAY_SHEET = '繳費紀錄';
const BILL_HEADERS = ['id', '名稱', '類型', '結帳日', '繳款日', '扣款帳戶', '自動扣繳', '預設金額', '啟用', '備註', '週期', '繳費月份'];
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
  if (action === 'allPayments') return allPayments();
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
    } else {
      // 舊的工作表若缺少新欄位（例如「週期」「繳費月份」），補上標題
      const cur = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), headers.length)).getValues()[0];
      headers.forEach((h, i) => { if (!cur[i]) sh.getRange(1, i + 1).setValue(h); });
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
      note: String(r[9] || ''),
      period: r[10] === '每年' ? '每年' : '每月',
      renewMonth: Number(r[11]) || null
    }));

  const payments = {};
  payRows.forEach(r => {
    if (monthKeyOf(r[0]) === month) {
      payments[String(r[1])] = { amount: Number(r[2]) || 0, paid: isTrue(r[3]) };
    }
  });
  return { ok: true, month: month, bills: bills, payments: payments };
}

// 統計頁用：所有帳單與所有繳費紀錄
function allPayments() {
  const bills = ss().getSheetByName(BILLS_SHEET).getDataRange().getValues().slice(1)
    .filter(r => r[0] !== '')
    .map(r => ({
      id: String(r[0]),
      name: String(r[1]),
      type: String(r[2]),
      period: r[10] === '每年' ? '每年' : '每月',
      renewMonth: Number(r[11]) || null
    }));
  // 同一個月份 + 同一筆帳單若有多列（舊資料），只取最後一列，與帳單頁 listData 一致
  const byKey = {};
  ss().getSheetByName(PAY_SHEET).getDataRange().getValues().slice(1)
    .filter(r => r[1] !== '')
    .forEach(r => {
      const month = monthKeyOf(r[0]);
      byKey[month + '|' + String(r[1])] = {
        month: month,
        id: String(r[1]),
        amount: Number(r[2]) || 0,
        paid: isTrue(r[3])
      };
    });
  return { ok: true, bills: bills, payments: Object.values(byKey) };
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
    ['信用卡', '訂閱'].indexOf(p.type) >= 0 ? p.type : '定期',
    Number(p.closeDay) || '',
    Number(p.dueDay) || '',
    p.account || '',
    p.auto === 'true',
    Number(p.defaultAmount) || 0,
    p.active === 'false' ? false : true,
    p.note || '',
    p.period === '每年' ? '每年' : '每月',
    p.period === '每年' ? (Number(p.renewMonth) || '') : ''
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

// 月份統一成 yyyy-MM 字串；試算表若把 "2026-11" 自動轉成日期，這裡會轉回來
function monthKeyOf(v) {
  if (v instanceof Date) return Utilities.formatDate(v, 'Asia/Taipei', 'yyyy-MM');
  return String(v).trim();
}

// 同一個月份 + 同一筆帳單只會有一列，沒有就新增
function setPayment(p) {
  const sh = ss().getSheetByName(PAY_SHEET);
  const values = sh.getDataRange().getValues();
  let r = -1;
  for (let i = values.length - 1; i >= 1; i--) { // 從最後一列找，與帳單頁顯示的值一致
    if (monthKeyOf(values[i][0]) === p.month && String(values[i][1]) === p.id) {
      r = i + 1;
      break;
    }
  }
  const row = [p.month, p.id, Number(p.amount) || 0, p.paid === 'true', new Date()];
  if (r < 0) r = sh.getLastRow() + 1;
  // A 欄設為純文字，避免 2026-11 被轉成日期
  sh.getRange(r, 1).setNumberFormat('@');
  sh.getRange(r, 1, 1, row.length).setValues([row]);
  return { ok: true };
}

// 一次性清理：刪除「同月份 + 同帳單」的重複列，只保留最後一列。
// 在 Apps Script 編輯器手動執行一次即可；執行前會回傳將刪除的列數，請先確認。
function removeDuplicatePayments() {
  const sh = ss().getSheetByName(PAY_SHEET);
  const values = sh.getDataRange().getValues();
  const seen = {};
  const toDelete = [];
  for (let i = values.length - 1; i >= 1; i--) { // 從底部往上，先遇到的是最後一列
    if (values[i][1] === '') continue;
    const key = monthKeyOf(values[i][0]) + '|' + String(values[i][1]);
    if (seen[key]) toDelete.push(i + 1); else seen[key] = true;
  }
  toDelete.forEach(row => sh.deleteRow(row)); // 已由下往上排序，刪除不會影響其他列號
  return { ok: true, deleted: toDelete.length };
}

// ══════════════ LINE 提醒（每天 09:00 執行）══════════════
// 需要指令碼屬性：LINE_TOKEN、GROUP_ID（與 webhook 專案相同的群組）

function pushLine(text) {
  const props = PropertiesService.getScriptProperties();
  const token = props.getProperty('LINE_TOKEN');
  const to = props.getProperty('GROUP_ID');
  if (!token || !to) throw new Error('缺少指令碼屬性 LINE_TOKEN 或 GROUP_ID');
  const res = UrlFetchApp.fetch('https://api.line.me/v2/bot/message/push', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + token },
    payload: JSON.stringify({ to: to, messages: [{ type: 'text', text: text }] }),
    muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) throw new Error('LINE 推播失敗：' + res.getContentText());
}

function lastDayOf(y, m) { // m 從 0 開始
  return new Date(y, m + 1, 0).getDate();
}
function dayOnMonth(y, m, day) {
  return new Date(y, m, Math.min(day, lastDayOf(y, m)));
}
function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
function daysBetween(from, to) {
  return Math.round((to - from) / 86400000);
}
function monthKeyFromDate(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}
function fmtMD(d) {
  return (d.getMonth() + 1) + '/' + d.getDate();
}

// 這張帳單在某個月是否需要繳：每月 → 每個月都要；每年 → 只有繳費月份
function appliesToMonth(b, year, month0) {
  if (b.period !== '每年') return true;
  return b.renewMonth === month0 + 1;
}

function loadBillsAndPayments() {
  const book = ss();
  const bills = book.getSheetByName(BILLS_SHEET).getDataRange().getValues().slice(1)
    .filter(r => r[0] !== '')
    .map(r => ({
      id: String(r[0]),
      name: String(r[1]),
      type: String(r[2]),
      closeDay: Number(r[3]) || null,
      dueDay: Number(r[4]) || null,
      account: String(r[5] || ''),
      auto: isTrue(r[6]),
      active: r[8] === '' ? true : isTrue(r[8]),
      period: r[10] === '每年' ? '每年' : '每月',
      renewMonth: Number(r[11]) || null
    }))
    .filter(b => b.active);
  const pays = {};
  book.getSheetByName(PAY_SHEET).getDataRange().getValues().slice(1).forEach(r => {
    pays[monthKeyOf(r[0]) + '|' + String(r[1])] = { amount: Number(r[2]) || 0, paid: isTrue(r[3]) };
  });
  return { bills: bills, pays: pays };
}

// 每天 09:00 執行：只在符合條件的那一天發送，不會重複
function dailyBillCheck() {
  const { bills, pays } = loadBillsAndPayments();
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yest = new Date(today);
  yest.setDate(yest.getDate() - 1);
  const msgs = [];

  bills.forEach(b => {
    // 1. 信用卡：結帳日過了 1 天，若該期金額還沒填，提醒去確認帳單
    if (b.type === '信用卡' && b.closeDay) {
      const stmt = dayOnMonth(yest.getFullYear(), yest.getMonth(), b.closeDay);
      if (sameDay(stmt, yest)) {
        const payMonth = (b.dueDay && b.closeDay > b.dueDay)
          ? new Date(yest.getFullYear(), yest.getMonth() + 1, 1)
          : new Date(yest.getFullYear(), yest.getMonth(), 1);
        if (!pays[monthKeyFromDate(payMonth) + '|' + b.id]) {
          msgs.push('📝 ' + b.name + ' ' + fmtMD(stmt) + ' 結帳，請確認帳單金額，並填在 ' + (payMonth.getMonth() + 1) + ' 月份');
        }
      }
    }

    if (!b.dueDay) return;
    // 檢查本月與下個月的繳款日（年繳只在繳費月份檢查）
    [new Date(now.getFullYear(), now.getMonth(), 1), new Date(now.getFullYear(), now.getMonth() + 1, 1)].forEach(m => {
      if (!appliesToMonth(b, m.getFullYear(), m.getMonth())) return;
      const due = dayOnMonth(m.getFullYear(), m.getMonth(), b.dueDay);
      const diff = daysBetween(today, due);
      const p = pays[monthKeyFromDate(due) + '|' + b.id];

      // 2. 繳費期限前 7 天內，每天提醒，直到勾選已繳
      if (diff >= 0 && diff <= 7 && !(p && p.paid)) {
        const left = diff === 0 ? '今天到期' : '還有 ' + diff + ' 天';
        msgs.push('⏰ ' + b.name + ' 繳費期限 ' + fmtMD(due) + '，' + left + '，請記得繳納');
      }

      // 3. 自動扣繳：3 天前提醒轉入帳戶（有填金額才提醒）
      if (diff === 3 && b.auto && p && p.amount > 0) {
        msgs.push('🏦 ' + fmtMD(due) + ' 自動扣繳 $' + p.amount.toLocaleString() + '（' + b.name + '），請確認已轉入' + (b.account ? ' ' + b.account : ''));
      }
    });
  });

  if (msgs.length) pushLine('🧾 帳單提醒\n' + msgs.join('\n'));
}

// 執行一次：建立每天 09:00 的檢查
function installBillTrigger() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'dailyBillCheck') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('dailyBillCheck').timeBased().everyDays(1).atHour(9).create();
}

// ══════════════ LINE webhook（記下群組 ID；群組傳「帳單」→ 回覆本月未繳）══════════════
// LINE 後台的 Webhook URL 設為本專案（帳單）的網址
function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    (body.events || []).forEach(handleBillEvent);
  } catch (err) {
    console.error(err);
  }
  return ContentService.createTextOutput('ok');
}

function handleBillEvent(ev) {
  if (!ev.source || ev.source.type !== 'group') return;
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('GROUP_ID')) props.setProperty('GROUP_ID', ev.source.groupId);
  if (props.getProperty('GROUP_ID') !== ev.source.groupId) return;
  if (ev.type !== 'message' || !ev.message || ev.message.type !== 'text') return;

  if (ev.message.text.trim() === '帳單') {
    replyBillStatus(ev.replyToken);
  }
}

function buildUnpaidText() {
  const { bills, pays } = loadBillsAndPayments();
  const key = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM');
  const [y, m] = key.split('-');
  const lines = [];
  let total = 0;
  bills.forEach(b => {
    if (!appliesToMonth(b, Number(y), Number(m) - 1)) return;
    const p = pays[key + '|' + b.id];
    if (p && p.paid) return;
    const amt = p ? p.amount : null;
    if (amt) total += amt;
    const amtText = amt ? '$' + amt.toLocaleString() : '未填金額';
    const dueText = b.dueDay ? '（' + b.dueDay + ' 號繳款）' : '';
    lines.push('・' + b.name + '　' + amtText + dueText);
  });
  if (!lines.length) return '✅ ' + y + ' 年 ' + Number(m) + ' 月帳單都已繳納';
  return '🧾 ' + y + ' 年 ' + Number(m) + ' 月未繳帳單\n' + lines.join('\n') + '\n合計（已填金額）：$' + total.toLocaleString();
}

function replyBillStatus(replyToken) {
  const token = PropertiesService.getScriptProperties().getProperty('LINE_TOKEN');
  UrlFetchApp.fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + token },
    payload: JSON.stringify({ replyToken: replyToken, messages: [{ type: 'text', text: buildUnpaidText() }] }),
    muteHttpExceptions: true
  });
}
