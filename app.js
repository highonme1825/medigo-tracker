/* ==================== 상수 / 유틸 ==================== */

const STORAGE_KEY = 'medigo_naver_tracker_v1';
const THEME_KEY = 'medigo_naver_tracker_theme';
const TASK_ORDER_KEY = 'medigo_naver_tracker_task_order';
const LONG_PRESS_MS = 450;

/* ==================== 클라우드 동기화 (Supabase) ==================== */
// 폰/컴퓨터 등 여러 기기에서 같은 데이터를 보고 편집할 수 있도록,
// localStorage 대신(및 오프라인 백업용으로 병행) Supabase의 tracker_state 테이블
// 한 행(id='default')에 전체 데이터를 JSON으로 저장하고 Realtime으로 변경을 구독한다.
const SUPABASE_URL = 'https://gjzqrrnzuvvobqdqqcjn.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdqenFycm56dXZ2b2JxZHFxY2puIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY1NDUyNDAsImV4cCI6MjEwMjEyMTI0MH0.nWIgs2DEdtKGPuvcCr8rX30iOZbbfBEf8waGAdO63IY';
const supabaseClient = window.supabase ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

// 공유 비밀번호(패스코드) 게이트 - 평문 대신 SHA-256 해시로 비교한다.
// 비밀번호를 바꾸려면: 새 비밀번호의 SHA-256 해시값으로 아래 상수만 교체하면 된다.
const PASSCODE_OK_KEY = 'medigo_naver_tracker_passcode_ok';
const APP_PASSCODE_HASH = '0be057bbbdf7ad63295016eb691feb8c21a364073267de09503eb04b954d522e'; // "1825"

async function sha256Hex(str) {
  const enc = new TextEncoder().encode(str);
  const buf = await crypto.subtle.digest('SHA-256', enc);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function showPasscodeGate() {
  return new Promise((resolve) => {
    if (localStorage.getItem(PASSCODE_OK_KEY) === '1') { resolve(); return; }

    const root = document.getElementById('app');
    root.innerHTML = `
      <div class="passcode-gate">
        <div class="passcode-card">
          <div class="passcode-title">MEDI GO ROUND</div>
          <div class="passcode-desc">비밀번호를 입력하면 계속할 수 있습니다.</div>
          <input type="password" id="passcodeInput" class="passcode-input" placeholder="비밀번호" autofocus>
          <div id="passcodeError" class="passcode-error"></div>
          <button type="button" id="passcodeSubmit" class="primary-btn btn-lg">입장하기</button>
        </div>
      </div>`;

    const pwEl = document.getElementById('passcodeInput');
    const errEl = document.getElementById('passcodeError');
    const btnEl = document.getElementById('passcodeSubmit');

    async function trySubmit() {
      const hash = await sha256Hex(pwEl.value);
      if (hash === APP_PASSCODE_HASH) {
        localStorage.setItem(PASSCODE_OK_KEY, '1');
        resolve();
      } else {
        errEl.textContent = '비밀번호가 올바르지 않습니다.';
        pwEl.value = '';
        pwEl.focus();
      }
    }

    btnEl.addEventListener('click', trySubmit);
    pwEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') trySubmit(); });
    pwEl.focus();
  });
}

function getInitialTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  if (saved === 'dark' || saved === 'light') return saved;
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

let currentTheme = getInitialTheme();
document.documentElement.dataset.theme = currentTheme;

function loadTaskOrder() {
  try {
    const parsed = JSON.parse(localStorage.getItem(TASK_ORDER_KEY) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (e) {
    return {};
  }
}

let taskOrder = loadTaskOrder();

function currentTaskOrderKey() {
  return `${state.hospitalId}::${monthKey(state.year, state.month)}`;
}

function saveCurrentTaskOrder() {
  const tbody = document.getElementById('trackerTbody');
  if (!tbody) return;
  taskOrder[currentTaskOrderKey()] = [...tbody.querySelectorAll('tr[data-task-id]')]
    .map((row) => row.dataset.taskId);
  localStorage.setItem(TASK_ORDER_KEY, JSON.stringify(taskOrder));
}

const TYPE_META = {
  brandBlog: { label: '브랜드 블로그', short: '브랜드', color: 'var(--series-1)' },
  press:     { label: '기자단',        short: '기자단', color: 'var(--series-2)' },
  receipt:   { label: '영수증 리뷰',    short: '영수증', color: 'var(--series-3)' },
};
const TYPE_KEYS = Object.keys(TYPE_META);
// 목표 수량 입력칸의 상한 - 오타로 큰 숫자가 들어가 자동 배정이 수만 건씩
// 생성되며 브라우저가 멈추는 사고를 막기 위한 안전장치.
const MAX_QUOTA_PER_TYPE = 200;
const STATUS_LIST = ['시작 전', '원고 준비', '메일 준비', '예약 발행', '요청 완료', '발행', '보고 완료'];
const DOW_LABELS = ['일', '월', '화', '수', '목', '금', '토'];

function uuid() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'id-' + Date.now() + '-' + Math.random().toString(16).slice(2);
}

function esc(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function pad2(n) { return String(n).padStart(2, '0'); }

function fmtDateStr(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function monthKey(year, month) { return `${year}-${pad2(month)}`; }

function monthLabel(year, month) { return `${year}년 ${month}월`; }

function normalizeUrl(u) {
  const trimmed = (u || '').trim();
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return 'https://' + trimmed;
}

function daysInMonth(year, month) { return new Date(year, month, 0).getDate(); }
function clampDay(year, month, day) { return Math.min(day, daysInMonth(year, month)); }

function getCycleRange(hospital, year, month) {
  const startDay = hospital.cycleStartDay || 1;
  const start = new Date(year, month - 1, clampDay(year, month, startDay));
  let nextYear = year;
  let nextMonth = month + 1;
  if (nextMonth > 12) { nextMonth = 1; nextYear += 1; }
  const nextStart = new Date(nextYear, nextMonth - 1, clampDay(nextYear, nextMonth, startDay));
  const end = new Date(nextStart);
  end.setDate(end.getDate() - 1);
  return { start, end };
}

function cycleLabel(hospital, year, month) {
  if ((hospital.cycleStartDay || 1) === 1) return monthLabel(year, month);
  const { start, end } = getCycleRange(hospital, year, month);
  return `${start.getFullYear()}.${start.getMonth() + 1}.${start.getDate()} ~ ${end.getFullYear()}.${end.getMonth() + 1}.${end.getDate()}`;
}

function periodWord(hospital, year, month) {
  const isMonthly = (hospital.cycleStartDay || 1) === 1;
  if (year === undefined || month === undefined) {
    return isMonthly ? '이번달' : '이번 주기';
  }
  const anchor = getCurrentCycleAnchor(hospital, today);
  const isCurrent = year === anchor.year && month === anchor.month;
  if (isCurrent) return isMonthly ? '이번달' : '이번 주기';
  return isMonthly ? `${month}월` : cycleLabel(hospital, year, month);
}

function getCurrentCycleAnchor(hospital, refDate) {
  const startDay = hospital.cycleStartDay || 1;
  let y = refDate.getFullYear();
  let m = refDate.getMonth() + 1;
  const d = refDate.getDate();
  const thisStart = clampDay(y, m, startDay);
  if (d < thisStart) {
    m -= 1;
    if (m < 1) { m = 12; y -= 1; }
  }
  return { year: y, month: m };
}

const today = new Date();
const TODAY_STR = fmtDateStr(today);

function isPublishedStatus(status) {
  return status === '발행' || status === '발행완료' || status === '보고 완료' || status === '보고';
}

const INITIAL_HOSPITALS = [
  { id: 'h-gangnam', name: '강남마디튼튼의원', defaultQuota: { brandBlog: 2, press: 2, receipt: 4 }, cycleStartDay: 1, naverId: '', naverPassword: '', naverBlogUrl: '', naverMapUrl: '' },
  { id: 'h-junghankyo', name: '정한교피부과의원', defaultQuota: { brandBlog: 5, press: 6, receipt: 4 }, cycleStartDay: 1, naverId: '', naverPassword: '', naverBlogUrl: '', naverMapUrl: '' },
  { id: 'h-gibaek', name: '기백한의원', defaultQuota: { brandBlog: 5, press: 3, receipt: 4 }, cycleStartDay: 1, naverId: '', naverPassword: '', naverBlogUrl: '', naverMapUrl: '' },
  { id: 'h-simpyeonhan', name: '심편한내과', defaultQuota: { brandBlog: 4, press: 4, receipt: 2 }, cycleStartDay: 1, naverId: '', naverPassword: '', naverBlogUrl: '', naverMapUrl: '' },
];

const INITIAL_TASKS = [
  { id: 't-1', hospitalId: 'h-gangnam', type: 'press', deadline: '2026-08-24', status: '시작 전', keyword: '', keywordVolume: 100, keywordDocs: 240 },
  { id: 't-2', hospitalId: 'h-junghankyo', type: 'brandBlog', deadline: '2026-08-24', status: '시작 전', keyword: '', keywordVolume: 30, keywordDocs: 110 },
  { id: 't-3', hospitalId: 'h-gibaek', type: 'brandBlog', deadline: '2026-08-24', status: '시작 전', keyword: '', keywordVolume: 20, keywordDocs: 44 },
  { id: 't-4', hospitalId: 'h-simpyeonhan', type: 'brandBlog', deadline: '2026-08-24', status: '시작 전', keyword: '시흥 심편한내과', keywordVolume: 20, keywordDocs: 71 },
  { id: 't-5', hospitalId: 'h-gangnam', type: 'brandBlog', deadline: '2026-08-17', status: '시작 전', keyword: '', keywordVolume: 350, keywordDocs: 160 },
  { id: 't-6', hospitalId: 'h-junghankyo', type: 'brandBlog', deadline: '2026-08-17', status: '시작 전', keyword: '', keywordVolume: 30, keywordDocs: 110 },
  { id: 't-7', hospitalId: 'h-junghankyo', type: 'brandBlog', deadline: '2026-08-17', status: '시작 전', keyword: '', keywordVolume: 30, keywordDocs: 110 },
  { id: 't-8', hospitalId: 'h-junghankyo', type: 'press', deadline: '2026-08-17', status: '시작 전', keyword: '', keywordVolume: 30, keywordDocs: 110 },
  { id: 't-9', hospitalId: 'h-junghankyo', type: 'press', deadline: '2026-08-17', status: '시작 전', keyword: '', keywordVolume: 30, keywordDocs: 110 },
  { id: 't-10', hospitalId: 'h-gibaek', type: 'brandBlog', deadline: '2026-08-17', status: '시작 전', keyword: '', keywordVolume: 20, keywordDocs: 44 },
  { id: 't-11', hospitalId: 'h-simpyeonhan', type: 'brandBlog', deadline: '2026-08-17', status: '시작 전', keyword: '', keywordVolume: 20, keywordDocs: 44 },
  { id: 't-12', hospitalId: 'h-simpyeonhan', type: 'press', deadline: '2026-08-17', status: '시작 전', keyword: '', keywordVolume: 20, keywordDocs: 44 },
  { id: 't-13', hospitalId: 'h-gibaek', type: 'brandBlog', deadline: '2026-08-10', status: '시작 전', keyword: '분당 공진단', keywordVolume: 80, keywordDocs: 105 },
  { id: 't-14', hospitalId: 'h-gangnam', type: 'press', deadline: '2026-08-10', status: '시작 전', keyword: '', keywordVolume: 100, keywordDocs: 240 },
  { id: 't-15', hospitalId: 'h-junghankyo', type: 'brandBlog', deadline: '2026-08-10', status: '예약 발행', keyword: '안산 기미 치료', keywordVolume: 20, keywordDocs: 440 },
  { id: 't-16', hospitalId: 'h-junghankyo', type: 'brandBlog', deadline: '2026-08-10', status: '예약 발행', keyword: '안산 피코토닝', keywordVolume: 20, keywordDocs: 90 },
  { id: 't-17', hospitalId: 'h-junghankyo', type: 'press', deadline: '2026-08-10', status: '시작 전', keyword: '안산 중앙역 색소', keywordVolume: 20, keywordDocs: 90 },
  { id: 't-18', hospitalId: 'h-junghankyo', type: 'press', deadline: '2026-08-10', status: '시작 전', keyword: '고잔동 기미', keywordVolume: 30, keywordDocs: 110 },
  { id: 't-19', hospitalId: 'h-gibaek', type: 'press', deadline: '2026-08-10', status: '시작 전', keyword: '단대오거리역 안면마비', keywordVolume: 20, keywordDocs: 5 },
  { id: 't-20', hospitalId: 'h-simpyeonhan', type: 'brandBlog', deadline: '2026-08-10', status: '원고 준비', keyword: '노인 다리 부종 원인', keywordVolume: 310, keywordDocs: 340 },
  { id: 't-21', hospitalId: 'h-simpyeonhan', type: 'press', deadline: '2026-08-10', status: '시작 전', keyword: '', keywordVolume: 20, keywordDocs: 44 },
  { id: 't-22', hospitalId: 'h-junghankyo', type: 'press', deadline: '2026-08-04', status: '보고 완료', keyword: '고잔동 기미 치료', keywordVolume: 20, keywordDocs: 28, publishedDate: '2026-08-04' },
  { id: 't-23', hospitalId: 'h-junghankyo', type: 'press', deadline: '2026-08-04', status: '보고 완료', keyword: '단원구 토닝', keywordVolume: 20, keywordDocs: 26, publishedDate: '2026-08-04' },
  { id: 't-24', hospitalId: 'h-gibaek', type: 'press', deadline: '2026-08-04', status: '보고 완료', keyword: '금광동 안면마비', keywordVolume: 20, keywordDocs: 6, publishedDate: '2026-08-04' },
  { id: 't-25', hospitalId: 'h-gangnam', type: 'brandBlog', deadline: '2026-08-03', status: '보고 완료', keyword: '다산 성장클리닉', keywordVolume: 350, keywordDocs: 160, publishedDate: '2026-08-03' },
  { id: 't-26', hospitalId: 'h-gibaek', type: 'press', deadline: '2026-08-03', status: '보고 완료', keyword: '단대오거리역 한의원', keywordVolume: 20, keywordDocs: 10, publishedDate: '2026-08-03' },
  { id: 't-27', hospitalId: 'h-gibaek', type: 'brandBlog', deadline: '2026-08-03', status: '보고 완료', keyword: '금광동 안면마비', keywordVolume: 20, keywordDocs: 6, publishedDate: '2026-08-03' },
  { id: 't-28', hospitalId: 'h-gibaek', type: 'brandBlog', deadline: '2026-08-03', status: '보고 완료', keyword: '단대오거리 안면마비', keywordVolume: 20, keywordDocs: 6, publishedDate: '2026-08-03' },
  { id: 't-29', hospitalId: 'h-simpyeonhan', type: 'press', deadline: '2026-08-03', status: '보고 완료', keyword: '목감 심장내과', keywordVolume: 20, keywordDocs: 64, publishedDate: '2026-08-03' },
  { id: 't-30', hospitalId: 'h-simpyeonhan', type: 'press', deadline: '2026-08-03', status: '보고 완료', keyword: '시흥 심장내', keywordVolume: 50, keywordDocs: 690, publishedDate: '2026-08-03' },
  { id: 't-31', hospitalId: 'h-junghankyo', type: 'brandBlog', deadline: '2026-07-28', status: '보고 완료', keyword: '안산 아그네스', keywordVolume: 40, keywordDocs: 5, publishedDate: '2026-07-28' },
  { id: 't-32', hospitalId: 'h-simpyeonhan', type: 'brandBlog', deadline: '2026-07-27', status: '보고 완료', keyword: '목감 심편한내과', keywordVolume: 260, keywordDocs: 4, publishedDate: '2026-07-27' },
  { id: 't-33', hospitalId: 'h-gibaek', type: 'brandBlog', deadline: '2026-07-27', status: '보고 완료', keyword: '분당 안면마비', keywordVolume: 30, keywordDocs: 151, publishedDate: '2026-07-27' },
  { id: 't-34', hospitalId: 'h-gibaek', type: 'press', deadline: '2026-07-27', status: '보고 완료', keyword: '성남 안면마비 한의원', keywordVolume: 20, keywordDocs: 44, publishedDate: '2026-07-27' },
  { id: 't-35', hospitalId: 'h-junghankyo', type: 'brandBlog', deadline: '2026-07-27', status: '보고 완료', keyword: '더블타이트 모공', keywordVolume: 30, keywordDocs: 110, publishedDate: '2026-07-27' },
  { id: 't-36', hospitalId: 'h-gibaek', type: 'brandBlog', deadline: '2026-07-27', status: '보고 완료', keyword: '성남 삼차신경통', keywordVolume: 20, keywordDocs: 7, publishedDate: '2026-07-27' },
  { id: 't-37', hospitalId: 'h-junghankyo', type: 'brandBlog', deadline: '2026-07-27', status: '보고 완료', keyword: '스킨젯', keywordVolume: 760, keywordDocs: 24, publishedDate: '2026-07-27' },
  { id: 't-38', hospitalId: 'h-gangnam', type: 'press', deadline: '2026-07-27', status: '보고 완료', keyword: '도농역 무릎통증', keywordVolume: 20, keywordDocs: 27, publishedDate: '2026-07-27' },
  { id: 't-39', hospitalId: 'h-gibaek', type: 'press', deadline: '2026-07-22', status: '보고 완료', keyword: '신흥역 한의원', keywordVolume: 150, keywordDocs: 182, publishedDate: '2026-07-22' },
  { id: 't-40', hospitalId: 'h-gangnam', type: 'brandBlog', deadline: '2026-07-22', status: '보고 완료', keyword: '남양주 인대강화주사', keywordVolume: 20, keywordDocs: 45, publishedDate: '2026-07-22' },
  { id: 't-41', hospitalId: 'h-junghankyo', type: 'press', deadline: '2026-07-22', status: '보고 완료', keyword: '안산 중앙역 피부과', keywordVolume: 300, keywordDocs: 160, publishedDate: '2026-07-22' },
  { id: 't-42', hospitalId: 'h-junghankyo', type: 'press', deadline: '2026-07-22', status: '보고 완료', keyword: '단원구 피부질환', keywordVolume: 20, keywordDocs: 140, publishedDate: '2026-07-22' },
  { id: 't-43', hospitalId: 'h-gibaek', type: 'brandBlog', deadline: '2026-07-22', status: '보고 완료', keyword: '구강작열감증후군 원인', keywordVolume: 40, keywordDocs: 330, publishedDate: '2026-07-22' },
  { id: 't-44', hospitalId: 'h-gibaek', type: 'brandBlog', deadline: '2026-07-22', status: '보고 완료', keyword: '분당 구강작열감', keywordVolume: 20, keywordDocs: 0, publishedDate: '2026-07-22' },
  { id: 't-45', hospitalId: 'h-gibaek', type: 'brandBlog', deadline: '2026-07-13', status: '보고 완료', keyword: '분당 심방세동', keywordVolume: 20, keywordDocs: 250, publishedDate: '2026-07-13' },
  { id: 't-46', hospitalId: 'h-junghankyo', type: 'brandBlog', deadline: '2026-07-13', status: '보고 완료', keyword: '손발톱 검은선', keywordVolume: 20, keywordDocs: 67, publishedDate: '2026-07-13' },
  { id: 't-47', hospitalId: 'h-gangnam', type: 'press', deadline: '2026-07-13', status: '보고 완료', keyword: '다산동 도수치료', keywordVolume: 30, keywordDocs: 130, publishedDate: '2026-07-13' },
  { id: 't-48', hospitalId: 'h-junghankyo', type: 'press', deadline: '2026-07-13', status: '보고 완료', keyword: '단원구 피부과', keywordVolume: 120, keywordDocs: 183, publishedDate: '2026-07-13' },
  { id: 't-49', hospitalId: 'h-gibaek', type: 'press', deadline: '2026-07-13', status: '보고 완료', keyword: '남한산성입구역 한의원', keywordVolume: 20, keywordDocs: 52, publishedDate: '2026-07-13' },
  { id: 't-50', hospitalId: 'h-gangnam', type: 'brandBlog', deadline: '2026-07-06', status: '보고 완료', keyword: '다산 비타민수액', keywordVolume: 20, keywordDocs: 11, publishedDate: '2026-07-06' },
  { id: 't-51', hospitalId: 'h-junghankyo', type: 'brandBlog', deadline: '2026-07-06', status: '보고 완료', keyword: '안산 사마귀 치료', keywordVolume: 120, keywordDocs: 198, publishedDate: '2026-07-06' },
  { id: 't-52', hospitalId: 'h-gibaek', type: 'brandBlog', deadline: '2026-07-06', status: '보고 완료', keyword: '분당 삼차신경통', keywordVolume: 20, keywordDocs: 25, publishedDate: '2026-07-06' },
  { id: 't-53', hospitalId: 'h-gangnam', type: 'brandBlog', deadline: '2026-06-29', status: '보고 완료', keyword: '다산 위고비', keywordVolume: 100, keywordDocs: 58, publishedDate: '2026-06-29' },
  { id: 't-54', hospitalId: 'h-junghankyo', type: 'brandBlog', deadline: '2026-06-29', status: '보고 완료', keyword: '안산 피부질환진료', keywordVolume: 20, keywordDocs: 1230, publishedDate: '2026-06-29' },
  { id: 't-55', hospitalId: 'h-junghankyo', type: 'brandBlog', deadline: '2026-06-29', status: '보고 완료', keyword: '안산 피부진료 잘하는', keywordVolume: 30, keywordDocs: 63, publishedDate: '2026-06-29' },
  { id: 't-56', hospitalId: 'h-gibaek', type: 'brandBlog', deadline: '2026-06-29', status: '보고 완료', keyword: '분당 이명 명의', keywordVolume: 20, keywordDocs: 0, publishedDate: '2026-06-29' },
  { id: 't-57', hospitalId: 'h-junghankyo', type: 'brandBlog', deadline: '2026-06-22', status: '보고 완료', keyword: '안산 3D 피부분석', keywordVolume: 20, keywordDocs: 70, publishedDate: '2026-06-22' },
  { id: 't-58', hospitalId: 'h-junghankyo', type: 'press', deadline: '2026-06-22', status: '보고 완료', keyword: '안산 피부과 전문의', keywordVolume: 890, keywordDocs: 370, publishedDate: '2026-06-22' },
  { id: 't-59', hospitalId: 'h-junghankyo', type: 'press', deadline: '2026-06-22', status: '보고 완료', keyword: '안산 중앙동 피부과의원', keywordVolume: 160, keywordDocs: 120, publishedDate: '2026-06-22' },
  { id: 't-60', hospitalId: 'h-junghankyo', type: 'press', deadline: '2026-06-22', status: '보고 완료', keyword: '안산 중앙동 피부과의원', keywordVolume: 160, keywordDocs: 120, publishedDate: '2026-06-22' },
  { id: 't-61', hospitalId: 'h-gibaek', type: 'brandBlog', deadline: '2026-06-22', status: '보고 완료', keyword: '금광동 이명', keywordVolume: 20, keywordDocs: 6, publishedDate: '2026-06-22' },
  { id: 't-62', hospitalId: 'h-gangnam', type: 'press', deadline: '2026-06-15', status: '보고 완료', keyword: '다산역 정형외과', keywordVolume: 660, keywordDocs: 120, publishedDate: '2026-06-15' },
  { id: 't-63', hospitalId: 'h-junghankyo', type: 'brandBlog', deadline: '2026-06-15', status: '보고 완료', keyword: '안산 정한교피부과', keywordVolume: 1700, keywordDocs: 4, publishedDate: '2026-06-15' },
  { id: 't-64', hospitalId: 'h-junghankyo', type: 'brandBlog', deadline: '2026-06-15', status: '보고 완료', keyword: '정한교피부과', keywordVolume: 3030, keywordDocs: 4, publishedDate: '2026-06-15' },
  { id: 't-65', hospitalId: 'h-gibaek', type: 'press', deadline: '2026-06-15', status: '보고 완료', keyword: '단대오거리역 한의원', keywordVolume: 30, keywordDocs: 330, publishedDate: '2026-06-15' },
  { id: 't-66', hospitalId: 'h-gibaek', type: 'press', deadline: '2026-06-15', status: '보고 완료', keyword: '서현역 한의원', keywordVolume: 1120, keywordDocs: 540, publishedDate: '2026-06-15' },
  { id: 't-67', hospitalId: 'h-gibaek', type: 'brandBlog', deadline: '2026-06-15', status: '보고 완료', keyword: '설통 치료법', keywordVolume: 20, keywordDocs: 83, publishedDate: '2026-06-15' },
  { id: 't-68', hospitalId: 'h-gibaek', type: 'brandBlog', deadline: '2026-06-14', status: '보고 완료', keyword: '비정형 안면통', keywordVolume: 250, keywordDocs: 32, publishedDate: '2026-06-14' },
  { id: 't-69', hospitalId: 'h-gangnam', type: 'press', deadline: '2026-06-08', status: '보고 완료', keyword: '다산 도수치료', keywordVolume: 200, keywordDocs: 310, publishedDate: '2026-06-08' },
  { id: 't-70', hospitalId: 'h-gangnam', type: 'brandBlog', deadline: '2026-06-01', status: '보고 완료', keyword: '도농역 어깨통증', keywordVolume: 20, keywordDocs: 90, publishedDate: '2026-06-01' }
];

function migrateTask(t) {
  if (t.status === '작성 전') t.status = '시작 전';
  if (t.status === '작성완료') t.status = '원고 준비';
  if (t.status === '발행완료') t.status = '발행';
  return t;
}

// parsed(로컬 or 원격에서 막 읽어온 원시 데이터)를 안전한 db 형태로 만든다.
// 예전에는 여기서 "병원 4곳 미만이면 데모로 대체", "작업 0건이면 데모로 대체",
// "빈 키워드/시작전 상태의 새 작업은 쓰레기로 간주해 삭제" 하는 1회성 마이그레이션
// 로직이 있었는데, 이게 실시간 동기화 경로(다른 기기 반영, echo 처리)에서도 매번
// 실행되면서 방금 자동배정으로 막 만든 정상 작업(키워드 없음+시작 전 상태라 조건이
// 똑같음)까지 계속 지워버리는 사고를 냈다. 이제는 타입만 검증하고 내용은 손대지 않는다.
function normalizeLoadedData(parsed) {
  const hospitals = Array.isArray(parsed.hospitals) ? parsed.hospitals : [];
  const tasks = Array.isArray(parsed.tasks) ? parsed.tasks.map(migrateTask) : [];

  return {
    hospitals,
    quotaOverrides: parsed.quotaOverrides && typeof parsed.quotaOverrides === 'object' ? parsed.quotaOverrides : {},
    tasks,
    tagPool: Array.isArray(parsed.tagPool) ? parsed.tagPool : [],
  };
}

// 로컬(localStorage)에 캐시된 데이터 - 오프라인이거나 Supabase 연결 실패 시 대비용.
function loadLocalData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return normalizeLoadedData(JSON.parse(raw));
  } catch (e) {
    console.error('로컬 데이터 로드 실패:', e);
    return null;
  }
}

// Supabase tracker_state 테이블의 단일 행(id='default')을 원격 저장소로 사용한다.
async function fetchRemoteData() {
  if (!supabaseClient) return null;
  try {
    const { data, error } = await supabaseClient
      .from('tracker_state')
      .select('data, updated_at')
      .eq('id', 'default')
      .maybeSingle();
    if (error) { console.error('Supabase 로드 실패:', error); return null; }
    if (!data || !data.data || typeof data.data !== 'object' || !Array.isArray(data.data.hospitals)) return null;
    lastSyncedUpdatedAt = data.updated_at || null;
    return normalizeLoadedData(data.data);
  } catch (e) {
    console.error('Supabase 로드 실패:', e);
    return null;
  }
}

async function pushRemoteState(data) {
  if (!supabaseClient) return;
  try {
    const nowIso = new Date().toISOString();
    const { error } = await supabaseClient
      .from('tracker_state')
      .update({ data, updated_at: nowIso })
      .eq('id', 'default');
    if (error) { console.error('Supabase 저장 실패:', error); return; }
    lastSyncedUpdatedAt = nowIso;
  } catch (e) {
    console.error('Supabase 저장 실패:', e);
  }
}

// 앱 시작 시 1회: 로컬과 원격을 모두 읽어서 비교한 뒤,
// 한쪽이 비어있으면 있는 쪽을 쓰고, 둘 다 있는데 내용이 다르면
// 절대 조용히 덮어쓰지 않고 사용자에게 직접 어느 쪽을 쓸지 물어본다.
// (예전에는 원격이 있으면 무조건 원격으로 로컬을 덮어써서 실제 작업 데이터가
//  테스트용 샘플 데이터에 지워지는 사고가 있었음 - 다시는 이런 일이 없도록 함)
async function loadInitialData() {
  const remote = await fetchRemoteData();
  const local = loadLocalData();

  if (!remote) {
    const base = local || { hospitals: INITIAL_HOSPITALS, quotaOverrides: {}, tasks: INITIAL_TASKS, tagPool: [] };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(base));
    pushRemoteState(base);
    return base;
  }

  if (!local) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(remote));
    return remote;
  }

  if (JSON.stringify(local) === JSON.stringify(remote)) {
    return remote;
  }

  const useRemote = confirm(
    '이 기기에 저장된 데이터와 클라우드에 저장된 데이터가 서로 다릅니다.\n\n' +
    '[확인] = 클라우드 데이터를 사용 (이 기기의 데이터는 클라우드 내용으로 바뀝니다)\n' +
    '[취소] = 이 기기의 데이터를 사용 (클라우드가 이 기기 내용으로 바뀝니다)\n\n' +
    '어느 쪽이 최신/정확한 데이터인지 확실하지 않다면 먼저 [취소]를 누르고 "내보내기"로 양쪽을 백업해두는 걸 권장합니다.'
  );
  if (useRemote) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(remote));
    return remote;
  }
  pushRemoteState(local);
  return local;
}

let lastSyncedUpdatedAt = null;
let saveDebounceTimer = null;

function saveData() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
  clearTimeout(saveDebounceTimer);
  saveDebounceTimer = setTimeout(() => pushRemoteState(db), 600);
}

function subscribeRemoteChanges() {
  if (!supabaseClient) return;
  supabaseClient
    .channel('tracker_state_changes')
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'tracker_state', filter: 'id=eq.default' }, (payload) => {
      const incoming = payload.new;
      if (!incoming || incoming.updated_at === lastSyncedUpdatedAt) return; // 내가 방금 보낸 변경의 메아리는 무시
      if (!incoming.data || !Array.isArray(incoming.data.hospitals)) return;
      lastSyncedUpdatedAt = incoming.updated_at;
      db = normalizeLoadedData(incoming.data);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
      render();
    })
    .subscribe();
}

let db = null;

let state = {
  view: 'list',        // 'list' | 'detail'
  hospitalId: null,
  year: today.getFullYear(),
  month: today.getMonth() + 1,
  weeklyOffset: 0,     // 0 = 이번주, -1 = 지난주, 1 = 다음주
  pwVisible: false,
  trackerExpanded: false,
};

function getMondaysInMonth(year, month) {
  const mondays = [];
  const totalDays = daysInMonth(year, month);
  for (let day = 1; day <= totalDays; day++) {
    const cur = new Date(year, month - 1, day);
    if (cur.getDay() === 1) { // 1 = 월요일
      mondays.push(cur);
    }
  }
  return mondays;
}

// 이미 발행 완료된 작업은 지나간 기록이므로 마감일을 건드리지 않는다.
// 목표 수량에서 부족한 만큼 새 작업(대기중)을 만든 뒤, 아직 발행 전인 작업들을
// "현재 배정 건수가 가장 적은 주"부터 순서대로 채워 넣어 총량이 이번 달(달력 월)
// 월요일들에 최대한 고르게(최대-최소 차이 1건 이하) 맞춰지도록 한다.
// 정산 주기(cycleStartDay)는 무시하고 항상 달력 월(1일~말일) 기준으로 채운다.
function assignQuotaEvenlyForMonth(hospital, year, month) {
  if (hospital.autoAssignPaused) return { added: 0, moved: 0, paused: true };

  const ymKey = monthKey(year, month);
  const quota = getEffectiveQuota(hospital, ymKey);
  const mondays = getMondaysInMonth(year, month).map(fmtDateStr);
  if (mondays.length === 0) return { added: 0, moved: 0, paused: false };

  const currentTasks = db.tasks.filter((t) => t.hospitalId === hospital.id && t.deadline && t.deadline.startsWith(ymKey));
  let added = 0;
  let moved = 0;

  TYPE_KEYS.forEach((type) => {
    // 목표 수량 입력 실수(예: 자릿수 오타)로 수만~수백만 건이 생성되며 브라우저가
    // 멈추는 사고를 막기 위해 한 달에 타입당 생성 가능한 상한을 둔다.
    const target = Math.min(MAX_QUOTA_PER_TYPE, Number(quota[type]) || 0);
    const typeTasks = currentTasks.filter((t) => t.type === type);
    const completed = typeTasks.filter((t) => isPublishedStatus(t.status));
    const pending = typeTasks.filter((t) => !isPublishedStatus(t.status));

    while (completed.length + pending.length < target) {
      const newTask = {
        id: uuid(),
        hospitalId: hospital.id,
        type,
        keyword: '',
        keywordVolume: null,
        keywordDocs: null,
        keywordGap: null,
        deadline: '',
        status: '시작 전',
        publishedDate: null,
        publishedUrl: '',
        performance: '',
        createdAt: Date.now() + added,
      };
      db.tasks.push(newTask);
      pending.push(newTask);
      added++;
    }

    // 완료된 작업이 이미 차지하고 있는 주차를 반영해 주차별 현재 배정 건수를 센다
    const countPerWeek = mondays.map(() => 0);
    completed.forEach((t) => {
      const idx = mondays.indexOf(toMondayStr(t.deadline));
      if (idx >= 0) countPerWeek[idx] += 1;
    });

    pending.forEach((task) => {
      let minIdx = 0;
      for (let i = 1; i < countPerWeek.length; i++) {
        if (countPerWeek[i] < countPerWeek[minIdx]) minIdx = i;
      }
      const newDeadline = mondays[minIdx];
      if (task.deadline !== newDeadline) moved++;
      task.deadline = newDeadline;
      countPerWeek[minIdx] += 1;
    });
  });

  return { added, moved, paused: false };
}

function autoAssignMondays(hospital, year, month) {
  const { added, moved, paused } = assignQuotaEvenlyForMonth(hospital, year, month);
  if (paused) {
    alert(`"${hospital.name}" 병원은 자동 배정이 일시중지된 상태입니다. "병원 정보 수정"에서 재개할 수 있어요.`);
    return;
  }
  saveData();
  render();
  if (added > 0 || moved > 0) {
    alert(`"${hospital.name}" 병원의 ${month}월 목표 수량에 맞춰 신규 ${added}건 생성, ${moved}건 재배치하여 월요일 마감일에 고르게 배정했습니다!`);
  } else {
    alert(`"${hospital.name}" 병원의 ${month}월은 이미 고르게 배정되어 있습니다.`);
  }
}

function autoAssignAllHospitalsMondays(year, month) {
  let totalAdded = 0;
  let totalMoved = 0;
  let pausedCount = 0;

  db.hospitals.forEach((hospital) => {
    const { added, moved, paused } = assignQuotaEvenlyForMonth(hospital, year, month);
    if (paused) { pausedCount += 1; return; }
    totalAdded += added;
    totalMoved += moved;
  });

  saveData();
  render();

  const pausedNote = pausedCount > 0 ? ` (자동 배정 일시중지된 병원 ${pausedCount}곳은 제외)` : '';
  if (totalAdded > 0 || totalMoved > 0) {
    alert(`${year}년 ${month}월 목표 수량에 맞춰 총 ${totalAdded}건 생성, ${totalMoved}건 재배치하여 월요일 마감일에 고르게 배정했습니다!${pausedNote}`);
  } else {
    alert(`${year}년 ${month}월은 이미 모든 병원이 고르게 배정되어 있습니다.${pausedNote}`);
  }
}

function toMondayStr(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(d.setDate(diff));
  return fmtDateStr(monday);
}

function renderMondayBoard() {
  const year = state.year;
  const month = state.month;

  // 보드 컬럼은 선택한 달(year, month)의 월 단위 월요일들로 표시
  const mondays = getMondaysInMonth(year, month);
  const ymPrefix = monthKey(year, month);

  // 현재 뷰 달력 월에 속한 작업들 (마감일 또는 발행일 기준 해당 월 속함)
  const monthMondayTasks = db.tasks.filter((task) => {
    const targetDate = task.deadline || task.publishedDate;
    return targetDate && targetDate.startsWith(ymPrefix);
  });

  const totalTasks = monthMondayTasks.length;
  const completedTasks = monthMondayTasks.filter((t) => isPublishedStatus(t.status)).length;
  const pendingTasks = totalTasks - completedTasks;

  const isCurrentMonth = year === today.getFullYear() && month === (today.getMonth() + 1);

  // 월요일별로 그 주(화~다음주 일)에 걸린 작업들을 묶는다
  const weeks = mondays.map((date) => {
    const dateStr = fmtDateStr(date);
    const weekTasks = monthMondayTasks.filter((t) => {
      if (t.deadline === dateStr) return true;
      const mDay = toMondayStr(t.deadline || t.publishedDate);
      return mDay === dateStr;
    });
    return { date, dateStr, isToday: dateStr === TODAY_STR, weekTasks };
  });

  // 병원 × 주차 매트릭스 헤더 (요일 대신 병원 행을 기준으로 한눈에 비교)
  const headerCellsHtml = weeks.map(({ date, dateStr, isToday, weekTasks }) => `
    <div class="week-head-cell ${isToday ? 'is-today' : ''}">
      <span class="week-head-date">${date.getMonth() + 1}/${date.getDate()}</span>
      <span class="week-head-count">${weekTasks.length}건</span>
    </div>`).join('');

  const rowsHtml = db.hospitals.map((hospital) => {
    const cellsHtml = weeks.map(({ dateStr, isToday, weekTasks }) => {
      const hospitalTasks = weekTasks.filter((t) => t.hospitalId === hospital.id);
      if (hospitalTasks.length === 0) {
        return `<div class="week-cell is-empty ${isToday ? 'is-today-col' : ''}">–</div>`;
      }
      const doneCount = hospitalTasks.filter((t) => isPublishedStatus(t.status)).length;
      const allDone = doneCount === hospitalTasks.length;
      const groupsHtml = TYPE_KEYS.map((type) => {
        const typeTasks = hospitalTasks.filter((t) => t.type === type);
        if (typeTasks.length === 0) return '';
        const meta = TYPE_META[type];
        const dotsHtml = typeTasks.map((t) => {
          const done = isPublishedStatus(t.status);
          return `<span class="week-item-dot ${done ? 'is-done' : ''}" style="--dot-color:${meta.color}" title="${esc(meta.label)} · ${esc(t.status)}"></span>`;
        }).join('');
        return `<span class="week-item-group">${dotsHtml}</span>`;
      }).join('');
      return `
      <div class="week-cell ${allDone ? 'is-complete' : ''} ${isToday ? 'is-today-col' : ''}" data-action="open-hospital" data-id="${hospital.id}" data-date="${dateStr}" title="${esc(hospital.name)} 상세보기 · ${doneCount}/${hospitalTasks.length}건 완료">
        ${groupsHtml}
      </div>`;
    }).join('');
    return `
    <div class="week-row-head" data-action="open-hospital" data-id="${hospital.id}" title="${esc(hospital.name)} 상세보기">${esc(hospital.name)}</div>
    ${cellsHtml}`;
  }).join('');

  return `
  <section class="monday-board-section">
    <div class="monday-board-head">
      <div class="monday-board-title">
        📅 마감 보드
        <div class="monday-board-nav">
          <button class="icon-btn" data-action="main-prev-month" title="이전달 보기">◀</button>
          <span class="monday-nav-label">${year}년 ${month}월</span>
          <button class="icon-btn" data-action="main-next-month" title="다음달 보기">▶</button>
          ${!isCurrentMonth ? `<button class="ghost-btn" data-action="main-today-month">이번달</button>` : ''}
        </div>
      </div>
      <div class="monday-board-stats">
        <span class="monday-stat-badge">마감 <strong>${totalTasks}건</strong></span>
        <span class="monday-stat-badge">· 진행 <strong>${pendingTasks}건</strong></span>
        <span class="monday-stat-badge">· 완료 <strong>${completedTasks}건</strong></span>
        <button type="button" class="primary-btn auto-assign-all-btn" data-action="auto-assign-all-mondays" title="이번달(달력 월) 목표 수량에 맞춰 마감 수량을 월요일 마감일로 자동 배정합니다">
          🎯 이번달 마감 자동 배정
        </button>
      </div>
    </div>
    <div class="monday-board-scroll">
      <div class="week-matrix" style="grid-template-columns: var(--week-corner-w, 132px) repeat(${mondays.length}, minmax(var(--week-col-min, 78px), 1fr));">
        <div class="week-corner">병원 \\ 주차</div>
        ${headerCellsHtml}
        ${rowsHtml}
      </div>
    </div>
  </section>`;
}

/* ==================== 데이터 헬퍼 ==================== */

function getHospital(id) { return db.hospitals.find((h) => h.id === id) || null; }

function getEffectiveQuota(hospital, ymKey) {
  const override = db.quotaOverrides[`${hospital.id}::${ymKey}`];
  return override || hospital.defaultQuota;
}

function getTasksForCycle(hospital, year, month) {
  const { start, end } = getCycleRange(hospital, year, month);
  const startStr = fmtDateStr(start);
  const endStr = fmtDateStr(end);
  return db.tasks.filter((t) => t.hospitalId === hospital.id && t.deadline && t.deadline >= startStr && t.deadline <= endStr);
}

function getCompletedCount(hospital, year, month, type) {
  return getTasksForCycle(hospital, year, month).filter((t) => t.type === type && isPublishedStatus(t.status)).length;
}

function deleteHospitalCascade(hospitalId) {
  db.hospitals = db.hospitals.filter((h) => h.id !== hospitalId);
  db.tasks = db.tasks.filter((t) => t.hospitalId !== hospitalId);
  db.tagPool = db.tagPool.filter((t) => t.hospitalId !== hospitalId);
  Object.keys(db.quotaOverrides).forEach((k) => {
    if (k.startsWith(`${hospitalId}::`)) delete db.quotaOverrides[k];
  });
}

function getHospitalTags(hospitalId, kind) {
  return db.tagPool.filter((t) => t.hospitalId === hospitalId && t.kind === kind);
}

/* ==================== 렌더링 : 헤더 ==================== */

function renderHeader() {
  const nextThemeLabel = currentTheme === 'dark' ? '라이트모드' : '다크모드';
  const themeIcon = currentTheme === 'dark' ? '☀' : '☾';
  return `
  <div class="app-header">
    <div class="app-title" data-action="go-list">네이버 마케팅 작업 트래커</div>
    <div class="header-actions">
      <button class="ghost-btn" data-action="export-data" title="현재 데이터를 JSON 백업 파일로 저장">내보내기</button>
      <button class="ghost-btn" data-action="import-data" title="백업 파일에서 데이터 복원">가져오기</button>
      <button class="ghost-btn danger-text-btn" data-action="clear-all-data" title="모든 데이터 초기화">초기화</button>
      <button class="ghost-btn theme-toggle" data-action="toggle-theme" title="${nextThemeLabel}로 전환" aria-label="${nextThemeLabel}로 전환">
        <span aria-hidden="true">${themeIcon}</span> ${nextThemeLabel}
      </button>
    </div>
  </div>
  ${state.view === 'detail' ? renderTabStrip() : ''}
  `;
}

function renderTabStrip() {
  const pills = db.hospitals.map((h) => `
    <button class="tab-pill ${h.id === state.hospitalId ? 'active' : ''}" data-action="switch-hospital" data-id="${h.id}">${esc(h.name)}${h.autoAssignPaused ? ' ⏸' : ''}</button>
  `).join('');
  return `
  <div class="tab-strip">
    ${pills}
    <button class="tab-pill add-pill" data-action="add-hospital">+ 새 병원</button>
  </div>`;
}

/* ==================== 렌더링 : 목록 화면 ==================== */

function renderMiniQuotaRow(type, hospital, year, month) {
  const ymKey = monthKey(year, month);
  const quota = getEffectiveQuota(hospital, ymKey);
  const target = Number(quota[type]) || 0;
  const done = getCompletedCount(hospital, year, month, type);
  const pct = target > 0 ? Math.min(100, Math.round((done / target) * 100)) : (done > 0 ? 100 : 0);
  const meta = TYPE_META[type];
  return `
  <div class="mini-quota-row">
    <span class="mini-dot" style="background:${meta.color}"></span>
    <span class="mini-label">${esc(meta.short)}</span>
    <span class="mini-track"><span class="mini-fill" style="width:${pct}%;background:${meta.color}"></span></span>
    <span class="mini-frac">${done}/${target}</span>
  </div>`;
}

function renderHospitalCard(hospital) {
  const anchor = getCurrentCycleAnchor(hospital, today);
  return `
  <div class="hospital-card" data-action="open-hospital" data-id="${hospital.id}">
    <div class="hospital-card-head">
      <div class="hospital-card-name">${esc(hospital.name)}</div>
      <div class="hospital-card-actions">
        <button class="icon-btn" data-action="edit-hospital" data-id="${hospital.id}" title="수정">⚙</button>
        <button class="icon-btn danger-btn" data-action="delete-hospital" data-id="${hospital.id}" title="삭제">✕</button>
      </div>
    </div>
    ${TYPE_KEYS.map((t) => renderMiniQuotaRow(t, hospital, anchor.year, anchor.month)).join('')}
  </div>`;
}

function getTasksForCalendarMonth(hospitalId, year, month) {
  const startStr = `${monthKey(year, month)}-01`;
  const endStr = `${monthKey(year, month)}-${pad2(daysInMonth(year, month))}`;
  return db.tasks.filter((task) => task.hospitalId === hospitalId && (
    (task.deadline && task.deadline >= startStr && task.deadline <= endStr)
    || (isPublishedStatus(task.status) && task.publishedDate && task.publishedDate >= startStr && task.publishedDate <= endStr)
  ));
}

function getMondaysInCycle(hospital, year, month) {
  const { start, end } = getCycleRange(hospital, year, month);
  const mondays = [];
  const cur = new Date(start);
  while (cur.getTime() <= end.getTime()) {
    if (cur.getDay() === 1) { // 1 = 월요일
      mondays.push(fmtDateStr(cur));
    }
    cur.setDate(cur.getDate() + 1);
  }
  if (mondays.length === 0) {
    mondays.push(fmtDateStr(start));
  }
  return mondays;
}

function renderDeadlineSummary(hospital, year, month) {
  const tasks = getTasksForCycle(hospital, year, month);
  const brandCount = tasks.filter((t) => t.type === 'brandBlog' && t.deadline).length;
  const pressCount = tasks.filter((t) => t.type === 'press' && t.deadline).length;
  const receiptCount = tasks.filter((t) => t.type === 'receipt' && t.deadline).length;
  const totalCount = brandCount + pressCount + receiptCount;

  return `
  <div class="deadline-summary-bar">
    <div class="deadline-summary-title">
      <span>📅 마감 현황</span>
      <small style="font-weight:normal;color:var(--text-muted);">(총 ${totalCount}건)</small>
    </div>
    <div class="deadline-summary-chips">
      <span class="deadline-summary-chip" style="color:var(--series-1);">
        <span class="mini-dot" style="background:var(--series-1)"></span> 브랜드: <strong>${brandCount}건 마감</strong>
      </span>
      <span class="deadline-summary-chip" style="color:var(--series-2);">
        <span class="mini-dot" style="background:var(--series-2)"></span> 기자단: <strong>${pressCount}건 마감</strong>
      </span>
      <span class="deadline-summary-chip" style="color:var(--series-3);">
        <span class="mini-dot" style="background:var(--series-3)"></span> 영수증: <strong>${receiptCount}건 마감</strong>
      </span>
    </div>
    <button type="button" class="primary-btn auto-assign-btn" data-action="auto-assign-mondays" title="목표 수량에 맞춰 월요일 마감일로 자동 균등 배정합니다">
      🎯 월요일 마감 자동 배정
    </button>
  </div>`;
}

function renderMonthlyHospitalSummary(hospital, year, month) {
  const tasks = getTasksForCalendarMonth(hospital.id, year, month);
  const quota = getEffectiveQuota(hospital, monthKey(year, month));

  let totalTarget = 0;
  let totalDone = 0;

  const rowsHtml = TYPE_KEYS.map((type) => {
    const meta = TYPE_META[type];
    const deadlineCount = tasks.filter((task) => task.type === type && task.deadline?.startsWith(monthKey(year, month))).length;
    const publishedCount = tasks.filter((task) => task.type === type && isPublishedStatus(task.status) && task.publishedDate?.startsWith(monthKey(year, month))).length;
    const target = Number(quota[type]) || 0;
    const pct = target > 0 ? Math.min(100, Math.round((publishedCount / target) * 100)) : (publishedCount > 0 ? 100 : 0);
    totalTarget += target;
    totalDone += publishedCount;
    return `
    <div class="monthly-stat-row">
      <span class="mini-dot" style="background:${meta.color}"></span>
      <span class="monthly-stat-label">${esc(meta.short)}</span>
      <span class="monthly-stat-track"><span class="monthly-stat-fill" style="width:${pct}%;background:${meta.color}"></span></span>
      <span class="monthly-stat-frac">${publishedCount}<small>/${target}</small></span>
      <span class="monthly-stat-deadline">마감 ${deadlineCount}</span>
    </div>`;
  }).join('');

  const overallPct = totalTarget > 0 ? Math.min(100, Math.round((totalDone / totalTarget) * 100)) : (totalDone > 0 ? 100 : 0);

  return `
  <div class="monthly-hospital-card" data-action="open-hospital" data-id="${hospital.id}">
    <div class="monthly-hospital-head">
      <strong>${esc(hospital.name)}</strong>
      <div class="monthly-hospital-ring" style="--pct:${overallPct}" title="전체 진행률 ${overallPct}%">
        <span>${overallPct}%</span>
      </div>
    </div>
    <div class="monthly-hospital-stats">
      ${rowsHtml}
    </div>
  </div>`;
}

function renderHomeEventChip(task, kind) {
  const meta = TYPE_META[task.type] || TYPE_META.brandBlog;
  const isPublish = kind === 'publish';
  return `
  <span class="home-event-chip ${isPublish ? 'is-published' : 'is-deadline'}" style="--chip-color:${meta.color}"
    title="${esc(meta.label)} ${isPublish ? '발행완료' : `마감 · ${task.status}`}">
    ${esc(meta.short)} ${isPublish ? '발행 ✓' : '마감'}
  </span>`;
}

function renderHomeCalendar(year, month) {
  const monthStart = new Date(year, month - 1, 1);
  const monthEnd = new Date(year, month - 1, daysInMonth(year, month));
  const cells = buildCycleCells(monthStart, monthEnd);
  const monthPrefix = monthKey(year, month);
  const monthlyTasks = db.hospitals.flatMap((hospital) => getTasksForCalendarMonth(hospital.id, year, month));

  const cellsHtml = cells.map((date) => {
    const dateStr = fmtDateStr(date);
    const isCurrentMonth = dateStr.startsWith(monthPrefix);
    const isToday = dateStr === TODAY_STR;
    const hospitalGroups = isCurrentMonth ? db.hospitals.map((hospital) => {
      const tasks = monthlyTasks.filter((task) => task.hospitalId === hospital.id);
      const events = [
        ...tasks.filter((task) => task.status === '발행완료' && task.publishedDate === dateStr)
          .map((task) => ({ task, kind: 'publish' })),
        ...tasks.filter((task) => task.deadline === dateStr && task.publishedDate !== dateStr)
          .map((task) => ({ task, kind: 'deadline' })),
      ];
      if (!events.length) return '';
      return `
      <div class="home-hospital-sector" data-action="open-hospital" data-id="${hospital.id}" data-date="${dateStr}">
        <div class="home-sector-name">${esc(hospital.name)}</div>
        <div class="home-sector-events">${events.map(({ task, kind }) => renderHomeEventChip(task, kind)).join('')}</div>
      </div>`;
    }).join('') : '';
    return `
    <div class="home-calendar-cell ${isCurrentMonth ? '' : 'outside'} ${isToday ? 'today' : ''}">
      <div class="home-calendar-day">${date.getDate()}</div>
      <div class="home-calendar-sectors">${hospitalGroups}</div>
    </div>`;
  }).join('');

  return `
  <section class="home-calendar-section">
    <div class="home-calendar-head">
      <div>
        <div class="section-title">${monthLabel(year, month)} 통합 작업 달력</div>
        <div class="home-calendar-description">이번 달 마감 작업과 이번 달 발행 작업을 병원별로 모아 표시합니다.</div>
      </div>
      <div class="home-calendar-legend">
        <span><i class="deadline-sample"></i>마감</span>
        <span><i class="publish-sample"></i>발행완료</span>
      </div>
    </div>
    <div class="home-calendar-scroll">
      <div class="home-calendar-grid">
        ${DOW_LABELS.map((day) => `<div class="home-calendar-dow">${day}</div>`).join('')}
        ${cellsHtml}
      </div>
    </div>
  </section>`;
}

function renderListView() {
  if (db.hospitals.length === 0) {
    return `
    <div class="empty-state onboarding-card">
      <div class="onboarding-icon">🏥</div>
      <h2 class="onboarding-title">네이버 마케팅 작업 트래커에 오신 것을 환영합니다!</h2>
      <p class="onboarding-desc">아직 등록된 병원(업체)이 없습니다.<br>새 병원을 추가하여 월별/주기별 목표 수량과 발행 일정을 편리하게 관리해 보세요.</p>
      <div class="onboarding-actions">
        <button class="primary-btn btn-lg" data-action="add-hospital">✨ 새 병원 추가하고 시작하기</button>
        <button class="ghost-btn" data-action="import-data">📁 기존 백업 파일 불러오기</button>
      </div>
    </div>`;
  }
  const year = today.getFullYear();
  const month = today.getMonth() + 1;
  return `
  ${renderMondayBoard()}
  <div class="list-toolbar">
    <div>
      <div class="section-title">${monthLabel(year, month)} 전체 병원 현황</div>
      <div class="home-summary-caption">숫자는 이번 달 발행량 / 목표량이며, 정산 주기와 별도로 달력 월 기준으로 집계됩니다.</div>
    </div>
    <button class="primary-btn" data-action="add-hospital">+ 병원 추가</button>
  </div>
  <div class="monthly-hospital-grid">
    ${db.hospitals.map((hospital) => renderMonthlyHospitalSummary(hospital, year, month)).join('')}
  </div>
  ${renderHomeCalendar(year, month)}`;
}

/* ==================== 렌더링 : 병원 상세 화면 ==================== */

function renderQuotaSection(hospital, year, month) {
  const ymKey = monthKey(year, month);
  return `
  <div class="quota-section">
    <div class="quota-section-head">
      <div class="section-title">${periodWord(hospital, year, month)} 할당량</div>
      <button class="ghost-btn" data-action="edit-quota">목표 수정</button>
    </div>
    <div class="stat-tiles">
      ${TYPE_KEYS.map((type) => {
        const quota = getEffectiveQuota(hospital, ymKey);
        const target = Number(quota[type]) || 0;
        const done = getCompletedCount(hospital, year, month, type);
        const pct = target > 0 ? Math.min(100, Math.round((done / target) * 100)) : (done > 0 ? 100 : 0);
        const meta = TYPE_META[type];
        return `
        <div class="stat-tile">
          <div class="stat-tile-head">
            <span class="stat-dot" style="background:${meta.color}"></span>
            <span class="stat-label">${esc(meta.label)}</span>
          </div>
          <div class="stat-value">${done}<span class="stat-value-sep">/</span>${target}</div>
          <div class="progress-track"><div class="progress-fill" style="width:${pct}%;background:${meta.color}"></div></div>
        </div>`;
      }).join('')}
    </div>
  </div>`;
}

function buildCycleCells(start, end) {
  const gridStart = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  gridStart.setDate(gridStart.getDate() - gridStart.getDay());
  const gridEnd = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  gridEnd.setDate(gridEnd.getDate() + (6 - gridEnd.getDay()));
  const cells = [];
  const cur = new Date(gridStart);
  while (cur.getTime() <= gridEnd.getTime()) {
    cells.push(new Date(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return cells;
}

function renderChip(task, kind) {
  const meta = TYPE_META[task.type];
  if (kind === 'publish') {
    return `<span class="chip chip-publish" style="--chip-color:${meta.color}" title="${esc(meta.label)} 발행완료">${esc(meta.short)} 발행 ✓</span>`;
  }
  const done = isPublishedStatus(task.status);
  return `<span class="chip chip-deadline ${done ? 'chip-done' : ''}" style="--chip-color:${meta.color}" title="${esc(meta.label)} 마감 (${esc(task.status)})">${esc(meta.short)} 마감${done ? ' ✓' : ''}</span>`;
}

function renderCalendarSection(hospital, year, month) {
  const { start, end } = getCycleRange(hospital, year, month);
  const startStr = fmtDateStr(start);
  const endStr = fmtDateStr(end);
  const cells = buildCycleCells(start, end);
  const hospitalTasks = db.tasks.filter((t) => t.hospitalId === hospital.id);

  const dayCellsHtml = cells.map((date) => {
    const dateStr = fmtDateStr(date);
    const isToday = dateStr === TODAY_STR;
    const inCycle = dateStr >= startStr && dateStr <= endStr;
    const deadlineTasks = hospitalTasks.filter((t) => t.deadline === dateStr && t.publishedDate !== dateStr);
    const publishTasks = hospitalTasks.filter((t) => isPublishedStatus(t.status) && t.publishedDate === dateStr);
    const chips = [
      ...publishTasks.map((t) => ({ t, kind: 'publish' })),
      ...deadlineTasks.map((t) => ({ t, kind: 'deadline' })),
    ];
    const shown = chips.slice(0, 3);
    const overflow = chips.length - shown.length;
    const monthTag = date.getDate() === 1 ? `<span class="calendar-month-tag">${date.getMonth() + 1}월</span>` : '';
    return `
    <div class="calendar-cell ${isToday ? 'today' : ''} ${inCycle ? '' : 'outside'}">
      <div class="calendar-daynum">${monthTag}${date.getDate()}</div>
      ${shown.map((c) => renderChip(c.t, c.kind)).join('')}
      ${overflow > 0 ? `<span class="chip-more">+${overflow}</span>` : ''}
    </div>`;
  }).join('');

  return `
  <div class="calendar-section">
    <div class="calendar-legend">
      <span><span class="legend-dot" style="background:var(--series-1)"></span>브랜드 블로그</span>
      <span><span class="legend-dot" style="background:var(--series-2)"></span>기자단</span>
      <span><span class="legend-dot" style="background:var(--series-3)"></span>영수증 리뷰</span>
      <span>· 옅은 색=마감 목표, 진한 색=발행완료</span>
      <span>· 흐린 날짜=이번 주기 범위 밖</span>
    </div>
    <div class="calendar-grid">
      ${DOW_LABELS.map((d) => `<div class="calendar-dow">${d}</div>`).join('')}
      ${dayCellsHtml}
    </div>
  </div>`;
}

function renderTaskRow(task) {
  const typeOptions = TYPE_KEYS.map((key) => `<option value="${key}" ${task.type === key ? 'selected' : ''}>${esc(TYPE_META[key].label)}</option>`).join('');
  const statusOptions = STATUS_LIST.map((s) => `<option value="${esc(s)}" ${task.status === s ? 'selected' : ''}>${esc(s)}</option>`).join('');
  
  const isPublished = isPublishedStatus(task.status);
  const publishedCell = isPublished
    ? `<input type="date" class="cell-input" data-field="publishedDate" value="${esc(task.publishedDate || '')}">`
    : `<span class="cell-dash">-</span>`;

  const isReceipt = task.type === 'receipt';
  const keywordCell = isReceipt
    ? `<span class="receipt-keyword-disabled">미사용</span>`
    : `<input type="text" class="cell-input" data-field="keyword" placeholder="키워드 입력" value="${esc(task.keyword || '')}">`;

  let volumeCell = `<span class="cell-dash">-</span>`;
  let docsCell = `<span class="cell-dash">-</span>`;
  let compCell = `<span class="comp-badge is-na">미사용</span>`;

  if (!isReceipt) {
    volumeCell = `<input type="number" class="cell-input num-input" data-field="keywordVolume" placeholder="0" min="0" value="${task.keywordVolume ?? ''}">`;
    docsCell = `<input type="number" class="cell-input num-input" data-field="keywordDocs" placeholder="0" min="0" value="${task.keywordDocs ?? ''}">`;
    
    if (task.keywordVolume !== null && task.keywordVolume !== undefined && Number(task.keywordVolume) > 0) {
      const vol = Number(task.keywordVolume);
      const docs = Number(task.keywordDocs || 0);
      const comp = docs / vol;
      const formattedComp = Number.isInteger(comp) ? comp.toString() : (Math.round(comp * 10000) / 10000).toString();
      compCell = `<span class="comp-badge" title="경쟁도 = 발행량 (${docs}) / 검색량 (${vol})">${formattedComp}</span>`;
    } else {
      compCell = `<span class="comp-badge is-na">-</span>`;
    }
  }

  return `
  <tr data-task-id="${task.id}">
    <td class="delete-task-cell"><button class="icon-btn danger-btn" data-action="delete-task" title="삭제" aria-label="작업 삭제">✕</button></td>
    <td><select class="cell-input type-select type-${task.type}" data-field="type">${typeOptions}</select></td>
    <td>${keywordCell}</td>
    <td><input type="date" class="cell-input" data-field="deadline" value="${esc(task.deadline || '')}"></td>
    <td><select class="cell-input status-select" data-status="${esc(task.status)}" data-field="status">${statusOptions}</select></td>
    <td>${publishedCell}</td>
    <td>${volumeCell}</td>
    <td>${docsCell}</td>
    <td>${compCell}</td>
    <td><input type="text" class="cell-input performance-input" data-field="performance" placeholder="예: 블로그탭 1위" value="${esc(task.performance || '')}"></td>
  </tr>`;
}

function renderTrackerSection(hospital, year, month) {
  const savedOrder = taskOrder[`${hospital.id}::${monthKey(year, month)}`] || [];
  const savedPositions = new Map(savedOrder.map((id, index) => [id, index]));
  const tasks = getTasksForCycle(hospital, year, month)
    .map((task, index) => ({ task, index, savedPosition: savedPositions.get(task.id) }))
    .sort((a, b) => {
      const aSaved = a.savedPosition !== undefined;
      const bSaved = b.savedPosition !== undefined;
      if (aSaved && bSaved) return a.savedPosition - b.savedPosition;
      if (aSaved !== bSaved) return aSaved ? -1 : 1;
      const aCreated = typeof a.task.createdAt === 'number' ? a.task.createdAt : Number.NEGATIVE_INFINITY;
      const bCreated = typeof b.task.createdAt === 'number' ? b.task.createdAt : Number.NEGATIVE_INFINITY;
      return aCreated - bCreated || a.index - b.index;
    })
    .map(({ task }) => task);
  const word = periodWord(hospital, year, month);
  return `
  <div class="tracker-section ${state.trackerExpanded ? 'is-expanded' : ''}">
    <div class="tracker-section-head" data-action="toggle-tracker-expand" title="${state.trackerExpanded ? '원래 크기로 보기' : '크게 보기'}">
      <div class="section-title tracker-expand-title">
        ${word} 작업 트래커
        <span class="tracker-expand-icon" aria-hidden="true">${state.trackerExpanded ? '↙' : '↗'}</span>
      </div>
      <div class="tracker-head-actions">
        ${state.trackerExpanded ? `<button class="ghost-btn" data-action="toggle-tracker-expand">축소</button>` : ''}
        <button class="ghost-btn" data-action="add-task" data-type="receipt">+ 영수증 리뷰 추가</button>
        <button class="primary-btn" data-action="add-task" data-type="brandBlog">+ 작업 추가</button>
      </div>
    </div>
    <div class="table-scroll">
      <table class="tracker-table">
        <thead>
          <tr>
            <th class="delete-task-head"><span class="sr-only">삭제</span></th>
            <th>발행 종류</th>
            <th>키워드</th>
            <th>마감일</th>
            <th>진행상황</th>
            <th>발행일</th>
            <th>검색량</th>
            <th>발행량</th>
            <th>경쟁도</th>
            <th>성과</th>
          </tr>
        </thead>
        <tbody id="trackerTbody">
          ${tasks.length ? tasks.map(renderTaskRow).join('') : ''}
        </tbody>
      </table>
      ${tasks.length === 0 ? `<div class="tracker-empty">${word} 작업이 없습니다. "+ 작업 추가"로 시작하세요.</div>` : ''}
    </div>
  </div>`;
}

function renderKeywordItem(task) {
  const meta = TYPE_META[task.type];
  const vol = task.keywordVolume;
  const docs = task.keywordDocs;
  const gap = task.keywordGap;
  return `
  <div class="keyword-item">
    <div class="keyword-item-head">
      <span class="mini-dot" style="background:${meta.color}"></span>
      <span class="keyword-item-text">${esc(task.keyword)}</span>
    </div>
    <div class="keyword-item-stats">
      <span>검색량 <strong>${vol === null || vol === undefined ? '-' : vol}</strong></span>
      <span>발행량 <strong>${docs === null || docs === undefined ? '-' : docs}</strong></span>
    </div>
  </div>`;
}

function renderPoolChip(item) {
  return `
  <div class="pool-chip" data-action="edit-pool-item" data-id="${item.id}">
    <button type="button" class="chip-x" data-action="delete-pool-item" data-id="${item.id}" title="삭제">×</button>
    <div class="pool-chip-text">${esc(item.keyword)}</div>
    <div class="pool-chip-stats">
      <span>검색 <strong>${item.volume ?? '-'}</strong></span>
      <span>발행 <strong>${item.docs ?? '-'}</strong></span>
    </div>
  </div>`;
}

function renderKeywordPoolSection(hospital) {
  const items = getHospitalTags(hospital.id, 'search');
  return `
  <div class="keyword-pool-block">
    <div class="keyword-pool-head">
      <div class="keyword-banner-subtitle">키워드 풀</div>
      <button type="button" class="icon-btn" data-action="add-pool-item" title="키워드 추가">+</button>
    </div>
    <div class="pool-chip-list">
      ${items.map(renderPoolChip).join('')}
      ${items.length === 0 ? `<div class="keyword-empty">아직 저장된 키워드가 없습니다.<br>발행에 쓰지 않아도 미리 모아둘 수 있어요.</div>` : ''}
    </div>
  </div>`;
}

function renderKeywordBanner(hospital) {
  const items = db.tasks
    .filter((t) => t.hospitalId === hospital.id && t.type !== 'receipt' && t.keyword && t.keyword.trim())
    .slice()
    .sort((a, b) => {
      const ca = a.createdAt || 0;
      const cb = b.createdAt || 0;
      if (cb !== ca) return cb - ca;
      return (b.deadline || '').localeCompare(a.deadline || '');
    })
    .slice(0, 40);

  return `
  <aside class="keyword-banner">
    <div class="keyword-banner-title">최근 ${esc(hospital.name)}의 키워드</div>
    ${items.length === 0
      ? `<div class="keyword-empty">아직 입력된 키워드가 없습니다.<br>트래커에서 키워드를 입력해보세요.</div>`
      : `<div class="keyword-list">${items.map(renderKeywordItem).join('')}</div>`}
    ${renderKeywordPoolSection(hospital)}
  </aside>`;
}

function renderCreds(hospital) {
  const id = hospital.naverId || '';
  const pw = hospital.naverPassword || '';
  const pwShown = state.pwVisible ? (pw || '-') : (pw ? '•'.repeat(Math.min(pw.length, 12)) : '-');
  return `
  <div class="detail-creds">
    <span class="cred-item">
      <span class="cred-key">네이버 아이디</span>
      <strong class="cred-val">${esc(id || '-')}</strong>
      <button class="icon-btn" data-action="copy-naver-id" title="아이디 복사">⧉</button>
    </span>
    <span class="cred-item">
      <span class="cred-key">비밀번호</span>
      <strong class="cred-val">${esc(pwShown)}</strong>
      <button class="icon-btn" data-action="toggle-pw" title="${state.pwVisible ? '숨기기' : '보기'}">${state.pwVisible ? '🙈' : '👁'}</button>
      <button class="icon-btn" data-action="copy-naver-pw" title="비밀번호 복사">⧉</button>
    </span>
  </div>`;
}

function renderQuickLinks(hospital) {
  const links = [];
  if (hospital.naverBlogUrl) {
    links.push(`<a class="ghost-btn link-btn" href="${esc(hospital.naverBlogUrl)}" target="_blank" rel="noopener noreferrer">블로그 바로가기 ↗</a>`);
  }
  if (hospital.naverMapUrl) {
    links.push(`<a class="ghost-btn link-btn" href="${esc(hospital.naverMapUrl)}" target="_blank" rel="noopener noreferrer">지도 바로가기 ↗</a>`);
  }
  if (links.length === 0) return '';
  return `<div class="detail-links">${links.join('')}</div>`;
}

function renderTextChip(item) {
  return `
  <div class="tag-chip" data-action="edit-tag-item" data-id="${item.id}">
    <span class="tag-chip-text">${esc(item.keyword)}</span>
    <button type="button" class="chip-x tag-chip-x" data-action="delete-tag-item" data-id="${item.id}" title="삭제">×</button>
  </div>`;
}

function renderTagGroup(hospital, kind, title) {
  const items = getHospitalTags(hospital.id, kind);
  return `
  <div class="tag-group">
    <div class="tag-group-head">
      <span class="tag-group-title">${esc(title)}</span>
      <button type="button" class="icon-btn" data-action="add-tag-item" data-kind="${kind}" title="${esc(title)} 추가">+</button>
    </div>
    <div class="tag-chip-list">
      ${items.map(renderTextChip).join('')}
      ${items.length === 0 ? `<span class="tag-empty">없음</span>` : ''}
    </div>
  </div>`;
}

function renderLocationProcedureSection(hospital) {
  return `
  <div class="tag-section">
    ${renderTagGroup(hospital, 'location', '위치 키워드')}
    ${renderTagGroup(hospital, 'procedure', '시술질환 키워드')}
  </div>`;
}

function renderDetailView() {
  const hospital = getHospital(state.hospitalId);
  if (!hospital) { state.view = 'list'; return renderListView(); }
  const anchor = getCurrentCycleAnchor(hospital, today);
  const isCurrentCycle = state.year === anchor.year && state.month === anchor.month;

  return `
  <div class="detail-head">
    <div>
      <div class="detail-title-row">
        <div class="detail-title">${esc(hospital.name)}</div>
        ${hospital.autoAssignPaused ? `<span class="paused-badge" title="자동 배정이 일시중지되어 있습니다">일시중지</span>` : ''}
        <button class="icon-btn" data-action="edit-hospital" data-id="${hospital.id}" title="병원 정보 수정">⚙</button>
      </div>
      ${renderCreds(hospital)}
      ${renderQuickLinks(hospital)}
      ${renderLocationProcedureSection(hospital)}
    </div>
    <div class="month-nav">
      <button class="icon-btn" data-action="prev-month">◀</button>
      <span class="month-nav-label">${cycleLabel(hospital, state.year, state.month)}</span>
      <button class="icon-btn" data-action="next-month">▶</button>
      ${!isCurrentCycle ? `<button class="ghost-btn" data-action="today-month">${periodWord(hospital)}</button>` : ''}
    </div>
  </div>
  <div class="detail-body">
    <div class="detail-main">
      ${renderDeadlineSummary(hospital, state.year, state.month)}
      ${renderQuotaSection(hospital, state.year, state.month)}
      ${renderCalendarSection(hospital, state.year, state.month)}
      ${renderTrackerSection(hospital, state.year, state.month)}
    </div>
    ${renderKeywordBanner(hospital)}
  </div>
  `;
}

/* ==================== 전체 렌더 ==================== */

function render() {
  if (state.view === 'detail' && !getHospital(state.hospitalId)) {
    state.view = 'list';
    state.hospitalId = null;
  }
  const app = document.getElementById('app');
  app.innerHTML = renderHeader() + (state.view === 'list' ? renderListView() : renderDetailView());
  document.body.classList.toggle('tracker-expanded', !!state.trackerExpanded);
  attachListeners();
}

/* ==================== 모달 ==================== */

function openModal(html) {
  const modalRoot = document.getElementById('modalRoot');
  modalRoot.innerHTML = `<div class="modal-backdrop"><div class="modal-card" role="dialog">${html}</div></div>`;
  modalRoot.querySelector('.modal-backdrop').addEventListener('click', (e) => {
    if (e.target.classList.contains('modal-backdrop')) closeModal();
  });
  modalRoot.querySelectorAll('[data-action="close-modal"]').forEach((button) => {
    button.addEventListener('click', closeModal);
  });
}

function closeModal() {
  document.getElementById('modalRoot').innerHTML = '';
}

function hospitalFormHtml(hospital) {
  const isEdit = !!hospital;
  const q = isEdit ? hospital.defaultQuota : { brandBlog: 0, press: 0, receipt: 0 };
  return `
  <h3>${isEdit ? '병원 정보 수정' : '병원 추가'}</h3>
  <form id="hospitalForm">
    <label>병원명
      <input type="text" name="name" required value="${isEdit ? esc(hospital.name) : ''}">
    </label>
    <div class="form-row-3">
      <label>브랜드 블로그 목표<input type="number" name="brandBlog" min="0" max="${MAX_QUOTA_PER_TYPE}" value="${q.brandBlog}"></label>
      <label>기자단 목표<input type="number" name="press" min="0" max="${MAX_QUOTA_PER_TYPE}" value="${q.press}"></label>
      <label>영수증 리뷰 목표<input type="number" name="receipt" min="0" max="${MAX_QUOTA_PER_TYPE}" value="${q.receipt}"></label>
    </div>
    <label>정산(발행) 시작일
      <input type="number" name="cycleStartDay" min="1" max="31" value="${isEdit ? (hospital.cycleStartDay || 1) : 1}">
    </label>
    <p class="helper-text">예: 25로 설정하면 매월 25일부터 다음달 24일까지를 한 주기(한달 단위)로 계산합니다. 기본값 1은 일반 달력 월(1일~말일)입니다. (단, "마감 자동 배정" 버튼은 이 설정과 무관하게 항상 달력 월 기준으로 채웁니다.)</p>
    <label class="checkbox-row">
      <input type="checkbox" name="autoAssignPaused" ${isEdit && hospital.autoAssignPaused ? 'checked' : ''}>
      자동 배정 일시중지 (기존 기록은 유지, 새로 자동 배정만 하지 않음)
    </label>
    <p class="helper-text">체크하면 "마감 자동 배정" 버튼을 눌러도 이 병원은 건너뜁니다. 수동으로 "+ 작업 추가"하는 건 그대로 가능합니다.</p>
    <label>네이버 블로그 아이디
      <input type="text" name="naverId" value="${isEdit ? esc(hospital.naverId || '') : ''}">
    </label>
    <label>네이버 블로그 비밀번호
      <div class="pw-row">
        <input type="password" name="naverPassword" id="naverPasswordInput" value="${isEdit ? esc(hospital.naverPassword || '') : ''}">
        <button type="button" class="ghost-btn" id="togglePwBtn">보기</button>
      </div>
    </label>
    <p class="helper-text">비밀번호는 이 트래커의 공유 클라우드 저장소(Supabase)에 평문으로 저장됩니다. 접속 비밀번호를 아는 사람은 누구나 볼 수 있으니 공용 컴퓨터/타인과 공유 시 주의하세요.</p>
    <div class="form-row-2">
      <label>네이버 블로그 주소<input type="text" name="naverBlogUrl" placeholder="blog.naver.com/..." value="${isEdit ? esc(hospital.naverBlogUrl || '') : ''}"></label>
      <label>네이버 지도 주소<input type="text" name="naverMapUrl" placeholder="map.naver.com/..." value="${isEdit ? esc(hospital.naverMapUrl || '') : ''}"></label>
    </div>
    <div class="modal-actions">
      ${isEdit ? `<button type="button" class="danger-btn" id="deleteHospitalBtn">병원 삭제</button>` : `<span></span>`}
      <div class="modal-actions-right">
        <button type="button" class="ghost-btn" data-action="close-modal">취소</button>
        <button type="submit" class="primary-btn">저장</button>
      </div>
    </div>
  </form>`;
}

function openHospitalForm(hospital) {
  openModal(hospitalFormHtml(hospital));
  const form = document.getElementById('hospitalForm');
  const pwInput = document.getElementById('naverPasswordInput');
  const toggleBtn = document.getElementById('togglePwBtn');
  toggleBtn.addEventListener('click', () => {
    const show = pwInput.type === 'password';
    pwInput.type = show ? 'text' : 'password';
    toggleBtn.textContent = show ? '숨기기' : '보기';
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const name = String(fd.get('name') || '').trim();
    if (!name) return;
    const defaultQuota = {
      brandBlog: Number(fd.get('brandBlog')) || 0,
      press: Number(fd.get('press')) || 0,
      receipt: Number(fd.get('receipt')) || 0,
    };
    const naverId = String(fd.get('naverId') || '').trim();
    const naverPassword = String(fd.get('naverPassword') || '');
    const naverBlogUrl = normalizeUrl(String(fd.get('naverBlogUrl') || ''));
    const naverMapUrl = normalizeUrl(String(fd.get('naverMapUrl') || ''));
    const cycleStartDay = Math.min(31, Math.max(1, Number(fd.get('cycleStartDay')) || 1));
    const autoAssignPaused = fd.get('autoAssignPaused') === 'on';
    if (hospital) {
      hospital.name = name;
      hospital.defaultQuota = defaultQuota;
      hospital.naverId = naverId;
      hospital.naverPassword = naverPassword;
      hospital.naverBlogUrl = naverBlogUrl;
      hospital.naverMapUrl = naverMapUrl;
      hospital.cycleStartDay = cycleStartDay;
      hospital.autoAssignPaused = autoAssignPaused;
    } else {
      db.hospitals.push({
        id: uuid(), name, defaultQuota, naverId, naverPassword, naverBlogUrl, naverMapUrl, cycleStartDay, autoAssignPaused, createdAt: TODAY_STR,
      });
    }
    saveData();
    closeModal();
    render();
  });
  if (hospital) {
    document.getElementById('deleteHospitalBtn').addEventListener('click', () => {
      if (!confirm(`"${hospital.name}" 병원과 관련된 모든 작업 기록을 삭제할까요? 되돌릴 수 없습니다.`)) return;
      deleteHospitalCascade(hospital.id);
      saveData();
      closeModal();
      if (state.hospitalId === hospital.id) { state.view = 'list'; state.hospitalId = null; }
      render();
    });
  }
}

function quotaFormHtml(hospital, ymKey) {
  const quota = getEffectiveQuota(hospital, ymKey);
  const hasOverride = !!db.quotaOverrides[`${hospital.id}::${ymKey}`];
  return `
  <h3>${cycleLabel(hospital, state.year, state.month)} 할당량 수정</h3>
  <form id="quotaForm">
    <label>브랜드 블로그 목표<input type="number" name="brandBlog" min="0" max="${MAX_QUOTA_PER_TYPE}" value="${Number(quota.brandBlog) || 0}"></label>
    <label>기자단 목표<input type="number" name="press" min="0" max="${MAX_QUOTA_PER_TYPE}" value="${Number(quota.press) || 0}"></label>
    <label>영수증 리뷰 목표<input type="number" name="receipt" min="0" max="${MAX_QUOTA_PER_TYPE}" value="${Number(quota.receipt) || 0}"></label>
    <div class="modal-actions">
      ${hasOverride ? `<button type="button" class="ghost-btn" id="resetQuotaBtn">기본값으로 초기화</button>` : `<span></span>`}
      <div class="modal-actions-right">
        <button type="button" class="ghost-btn" data-action="close-modal">취소</button>
        <button type="submit" class="primary-btn">저장</button>
      </div>
    </div>
  </form>`;
}

function openQuotaForm(hospital, ymKey) {
  openModal(quotaFormHtml(hospital, ymKey));
  const form = document.getElementById('quotaForm');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    db.quotaOverrides[`${hospital.id}::${ymKey}`] = {
      brandBlog: Number(fd.get('brandBlog')) || 0,
      press: Number(fd.get('press')) || 0,
      receipt: Number(fd.get('receipt')) || 0,
    };
    saveData();
    closeModal();
    render();
  });
  const resetBtn = document.getElementById('resetQuotaBtn');
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      delete db.quotaOverrides[`${hospital.id}::${ymKey}`];
      saveData();
      closeModal();
      render();
    });
  }
}

function keywordFormHtml(task) {
  const hasKeywordInfo = !!(
    (task.keyword && task.keyword.trim())
    || task.keywordVolume !== null && task.keywordVolume !== undefined
    || task.keywordDocs !== null && task.keywordDocs !== undefined
    || task.keywordGap !== null && task.keywordGap !== undefined
  );
  return `
  <h3>키워드 정보</h3>
  <form id="keywordForm">
    <label>키워드
      <input type="text" name="keyword" value="${esc(task.keyword || '')}" placeholder="예: 강남 임플란트">
    </label>
    <div class="form-row-2">
      <label>월간 검색량<input type="number" name="volume" min="0" value="${task.keywordVolume ?? ''}"></label>
      <label>월간 문서 발행수<input type="number" name="docs" min="0" value="${task.keywordDocs ?? ''}"></label>
    </div>
    <label>빈자리<input type="number" name="gap" min="0" value="${task.keywordGap ?? ''}"></label>
    <div class="modal-actions">
      ${hasKeywordInfo ? `<button type="button" class="danger-btn" id="deleteKeywordBtn">삭제</button>` : `<span></span>`}
      <div class="modal-actions-right">
        <button type="button" class="ghost-btn" data-action="close-modal">취소</button>
        <button type="submit" class="primary-btn">저장</button>
      </div>
    </div>
  </form>`;
}

function openKeywordForm(task) {
  openModal(keywordFormHtml(task));
  const form = document.getElementById('keywordForm');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    task.keyword = String(fd.get('keyword') || '').trim();
    const vol = fd.get('volume');
    const docs = fd.get('docs');
    const gap = fd.get('gap');
    task.keywordVolume = vol === '' ? null : Number(vol);
    task.keywordDocs = docs === '' ? null : Number(docs);
    task.keywordGap = gap === '' ? null : Number(gap);
    if (!task.createdAt) task.createdAt = Date.now();
    saveData();
    closeModal();
    render();
  });
  const deleteBtn = document.getElementById('deleteKeywordBtn');
  if (deleteBtn) {
    deleteBtn.addEventListener('click', () => {
      if (!confirm('이 작업의 키워드 정보를 삭제할까요?')) return;
      task.keyword = '';
      task.keywordVolume = null;
      task.keywordDocs = null;
      task.keywordGap = null;
      saveData();
      closeModal();
      render();
    });
  }
}

function poolFormHtml(item) {
  const isEdit = !!item;
  return `
  <h3>키워드 풀 ${isEdit ? '수정' : '추가'}</h3>
  <form id="poolForm">
    <label>키워드
      <input type="text" name="keyword" required value="${isEdit ? esc(item.keyword) : ''}" placeholder="예: 강남 임플란트">
    </label>
    <div class="form-row-3">
      <label>월간 검색량<input type="number" name="volume" min="0" value="${isEdit ? (item.volume ?? '') : ''}"></label>
      <label>월간 발행량<input type="number" name="docs" min="0" value="${isEdit ? (item.docs ?? '') : ''}"></label>
      <label>빈자리<input type="number" name="gap" min="0" value="${isEdit ? (item.gap ?? '') : ''}"></label>
    </div>
    <div class="modal-actions">
      ${isEdit ? `<button type="button" class="danger-btn" id="deletePoolBtn">삭제</button>` : `<span></span>`}
      <div class="modal-actions-right">
        <button type="button" class="ghost-btn" data-action="close-modal">취소</button>
        <button type="submit" class="primary-btn">저장</button>
      </div>
    </div>
  </form>`;
}

function openPoolForm(hospitalId, item) {
  openModal(poolFormHtml(item));
  const form = document.getElementById('poolForm');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const keyword = String(fd.get('keyword') || '').trim();
    if (!keyword) return;
    const vol = fd.get('volume');
    const docs = fd.get('docs');
    const gap = fd.get('gap');
    const volume = vol === '' ? null : Number(vol);
    const docsNum = docs === '' ? null : Number(docs);
    const gapNum = gap === '' ? null : Number(gap);
    if (item) {
      item.keyword = keyword;
      item.volume = volume;
      item.docs = docsNum;
      item.gap = gapNum;
    } else {
      db.tagPool.push({
        id: uuid(), hospitalId, kind: 'search', keyword, volume, docs: docsNum, gap: gapNum, createdAt: Date.now(),
      });
    }
    saveData();
    closeModal();
    render();
  });
  if (item) {
    document.getElementById('deletePoolBtn').addEventListener('click', () => {
      if (!confirm('이 키워드를 삭제할까요?')) return;
      db.tagPool = db.tagPool.filter((t) => t.id !== item.id);
      saveData();
      closeModal();
      render();
    });
  }
}

function tagFormHtml(kind, item) {
  const isEdit = !!item;
  const kindLabel = kind === 'location' ? '위치 키워드' : '시술질환 키워드';
  return `
  <h3>${esc(kindLabel)} ${isEdit ? '수정' : '추가'}</h3>
  <form id="tagForm">
    <label>키워드
      <input type="text" name="keyword" required value="${isEdit ? esc(item.keyword) : ''}" placeholder="${kind === 'location' ? '예: 강남역' : '예: 임플란트'}">
    </label>
    <div class="modal-actions">
      ${isEdit ? `<button type="button" class="danger-btn" id="deleteTagBtn">삭제</button>` : `<span></span>`}
      <div class="modal-actions-right">
        <button type="button" class="ghost-btn" data-action="close-modal">취소</button>
        <button type="submit" class="primary-btn">저장</button>
      </div>
    </div>
  </form>`;
}

function openTagForm(hospitalId, kind, item) {
  openModal(tagFormHtml(kind, item));
  const form = document.getElementById('tagForm');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const keyword = String(fd.get('keyword') || '').trim();
    if (!keyword) return;
    if (item) {
      item.keyword = keyword;
    } else {
      db.tagPool.push({ id: uuid(), hospitalId, kind, keyword, volume: null, docs: null, gap: null, createdAt: Date.now() });
    }
    saveData();
    closeModal();
    render();
  });
  if (item) {
    document.getElementById('deleteTagBtn').addEventListener('click', () => {
      if (!confirm('이 키워드를 삭제할까요?')) return;
      db.tagPool = db.tagPool.filter((t) => t.id !== item.id);
      saveData();
      closeModal();
      render();
    });
  }
}

/* ==================== 이벤트 처리 ==================== */

function handleAddTask(type) {
  const hospital = getHospital(state.hospitalId);
  if (!hospital) return;
  const anchor = getCurrentCycleAnchor(hospital, today);
  const isCurrentCycle = state.year === anchor.year && state.month === anchor.month;
  let deadline;
  if (isCurrentCycle) {
    deadline = TODAY_STR;
  } else {
    const { start } = getCycleRange(hospital, state.year, state.month);
    deadline = fmtDateStr(start);
  }
  const isReceipt = type === 'receipt';
  db.tasks.push({
    id: uuid(),
    hospitalId: state.hospitalId,
    type: TYPE_KEYS.includes(type) ? type : 'brandBlog',
    keyword: isReceipt ? null : '',
    keywordVolume: null,
    keywordDocs: null,
    keywordGap: null,
    deadline,
    status: '작성 전',
    publishedDate: null,
    publishedUrl: '',
    performance: '',
    createdAt: Date.now(),
  });
  saveData();
  render();
}

function handleTrackerChange(e) {
  const field = e.target.dataset.field;
  if (!field) return;
  const tr = e.target.closest('tr');
  const task = db.tasks.find((t) => t.id === tr.dataset.taskId);
  if (!task) return;
  if (field === 'type') {
    task.type = e.target.value;
    if (task.type === 'receipt') {
      task.keyword = null;
      task.keywordVolume = null;
      task.keywordDocs = null;
      task.keywordGap = null;
    }
  } else if (field === 'status') {
    task.status = e.target.value;
    if (isPublishedStatus(task.status)) {
      if (!task.publishedDate) task.publishedDate = TODAY_STR;
    } else {
      task.publishedDate = null;
    }
  } else if (field === 'publishedDate') {
    task.publishedDate = e.target.value || null;
  } else if (field === 'keywordVolume' || field === 'keywordDocs') {
    const val = e.target.value;
    task[field] = val === '' ? null : Math.max(0, Number(val));
  } else {
    task[field] = e.target.value;
  }
  saveData();
  render();
}

function handleTrackerClick(e) {
  const delBtn = e.target.closest('[data-action="delete-task"]');
  if (delBtn) {
    const tr = delBtn.closest('tr');
    const id = tr.dataset.taskId;
    if (!confirm('이 작업 항목을 삭제할까요?')) return;
    db.tasks = db.tasks.filter((t) => t.id !== id);
    saveData();
    render();
    return;
  }
  const kwBtn = e.target.closest('[data-action="edit-keyword"]');
  if (kwBtn) {
    const tr = kwBtn.closest('tr');
    const task = db.tasks.find((t) => t.id === tr.dataset.taskId);
    if (task) openKeywordForm(task);
  }
}

function fallbackCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); } catch (e) { /* noop */ }
  document.body.removeChild(ta);
}

function copyToClipboard(text) {
  if (!text) return;
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
  } else {
    fallbackCopy(text);
  }
}

function exportDataFile() {
  const blob = new Blob([JSON.stringify(db, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `naver-tracker-backup-${TODAY_STR}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function importDataFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result);
      if (!parsed || !Array.isArray(parsed.hospitals)) throw new Error('invalid');
      if (!confirm('현재 데이터를 가져온 파일 내용으로 덮어씁니다. 계속할까요?')) return;
      db = {
        hospitals: Array.isArray(parsed.hospitals) ? parsed.hospitals : [],
        quotaOverrides: parsed.quotaOverrides && typeof parsed.quotaOverrides === 'object' ? parsed.quotaOverrides : {},
        tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [],
        tagPool: Array.isArray(parsed.tagPool) ? parsed.tagPool : [],
      };
      saveData();
      state = { view: 'list', hospitalId: null, year: today.getFullYear(), month: today.getMonth() + 1 };
      render();
      alert('가져오기가 완료되었습니다.');
    } catch (err) {
      alert('올바른 백업 파일이 아닙니다.');
    }
  };
  reader.readAsText(file);
}

function attachListeners() {
  const tbody = document.getElementById('trackerTbody');
  if (tbody) {
    tbody.addEventListener('change', handleTrackerChange);
    tbody.addEventListener('click', handleTrackerClick);
    attachTaskReordering(tbody);
  }
}

function attachTaskReordering(tbody) {
  let pressTimer = null;
  let pressedRow = null;
  let draggingRow = null;
  let activePointerId = null;
  let suppressNextClick = false;
  let startX = 0;
  let startY = 0;

  const clearPress = () => {
    if (pressTimer) clearTimeout(pressTimer);
    pressTimer = null;
    pressedRow = null;
  };

  tbody.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const row = e.target.closest('tr[data-task-id]');
    if (!row) return;
    pressedRow = row;
    activePointerId = e.pointerId;
    startX = e.clientX;
    startY = e.clientY;
    pressTimer = setTimeout(() => {
      if (pressedRow !== row) return;
      draggingRow = row;
      row.classList.add('is-reordering');
      document.body.classList.add('task-reordering');
      try { tbody.setPointerCapture(activePointerId); } catch (err) { /* unsupported */ }
      if (navigator.vibrate) navigator.vibrate(25);
    }, LONG_PRESS_MS);
  });

  tbody.addEventListener('pointermove', (e) => {
    if (!pressedRow && !draggingRow) return;
    if (!draggingRow) {
      if (Math.hypot(e.clientX - startX, e.clientY - startY) > 8) clearPress();
      return;
    }
    e.preventDefault();
    const target = document.elementFromPoint(e.clientX, e.clientY)?.closest('tr[data-task-id]');
    if (!target || target === draggingRow || target.parentElement !== tbody) return;
    const rect = target.getBoundingClientRect();
    if (e.clientY < rect.top + rect.height / 2) {
      tbody.insertBefore(draggingRow, target);
    } else {
      tbody.insertBefore(draggingRow, target.nextSibling);
    }
  });

  const finishReorder = () => {
    clearPress();
    if (!draggingRow) return;
    suppressNextClick = true;
    setTimeout(() => { suppressNextClick = false; }, 500);
    draggingRow.classList.remove('is-reordering');
    document.body.classList.remove('task-reordering');
    try {
      if (activePointerId !== null && tbody.hasPointerCapture(activePointerId)) tbody.releasePointerCapture(activePointerId);
    } catch (err) { /* unsupported */ }
    activePointerId = null;
    draggingRow = null;
    saveCurrentTaskOrder();
  };

  tbody.addEventListener('click', (e) => {
    if (!suppressNextClick) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    suppressNextClick = false;
  }, true);

  tbody.addEventListener('pointerup', finishReorder);
  tbody.addEventListener('pointercancel', finishReorder);
  tbody.addEventListener('pointerleave', () => {
    if (!draggingRow) clearPress();
  });
}

function onAppClick(e) {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const action = el.dataset.action;
  const id = el.dataset.id;

  switch (action) {
    case 'go-list':
      state.view = 'list';
      state.hospitalId = null;
      state.trackerExpanded = false;
      render();
      break;
    case 'export-data':
      exportDataFile();
      break;
    case 'import-data':
      document.getElementById('importFileInput').click();
      break;
    case 'clear-all-data': {
      if (!confirm('정말로 모든 병원 및 작업 데이터를 초기화(전체 삭제)할까요?\n\n※ 삭제된 데이터는 복구할 수 없으니 필요한 경우 미리 [내보내기]로 백업해 두세요.')) return;
      db = { hospitals: [], quotaOverrides: {}, tasks: [], tagPool: [] };
      taskOrder = {};
      saveData();
      localStorage.removeItem(TASK_ORDER_KEY);
      state.view = 'list';
      state.hospitalId = null;
      state.trackerExpanded = false;
      render();
      alert('모든 데이터가 초기화되었습니다.');
      break;
    }
    case 'toggle-theme':
      currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = currentTheme;
      localStorage.setItem(THEME_KEY, currentTheme);
      render();
      break;
    case 'add-hospital':
      openHospitalForm(null);
      break;
    case 'edit-hospital':
      openHospitalForm(getHospital(id));
      break;
    case 'delete-hospital': {
      const h = getHospital(id);
      if (!h) return;
      if (!confirm(`"${h.name}" 병원과 관련된 모든 작업 기록을 삭제할까요? 되돌릴 수 없습니다.`)) return;
      deleteHospitalCascade(id);
      saveData();
      if (state.hospitalId === id) { state.view = 'list'; state.hospitalId = null; }
      render();
      break;
    }
    case 'open-hospital': {
      const h = getHospital(id);
      // 클릭한 요소에 특정 날짜(data-date)가 실려있으면(마감 보드 셀, 달력 칸 등)
      // "오늘" 기준이 아니라 그 날짜가 속한 실제 주기로 바로 이동한다.
      const dateAttr = el.dataset.date;
      const refDate = dateAttr ? new Date(dateAttr) : today;
      const anchor = h ? getCurrentCycleAnchor(h, refDate) : { year: today.getFullYear(), month: today.getMonth() + 1 };
      state.view = 'detail';
      state.hospitalId = id;
      state.year = anchor.year;
      state.month = anchor.month;
      state.pwVisible = false;
      state.trackerExpanded = false;
      render();
      break;
    }
    case 'switch-hospital': {
      const h = getHospital(id);
      const anchor = h ? getCurrentCycleAnchor(h, today) : { year: today.getFullYear(), month: today.getMonth() + 1 };
      state.hospitalId = id;
      state.year = anchor.year;
      state.month = anchor.month;
      state.pwVisible = false;
      state.trackerExpanded = false;
      render();
      break;
    }
    case 'auto-assign-mondays': {
      const h = getHospital(state.hospitalId);
      if (h) {
        if (confirm(`"${h.name}" 병원의 목표 수량(브랜드, 기자단, 영수증)에 맞게 이번달의 월요일 마감일을 자동 분배할까요?`)) {
          autoAssignMondays(h, state.year, state.month);
        }
      }
      break;
    }
    case 'auto-assign-all-mondays': {
      if (confirm(`모든 병원의 목표 수량을 이번달(달력 월) 기준으로 월요일 마감일에 골고루 자동 배정하시겠습니까? (자동 배정 일시중지된 병원은 제외됩니다)`)) {
        autoAssignAllHospitalsMondays(state.year, state.month);
      }
      break;
    }
    case 'main-prev-month':
      state.month -= 1;
      if (state.month < 1) { state.month = 12; state.year -= 1; }
      if (state.year < 2026 || (state.year === 2026 && state.month < 6)) {
        state.year = 2026;
        state.month = 6;
      }
      render();
      break;
    case 'main-next-month':
      state.month += 1;
      if (state.month > 12) { state.month = 1; state.year += 1; }
      render();
      break;
    case 'main-today-month':
      state.year = today.getFullYear();
      state.month = today.getMonth() + 1;
      render();
      break;
    case 'prev-week':
      state.weeklyOffset = (state.weeklyOffset || 0) - 1;
      render();
      break;
    case 'next-week':
      state.weeklyOffset = (state.weeklyOffset || 0) + 1;
      render();
      break;
    case 'today-week':
      state.weeklyOffset = 0;
      render();
      break;
    case 'prev-month':
      state.month -= 1;
      if (state.month < 1) { state.month = 12; state.year -= 1; }
      render();
      break;
    case 'next-month':
      state.month += 1;
      if (state.month > 12) { state.month = 1; state.year += 1; }
      render();
      break;
    case 'today-month': {
      const h = getHospital(state.hospitalId);
      const anchor = h ? getCurrentCycleAnchor(h, today) : { year: today.getFullYear(), month: today.getMonth() + 1 };
      state.year = anchor.year;
      state.month = anchor.month;
      render();
      break;
    }
    case 'edit-quota':
      openQuotaForm(getHospital(state.hospitalId), monthKey(state.year, state.month));
      break;
    case 'toggle-pw':
      state.pwVisible = !state.pwVisible;
      render();
      break;
    case 'copy-naver-id': {
      const h = getHospital(state.hospitalId);
      if (h) copyToClipboard(h.naverId || '');
      break;
    }
    case 'copy-naver-pw': {
      const h = getHospital(state.hospitalId);
      if (h) copyToClipboard(h.naverPassword || '');
      break;
    }
    case 'add-task':
      handleAddTask(el.dataset.type || 'brandBlog');
      break;
    case 'toggle-tracker-expand':
      state.trackerExpanded = !state.trackerExpanded;
      render();
      break;
    case 'add-pool-item':
      if (state.hospitalId) openPoolForm(state.hospitalId, null);
      break;
    case 'edit-pool-item': {
      const item = db.tagPool.find((t) => t.id === id);
      if (item) openPoolForm(item.hospitalId, item);
      break;
    }
    case 'delete-pool-item':
      db.tagPool = db.tagPool.filter((t) => t.id !== id);
      saveData();
      render();
      break;
    case 'add-tag-item': {
      const kind = el.dataset.kind;
      if (state.hospitalId && kind) openTagForm(state.hospitalId, kind, null);
      break;
    }
    case 'edit-tag-item': {
      const item = db.tagPool.find((t) => t.id === id);
      if (item) openTagForm(item.hospitalId, item.kind, item);
      break;
    }
    case 'delete-tag-item':
      db.tagPool = db.tagPool.filter((t) => t.id !== id);
      saveData();
      render();
      break;
    case 'close-modal':
      closeModal();
      break;
    default:
      break;
  }
}

document.getElementById('importFileInput').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file) importDataFile(file);
  e.target.value = '';
});

document.getElementById('app').addEventListener('click', onAppClick);

function closeScreensaver() {
  const root = document.getElementById('screensaverRoot');
  if (!root || !root.firstChild) return;
  root.innerHTML = '';
  document.body.classList.remove('screensaver-active');
  document.removeEventListener('keydown', closeScreensaver);
}

function openScreensaver() {
  const root = document.getElementById('screensaverRoot');
  root.innerHTML = `
    <div class="screensaver" role="dialog" aria-modal="true" aria-label="NAVIRM 화면보호기">
      <div class="screensaver-ambient" aria-hidden="true"></div>
      <div class="screensaver-logo" aria-label="NAVIRM">NAVIRM</div>
      <div class="screensaver-hint">화면을 누르거나 아무 키를 누르면 돌아갑니다</div>
    </div>`;
  document.body.classList.add('screensaver-active');
  root.querySelector('.screensaver').addEventListener('pointerdown', closeScreensaver, { once: true });
  document.addEventListener('keydown', closeScreensaver);
}

document.getElementById('screensaverBtn').addEventListener('click', openScreensaver);

document.addEventListener('keydown', (e) => {
  if (document.getElementById('screensaverRoot').firstChild) return;
  if (e.key !== 'Escape' || !state.trackerExpanded) return;
  state.trackerExpanded = false;
  render();
});

(async function bootstrap() {
  await showPasscodeGate();
  document.getElementById('app').innerHTML = `<div class="boot-loading">불러오는 중…</div>`;
  db = await loadInitialData();
  render();
  subscribeRemoteChanges();
})();
