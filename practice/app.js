// ── 상태 ──────────────────────────────────────────────────────────
let ALL_Q = [], TOPICS = [];
let session = null;
let timer = null;
let currentMode = 'instant'; // 'instant' | 'exam'

function setMode(m) {
  currentMode = m;
  document.getElementById('mode-instant').classList.toggle('active', m === 'instant');
  document.getElementById('mode-exam').classList.toggle('active', m === 'exam');
}

function startMockWithMode(mode) {
  currentMode = mode;
  startMockExam();
}

const PASS = 69; // 720/1000 scaled ≈ 69% raw
const KEY_HIST  = 'saa_history';
const KEY_WRONG = 'saa_wrong';
const KEY_MOCK  = 'saa_mock_attempts';
const MOCK_TOTAL = 65;
const MOCK_MINUTES = 130;

// 도메인 정의: [이름, 비율, 색상, 키워드들]
const DOMAINS = [
  { id: 'secure',    name: 'Secure Architectures',       pct: 0.30, color: '#7c3aed',
    kw: ['iam','role','policy','kms','cloudhsm','secrets manager','waf','shield','guardduty',
         'macie','inspector','cloudtrail','aws config','scp','organizations','permission',
         'encrypt','certificate','acm','firewall','ddos','identity','cognito','nacl','security group'] },
  { id: 'resilient', name: 'Resilient Architectures',    pct: 0.26, color: '#0284c7',
    kw: ['multi-az','failover','backup','disaster recovery','rds','aurora','dynamodb',
         'auto scaling','ebs','efs','fsx','replication','route 53','health check',
         'availability','redundan','replicate','recovery','datasync','migration','rpo','rto',
         'multi-region','standby','pilot light','warm standby'] },
  { id: 'performing',name: 'High-Performing Architectures', pct: 0.24, color: '#059669',
    kw: ['lambda','ecs','eks','fargate','elasticache','cloudfront','kinesis','athena','emr',
         'glue','sqs','sns','api gateway','latency','throughput','performance','cache',
         'streaming','read replica','global accelerator','edge','cdn'] },
  { id: 'cost',      name: 'Cost-Optimized Architectures', pct: 0.20, color: '#d97706',
    kw: ['cost','billing','savings plan','reserved instance','spot instance','cost explorer',
         'budgets','glacier','lifecycle','pricing','optimize','cheaper','rightsizing',
         'compute optimizer','trusted advisor'] },
];

function detectDomain(q) {
  const text = (q.question + ' ' + Object.values(q.options).join(' ')).toLowerCase();
  const scores = DOMAINS.map(d => ({
    id: d.id,
    score: d.kw.filter(k => text.includes(k)).length,
  }));
  scores.sort((a, b) => b.score - a.score);
  return scores[0].score > 0 ? scores[0].id : 'secure'; // fallback
}

// ── 부트 ──────────────────────────────────────────────────────────
async function boot() {
  try {
    const r = await fetch('questions.json');
    if (!r.ok) throw new Error(r.status);
    const d = await r.json();
    loadData(d);
  } catch (e) {
    // questions.json 없으면 업로드 화면으로
    document.getElementById('loading').style.display = 'none';
    showUploadOnly();
  }
}

function loadData(d) {
  ALL_Q  = d.questions || [];
  TOPICS = d.topics    || [];
  document.getElementById('loading').style.display = 'none';
  document.getElementById('home-meta').textContent =
    `${ALL_Q.length}문제 · 한글 번역`;
  renderHome();
  show('home');
}

function showUploadOnly() {
  document.getElementById('home-meta').textContent = 'JSON 파일을 업로드하여 시작';
  document.getElementById('topic-list').innerHTML =
    `<div style="padding:32px 0;color:var(--muted);font-size:14px;line-height:1.8">
      문제 파일이 없습니다.<br>
      아래에서 <strong style="color:var(--text)">JSON 파일을 업로드</strong>하면 바로 시작됩니다.<br>
      <span style="font-size:12px">build_questions.py 실행 후 생성된 questions.json을 사용하세요.</span>
    </div>`;
  // 모의고사·오답 버튼 숨기기
  document.getElementById('mock-buttons-wrap').style.display = 'none';
  document.getElementById('wrong-row').classList.add('hidden');
  show('home');
}

// ── 홈 렌더 ───────────────────────────────────────────────────────
function renderHome() {
  const hist  = loadHist();
  const wrong = loadWrong();

  // 토픽 리스트
  const list = document.getElementById('topic-list');
  const rows = [{ key: '__all__', name: '전체 문제', count: ALL_Q.length }, ...TOPICS.map(t => ({ key: t.name, name: t.name, count: t.ids.length }))];
  list.innerHTML = rows.map(r => {
    const score = lastScore(hist, r.key);
    const [cls, scoreText] = scoreStyle(score);
    return `<div class="topic-row" onclick="startExam('${r.key}')">
      <span class="topic-row-name">${r.name}</span>
      <span class="topic-row-count">${r.count}문항</span>
      <span class="topic-row-score ${cls}">${scoreText}</span>
      <span class="arrow">→</span>
    </div>`;
  }).join('');

  // 오답 버튼
  const wrongIds = Object.keys(wrong).filter(id => wrong[id] > 0);
  if (wrongIds.length) {
    document.getElementById('wrong-count-badge').textContent = wrongIds.length;
    document.getElementById('wrong-row').classList.remove('hidden');
  }

  renderHistory();
  syncHistFilter();

}

function scoreStyle(score) {
  if (score === null) return ['score-none', '—'];
  const scaled = Math.round(100 + (score / 100) * 900);
  if (score >= 85) return ['score-good', scaled + '점'];
  if (score >= 69) return ['score-mid',  scaled + '점'];
  return ['score-bad', scaled + '점'];
}

function lastScore(hist, key) {
  const list = hist[key];
  return list && list.length ? list[list.length - 1].score : null;
}

// ── 시험 시작 ─────────────────────────────────────────────────────
function startExam(key, forceIds = null) {
  let qs, name = key;

  if (forceIds) {
    qs = ALL_Q.filter(q => forceIds.includes(q.id));
  } else if (key === '__all__') {
    qs = [...ALL_Q]; name = '전체 문제';
  } else if (key === '__wrong__') {
    const w = loadWrong();
    const ids = Object.keys(w).filter(id => w[id] > 0).map(Number);
    qs = ALL_Q.filter(q => ids.includes(q.id));
    name = '오답 복습';
  } else {
    const t = TOPICS.find(t => t.name === key);
    qs = t ? ALL_Q.filter(q => t.ids.includes(q.id)) : ALL_Q;
  }

  qs = shuffle(qs);

  session = {
    key, name, questions: qs,
    answers: {}, selected: {},
    flagged: new Set(),
    idx: 0, startTime: Date.now(),
    mode: currentMode,
  };

  hide('home'); hide('result'); hide('review'); hide('attempt-review');
  const examEl = document.getElementById('exam');
  examEl.classList.remove('hidden');
  examEl.style.display = 'flex';
  startTimer();
  renderQ();
}

// ── 모의고사 시작 ─────────────────────────────────────────────────
function startMockExam() {
  // 각 도메인별 목표 문항 수 계산
  const counts = DOMAINS.map((d, i) => ({
    ...d,
    target: i < DOMAINS.length - 1
      ? Math.round(MOCK_TOTAL * d.pct)
      : MOCK_TOTAL - DOMAINS.slice(0, -1).reduce((s, dd) => s + Math.round(MOCK_TOTAL * dd.pct), 0),
  }));

  // 문제를 도메인별로 분류
  const buckets = {};
  DOMAINS.forEach(d => buckets[d.id] = []);
  ALL_Q.forEach(q => buckets[detectDomain(q)].push(q));

  // 도메인별로 랜덤 선택 후 합치기
  let selected = [];
  counts.forEach(({ id, target }) => {
    const pool = shuffle(buckets[id]);
    selected.push(...pool.slice(0, Math.min(target, pool.length)));
  });

  // 부족하면 전체에서 보충
  if (selected.length < MOCK_TOTAL) {
    const usedIds = new Set(selected.map(q => q.id));
    const extra = shuffle(ALL_Q.filter(q => !usedIds.has(q.id)));
    selected.push(...extra.slice(0, MOCK_TOTAL - selected.length));
  }

  selected = shuffle(selected.slice(0, MOCK_TOTAL));

  session = {
    key: '__mock__', name: '모의고사',
    questions: selected,
    answers: {}, selected: {},
    flagged: new Set(),
    idx: 0, startTime: Date.now(),
    isMock: true,
    mode: currentMode,
    countdown: MOCK_MINUTES * 60, // 초
  };

  hide('home'); hide('result'); hide('review');
  const examEl = document.getElementById('exam');
  examEl.classList.remove('hidden');
  examEl.style.display = 'flex';
  startTimer();
  renderQ();
}

// ── 타이머 ────────────────────────────────────────────────────────
function startTimer() {
  clearInterval(timer);
  const el = document.getElementById('nav-timer');

  if (session.isMock) {
    // 카운트다운
    timer = setInterval(() => {
      const elapsed = Math.floor((Date.now() - session.startTime) / 1000);
      const remain  = session.countdown - elapsed;
      if (remain <= 0) {
        clearInterval(timer);
        el.textContent = '00:00';
        el.classList.add('timer-warn');
        finishExam();
        return;
      }
      const m = String(Math.floor(remain / 60)).padStart(2, '0');
      const s = String(remain % 60).padStart(2, '0');
      el.textContent = `${m}:${s}`;
      if (remain <= 600) el.classList.add('timer-warn');  // 10분 이하 경고
      else el.classList.remove('timer-warn');
    }, 1000);
  } else {
    // 카운트업
    timer = setInterval(() => {
      const s = Math.floor((Date.now() - session.startTime) / 1000);
      el.textContent =
        `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;
    }, 1000);
  }
}

// ── 문제 렌더 ─────────────────────────────────────────────────────
function renderQ() {
  const q    = session.questions[session.idx];
  const tot  = session.questions.length;
  const pct  = Math.round((session.idx / tot) * 100);
  const sub  = session.answers[q.id];
  const sel  = session.selected[q.id] || [];
  const correct = letters(q.answer);

  document.getElementById('nav-topic').textContent = session.name;
  document.getElementById('nav-qnum').textContent  = `${session.idx + 1} / ${tot}`;
  document.getElementById('prog-bar').style.width  = pct + '%';

  const flagBtn = document.getElementById('flag-btn');
  flagBtn.textContent = session.flagged.has(q.id) ? '🚩 플래그됨' : '플래그';
  flagBtn.className   = 'flag-btn' + (session.flagged.has(q.id) ? ' on' : '');

  document.getElementById('q-topic-tag').textContent = q.topic || '';
  const mtag = document.getElementById('multi-tag');
  q.multi_answer ? mtag.classList.remove('hidden') : mtag.classList.add('hidden');

  document.getElementById('q-text').textContent = q.question_ko || q.question;

  // 옵션
  const opts = q.options_ko && Object.keys(q.options_ko).length ? q.options_ko : q.options;
  const wrap = document.getElementById('options');
  wrap.innerHTML = '';
  for (const [k, v] of Object.entries(opts)) {
    const div = document.createElement('div');
    div.className = 'opt' + (sub ? ' done' : '');
    div.dataset.l = k;

    if (sub) {
      if (correct.includes(k)) div.classList.add('correct');
      else if (sub.includes(k)) div.classList.add('wrong');
    } else if (sel.includes(k)) {
      div.classList.add('selected');
    }

    div.innerHTML = `<div class="opt-letter">${k}</div><div class="opt-text">${v}</div>`;
    if (!sub) div.onclick = () => pick(k);
    wrap.appendChild(div);
  }

  // 제출 버튼
  const btn = document.getElementById('submit-btn');
  const isExamMode = session.mode === 'exam';
  if (isExamMode) {
    btn.style.display = 'none';
  } else {
    btn.style.display = '';
    btn.disabled = !!sub || sel.length === 0;
    btn.textContent = sub ? '제출 완료' : '제출';
  }

  // 해설
  const expEl = document.getElementById('explanation');
  if (!isExamMode && sub) {
    expEl.classList.remove('hidden');
    document.getElementById('exp-text').textContent = q.explanation_ko || q.explanation || '해설 없음';
    document.getElementById('exp-orig').textContent = q.explanation || '';
  } else {
    expEl.classList.add('hidden');
  }

  // 네비
  document.getElementById('prev-btn').disabled = session.idx === 0;
  document.getElementById('next-btn').textContent = session.idx === tot - 1 ? '완료' : '다음 →';

  document.getElementById('exam-body').scrollTop = 0;
}

function pick(k) {
  const q = session.questions[session.idx];
  if (session.answers[q.id]) return;
  const cur = session.selected[q.id] || [];
  session.selected[q.id] = q.multi_answer
    ? (cur.includes(k) ? cur.filter(l => l !== k) : [...cur, k])
    : [k];
  renderQ();
}

function submitAnswer() {
  const q   = session.questions[session.idx];
  const sel = session.selected[q.id] || [];
  if (!sel.length) return;
  session.answers[q.id] = sel;

  const ans = letters(q.answer);
  const ok  = ans.every(l => sel.includes(l)) && sel.every(l => ans.includes(l));

  const wrong = loadWrong();
  if (ok) {
    if (wrong[q.id]) { wrong[q.id]--; if (!wrong[q.id]) delete wrong[q.id]; }
  } else {
    wrong[q.id] = (wrong[q.id] || 0) + 1;
  }
  saveWrong(wrong);
  renderQ();
}

function nav(dir) {
  const next = session.idx + dir;
  if (next < 0) return;
  if (next >= session.questions.length) { finishExam(); return; }
  session.idx = next;
  renderQ();
}

function toggleFlag() {
  const q = session.questions[session.idx];
  session.flagged.has(q.id) ? session.flagged.delete(q.id) : session.flagged.add(q.id);
  renderQ();
}

// ── 리뷰 그리드 ───────────────────────────────────────────────────
function showReview() {
  hide('exam');
  show('review');
  const tot = session.questions.length;
  const isExamMode = session.mode === 'exam';
  const answeredCount = isExamMode
    ? session.questions.filter(q => (session.selected[q.id] || []).length > 0).length
    : Object.keys(session.answers).length;
  document.getElementById('review-sub').textContent = `${answeredCount} / ${tot} 답변 완료`;

  // 범례 업데이트
  document.getElementById('review-legend').innerHTML = isExamMode
    ? `<span><span class="leg-dot" style="background:#dbeafe;border:1px solid #bfdbfe"></span>답변 완료</span>
       <span><span class="leg-dot" style="background:#fef3c7;border:1px solid #fde68a"></span>플래그</span>
       <span><span class="leg-dot" style="background:var(--bg2);border:1px solid var(--line)"></span>미답</span>`
    : `<span><span class="leg-dot" style="background:#dcfce7;border:1px solid #bbf7d0"></span>정답</span>
       <span><span class="leg-dot" style="background:#fee2e2;border:1px solid #fecaca"></span>오답</span>
       <span><span class="leg-dot" style="background:#fef3c7;border:1px solid #fde68a"></span>플래그</span>
       <span><span class="leg-dot" style="background:var(--bg2);border:1px solid var(--line)"></span>미답</span>`;

  const grid = document.getElementById('q-grid');
  grid.innerHTML = '';
  session.questions.forEach((q, i) => {
    let cls;
    if (isExamMode) {
      cls = (session.selected[q.id] || []).length > 0 ? 'answered' : 'unanswered';
    } else {
      const sub = session.answers[q.id];
      const ans = letters(q.answer);
      cls = 'unanswered';
      if (sub) cls = (ans.every(l => sub.includes(l)) && sub.every(l => ans.includes(l))) ? 'correct' : 'wrong';
    }
    if (session.flagged.has(q.id)) cls = 'flagged';
    if (i === session.idx) cls += ' current';

    const c = document.createElement('div');
    c.className = `q-cell ${cls}`;
    c.textContent = i + 1;
    c.onclick = () => {
      session.idx = i;
      hide('review');
      const examEl2 = document.getElementById('exam');
      examEl2.classList.remove('hidden');
      examEl2.style.display = 'flex';
      renderQ();
    };
    grid.appendChild(c);
  });
}

// ── 시험 종료 ─────────────────────────────────────────────────────
function finishExam() {
  clearInterval(timer);

  // 시험 모드: 선택 내용을 답안으로 확정 + 오답 기록 갱신
  if (session.mode === 'exam') {
    const wrong = loadWrong();
    session.questions.forEach(q => {
      const sel = session.selected[q.id];
      if (sel && sel.length > 0) {
        session.answers[q.id] = sel;
        const ans = letters(q.answer);
        const ok  = ans.every(l => sel.includes(l)) && sel.every(l => ans.includes(l));
        if (ok) {
          if (wrong[q.id]) { wrong[q.id]--; if (!wrong[q.id]) delete wrong[q.id]; }
        } else {
          wrong[q.id] = (wrong[q.id] || 0) + 1;
        }
      }
    });
    saveWrong(wrong);
  }

  hide('exam'); hide('review');
  show('result');

  const qs = session.questions;
  let correct = 0;
  qs.forEach(q => {
    const sub = session.answers[q.id];
    if (!sub) return;
    const ans = letters(q.answer);
    if (ans.every(l => sub.includes(l)) && sub.every(l => ans.includes(l))) correct++;
  });

  const total    = qs.length;
  const answered = Object.keys(session.answers).length;
  const score    = total ? Math.round(correct / total * 100) : 0;
  const scaled   = Math.round(100 + (score / 100) * 900);
  const pass     = score >= PASS;

  document.getElementById('res-topic').textContent  = session.name;
  document.getElementById('res-score').textContent  = `${correct}/${total}문제 (${score}%) · 추정 ${scaled}점`;
  document.getElementById('res-score').className    = 'result-score ' + (pass ? 'pass' : 'fail');
  document.getElementById('res-verdict').textContent = pass ? '합격 기준 통과 (720점 이상)' : '불합격 (720점 미만)';
  document.getElementById('res-detail').textContent =
    `${answered}문제 답변 · 합격선 약 720점 (정답률 69%)이상`;

  // 도메인별 breakdown (모의고사만)
  const breakdownEl = document.getElementById('domain-breakdown');
  if (session.isMock) {
    const domainStats = {};
    DOMAINS.forEach(d => domainStats[d.id] = { correct: 0, total: 0, domain: d });

    qs.forEach(q => {
      const sub = session.answers[q.id];
      const did = detectDomain(q);
      domainStats[did].total++;
      if (sub) {
        const ans = letters(q.answer);
        if (ans.every(l => sub.includes(l)) && sub.every(l => ans.includes(l)))
          domainStats[did].correct++;
      }
    });

    breakdownEl.innerHTML = DOMAINS.map(d => {
      const st = domainStats[d.id];
      const pct = st.total ? Math.round(st.correct / st.total * 100) : 0;
      return `<div class="domain-row">
        <span class="domain-name">${d.name}</span>
        <div class="domain-bar-wrap">
          <div class="domain-bar" style="width:${pct}%;background:${d.color}"></div>
        </div>
        <span class="domain-score" style="color:${d.color}">${pct}%</span>
        <span style="font-size:12px;color:var(--muted)">${st.correct}/${st.total}</span>
      </div>`;
    }).join('');
    breakdownEl.classList.remove('hidden');
  } else {
    breakdownEl.classList.add('hidden');
  }

  // 시험 모드에서만 "전체 복기" 버튼 표시
  const fullReviewBtn = document.getElementById('full-review-btn');
  if (fullReviewBtn) fullReviewBtn.style.display = session.mode === 'exam' ? '' : 'none';

  const hist = loadHist();
  const k    = session.key === '__all__' ? '__all__' : session.name;
  hist[k] = hist[k] || [];
  hist[k].push({ date: new Date().toLocaleDateString('ko-KR'), topic: session.name, score, scaled, correct, total, pass });
  saveHist(hist);

  // 모의고사 상세 기록 저장
  if (session.isMock) {
    const domainStats = {};
    DOMAINS.forEach(d => domainStats[d.id] = { correct: 0, total: 0 });
    const wrongIds = [], correctIds = [];

    qs.forEach(q => {
      const sub = session.answers[q.id];
      const did = detectDomain(q);
      domainStats[did].total++;
      if (sub) {
        const ans = letters(q.answer);
        const ok  = ans.every(l => sub.includes(l)) && sub.every(l => ans.includes(l));
        if (ok) { domainStats[did].correct++; correctIds.push(q.id); }
        else    { wrongIds.push(q.id); }
      } else {
        wrongIds.push(q.id); // 미답도 오답 처리
      }
    });

    const timeUsed = Math.floor((Date.now() - session.startTime) / 1000);
    const attempts = loadMock();
    attempts.push({
      date: new Date().toLocaleDateString('ko-KR'),
      score, correct, total, pass, timeUsed,
      domainStats,
      wrongIds,
      correctIds,
      questionIds: qs.map(q => q.id),
      userAnswers: Object.fromEntries(
        Object.entries(session.answers).map(([id, ans]) => [id, ans])
      ),
    });
    saveMock(attempts);

    // 기록 보기 버튼에 횟수 뱃지
  }
}

function reviewWrong() {
  const ids = session.questions.filter(q => {
    const sub = session.answers[q.id];
    if (!sub) return false;
    const ans = letters(q.answer);
    return !(ans.every(l => sub.includes(l)) && sub.every(l => ans.includes(l)));
  }).map(q => q.id);
  if (!ids.length) { alert('오답이 없습니다!'); return; }
  startExam(session.key, ids);
}

function restartExam() { startExam(session.key); }

function goHome() {
  clearInterval(timer);
  hide('exam'); hide('review'); hide('result'); hide('stats');
  renderHome();
  show('home');
}

// ── 모의고사 통계 ──────────────────────────────────────────────────
function showStats() {
  const attempts = loadMock();
  if (!attempts.length) { alert('모의고사 기록이 없습니다.\n먼저 모의고사를 진행해주세요.'); return; }
  hide('home');
  renderStats(attempts);
  show('stats');
}

function renderStats(attempts) {
  const n      = attempts.length;
  const scores = attempts.map(a => a.score);
  const avg    = Math.round(scores.reduce((s,v)=>s+v,0) / n);
  const best   = Math.max(...scores);

  document.getElementById('stats-sub').textContent  = `총 ${n}회 응시`;
  document.getElementById('st-count').textContent   = n + '회';
  document.getElementById('st-avg').textContent     = avg + '%';
  document.getElementById('st-best').textContent    = best + '%';

  // 도메인별 누적 정답률
  const aggDomain = {};
  DOMAINS.forEach(d => aggDomain[d.id] = { correct: 0, total: 0 });
  attempts.forEach(a => {
    DOMAINS.forEach(d => {
      const st = a.domainStats?.[d.id];
      if (!st) return;
      aggDomain[d.id].correct += st.correct;
      aggDomain[d.id].total   += st.total;
    });
  });

  document.getElementById('domain-agg').innerHTML = DOMAINS.map(d => {
    const st  = aggDomain[d.id];
    const pct = st.total ? Math.round(st.correct / st.total * 100) : 0;
    return `<div class="domain-stat-row">
      <span class="dsrow-name">${d.name}</span>
      <div class="dsrow-bar-wrap">
        <div class="dsrow-bar" style="width:${pct}%;background:${d.color}"></div>
      </div>
      <span class="dsrow-pct" style="color:${d.color}">${pct}%</span>
      <span class="dsrow-count">${st.correct}/${st.total}</span>
    </div>`;
  }).join('');

  // 자주 틀린 문제 집계
  const wrongCount = {};
  attempts.forEach(a => (a.wrongIds || []).forEach(id => {
    wrongCount[id] = (wrongCount[id] || 0) + 1;
  }));
  const topWrong = Object.entries(wrongCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  const wList = document.getElementById('wrong-q-list');
  if (!topWrong.length) {
    wList.innerHTML = '<div style="color:var(--muted);font-size:13px;padding:12px 0">데이터 없음</div>';
  } else {
    wList.innerHTML = topWrong.map(([id, cnt]) => {
      const q = ALL_Q.find(q => q.id === Number(id));
      if (!q) return '';
      const preview = (q.question_ko || q.question).slice(0, 80) + '…';
      const domain  = DOMAINS.find(d => d.id === detectDomain(q));
      return `<div class="wrong-q-card">
        <div class="wrong-q-top">
          <span class="wrong-q-num">Q${q.id}</span>
          <span class="wrong-q-count">${cnt}회 오답</span>
          <span class="pill pill-domain">${domain?.name.split(' ')[0] ?? ''}</span>
        </div>
        <div class="wrong-q-text">${preview}</div>
        <div class="wrong-q-answer">정답: ${q.answer || '?'}</div>
      </div>`;
    }).join('');
  }

  // 회차별 기록 테이블
  const tbody = document.getElementById('attempt-tbody');
  tbody.innerHTML = [...attempts].reverse().map((a, ri) => {
    const i       = n - ri;
    const realIdx = n - 1 - ri; // attempts 배열 인덱스
    const ds      = a.domainStats || {};
    const dpct    = id => {
      const st = ds[id]; if (!st || !st.total) return '—';
      return Math.round(st.correct / st.total * 100) + '%';
    };
    const hasDetail = !!(a.questionIds && a.userAnswers);
    return `<tr style="cursor:${hasDetail ? 'pointer' : 'default'}" onclick="${hasDetail ? `showAttemptReview(${realIdx})` : ''}">
      <td style="color:var(--muted)">${i}</td>
      <td>${a.date}</td>
      <td style="font-weight:700;color:${a.pass ? 'var(--green)' : 'var(--red)'}">${a.correct}/${a.total} (${a.score}%) · ${a.scaled ?? Math.round(100+(a.score/100)*900)}점</td>
      <td>${dpct('secure')}</td>
      <td>${dpct('resilient')}</td>
      <td>${dpct('performing')}</td>
      <td>${dpct('cost')}</td>
      <td><span class="pill ${a.pass ? 'pill-pass' : 'pill-fail'}">${a.pass ? '합격' : '불합격'}</span>${hasDetail ? '<span style="font-size:11px;color:var(--accent);margin-left:6px">복기 →</span>' : ''}</td>
    </tr>`;
  }).join('');
}

// ── 회차 복기 ─────────────────────────────────────────────────────
function showAttemptReview(idx) {
  const attempt = loadMock()[idx];
  if (!attempt) return;

  hide('stats');
  show('attempt-review');

  const n = loadMock().length;
  document.getElementById('ar-title').textContent = `${idx + 1}회차 복기`;
  document.getElementById('ar-sub').textContent =
    `${attempt.date} · ${attempt.score}% · ${attempt.correct}/${attempt.total}문제 정답`;

  const qIds      = attempt.questionIds || [];
  const userAnss  = attempt.userAnswers  || {};

  const html = qIds.map((id, qi) => {
    const q = ALL_Q.find(q => q.id === id);
    if (!q) return '';

    const userAns   = userAnss[id] || [];
    const corrAns   = letters(q.answer);
    const answered  = userAns.length > 0;
    const isCorrect = answered &&
      corrAns.every(l => userAns.includes(l)) &&
      userAns.every(l => corrAns.includes(l));

    const cardCls = !answered ? 'ar-skip' : isCorrect ? 'ar-correct' : 'ar-wrong';
    const badge   = !answered
      ? '<span class="ar-badge skip">미답</span>'
      : isCorrect
        ? '<span class="ar-badge correct">정답</span>'
        : '<span class="ar-badge wrong">오답</span>';

    const domain = DOMAINS.find(d => d.id === detectDomain(q));
    const qText  = q.question_ko || q.question;
    const opts   = q.options_ko && Object.keys(q.options_ko).length ? q.options_ko : q.options;

    const optHtml = Object.entries(opts).map(([k, v]) => {
      const userPicked = userAns.includes(k);
      const isAnswer   = corrAns.includes(k);
      let cls = '';
      if (userPicked && isAnswer)  cls = 'user-correct';
      else if (userPicked)         cls = 'user-wrong';
      else if (isAnswer)           cls = 'answer-only';
      return `<div class="ar-opt ${cls}">
        <div class="ar-opt-letter">${k}</div>
        <div>${v}</div>
      </div>`;
    }).join('');

    return `<div class="ar-q-card ${cardCls}">
      <div class="ar-q-header">
        <span class="ar-q-num">Q${qi + 1} · #${id}</span>
        ${badge}
        <span class="ar-domain-tag">${domain?.name.split(' ')[0] ?? ''}</span>
      </div>
      <div class="ar-q-text">${qText}</div>
      <div class="ar-options">${optHtml}</div>
      <div class="ar-answer-line">
        정답: <strong>${q.answer || '?'}</strong>
        ${answered && !isCorrect ? ` · 내 답: <strong style="color:var(--red)">${userAns.join(', ')}</strong>` : ''}
      </div>
    </div>`;
  }).join('');

  document.getElementById('ar-q-list').innerHTML = html || '<p style="color:var(--muted)">데이터 없음 (이전 기록은 복기 미지원)</p>';
}

function loadMock()      { try { return JSON.parse(localStorage.getItem(KEY_MOCK)) || []; } catch { return []; } }
function saveMock(arr)   { localStorage.setItem(KEY_MOCK, JSON.stringify(arr)); }

// ── 전체 복기 (시험 모드 종료 후) ─────────────────────────────────
function showFullReview() {
  hide('result');

  let correctCount = 0;
  session.questions.forEach(q => {
    const sub = session.answers[q.id];
    if (sub) {
      const ans = letters(q.answer);
      if (ans.every(l => sub.includes(l)) && sub.every(l => ans.includes(l))) correctCount++;
    }
  });

  document.getElementById('ar-title').textContent = session.name + ' 복기';
  document.getElementById('ar-sub').textContent =
    `${session.questions.length}문제 · ${correctCount}개 정답`;

  const arBack = document.querySelector('#attempt-review .ar-back');
  arBack.onclick = () => { hide('attempt-review'); show('result'); };

  const html = session.questions.map((q, qi) => {
    const userAns  = session.answers[q.id] || [];
    const corrAns  = letters(q.answer);
    const answered = userAns.length > 0;
    const isCorrect = answered &&
      corrAns.every(l => userAns.includes(l)) &&
      userAns.every(l => corrAns.includes(l));

    const cardCls = !answered ? 'ar-skip' : isCorrect ? 'ar-correct' : 'ar-wrong';
    const badge   = !answered
      ? '<span class="ar-badge skip">미답</span>'
      : isCorrect
        ? '<span class="ar-badge correct">정답</span>'
        : '<span class="ar-badge wrong">오답</span>';

    const domain = DOMAINS.find(d => d.id === detectDomain(q));
    const qText  = q.question_ko || q.question;
    const opts   = q.options_ko && Object.keys(q.options_ko).length ? q.options_ko : q.options;

    const optHtml = Object.entries(opts).map(([k, v]) => {
      const userPicked = userAns.includes(k);
      const isAnswer   = corrAns.includes(k);
      let cls = '';
      if (userPicked && isAnswer)  cls = 'user-correct';
      else if (userPicked)         cls = 'user-wrong';
      else if (isAnswer)           cls = 'answer-only';
      return `<div class="ar-opt ${cls}">
        <div class="ar-opt-letter">${k}</div>
        <div>${v}</div>
      </div>`;
    }).join('');

    const expKo  = q.explanation_ko || q.explanation || '';
    const expEng = q.explanation || '';
    const expHtml = expKo ? `
      <div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--line)">
        <div style="font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:var(--muted);margin-bottom:6px">해설</div>
        <div style="font-size:13px;line-height:1.75;color:#374151;white-space:pre-wrap">${expKo}</div>
        ${expEng ? `<details style="margin-top:8px"><summary style="font-size:12px;color:var(--muted);cursor:pointer">원문 보기</summary>
          <div style="margin-top:6px;font-size:12px;color:var(--muted);white-space:pre-wrap">${expEng}</div>
        </details>` : ''}
      </div>` : '';

    return `<div class="ar-q-card ${cardCls}">
      <div class="ar-q-header">
        <span class="ar-q-num">Q${qi + 1} · #${q.id}</span>
        ${badge}
        <span class="ar-domain-tag">${domain?.name.split(' ')[0] ?? ''}</span>
      </div>
      <div class="ar-q-text">${qText}</div>
      <div class="ar-options">${optHtml}</div>
      <div class="ar-answer-line">
        정답: <strong>${q.answer || '?'}</strong>
        ${answered && !isCorrect ? ` · 내 답: <strong style="color:var(--red)">${userAns.join(', ')}</strong>` : ''}
      </div>
      ${expHtml}
    </div>`;
  }).join('');

  document.getElementById('ar-q-list').innerHTML = html;
  show('attempt-review');
}

function showFormatGuide() { show('format-modal'); }
function closeFormatGuide() { hide('format-modal'); }

function exportRecords() {
  const data = {
    exported: new Date().toISOString(),
    [KEY_HIST]:  loadHist(),
    [KEY_WRONG]: loadWrong(),
    [KEY_MOCK]:  loadMock(),
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `aws-saa-records-${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function importRecords(e) {
  const file = e.target.files[0]; if (!file) return;
  const r = new FileReader();
  r.onload = ev => {
    try {
      const data = JSON.parse(ev.target.result);
      if (!data[KEY_HIST] && !data[KEY_MOCK]) {
        alert('올바른 기록 파일이 아닙니다.');
        return;
      }
      if (!confirm(`기록을 불러오면 현재 데이터에 병합됩니다.\n계속하시겠습니까?`)) return;

      // 히스토리 병합
      if (data[KEY_HIST]) {
        const cur = loadHist();
        const imp = data[KEY_HIST];
        for (const k of Object.keys(imp)) {
          cur[k] = [...(cur[k] || []), ...imp[k]];
        }
        saveHist(cur);
      }
      // 오답 병합 (더 높은 횟수 우선)
      if (data[KEY_WRONG]) {
        const cur = loadWrong();
        const imp = data[KEY_WRONG];
        for (const id of Object.keys(imp)) {
          cur[id] = Math.max(cur[id] || 0, imp[id]);
        }
        saveWrong(cur);
      }
      // 모의고사 기록 병합
      if (data[KEY_MOCK]) {
        const cur = loadMock();
        saveMock([...cur, ...data[KEY_MOCK]]);
      }

      e.target.value = '';
      alert('불러오기 완료!');
      renderHome();
    } catch { alert('파일 형식 오류'); }
  };
  r.readAsText(file);
}

// ── 기록 ──────────────────────────────────────────────────────────
function renderHistory() {
  const hist = loadHist();
  const filter = document.getElementById('hist-filter').value || 'all';
  let entries = filter === 'all' ? Object.values(hist).flat() : (hist[filter] || []);
  entries = entries.slice().reverse().slice(0, 20);

  const scores = entries.map(e => e.score);
  document.getElementById('h-attempts').textContent = entries.length || '—';
  document.getElementById('h-best').textContent = scores.length ? Math.max(...scores) + '%' : '—';
  document.getElementById('h-avg').textContent  = scores.length ? Math.round(scores.reduce((a,b)=>a+b,0)/scores.length) + '%' : '—';

  document.getElementById('hist-tbody').innerHTML = entries.map(e =>
    `<tr>
      <td>${e.date}</td>
      <td>${e.topic}</td>
      <td style="text-align:right;font-weight:600;color:${e.pass?'var(--green)':'var(--red)'}">${e.score}%</td>
    </tr>`
  ).join('') || `<tr><td colspan="3" style="color:var(--muted);padding:16px 0">기록 없음</td></tr>`;
}

function syncHistFilter() {
  const hist = loadHist();
  const sel = document.getElementById('hist-filter');
  const existing = new Set([...sel.options].map(o => o.value));
  if (!existing.has('all')) {
    const o = document.createElement('option');
    o.value = 'all'; o.textContent = '전체'; sel.prepend(o);
  }
  for (const key of Object.keys(hist)) {
    if (!existing.has(key)) {
      const o = document.createElement('option');
      o.value = key; o.textContent = key === '__all__' ? '전체 문제' : key;
      sel.appendChild(o);
    }
  }
}

// ── JSON 업로드 ───────────────────────────────────────────────────
function uploadJSON(e) {
  const file = e.target.files[0]; if (!file) return;
  const r = new FileReader();
  r.onload = ev => {
    try {
      const d = JSON.parse(ev.target.result);
      // 모의고사 버튼 다시 보이게
      document.getElementById('mock-buttons-wrap').style.display = '';
      loadData(d);
    } catch { alert('JSON 형식 오류'); }
  };
  r.readAsText(file);
}

// ── 유틸 ──────────────────────────────────────────────────────────
function letters(ans) {
  return (ans || '').toUpperCase().split('').filter(c => /[A-E]/.test(c));
}
function shuffle(a) {
  a = [...a];
  for (let i = a.length-1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i+1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function show(id) { document.getElementById(id).classList.remove('hidden'); }
function hide(id) { document.getElementById(id).classList.add('hidden'); }
function loadHist()  { try { return JSON.parse(localStorage.getItem(KEY_HIST))  || {}; } catch { return {}; } }
function saveHist(h) { localStorage.setItem(KEY_HIST,  JSON.stringify(h)); }
function loadWrong()  { try { return JSON.parse(localStorage.getItem(KEY_WRONG)) || {}; } catch { return {}; } }
function saveWrong(w) { localStorage.setItem(KEY_WRONG, JSON.stringify(w)); }

boot();

window.addEventListener('beforeunload', function(e) {
  if (session && document.getElementById('result').classList.contains('hidden')) {
    e.preventDefault();
    e.returnValue = '';
  }
});
