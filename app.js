const DATA = window.QUIZ_DATA || { subjects: [], questions: [] };
const PRACTICE_MAX = 50;
const PRACTICE_PAGE_SIZE = 5;
const EXAM_SIZE = 50;
const CHINESE_EXAM_SIZE = 45;
const CHINESE_EXAM_SINGLE_COUNT = 35;
const CHINESE_EXAM_MULTIPLE_COUNT = 10;

const els = {
  bankSummary: document.getElementById("bankSummary"),
  modeSummary: document.getElementById("modeSummary"),
  subjectSelect: document.getElementById("subjectSelect"),
  typeSettings: document.getElementById("typeSettings"),
  typeSelect: document.getElementById("typeSelect"),
  practiceSettings: document.getElementById("practiceSettings"),
  practiceCount: document.getElementById("practiceCount"),
  examSettings: document.getElementById("examSettings"),
  examCount: document.getElementById("examCount"),
  historySettings: document.getElementById("historySettings"),
  yearSelect: document.getElementById("yearSelect"),
  historyCount: document.getElementById("historyCount"),
  primaryAction: document.getElementById("primaryAction"),
  secondaryAction: document.getElementById("secondaryAction"),
  filterStats: document.getElementById("filterStats"),
  prevUnit: document.getElementById("prevUnit"),
  nextUnit: document.getElementById("nextUnit"),
  unitProgress: document.getElementById("unitProgress"),
  quizContent: document.getElementById("quizContent"),
  modeButtons: Array.from(document.querySelectorAll(".mode-button")),
};

const state = {
  mode: "practice",
  units: [],
  currentIndex: 0,
  answers: {},
  revealed: {},
  examSubmitted: false,
  questionNumbers: {},
};

const questionById = new Map(DATA.questions.map((question) => [question.id, question]));

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatText(value) {
  return escapeHtml(value).replace(/\n/g, "<br>");
}

// 題幹與題組文章中以「｜」開頭的連續行是原卷表格（第一列為表頭），其餘照原文換行顯示
function formatWithTables(value) {
  let html = "";
  let rows = [];
  let afterText = false;
  const flushTable = () => {
    if (!rows.length) return;
    const cells = (row, tag) => row.map((cell) => `<${tag}>${escapeHtml(cell.trim())}</${tag}>`).join("");
    const [head, ...body] = rows;
    html += `<div class="stem-table"><table><thead><tr>${cells(head, "th")}</tr></thead><tbody>${body
      .map((row) => `<tr>${cells(row, "td")}</tr>`)
      .join("")}</tbody></table></div>`;
    rows = [];
    afterText = false;
  };
  for (const line of String(value ?? "").split("\n")) {
    if (line.startsWith("｜")) {
      rows.push(line.replace(/^｜|｜$/g, "").split("｜"));
      continue;
    }
    flushTable();
    html += (afterText ? "<br>" : "") + escapeHtml(line);
    afterText = true;
  }
  flushTable();
  return html;
}

const URL_PATTERN = /https?:\/\/[^\s<>"'）)】，。、]+/g;

function externalLink(url, label) {
  return `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`;
}

// 「名稱：網址」整行顯示成名稱連結；其他行內網址顯示成網域連結
function linkifyLine(line) {
  const named = line.match(/^(.+?)[：:]\s*(https?:\/\/\S+)\s*$/);
  if (named && !/^https?$/.test(named[1].trim())) return externalLink(named[2], named[1].trim());
  let html = "";
  let last = 0;
  for (const match of line.matchAll(URL_PATTERN)) {
    let host = match[0];
    try {
      host = new URL(match[0]).hostname;
    } catch (error) {
      // 保留原網址當作連結文字
    }
    html += escapeHtml(line.slice(last, match.index)) + externalLink(match[0], host);
    last = match.index + match[0].length;
  }
  return html + escapeHtml(line.slice(last));
}

function formatRichText(value) {
  return String(value ?? "").split("\n").map(linkifyLine).join("<br>");
}

function shuffle(items) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const other = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[other]] = [copy[other], copy[index]];
  }
  return copy;
}

function sameSet(a, b) {
  if (a.length !== b.length) return false;
  return a.every((item) => b.includes(item));
}

function getSelected(questionId) {
  return state.answers[questionId] || [];
}

function isCorrect(question, selected = getSelected(question.id)) {
  if (question.giveAll) return true;
  if (!selected.length) return false;
  if (question.answerMode === "multiple") {
    return sameSet([...selected].sort(), [...question.answer].sort());
  }
  return selected.length === 1 && question.answer.includes(selected[0]);
}

function answerLabel(question) {
  return question.answerText || question.answer.join("/");
}

function selectedLabel(question) {
  const selected = getSelected(question.id);
  if (!selected.length) return "未作答";
  return selected
    .map((key) => {
      const option = question.options.find((item) => item.key === key);
      return option ? `${key} ${option.text}` : key;
    })
    .join("、");
}

function isSubmissionMode() {
  return state.mode === "exam" || state.mode === "history";
}

function isQuestionLocked(questionId) {
  return Boolean(state.revealed[questionId]) || (isSubmissionMode() && state.examSubmitted);
}

function shouldIgnoreTypeFilter() {
  return state.mode === "random" || isSubmissionMode();
}

// 舊法題（官方答案在現行法下已不成立）只出現在歷年試題，不進練習／隨機／模擬考
function isDrillable(question) {
  return !question.outdatedNote;
}

function filteredQuestions(options = {}) {
  const subject = els.subjectSelect.value;
  const type = options.ignoreType ? "all" : els.typeSelect.value;
  return DATA.questions.filter((question) => {
    if (!isDrillable(question)) return false;
    if (subject !== "all" && question.subject !== subject) return false;
    if (type !== "all" && question.type !== type) return false;
    return true;
  });
}

function questionHistorySessions(question, dataIndex) {
  const papers = Array.isArray(question.historyPapers) ? question.historyPapers : [];
  const sessions = papers.map((paper) => ({
    id: `paper:${paper.id}`,
    year: String(paper.year || question.year || ""),
    day: Number(paper.day || 0),
    label: paper.label || `${paper.year || question.year} 年`,
    order: Number(paper.order || dataIndex + 1),
  }));
  const paperYears = new Set(sessions.map((session) => session.year));
  if (question.year && !paperYears.has(String(question.year))) {
    sessions.push({
      id: `year:${question.year}`,
      year: String(question.year),
      day: 0,
      label: `${question.year} 年`,
      order: dataIndex + 1,
    });
  }
  return sessions;
}

// 各科的歷年場次與其題目（依原題號排序）只計算一次；題庫資料不會變動，可安全快取
const historyIndexCache = new Map();

function historyIndex(subject) {
  if (!historyIndexCache.has(subject)) {
    const sessions = new Map();
    DATA.questions.forEach((question, dataIndex) => {
      if (question.subject !== subject) return;
      questionHistorySessions(question, dataIndex).forEach((entry) => {
        if (!sessions.has(entry.id)) {
          sessions.set(entry.id, { ...entry, count: 0, items: [] });
        }
        const session = sessions.get(entry.id);
        session.count += 1;
        session.items.push({ question, order: entry.order, dataIndex });
      });
    });
    sessions.forEach((session) => session.items.sort((a, b) => a.order - b.order || a.dataIndex - b.dataIndex));
    historyIndexCache.set(subject, sessions);
  }
  return historyIndexCache.get(subject);
}

function availableHistorySessions(subject = els.subjectSelect.value) {
  if (subject === "all") return [];
  return [...historyIndex(subject).values()].sort(
    (a, b) => Number(b.year) - Number(a.year) || a.day - b.day || a.label.localeCompare(b.label, "zh-Hant")
  );
}

function selectedHistorySession() {
  return availableHistorySessions().find((session) => session.id === els.yearSelect.value) || null;
}

function historicalQuestions() {
  const subject = els.subjectSelect.value;
  const sessionId = els.yearSelect.value;
  if (subject === "all" || !sessionId) return [];
  const session = historyIndex(subject).get(sessionId);
  return session ? session.items.map((item) => item.question) : [];
}

function buildUnits(questions) {
  const unitsById = new Map();
  questions.forEach((question, order) => {
    const id = question.groupId || question.id;
    if (!unitsById.has(id)) {
      unitsById.set(id, {
        id,
        order,
        subject: question.subject,
        title: question.groupTitle || question.id,
        passage: question.passage || "",
        questions: [],
      });
    }
    const unit = unitsById.get(id);
    if (!unit.passage && question.passage) unit.passage = question.passage;
    unit.questions.push(question);
  });
  return [...unitsById.values()].sort((a, b) => a.order - b.order);
}

function summarizeUnitValue(units, key, fallback) {
  const values = [...new Set(units.map((unit) => unit[key]).filter(Boolean))];
  return values.length === 1 ? values[0] : fallback;
}

// 把一或多個題目單位組成一個畫面頁；題組文章統一放在 passages
function makePage(id, order, title, units) {
  return {
    id,
    order,
    subject: summarizeUnitValue(units, "subject", "多科目"),
    title,
    passages: units
      .filter((unit) => unit.passage)
      .map((unit) => ({
        title: unit.title,
        text: unit.passage,
        translation: groupTranslation(unit),
        questionIds: unit.questions.map((question) => question.id),
      })),
    questions: units.flatMap((unit) => unit.questions),
  };
}

function packPracticePages(units) {
  const pages = [];
  let pending = [];
  let pendingCount = 0;

  const flushPending = () => {
    if (!pending.length) return;
    pages.push(makePage(`practice-page-${pages.length + 1}`, pages.length, `第 ${pages.length + 1} 頁`, pending));
    pending = [];
    pendingCount = 0;
  };

  units.forEach((unit) => {
    const size = unit.questions.length;
    if (size >= PRACTICE_PAGE_SIZE) {
      flushPending();
      pages.push(
        makePage(`practice-page-${pages.length + 1}-${unit.id}`, pages.length, unit.title || `第 ${pages.length + 1} 頁`, [
          unit,
        ])
      );
      return;
    }

    if (pendingCount + size > PRACTICE_PAGE_SIZE) {
      flushPending();
    }
    pending.push(unit);
    pendingCount += size;
    if (pendingCount === PRACTICE_PAGE_SIZE) {
      flushPending();
    }
  });

  flushPending();
  return pages;
}

function selectedPracticeLimit() {
  const value = Number(els.practiceCount?.value || PRACTICE_MAX);
  return Math.min(PRACTICE_MAX, Math.max(PRACTICE_PAGE_SIZE, value));
}

function buildPracticeSession(questions, limit) {
  const selected = [];
  let selectedCount = 0;

  shuffle(buildUnits(questions)).forEach((unit) => {
    const size = unit.questions.length;
    if (selectedCount + size > limit) return;
    selected.push(unit);
    selectedCount += size;
  });

  return packPracticePages(selected);
}

function unitQuestionCount(units) {
  return units.reduce((sum, unit) => sum + unit.questions.length, 0);
}

function selectUnitsForQuestionCount(units, target) {
  const selected = [];
  let count = 0;
  shuffle(units).forEach((unit) => {
    const size = unit.questions.length;
    if (count + size > target) return;
    selected.push(unit);
    count += size;
  });
  return selected;
}

function examQuestionsForSubject(subject) {
  return DATA.questions.filter(
    (question) => isDrillable(question) && (subject === "all" || question.subject === subject)
  );
}

function buildCivicsEnglishExam() {
  const questions = examQuestionsForSubject("公民與英文");
  const units = buildUnits(questions);
  const civicsUnits = units.filter((unit) => unit.questions.every((question) => question.id.startsWith("公英-公民-")));
  const englishUnits = units.filter((unit) => unit.questions.every((question) => question.id.startsWith("公英-英文")));
  const englishGroupUnits = englishUnits.filter((unit) => unit.questions.length > 1);

  const civics = selectUnitsForQuestionCount(civicsUnits, 35);
  const requiredGroup = shuffle(englishGroupUnits)[0];
  const remainingEnglish = englishUnits.filter((unit) => !requiredGroup || unit.id !== requiredGroup.id);
  const english = requiredGroup
    ? [requiredGroup, ...selectUnitsForQuestionCount(remainingEnglish, EXAM_SIZE - 35 - requiredGroup.questions.length)]
    : selectUnitsForQuestionCount(englishUnits, EXAM_SIZE - 35);
  english.sort((a, b) => b.questions.length - a.questions.length);

  return [...civics, ...english];
}

function buildChineseExam() {
  const units = buildUnits(examQuestionsForSubject("國文"));
  const singleUnits = units.filter((unit) => unit.questions.every((question) => question.type === "單選題"));
  const multipleUnits = units.filter((unit) => unit.questions.every((question) => question.type === "複選題"));
  const singles = selectUnitsForQuestionCount(singleUnits, CHINESE_EXAM_SINGLE_COUNT);
  const multiples = selectUnitsForQuestionCount(multipleUnits, CHINESE_EXAM_MULTIPLE_COUNT);
  return [...singles, ...multiples];
}

function buildDefaultExam() {
  return selectUnitsForQuestionCount(buildUnits(filteredQuestions({ ignoreType: true })), EXAM_SIZE).sort(
    (a, b) => b.questions.length - a.questions.length
  );
}

function buildExamSession() {
  const subject = els.subjectSelect.value;
  if (subject === "公民與英文") return buildCivicsEnglishExam();
  if (subject === "國文") return buildChineseExam();
  return buildDefaultExam();
}

function selectedExamSize() {
  return els.subjectSelect.value === "國文" ? CHINESE_EXAM_SIZE : EXAM_SIZE;
}

function currentUnit() {
  return state.units[state.currentIndex] || null;
}

function resetWork() {
  state.answers = {};
  state.revealed = {};
  state.examSubmitted = false;
  state.questionNumbers = {};
}

function populateSubjects() {
  const options = [`<option value="all">全部科目</option>`]
    .concat(DATA.subjects.map((subject) => `<option value="${escapeHtml(subject.id)}">${escapeHtml(subject.name)}</option>`));
  els.subjectSelect.innerHTML = options.join("");
}

function populateYears() {
  const subject = els.subjectSelect.value;
  const previous = els.yearSelect.value;

  if (subject === "all") {
    els.yearSelect.innerHTML = '<option value="">請先選擇科目</option>';
    els.yearSelect.disabled = true;
    return;
  }

  const sessions = availableHistorySessions(subject);
  if (!sessions.length) {
    els.yearSelect.innerHTML = '<option value="">沒有年度資料</option>';
    els.yearSelect.disabled = true;
    return;
  }

  els.yearSelect.disabled = false;
  els.yearSelect.innerHTML = sessions
    .map(
      (session) =>
        `<option value="${escapeHtml(session.id)}">${escapeHtml(session.label)}（${session.count} 題）</option>`
    )
    .join("");
  els.yearSelect.value = sessions.some((session) => session.id === previous) ? previous : sessions[0].id;
}

function updateStats() {
  if (state.mode === "history") {
    const questions = historicalQuestions();
    const units = buildUnits(questions);
    const pages = packPracticePages(units);
    const grouped = units.filter((unit) => unit.questions.length > 1).length;
    const session = selectedHistorySession();
    els.historyCount.textContent = questions.length ? `${questions.length} 題` : "—";
    els.filterStats.innerHTML = [
      `年度／場次：${session ? escapeHtml(session.label) : "—"}`,
      `歷年試題：${questions.length} 題，共 ${pages.length} 頁`,
      `題組：${grouped} 組`,
    ].join("<br>");
    return;
  }

  const questions = filteredQuestions({ ignoreType: shouldIgnoreTypeFilter() });
  const units = buildUnits(questions);
  const grouped = units.filter((unit) => unit.questions.length > 1).length;
  const subject = els.subjectSelect.value;
  const outdated = DATA.questions.filter(
    (question) => !isDrillable(question) && (subject === "all" || question.subject === subject)
  ).length;
  const lines = [
    `目前範圍：${questions.length} 題`,
    `題組：${grouped} 組`,
  ];
  if (outdated) lines.push(`舊法題：已排除 ${outdated} 題（僅於歷年試題出現）`);
  if (state.mode === "practice") {
    lines.push(`題型：${els.typeSelect.value === "all" ? "全部題型" : els.typeSelect.value}`);
  }
  if (state.mode === "practice") {
    lines.push(`練習題數：${selectedPracticeLimit()} 題，每頁 ${PRACTICE_PAGE_SIZE} 題`);
  }
  if (state.mode === "exam") {
    lines.push(`模擬考題數：固定 ${selectedExamSize()} 題，每頁 ${PRACTICE_PAGE_SIZE} 題`);
  }
  els.filterStats.innerHTML = lines.join("<br>");
}

function updateModeUi() {
  els.modeButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.mode === state.mode);
  });
  els.examSettings.classList.toggle("visible", state.mode === "exam");
  els.examCount.textContent = `固定 ${selectedExamSize()} 題`;
  els.practiceSettings.classList.toggle("visible", state.mode === "practice");
  els.typeSettings.classList.toggle("visible", state.mode === "practice");
  els.historySettings.classList.toggle("visible", state.mode === "history");
  els.typeSelect.disabled = state.mode !== "practice";
  els.primaryAction.disabled = false;
  if (state.mode === "practice") {
    els.primaryAction.textContent = "開始練習";
    els.modeSummary.textContent = "練習模式";
  } else if (state.mode === "random") {
    els.primaryAction.textContent = "隨機抽題";
    els.modeSummary.textContent = "隨機出題";
  } else if (state.mode === "exam") {
    els.primaryAction.textContent = "開始模擬考";
    els.modeSummary.textContent = state.examSubmitted ? "已交卷" : "模擬考試";
  } else {
    els.primaryAction.textContent = "開始歷年試題";
    els.modeSummary.textContent = state.examSubmitted ? "已交卷" : "歷年試題";
    els.primaryAction.disabled = historicalQuestions().length === 0;
  }
}

function startPractice() {
  resetWork();
  state.units = buildPracticeSession(filteredQuestions(), selectedPracticeLimit());
  state.currentIndex = 0;
  render();
}

function drawRandomUnit() {
  resetWork();
  const units = buildUnits(filteredQuestions({ ignoreType: true }));
  const unit = units[Math.floor(Math.random() * units.length)];
  state.units = unit ? [makePage(unit.id, 0, unit.title, [unit])] : [];
  state.currentIndex = 0;
  render();
}

function startExam() {
  resetWork();
  state.units = packPracticePages(buildExamSession());
  state.currentIndex = 0;
  render();
}

function startHistory() {
  resetWork();
  const questions = historicalQuestions();
  state.questionNumbers = Object.fromEntries(questions.map((question, index) => [question.id, index + 1]));
  state.units = packPracticePages(buildUnits(questions));
  state.currentIndex = 0;
  render();
}

function primaryAction() {
  if (state.mode === "practice") startPractice();
  if (state.mode === "random") drawRandomUnit();
  if (state.mode === "exam") startExam();
  if (state.mode === "history") startHistory();
}

function toggleAnswer(questionId, key) {
  if (isQuestionLocked(questionId)) return;
  const question = questionById.get(questionId);
  const current = getSelected(questionId);
  if (question.answerMode === "multiple") {
    state.answers[questionId] = current.includes(key)
      ? current.filter((item) => item !== key)
      : [...current, key].sort();
  } else {
    state.answers[questionId] = [key];
  }
  renderUnit();
}

function revealQuestion(questionId) {
  state.revealed[questionId] = true;
  renderUnit();
}

function submitExam() {
  state.examSubmitted = true;
  state.revealed = Object.fromEntries(state.units.flatMap((unit) => unit.questions.map((question) => [question.id, true])));
  render();
}

function renderOption(question, option) {
  const selected = getSelected(question.id).includes(option.key);
  const revealed = state.revealed[question.id] || state.examSubmitted;
  const correctOption = question.answer.includes(option.key);
  const disabled = isQuestionLocked(question.id) ? "disabled" : "";
  let className = "option-button";
  if (selected) className += " selected";
  if (revealed && correctOption) className += " correct";
  if (revealed && selected && !correctOption && !question.giveAll) className += " wrong";
  return `
    <button class="${className}" type="button" data-answer="${escapeHtml(question.id)}" data-key="${escapeHtml(option.key)}" ${disabled}>
      <span class="option-key">${escapeHtml(option.key)}</span>
      <span class="option-text">${formatText(option.text)}</span>
    </button>
  `;
}

// 詳解依行首【標籤】分段：【答案】不重複顯示（上方已有對錯與正確答案）；重點段落直接展開並排在前面，
// 其餘（法規依據、名詞補充、白話文、翻譯、參考資料）預設收合；題組的【全文翻譯】改在文章下方顯示一次。
const EXPLANATION_HIDDEN_TAGS = new Set(["答案"]);
const EXPLANATION_OPEN_TAGS = new Set(["解題", "解題過程", "判斷依據", "現行法提醒", "補充說明", "爭議說明"]);
const GROUP_TRANSLATION_TAG = "全文翻譯";
const explanationCache = new Map();

function explanationSections(question) {
  if (!explanationCache.has(question.id)) {
    const parts = (question.explanation || "").split(/(?:^|\n)【([^】]{1,20})】/);
    const sections = parts[0].trim() ? [{ tag: "", text: parts[0].trim() }] : [];
    for (let index = 1; index < parts.length; index += 2) {
      sections.push({ tag: parts[index], text: (parts[index + 1] || "").trim() });
    }
    explanationCache.set(question.id, sections);
  }
  return explanationCache.get(question.id);
}

function groupTranslation(unit) {
  for (const question of unit.questions) {
    const section = explanationSections(question).find((item) => item.tag === GROUP_TRANSLATION_TAG);
    if (section) return section.text;
  }
  return "";
}

function renderExplanation(question) {
  const inPassageGroup = Boolean(question.passage);
  const sections = explanationSections(question).filter(
    (section) =>
      !EXPLANATION_HIDDEN_TAGS.has(section.tag) && !(inPassageGroup && section.tag === GROUP_TRANSLATION_TAG)
  );
  const isOpen = (section) => !section.tag || EXPLANATION_OPEN_TAGS.has(section.tag);
  const open = sections.filter(isOpen).map(
    (section) =>
      `<div class="exp-section">${section.tag ? `<div class="exp-tag">${escapeHtml(section.tag)}</div>` : ""}<div>${formatRichText(section.text)}</div></div>`
  );
  const more = sections
    .filter((section) => !isOpen(section))
    .map(
      (section) =>
        `<details class="exp-more"><summary>${escapeHtml(section.tag)}</summary><div>${formatRichText(section.text)}</div></details>`
    );
  return `<div class="explanation">${[...open, ...more].join("")}${renderLawCheck(question)}</div>`;
}

// 引用法規的題目標示法規查核日期（tools/check_law_dates.py 查核全國法規資料庫等官方資料的日期）
function renderLawCheck(question) {
  const match = (question.lawCheckedAt || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return "";
  const checkedAt = `${match[1]} 年 ${Number(match[2])} 月 ${Number(match[3])} 日`;
  return `<p class="law-checked">法規查核日期：${checkedAt}（依全國法規資料庫等官方資料）。此後若法規再修正，請以現行條文為準。</p>`;
}

// 選項解析開頭的「正確。／錯誤。」（可帶括號限定，如「正確（依當年法）。」）顯示成標記
const VERDICT_PATTERN = /^(正確|錯誤)(（[^）]{1,20}）)?[。，；]/;

function renderAnalysisText(text) {
  const match = (text || "").match(VERDICT_PATTERN);
  if (!match) return formatText(text || "");
  const tone = match[1] === "正確" ? "verdict-good" : "verdict-bad";
  const mark = match[1] === "正確" ? "✓" : "✗";
  return `<span class="verdict ${tone}">${mark} ${escapeHtml(match[1] + (match[2] || ""))}</span>${formatText(text.slice(match[0].length))}`;
}

function renderOptionAnalysis(question) {
  if (!question.options.length) return "";
  const items = question.options
    .map((option) => {
      const isAnswer = question.answer.includes(option.key);
      const className = isAnswer ? "analysis-item answer" : "analysis-item";
      return `
        <li class="${className}">
          <span class="analysis-key">${escapeHtml(option.key)}</span>
          <div>
            <strong>${question.giveAll ? "一律給分" : isAnswer ? "本題答案" : "不是本題答案"}：${formatText(option.text)}</strong>
            <p>${renderAnalysisText(question.optionAnalysis?.[option.key])}</p>
          </div>
        </li>
      `;
    })
    .join("");
  return `
    <div class="option-analysis">
      <h3>選項解析</h3>
      <ul>${items}</ul>
    </div>
  `;
}

// 題目提示：舊法題（不進練習／隨機／模擬考）與爭議題（命題瑕疵，仍依官方答案計分）。
// 作答前只顯示標籤與提醒，說明內容等作答後才顯示，避免洩題。
const QUESTION_NOTICES = [
  {
    key: "outdatedNote",
    label: "舊法題",
    banner: "舊法題：相關法規已修正，本題依當年官方答案計分；現行法差異於作答後說明。",
    noteTitle: "現行法提醒",
  },
  {
    key: "disputedNote",
    label: "爭議題",
    banner: "爭議題：本題命題有瑕疵，依官方公布答案計分；爭議說明於作答後顯示。",
    noteTitle: "爭議說明",
  },
];

function questionNotices(question) {
  return QUESTION_NOTICES.filter((notice) => question[notice.key]);
}

function renderNoticeNotes(question) {
  return questionNotices(question)
    .map((notice) => `<div class="notice-note">${notice.noteTitle}：${formatText(question[notice.key])}</div>`)
    .join("");
}

function renderFeedback(question) {
  const revealed = state.revealed[question.id] || state.examSubmitted;
  if (!revealed) return "";
  if (question.giveAll) {
    return `
      <div class="feedback neutral">
        <strong>本題一律給分。</strong>
        ${renderNoticeNotes(question)}
        ${renderExplanation(question)}
        ${renderOptionAnalysis(question)}
      </div>
    `;
  }
  const correct = isCorrect(question);
  const tone = correct ? "good" : "bad";
  const headline = correct ? "答對" : `答錯：你選的是 ${escapeHtml(selectedLabel(question))}，正確答案是 ${escapeHtml(answerLabel(question))}`;
  return `
    <div class="feedback ${tone}">
      <strong>${headline}</strong>
      ${renderNoticeNotes(question)}
      ${renderExplanation(question)}
      ${renderOptionAnalysis(question)}
    </div>
  `;
}

function renderQuestion(question) {
  const selected = getSelected(question.id);
  const canCheck = selected.length > 0 || question.giveAll;
  const shouldShowCheck = !isSubmissionMode() && !isQuestionLocked(question.id);
  const historySession = state.mode === "history" ? selectedHistorySession() : null;
  const displayYear = question.year || historySession?.year;
  const year = displayYear ? `<span class="meta-pill">${escapeHtml(displayYear)} 年</span>` : "";
  const modeLabel = question.answerMode === "multiple" ? "複選" : question.giveAll ? "送分" : "單選";
  const questionCode = state.mode === "history" ? `第 ${state.questionNumbers[question.id] || "—"} 題` : question.id;
  return `
    <article class="question-card">
      <div class="question-topline">
        <span class="question-code">${escapeHtml(questionCode)}</span>
        <span class="meta-pill">${escapeHtml(question.subject)}</span>
        <span class="meta-pill">${escapeHtml(modeLabel)}</span>
        ${year}
        ${questionNotices(question).map((notice) => `<span class="meta-pill notice-pill">${notice.label}</span>`).join("")}
      </div>
      ${questionNotices(question).map((notice) => `<div class="notice-banner">${notice.banner}</div>`).join("")}
      <div class="stem">${formatWithTables(question.stem)}</div>
      <div class="options">${question.options.map((option) => renderOption(question, option)).join("")}</div>
      ${shouldShowCheck ? `
        <div class="question-actions">
          <button class="check-button" type="button" data-check="${escapeHtml(question.id)}" ${canCheck ? "" : "disabled"}>確認答案</button>
        </div>
      ` : ""}
      ${renderFeedback(question)}
    </article>
  `;
}

function renderExamResult() {
  if (!isSubmissionMode() || !state.examSubmitted) return "";
  const questions = state.units.flatMap((unit) => unit.questions);
  const correct = questions.filter((question) => isCorrect(question)).length;
  const answered = questions.filter((question) => getSelected(question.id).length || question.giveAll).length;
  const score = questions.length ? Math.round((correct / questions.length) * 100) : 0;
  const historySession = state.mode === "history" ? selectedHistorySession() : null;
  const title = historySession ? `${escapeHtml(historySession.label)}成績` : "成績";
  return `
    <section class="exam-result">
      <h2>${title} ${score} 分</h2>
      <div>答對 ${correct} / ${questions.length} 題，已作答 ${answered} 題。</div>
    </section>
  `;
}

function renderSubmitRow() {
  if (!isSubmissionMode() || state.examSubmitted || !state.units.length) return "";
  return `<div class="submit-row"><button class="submit-exam" id="submitExam" type="button">交卷計分</button></div>`;
}

function renderUnit() {
  const unit = currentUnit();
  if (!unit) {
    els.quizContent.innerHTML = `<div class="empty-state">目前範圍沒有題目。</div>`;
    els.unitProgress.textContent = "0 / 0";
    els.prevUnit.disabled = true;
    els.nextUnit.disabled = true;
    return;
  }

  const questionCount = unit.questions.length;
  const title = questionCount > 1 ? unit.title : unit.questions[0].id;
  const passage = unit.passages
    .map((item) => {
      let translation = "";
      if (item.translation) {
        const groupRevealed = item.questionIds.every((id) => state.revealed[id] || state.examSubmitted);
        translation = groupRevealed
          ? `<details class="exp-more passage-translation"><summary>全文翻譯</summary><div>${formatRichText(item.translation)}</div></details>`
          : `<p class="passage-hint">本題組全部確認答案（或交卷）後，可在此查看全文翻譯。</p>`;
      }
      return `<section class="passage-box"><h2 class="passage-title">${escapeHtml(item.title)}</h2><div class="passage-text">${formatWithTables(item.text)}</div>${translation}</section>`;
    })
    .join("");
  els.quizContent.innerHTML = [
    renderExamResult(),
    `<div class="unit-header">
      <h2 class="unit-title">${escapeHtml(title)}</h2>
      <div class="meta-row">
        <span class="meta-pill">${escapeHtml(unit.subject)}</span>
        <span class="meta-pill">${questionCount} 題</span>
      </div>
    </div>`,
    passage,
    ...unit.questions.map(renderQuestion),
    renderSubmitRow(),
  ].join("");

  els.unitProgress.textContent = `${state.currentIndex + 1} / ${state.units.length}`;
  els.prevUnit.disabled = state.currentIndex <= 0;
  els.nextUnit.disabled = state.currentIndex >= state.units.length - 1;
}

function render() {
  updateModeUi();
  updateStats();
  renderUnit();
}

function resetAndRender() {
  resetWork();
  state.units = [];
  state.currentIndex = 0;
  render();
}

function init() {
  populateSubjects();
  populateYears();
  els.bankSummary.textContent = `${DATA.subjects.length} 科，${DATA.questions.length} 題，資料日期 ${DATA.generatedAt}`;
  updateStats();
  render();

  els.modeButtons.forEach((button) => {
    button.addEventListener("click", () => {
      state.mode = button.dataset.mode;
      populateYears();
      resetAndRender();
    });
  });
  els.subjectSelect.addEventListener("change", () => {
    populateYears();
    resetAndRender();
  });
  els.typeSelect.addEventListener("change", resetAndRender);
  els.practiceCount.addEventListener("change", resetAndRender);
  els.yearSelect.addEventListener("change", resetAndRender);
  // 題目區只綁一次點擊（事件委派），重繪時不必重新綁定各按鈕
  els.quizContent.addEventListener("click", (event) => {
    const answer = event.target.closest("[data-answer]");
    if (answer) {
      if (!answer.disabled) toggleAnswer(answer.dataset.answer, answer.dataset.key);
      return;
    }
    const check = event.target.closest("[data-check]");
    if (check) {
      if (!check.disabled) revealQuestion(check.dataset.check);
      return;
    }
    if (event.target.closest("#submitExam")) submitExam();
  });
  els.primaryAction.addEventListener("click", primaryAction);
  els.secondaryAction.addEventListener("click", resetAndRender);
  els.prevUnit.addEventListener("click", () => {
    state.currentIndex = Math.max(0, state.currentIndex - 1);
    renderUnit();
  });
  els.nextUnit.addEventListener("click", () => {
    state.currentIndex = Math.min(state.units.length - 1, state.currentIndex + 1);
    renderUnit();
  });
}

init();
