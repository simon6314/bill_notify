// 把這裡換成 Apps Script 部署後的網址（以 /exec 結尾）
const API_URL = 'https://script.google.com/macros/s/AKfycbwaXe6NUpewpBWRxUdvb2qG6bdWWt9GfeccEaddtEeQSt--XRa3mQgu4YXTEht9zWUAZg/exec';

const state = {
  month: currentMonthKey(),
  bills: [],
  payments: {},
  editingId: null
};

const $ = id => document.getElementById(id);

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function money(n) {
  return '$' + Math.round(Number(n) || 0).toLocaleString();
}
function currentMonthKey() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}
function shiftMonth(key, delta) {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

// 把 Apps Script 回傳的 JSON 取出來；失敗就丟錯
async function api(params) {
  if (!API_URL || API_URL.startsWith('PASTE_')) throw new Error('尚未設定 API_URL');
  const qs = Object.entries(params)
    .map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v))
    .join('&');
  const res = await fetch(API_URL + '?' + qs);
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || '未知錯誤');
  return data;
}

function setStatus(text, isError) {
  const el = $('status');
  el.textContent = text;
  el.style.color = isError ? 'var(--danger)' : '';
}

async function loadMonth() {
  $('monthSel').value = state.month;
  setStatus('載入中…');
  try {
    const data = await api({ action: 'list', month: state.month });
    state.bills = data.bills;
    state.payments = data.payments;
    setStatus('');
    render();
  } catch (err) {
    setStatus('載入失敗：' + err.message, true);
  }
}

// 這個月的繳款日（超過當月天數時取月底）
function dueDateOf(bill, monthKey) {
  const [y, m] = monthKey.split('-').map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  const day = Math.min(bill.dueDay || 1, lastDay);
  return new Date(y, m - 1, day);
}

function daysUntil(date) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((date - today) / 86400000);
}

// 該月份還沒有填過金額時回傳 null（顯示「未填」，不計入合計）
function amountOf(bill) {
  const p = state.payments[bill.id];
  return p ? p.amount : null;
}
function isPaid(bill) {
  const p = state.payments[bill.id];
  return !!(p && p.paid);
}

// 年繳的帳單只在繳費月份出現；每月的帳單每個月都出現
function appliesToCurrentMonth(b) {
  if (b.period !== '每年') return true;
  return b.renewMonth === Number(state.month.split('-')[1]);
}

function render() {
  const active = state.bills.filter(b => b.active && appliesToCurrentMonth(b));
  let total = 0, paidTotal = 0, unpaidCount = 0;
  active.forEach(b => {
    const amt = amountOf(b);
    if (amt !== null) total += amt;
    if (isPaid(b)) { if (amt !== null) paidTotal += amt; } else unpaidCount++;
  });
  $('summary').innerHTML = `
    <div><small>本月應繳</small><strong>${money(total)}</strong></div>
    <div><small>已繳</small><strong style="color:var(--ok)">${money(paidTotal)}</strong></div>
    <div><small>未繳</small><strong>${unpaidCount} 筆</strong></div>`;

  const sorted = [...active].sort((a, b) => (a.dueDay || 99) - (b.dueDay || 99));
  const list = sorted.map(renderBill).join('');
  $('billList').innerHTML = list || '<div class="status">還沒有帳單，請到下方「管理帳單」新增</div>';

  renderManage();
}

function renderBill(b) {
  const paid = isPaid(b);
  const due = dueDateOf(b, state.month);
  const days = daysUntil(due);
  let cls = '', dueCls = '', dueText = '';
  if (paid) {
    cls = 'paid';
    dueText = '已繳';
  } else if (days < 0) {
    cls = 'overdue'; dueCls = 'overdue';
    dueText = '已逾期 ' + (-days) + ' 天';
  } else if (days <= 3) {
    cls = 'soon'; dueCls = 'soon';
    dueText = days === 0 ? '今天繳款' : '還有 ' + days + ' 天';
  } else {
    dueText = '還有 ' + days + ' 天';
  }

  const badges = [
    `<span class="badge">${esc(b.type)}</span>`,
    b.auto ? '<span class="badge auto">自動扣繳</span>' : ''
  ].join('');

  // 結帳日比繳款日大（例：25 結帳、次月 10 繳款）→ 本月繳的是「上月」結帳的帳單
  let closeLine = '';
  if (b.type === '信用卡' && b.closeDay) {
    closeLine = b.dueDay && b.closeDay > b.dueDay
      ? `上月 ${b.closeDay} 號結帳，本月 ${b.dueDay} 號繳款｜`
      : `每月 ${b.closeDay} 號結帳｜`;
  }
  const accountLine = b.account ? `扣款：${esc(b.account)}｜` : '';

  return `
    <div class="bill ${cls}">
      <div class="bill-head">
        <div class="bill-name">${esc(b.name)}</div>
        <div class="badges">${badges}</div>
      </div>
      <div class="bill-meta">${closeLine}${accountLine}${b.period === '每年' ? '每年 ' + b.renewMonth + ' 月 ' : '每月 '}${b.dueDay || '—'} 號繳款
        <span class="due-text ${dueCls}">｜${dueText}</span>
      </div>
      ${b.auto ? `<div class="bill-meta auto-note">📌 將於 ${b.dueDay || '—'} 號自動扣繳（請自行確認是否扣款成功）</div>` : ''}
      ${b.note ? `<div class="bill-meta">${esc(b.note)}</div>` : ''}
      <div class="bill-row">
        <div class="amount-wrap">
          <span>金額</span>
          <input type="number" min="0" inputmode="numeric" placeholder="未填"
            value="${amountOf(b) === null ? '' : amountOf(b)}"
            aria-label="${esc(b.name)} 金額"
            onchange="changeAmount('${esc(b.id)}', this.value)">
        </div>
        <label class="paid-toggle">
          <input type="checkbox" ${paid ? 'checked' : ''} onchange="togglePaid('${esc(b.id)}', this.checked)">
          已繳納
        </label>
      </div>
    </div>`;
}

async function changeAmount(id, value) {
  const bill = state.bills.find(b => b.id === id);
  if (!bill) return;
  // 清空金額：不寫入，還原為顯示「未填」
  if (String(value).trim() === '') { render(); return; }
  const amount = Number(value) || 0;
  // 金額為 0 代表這個月不用繳，自動勾選已繳納
  const paid = amount === 0 ? true : isPaid(bill);
  state.payments[id] = { amount, paid };
  render();
  await savePayment(id, amount, paid);
}

async function togglePaid(id, paid) {
  const bill = state.bills.find(b => b.id === id);
  if (!bill) return;
  const amount = amountOf(bill) ?? 0;
  state.payments[id] = { amount, paid };
  render();
  await savePayment(id, amount, paid);
}

async function savePayment(id, amount, paid) {
  try {
    await api({ action: 'setPayment', month: state.month, id, amount, paid: String(paid) });
    setStatus('已儲存');
    setTimeout(() => { if ($('status').textContent === '已儲存') setStatus(''); }, 1500);
  } catch (err) {
    setStatus('儲存失敗：' + err.message, true);
    loadMonth();
  }
}

// ── 帳單管理 ──
function renderManage() {
  const rows = [...state.bills].sort((a, b) => (a.dueDay || 99) - (b.dueDay || 99));
  $('manageList').innerHTML = rows.map(b => `
    <div class="manage-item">
      <div>
        <div><strong>${esc(b.name)}</strong>${b.active ? '' : ' <small>（已停用）</small>'}</div>
        <small>${esc(b.type)}${b.closeDay ? '｜結帳 ' + b.closeDay + ' 號' : ''}｜${b.period === '每年' ? '每年 ' + (b.renewMonth || '—') + ' 月 ' : ''}繳款 ${b.dueDay || '—'} 號${b.account ? '｜' + esc(b.account) : ''}${b.auto ? '｜自動扣繳' : ''}</small>
      </div>
      <div class="btns">
        <button onclick="editBill('${esc(b.id)}')">編輯</button>
        <button onclick="removeBill('${esc(b.id)}')">刪除</button>
      </div>
    </div>`).join('') || '<div class="status">目前沒有帳單</div>';
}

function editBill(id) {
  const b = state.bills.find(x => x.id === id);
  if (!b) return;
  state.editingId = id;
  $('f-id').value = b.id;
  $('f-name').value = b.name;
  $('f-type').value = b.type === '信用卡' ? '信用卡' : '定期';
  $('f-close').value = b.closeDay || '';
  $('f-due').value = b.dueDay || '';
  $('f-account').value = b.account;
  $('f-auto').checked = b.auto;
  $('f-note').value = b.note;
  $('f-period').value = b.period === '每年' ? '每年' : '每月';
  $('f-renew').value = b.renewMonth || '';
  toggleRenewField();
  $('manage').open = true;
  $('f-name').focus();
}

// 只有「每年」才顯示繳費月份欄位
function toggleRenewField() {
  $('f-renew-wrap').style.display = $('f-period').value === '每年' ? '' : 'none';
}

function resetForm() {
  state.editingId = null;
  $('billForm').reset();
  $('f-id').value = '';
  toggleRenewField();
}

async function submitBill(e) {
  e.preventDefault();
  const params = {
    action: 'saveBill',
    id: $('f-id').value,
    name: $('f-name').value.trim(),
    type: $('f-type').value,
    closeDay: $('f-close').value,
    dueDay: $('f-due').value,
    account: $('f-account').value.trim(),
    auto: String($('f-auto').checked),
    period: $('f-period').value,
    renewMonth: $('f-renew').value,
    active: 'true',
    note: $('f-note').value.trim()
  };
  if (!params.name) return;
  try {
    setStatus('儲存中…');
    await api(params);
    resetForm();
    await loadMonth();
    setStatus('已儲存');
  } catch (err) {
    setStatus('儲存失敗：' + err.message, true);
  }
}

async function removeBill(id) {
  const b = state.bills.find(x => x.id === id);
  if (!b || !confirm('確定刪除「' + b.name + '」？（已記錄的繳費紀錄會保留）')) return;
  try {
    await api({ action: 'deleteBill', id });
    await loadMonth();
  } catch (err) {
    setStatus('刪除失敗：' + err.message, true);
  }
}

// ── 初始化 ──
$('monthSel').addEventListener('change', e => {
  if (!e.target.value) return;
  state.month = e.target.value;
  loadMonth();
});
$('prevMonth').addEventListener('click', () => { state.month = shiftMonth(state.month, -1); loadMonth(); });
$('nextMonth').addEventListener('click', () => { state.month = shiftMonth(state.month, 1); loadMonth(); });
$('billForm').addEventListener('submit', submitBill);
$('cancelEdit').addEventListener('click', resetForm);

// 讓 inline onchange 能呼叫到
Object.assign(window, { changeAmount, togglePaid, editBill, removeBill });

loadMonth();
