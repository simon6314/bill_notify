// 與帳單頁使用同一個 Apps Script 網址
const API_URL = 'https://script.google.com/macros/s/AKfycbwaXe6NUpewpBWRxUdvb2qG6bdWWt9GfeccEaddtEeQSt--XRa3mQgu4YXTEht9zWUAZg/exec';

const TYPE_ORDER = ['信用卡', '定期', '訂閱', '已刪除'];
const COLORS = { '信用卡': '#0891b2', '定期': '#db2777', '訂閱': '#7c3aed', '已刪除': '#94a3b8' };

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = n => '$' + Math.round(Number(n) || 0).toLocaleString();

function todayMonthKey() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

const sel = { mode: 'month', value: todayMonthKey() }; // month: 'YYYY-MM'；year: 'YYYY'
let data = { bills: [], payments: [] };

function inPeriod(month) {
  return sel.mode === 'month' ? month === sel.value : month.slice(0, 4) === sel.value;
}

function periodLabel() {
  if (sel.mode === 'year') return sel.value + ' 年';
  const [y, m] = sel.value.split('-');
  return y + ' 年 ' + Number(m) + ' 月';
}

// 圓餅圖（SVG，不需要外部套件）
function pieSvg(slices) {
  const total = slices.reduce((s, x) => s + x.value, 0);
  if (!total) return '<div class="status">這個期間沒有花費紀錄</div>';
  if (slices.length === 1) {
    return `<svg viewBox="-1 -1 2 2" class="pie"><circle r="1" fill="${slices[0].color}"/></svg>`;
  }
  let acc = 0;
  const paths = slices.map(s => {
    const start = (acc / total) * 2 * Math.PI;
    acc += s.value;
    const end = (acc / total) * 2 * Math.PI;
    const x1 = Math.cos(start - Math.PI / 2), y1 = Math.sin(start - Math.PI / 2);
    const x2 = Math.cos(end - Math.PI / 2), y2 = Math.sin(end - Math.PI / 2);
    const large = end - start > Math.PI ? 1 : 0;
    return `<path d="M0 0 L${x1} ${y1} A1 1 0 ${large} 1 ${x2} ${y2} Z" fill="${s.color}"/>`;
  }).join('');
  return `<svg viewBox="-1 -1 2 2" class="pie">${paths}</svg>`;
}

function render() {
  const billMap = {};
  data.bills.forEach(b => { billMap[b.id] = b; });

  const rows = data.payments.filter(p => inPeriod(p.month) && p.amount > 0);
  const byType = {};
  const byBill = {};
  rows.forEach(p => {
    const b = billMap[p.id];
    const type = b ? b.type : '已刪除';
    const name = b ? b.name : '（已刪除的帳單）';
    byType[type] = (byType[type] || 0) + p.amount;
    byBill[name] = (byBill[name] || 0) + p.amount;
  });

  const slices = TYPE_ORDER
    .filter(t => byType[t] > 0)
    .map(t => ({ label: t, value: byType[t], color: COLORS[t] }));
  const total = slices.reduce((s, x) => s + x.value, 0);

  $('pie').innerHTML = pieSvg(slices);
  $('totalLabel').textContent = periodLabel() + ' 總花費';
  $('total').textContent = money(total);
  $('countLabel').textContent = rows.length ? rows.length + ' 筆紀錄' : '';

  $('legend').innerHTML = slices.map(s => {
    const pct = total ? Math.round((s.value / total) * 100) : 0;
    return `<div class="legend-row">
      <span class="dot" style="background:${s.color}"></span>
      <span class="legend-label">${esc(s.label)}</span>
      <span class="pct">${pct}%</span>
      <strong>${money(s.value)}</strong>
    </div>`;
  }).join('') || '';

  const ranked = Object.entries(byBill).sort((a, b) => b[1] - a[1]);
  const max = ranked.length ? ranked[0][1] : 0;
  $('ranking').innerHTML = ranked.map(([name, value]) => {
    const w = max ? Math.round((value / max) * 100) : 0;
    return `<div class="rank-row">
      <div class="rank-head"><span>${esc(name)}</span><strong>${money(value)}</strong></div>
      <div class="rank-bar"><span style="width:${w}%"></span></div>
    </div>`;
  }).join('') || '<div class="status">沒有資料</div>';
}

function syncControls() {
  $('modeMonth').classList.toggle('active', sel.mode === 'month');
  $('modeYear').classList.toggle('active', sel.mode === 'year');
  const pick = $('pick');
  if (sel.mode === 'month') {
    pick.type = 'month';
    pick.value = sel.value;
  } else {
    pick.type = 'number';
    pick.min = 2020;
    pick.max = 2100;
    pick.value = sel.value;
  }
}

function shift(delta) {
  if (sel.mode === 'month') {
    const [y, m] = sel.value.split('-').map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    sel.value = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  } else {
    sel.value = String(Number(sel.value) + delta);
  }
  syncControls();
  render();
}

$('modeMonth').addEventListener('click', () => {
  if (sel.mode === 'month') return;
  sel.mode = 'month';
  sel.value = sel.value.length === 4 ? sel.value + '-' + todayMonthKey().slice(5) : sel.value;
  syncControls();
  render();
});
$('modeYear').addEventListener('click', () => {
  if (sel.mode === 'year') return;
  sel.mode = 'year';
  sel.value = sel.value.slice(0, 4);
  syncControls();
  render();
});
$('pick').addEventListener('change', e => {
  if (!e.target.value) return;
  sel.value = sel.mode === 'month' ? e.target.value : String(e.target.value);
  render();
});
$('prev').addEventListener('click', () => shift(-1));
$('next').addEventListener('click', () => shift(1));

async function load() {
  $('status').textContent = '載入中…';
  try {
    const res = await fetch(API_URL + '?action=allPayments');
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || '未知錯誤');
    data = json;
    $('status').textContent = '';
    syncControls();
    render();
  } catch (err) {
    $('status').textContent = '載入失敗：' + err.message;
  }
}

load();
