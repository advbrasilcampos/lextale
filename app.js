// LexTale — Motor Modular PWA v4
let DICTIONARY_DB = {};
let BASE_LESSONS = [];
let lessons = [];
let wordStates = {};
let srsData = {};
let completedLessons = {};
let lessonBookmarks = {};
let activeLessonId = "act-1";
let activeDomainFilter = "all";
let activeSlideIdx = 0;
let selectedTerm = null;
let vocabFilter = "learning";
let vocabSearchQuery = "";
let flashcardIndex = 0;
let selectedMcqAnswers = {};
let isPlayingScene = false;
let playbackSpeed = 0.25;
let currentPartIndex = 0;
let lastBoundaryCharIdx = 0;
let showLineTranslations = false;
let listeningMode = false;
let legalFocusMode = false;
let carouselCollapsed = false;
let readerFontSize = 16;
let playbackWatchdog = null;
let activeAudioEl = null;

const STORAGE_WORDS = "jurislingq_words_v4";
const STORAGE_CUSTOM = "jurislingq_custom_v4";
const STORAGE_DONE = "jurislingq_done_v4";
const STORAGE_SRS = "jurislingq_srs_v4";
const STORAGE_DAILY = "jurislingq_daily_v4";
const STORAGE_BOOKMARKS = "jurislingq_bookmarks_v4";

function getTodayKey() { return new Date().toISOString().slice(0, 10); }

function getDailyReviews() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_DAILY) || "{}");
    return raw.date === getTodayKey() ? (raw.count || 0) : 0;
  } catch (e) { return 0; }
}

function incrementDailyReviews() {
  try {
    const count = getDailyReviews() + 1;
    localStorage.setItem(STORAGE_DAILY, JSON.stringify({ date: getTodayKey(), count }));
    const el = document.getElementById("daily-reviews-count");
    if (el) el.textContent = count;
  } catch (e) {}
}

function loadState() {
  try { const sw = localStorage.getItem(STORAGE_WORDS); if (sw) wordStates = JSON.parse(sw); } catch (e) {}
  try { const ss = localStorage.getItem(STORAGE_SRS); if (ss) srsData = JSON.parse(ss); } catch (e) {}
  try { const sb = localStorage.getItem(STORAGE_BOOKMARKS); if (sb) lessonBookmarks = JSON.parse(sb); } catch (e) {}
  lessons = BASE_LESSONS.map(l => ({ ...l }));
  try {
    const sc = localStorage.getItem(STORAGE_CUSTOM);
    if (sc) {
      const parsed = JSON.parse(sc);
      if (Array.isArray(parsed)) lessons = [...lessons, ...parsed];
    }
  } catch (e) {}
  try { const sd = localStorage.getItem(STORAGE_DONE); if (sd) completedLessons = JSON.parse(sd); } catch (e) {}
  if (lessons.length > 0 && !lessons.some(l => l.id === activeLessonId)) activeLessonId = lessons[0].id;
}

function saveWords() { try { localStorage.setItem(STORAGE_WORDS, JSON.stringify(wordStates)); } catch (e) {} }
function saveSrs() { try { localStorage.setItem(STORAGE_SRS, JSON.stringify(srsData)); } catch (e) {} }
function saveDone() { try { localStorage.setItem(STORAGE_DONE, JSON.stringify(completedLessons)); } catch (e) {} }
function saveBookmarks() { try { localStorage.setItem(STORAGE_BOOKMARKS, JSON.stringify(lessonBookmarks)); } catch (e) {} }
function saveCustomLessons() {
  try {
    const custom = lessons.filter(l => !BASE_LESSONS.some(d => d.id === l.id));
    localStorage.setItem(STORAGE_CUSTOM, JSON.stringify(custom));
  } catch (e) {}
}

function getStatus(key) { return wordStates[key.toLowerCase()] || "new"; }

function setStatus(key, status) {
  const k = key.toLowerCase();
  if (status === "new") delete wordStates[k];
  else wordStates[k] = status;
  if (status === "learning" && !srsData[k]) {
    srsData[k] = { reps: 0, nextReview: Date.now() };
    saveSrs();
  }
  saveWords();
  refreshTokenColorsInPlace();
  updateStats();
  if (selectedTerm && selectedTerm.toLowerCase() === k) syncWordInfo(selectedTerm);
}

function lookupInfo(rawTerm) {
  const k = (rawTerm || "").toLowerCase().trim();
  const clean = k.replace(/[.,!?;:"()]+/g, "").replace(/[’']/g, "'");
  const base = clean.replace(/'s$/, "");
  const candidates = [k, clean, base, base.replace(/s$/, ""), base.replace(/ed$/, ""), base.replace(/ing$/, ""), base.replace(/ly$/, "")];

  for (const c of candidates) {
    if (c && DICTIONARY_DB[c]) {
      const entry = DICTIONARY_DB[c];
      return {
        term: rawTerm,
        translation: entry[0],
        category: entry[1] || "vocabulário",
        note: entry[2] || "Termo presente no contexto da história."
      };
    }
  }
  return {
    term: rawTerm,
    translation: `Termo em inglês: "${clean}"`,
    category: "vocabulário do texto",
    note: "Clique em 'Aprendendo' para salvar na sua Caixa de Vocabulário e revisar depois nos Flashcards."
  };
}

function tokenizeLine(text, chunks) {
  const sorted = [...(chunks || [])].sort((a, b) => b.length - a.length);
  if (sorted.length === 0) {
    return text.split(/(\s+)/).map(part => {
      if (/^\s+$/.test(part) || part === "") return { type: "space", text: part };
      const clean = part.replace(/^[^a-zA-Z0-9'-]+|[^a-zA-Z0-9'-]+$/g, "");
      if (!clean) return { type: "punct", text: part };
      const idx = part.indexOf(clean);
      return { type: "word", text: clean, key: clean.toLowerCase(), prefix: part.slice(0, idx), suffix: part.slice(idx + clean.length), isChunk: false };
    });
  }
  const escaped = sorted.map(c => c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const regex = new RegExp("(" + escaped.join("|") + ")", "gi");
  const tokens = [];
  text.split(regex).forEach(seg => {
    if (!seg) return;
    const isChunk = sorted.some(c => c.toLowerCase() === seg.toLowerCase());
    if (isChunk) {
      tokens.push({ type: "word", text: seg, key: seg.toLowerCase(), prefix: "", suffix: "", isChunk: true });
    } else {
      seg.split(/(\s+)/).forEach(part => {
        if (/^\s+$/.test(part) || part === "") {
          tokens.push({ type: "space", text: part });
        } else {
          const clean = part.replace(/^[^a-zA-Z0-9'-]+|[^a-zA-Z0-9'-]+$/g, "");
          if (!clean) {
            tokens.push({ type: "punct", text: part });
          } else {
            const idx = part.indexOf(clean);
            tokens.push({ type: "word", text: clean, key: clean.toLowerCase(), prefix: part.slice(0, idx), suffix: part.slice(idx + clean.length), isChunk: false });
          }
        }
      });
    }
  });
  return tokens;
}

function getActiveLesson() { return lessons.find(l => l.id === activeLessonId) || lessons[0]; }

function getFilteredLessons() {
  if (activeDomainFilter === "all") return lessons;
  return lessons.filter(l => (l.domain || "cotidiano") === activeDomainFilter);
}

function renderTabs() {
  const container = document.getElementById("lesson-tabs");
  const jumpSelect = document.getElementById("lesson-jump-select");
  container.innerHTML = "";
  jumpSelect.innerHTML = "";
  let doneCount = 0;
  lessons.forEach(l => {
    if (completedLessons[l.id]) doneCount++;
    const opt = document.createElement("option");
    opt.value = l.id;
    opt.textContent = (completedLessons[l.id] ? "✓ " : "") + l.title;
    if (l.id === activeLessonId) opt.selected = true;
    jumpSelect.appendChild(opt);
  });

  getFilteredLessons().forEach(l => {
    const isDone = !!completedLessons[l.id];
    const active = l.id === activeLessonId;
    const btn = document.createElement("button");
    btn.className = `shrink-0 px-3 py-1.5 rounded-lg text-xs font-bold border transition flex items-center gap-1.5 ${
      active
        ? "bg-[#C9A227] text-[#0B1324] border-[#C9A227] shadow"
        : "bg-[#111D35] text-[#CBD5E1] border-[#24385E] hover:border-[#C9A227]/60 hover:text-white"
    }`;
    btn.innerHTML = `<span>${l.title}</span>` + (isDone ? `<span class="${active ? "text-[#0B1324]" : "text-emerald-400"}">&#10003;</span>` : "");
    btn.onclick = () => switchLesson(l.id);
    container.appendChild(btn);
    if (active) setTimeout(() => btn.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" }), 30);
  });
  document.getElementById("progress-pill").textContent = `${doneCount}/${lessons.length} concluídas`;
}

function switchLesson(id) {
  stopGuidedPlayback();
  hideTooltip();
  activeLessonId = id;
  activeSlideIdx = 0;
  selectedTerm = null;
  currentPartIndex = 0;
  lastBoundaryCharIdx = 0;
  renderTabs();
  renderCarousel();
  renderPlaybackSegments();
  renderReaderOnly();
  updateStats();
  const l = getActiveLesson();
  document.getElementById("lesson-badge").textContent = l.badge || "ATIVIDADE";
  document.getElementById("lesson-title").textContent = l.title;
  const iracText = document.getElementById("lesson-irac-text");
  if (iracText) iracText.textContent = l.iracNote || "Prática integrada de leitura, escuta e vocabulário jurídico.";
  updateBookmarkBanner();
}

function updateBookmarkBanner() {
  const lesson = getActiveLesson();
  const btn = document.getElementById("btn-resume-bookmark");
  const progEl = document.getElementById("lesson-read-progress");
  if (!lesson || !btn) return;
  const savedIdx = lessonBookmarks[lesson.id];
  const total = lesson.lines.length;
  if (typeof savedIdx === "number" && savedIdx > 0 && savedIdx < total) {
    btn.classList.remove("hidden");
    btn.textContent = `Continuar da fala ${savedIdx + 1}/${total}`;
  } else {
    btn.classList.add("hidden");
  }
  const currentPos = typeof savedIdx === "number" ? savedIdx + 1 : 0;
  const pct = total > 0 ? Math.round((currentPos / total) * 100) : 0;
  if (progEl) progEl.textContent = currentPos > 0 ? `• Progresso: ${currentPos}/${total} (${pct}%)` : "";
}

function recordBookmark(idx) {
  const lesson = getActiveLesson();
  if (!lesson) return;
  lessonBookmarks[lesson.id] = idx;
  saveBookmarks();
  updateBookmarkBanner();
}

function renderCarousel() {
  const lesson = getActiveLesson();
  if (!lesson) return;
  const slides = lesson.slides && lesson.slides.length ? lesson.slides : [{ img: "assets/office.webp", caption: lesson.title }];
  if (activeSlideIdx >= slides.length) activeSlideIdx = 0;
  if (activeSlideIdx < 0) activeSlideIdx = slides.length - 1;

  const slide = slides[activeSlideIdx];
  const imgEl = document.getElementById("carousel-img");
  imgEl.src = slide.img;
  // Native 16:9 panels (a21_p*) fill widescreen cleanly; 1:1 panels stay uncropped inside 16:9 frame
  imgEl.className = slide.img.includes("a21_p")
    ? "w-full h-full object-cover block bg-[#070D1A]"
    : "w-full h-full object-contain block bg-[#070D1A]";

  document.getElementById("carousel-counter").textContent = `Quadro ${activeSlideIdx + 1} de ${slides.length}`;
  document.getElementById("carousel-caption").textContent = slide.caption;

  const dots = document.getElementById("carousel-dots");
  dots.innerHTML = "";
  slides.forEach((_, i) => {
    const d = document.createElement("button");
    d.className = `h-2 rounded-full transition-all ${i === activeSlideIdx ? "w-6 bg-[#C9A227]" : "w-2 bg-[#2B4370] hover:bg-[#496BB0]"}`;
    d.onclick = () => { activeSlideIdx = i; renderCarousel(); };
    dots.appendChild(d);
  });
}

function renderPlaybackSegments() {
  const lesson = getActiveLesson();
  if (!lesson) return;
  const segBox = document.getElementById("playback-segments");
  segBox.innerHTML = "";
  lesson.lines.forEach((line, idx) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.dataset.segIdx = idx;
    btn.className = `px-2 py-1 rounded text-[11px] font-semibold border transition ${
      idx === currentPartIndex && isPlayingScene
        ? "bg-[#C9A227] text-[#0B1324] border-[#C9A227]"
        : "bg-[#162749] text-[#CBD5E1] border-[#2B4370] hover:border-[#C9A227]"
    }`;
    const label = line.speaker ? `${idx + 1}. ${line.speaker}` : `Parte ${idx + 1}`;
    btn.textContent = label;
    btn.onclick = () => startGuidedPlaybackFrom(idx);
    segBox.appendChild(btn);
  });
  updatePlaybackBarUI(isPlayingScene ? currentPartIndex : -1);
}

function updatePlaybackBarUI(activeIdx) {
  const lesson = getActiveLesson();
  if (!lesson) return;
  const total = lesson.lines.length;
  const fill = document.getElementById("playback-progress-fill");
  const label = document.getElementById("playback-part-label");
  if (activeIdx < 0 || total === 0) {
    fill.style.width = "0%";
    label.textContent = `Parte 0 de ${total}`;
  } else {
    const pct = Math.round(((activeIdx + 1) / total) * 100);
    fill.style.width = `${pct}%`;
    const sp = lesson.lines[activeIdx].speaker || `Parte ${activeIdx + 1}`;
    label.textContent = `Parte ${activeIdx + 1} de ${total} • ${sp}`;
  }
  document.querySelectorAll("#playback-segments button").forEach(b => {
    const i = parseInt(b.dataset.segIdx, 10);
    if (i === activeIdx) {
      b.className = "px-2 py-1 rounded text-[11px] font-bold border transition bg-[#C9A227] text-[#0B1324] border-[#C9A227]";
    } else {
      b.className = "px-2 py-1 rounded text-[11px] font-semibold border transition bg-[#162749] text-[#CBD5E1] border-[#2B4370] hover:border-[#C9A227]";
    }
  });
}

function refreshTokenColorsInPlace() {
  document.querySelectorAll("#reader-container .word-token").forEach(span => {
    const key = span.dataset.key;
    const st = getStatus(key);
    const isActive = selectedTerm && selectedTerm.toLowerCase() === key;
    const isChunk = span.dataset.chunk === "1";
    span.className = `word-token tok-${st}` + (isChunk ? " tok-chunk" : "") + (isActive ? " tok-active" : "");
  });
}

function clearSpeakingHighlights() {
  document.querySelectorAll("#reader-container .tok-speaking").forEach(el => el.classList.remove("tok-speaking"));
}

function renderReaderOnly() {
  const lesson = getActiveLesson();
  if (!lesson) return;
  const reader = document.getElementById("reader-container");
  reader.style.fontSize = `${readerFontSize}px`;
  reader.classList.toggle("listening-blur", listeningMode);
  reader.classList.toggle("legal-focus-mode", legalFocusMode);
  reader.innerHTML = "";
  lesson.lines.forEach((line, lineIdx) => {
    const row = document.createElement("div");
    row.className = "p-3.5 rounded-xl bg-[#0D172B] border border-[#203357] transition-all cursor-pointer";
    row.dataset.lineIdx = lineIdx;

    const headerRow = document.createElement("div");
    headerRow.className = "flex items-center justify-between gap-2 mb-1.5";

    const sp = document.createElement("div");
    sp.className = "text-[11px] font-extrabold uppercase tracking-wider text-[#C9A227]";
    sp.textContent = `${lineIdx + 1}. ${line.speaker || "Narrator"}`;
    sp.title = "Clique para ouvir a partir desta parte";
    sp.onclick = (e) => { e.stopPropagation(); startGuidedPlaybackFrom(lineIdx); };
    headerRow.appendChild(sp);

    const playOne = document.createElement("button");
    playOne.type = "button";
    playOne.className = "text-[11px] text-[#94A3B8] hover:text-[#C9A227] font-semibold";
    playOne.textContent = "Ouvir fala";
    playOne.onclick = (e) => {
      e.stopPropagation();
      stopGuidedPlayback();
      currentPartIndex = lineIdx;
      lastBoundaryCharIdx = 0;
      recordBookmark(lineIdx);
      updatePlaybackBarUI(lineIdx);
      speakLineObj(line, lineIdx, null, 0);
    };
    headerRow.appendChild(playOne);
    row.appendChild(headerRow);

    const p = document.createElement("div");
    p.className = "line-text-wrap";
    const tokens = tokenizeLine(line.text, lesson.chunks || []);
    let charCursor = 0;
    tokens.forEach(tok => {
      if (tok.type !== "word") {
        p.appendChild(document.createTextNode(tok.text));
        charCursor += tok.text.length;
      } else {
        if (tok.prefix) {
          p.appendChild(document.createTextNode(tok.prefix));
          charCursor += tok.prefix.length;
        }
        const span = document.createElement("span");
        const st = getStatus(tok.key);
        const isActive = selectedTerm && selectedTerm.toLowerCase() === tok.key;
        span.className = `word-token tok-${st}` + (tok.isChunk ? " tok-chunk" : "") + (isActive ? " tok-active" : "");
        span.textContent = tok.text;
        span.dataset.key = tok.key;
        span.dataset.chunk = tok.isChunk ? "1" : "0";
        span.dataset.start = charCursor;
        span.dataset.end = charCursor + tok.text.length;
        charCursor += tok.text.length;
        span.onclick = (ev) => {
          ev.stopPropagation();
          selectedTerm = tok.text;
          recordBookmark(lineIdx);
          const targetRect = ev.currentTarget.getBoundingClientRect();
          refreshTokenColorsInPlace();
          syncWordInfo(tok.text);
          showTooltipAtRect(tok.text, targetRect);
          speakText(tok.text, true, line.speaker, line.gender);
        };
        p.appendChild(span);
        if (tok.suffix) {
          p.appendChild(document.createTextNode(tok.suffix));
          charCursor += tok.suffix.length;
        }
      }
    });
    row.appendChild(p);

    if (showLineTranslations) {
      const trBox = document.createElement("p");
      trBox.className = "mt-2 pt-2 border-t border-[#1E3156] text-xs sm:text-sm text-sky-200/95 leading-relaxed";
      trBox.textContent = line.pt || "Tradução contextual disponível para histórias do acervo oficial.";
      row.appendChild(trBox);
    }

    reader.appendChild(row);
  });
}

function syncWordInfo(rawTerm) {
  const info = lookupInfo(rawTerm);
  const status = getStatus(rawTerm);
  document.getElementById("insp-term").textContent = info.term;
  document.getElementById("btn-tts-word").classList.remove("hidden");
  document.getElementById("insp-category").textContent = info.category;
  document.getElementById("insp-translation").textContent = info.translation;
  document.getElementById("insp-note").textContent = info.note;

  const pill = document.getElementById("insp-status-pill");
  if (status === "new") {
    pill.textContent = "Nova (Azul)";
    pill.className = "px-2 py-0.5 rounded-full text-[11px] font-bold bg-sky-500/20 text-sky-300 border border-sky-500/40";
  } else if (status === "learning") {
    pill.textContent = "Aprendendo (Amarela)";
    pill.className = "px-2 py-0.5 rounded-full text-[11px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40";
  } else {
    pill.textContent = "Conhecida";
    pill.className = "px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40";
  }
}

function showTooltipAtRect(rawTerm, rect) {
  const tip = document.getElementById("floating-tooltip");
  const info = lookupInfo(rawTerm);
  document.getElementById("ft-term").textContent = rawTerm;
  document.getElementById("ft-category").textContent = info.category;
  document.getElementById("ft-translation").textContent = info.translation;
  document.getElementById("ft-note").textContent = info.note;
  tip.classList.remove("hidden");

  const tipW = tip.offsetWidth || 300;
  const tipH = tip.offsetHeight || 200;
  let left = rect.left + (rect.width / 2) - (tipW / 2);
  left = Math.max(12, Math.min(left, window.innerWidth - tipW - 12));

  let top = rect.bottom + 8;
  if (top + tipH > window.innerHeight - 10) top = Math.max(10, rect.top - tipH - 8);
  tip.style.left = Math.round(left) + "px";
  tip.style.top = Math.round(top) + "px";
}

function hideTooltip() { document.getElementById("floating-tooltip").classList.add("hidden"); }

function updateStats() {
  const lesson = getActiveLesson();
  if (!lesson) return;
  const uniqueKeys = new Set();
  lesson.lines.forEach(l => tokenizeLine(l.text, lesson.chunks || []).forEach(t => {
    if (t.type === "word") uniqueKeys.add(t.key);
  }));
  let n = 0, lr = 0, kn = 0;
  uniqueKeys.forEach(k => {
    const s = getStatus(k);
    if (s === "new") n++; else if (s === "learning") lr++; else kn++;
  });
  document.getElementById("stat-new").textContent = n;
  document.getElementById("stat-learning").textContent = lr;
  document.getElementById("stat-known").textContent = kn;
  document.getElementById("vocab-badge").textContent = Object.values(wordStates).filter(v => v === "learning").length;

  const totalDict = Math.max(1, Object.keys(DICTIONARY_DB).length);
  const totalKnown = Object.values(wordStates).filter(v => v === "known").length;
  const masteryPct = Math.min(100, Math.round((totalKnown / totalDict) * 100));
  const masteryEl = document.getElementById("global-mastery-pill");
  if (masteryEl) masteryEl.textContent = `Domínio: ${masteryPct}% (${totalKnown})`;

  const dailyEl = document.getElementById("daily-reviews-count");
  if (dailyEl) dailyEl.textContent = getDailyReviews();
}

function stopGuidedPlayback() {
  isPlayingScene = false;
  clearTimeout(playbackWatchdog);
  clearSpeakingHighlights();
  if (activeAudioEl) { try { activeAudioEl.pause(); activeAudioEl = null; } catch (e) {} }
  try { if ("speechSynthesis" in window) window.speechSynthesis.cancel(); } catch (e) {}
  document.querySelectorAll("#reader-container > div").forEach(el => {
    el.classList.remove("ring-2", "ring-amber-400", "bg-[#162749]");
  });
  updatePlaybackBarUI(-1);
  const btn = document.getElementById("btn-guided-read");
  if (btn) btn.textContent = `▶ Leitura Guiada (${playbackSpeed}x)`;
}

function startGuidedPlaybackFrom(startIdx, charOffset) {
  clearTimeout(playbackWatchdog);
  clearSpeakingHighlights();
  if (activeAudioEl) { try { activeAudioEl.pause(); activeAudioEl = null; } catch (e) {} }
  try { if ("speechSynthesis" in window) window.speechSynthesis.cancel(); } catch (e) {}
  isPlayingScene = true;
  currentPartIndex = startIdx;
  lastBoundaryCharIdx = charOffset || 0;
  document.getElementById("btn-guided-read").textContent = "■ Parar Leitura";
  runPlaybackStep(charOffset || 0);
}

function runPlaybackStep(charOffset) {
  const lesson = getActiveLesson();
  const rows = document.querySelectorAll("#reader-container > div");
  if (!isPlayingScene || !lesson || currentPartIndex >= lesson.lines.length) {
    stopGuidedPlayback();
    return;
  }
  const activeIdx = currentPartIndex;
  recordBookmark(activeIdx);
  clearSpeakingHighlights();
  rows.forEach(el => el.classList.remove("ring-2", "ring-amber-400", "bg-[#162749]"));
  if (rows[activeIdx]) {
    rows[activeIdx].classList.add("ring-2", "ring-amber-400", "bg-[#162749]");
    rows[activeIdx].scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
  updatePlaybackBarUI(activeIdx);

  const slides = lesson.slides || [];
  if (slides.length > 1) {
    const targetSlide = Math.min(slides.length - 1, Math.floor((activeIdx / lesson.lines.length) * slides.length));
    if (targetSlide !== activeSlideIdx) {
      activeSlideIdx = targetSlide;
      renderCarousel();
    }
  }

  const line = lesson.lines[activeIdx];
  const advanceNext = () => {
    clearTimeout(playbackWatchdog);
    clearSpeakingHighlights();
    if (!isPlayingScene || currentPartIndex !== activeIdx) return;
    currentPartIndex++;
    lastBoundaryCharIdx = 0;
    runPlaybackStep(0);
  };

  const fallbackMs = Math.max(4000, Math.round((line.text.length * 105) / Math.max(0.25, playbackSpeed))) + 4000;
  clearTimeout(playbackWatchdog);
  playbackWatchdog = setTimeout(advanceNext, fallbackMs);

  speakLineObj(line, activeIdx, advanceNext, charOffset || 0);
}

function rewindFiveWords() {
  const lesson = getActiveLesson();
  if (!lesson || !lesson.lines.length) return;
  const idx = Math.min(currentPartIndex, lesson.lines.length - 1);
  const fullText = lesson.lines[idx].text;
  const curPos = Math.max(0, Math.min(lastBoundaryCharIdx, fullText.length));
  const before = fullText.slice(0, curPos);
  const wordMatches = [...before.matchAll(/\S+/g)];
  let newOffset = 0;
  if (wordMatches.length > 5) {
    newOffset = wordMatches[wordMatches.length - 5].index;
  }
  lastBoundaryCharIdx = newOffset;
  if (isPlayingScene) {
    startGuidedPlaybackFrom(idx, newOffset);
  } else {
    speakLineObj(lesson.lines[idx], idx, null, newOffset);
  }
  showToast("Voltando 5 palavras...");
}

function speakLineObj(line, lineIdx, onEndCallback, charOffset) {
  const offset = charOffset || 0;
  const sliceText = offset > 0 ? line.text.slice(offset) : line.text;
  const dictationPauses = document.getElementById("chk-dictation-pauses")?.checked;

  if (line.audio && offset === 0) {
    try {
      const audio = new Audio(line.audio);
      activeAudioEl = audio;
      audio.playbackRate = Math.max(0.5, playbackSpeed);
      audio.onended = () => { activeAudioEl = null; if (onEndCallback) onEndCallback(); };
      audio.onerror = () => { activeAudioEl = null; speakText(sliceText, true, line.speaker, line.gender, onEndCallback, lineIdx, offset); };
      audio.play().catch(() => { activeAudioEl = null; speakText(sliceText, true, line.speaker, line.gender, onEndCallback, lineIdx, offset); });
      return;
    } catch (e) {}
  }

  if (dictationPauses && sliceText.split(/\s+/).length > 7) {
    speakInPausedChunks(sliceText, line.speaker, line.gender, onEndCallback, lineIdx, offset);
  } else {
    speakText(sliceText, true, line.speaker, line.gender, onEndCallback, lineIdx, offset);
  }
}

function speakInPausedChunks(text, speakerName, gender, onEndCallback, lineIdx, baseOffset) {
  const words = text.split(/(\s+)/);
  const chunks = [];
  let cur = "";
  let wordCount = 0;
  for (const w of words) {
    cur += w;
    if (!/^\s+$/.test(w) && w) wordCount++;
    if (wordCount >= 6 || /[.!?;,]$/.test(w)) {
      if (cur.trim()) chunks.push(cur);
      cur = "";
      wordCount = 0;
    }
  }
  if (cur.trim()) chunks.push(cur);

  let ci = 0;
  let runningOffset = baseOffset || 0;
  const nextChunk = () => {
    if (ci >= chunks.length || (isPlayingScene && currentPartIndex !== lineIdx)) {
      if (onEndCallback) onEndCallback();
      return;
    }
    const ch = chunks[ci];
    const thisOffset = runningOffset;
    runningOffset += ch.length;
    ci++;
    speakText(ch, true, speakerName, gender, () => {
      setTimeout(nextChunk, 420);
    }, lineIdx, thisOffset);
  };
  nextChunk();
}

function toggleGuidedPlayback() {
  if (isPlayingScene) { stopGuidedPlayback(); return; }
  startGuidedPlaybackFrom(0, 0);
}

let cachedVoices = [];
function refreshVoices() {
  try { if ("speechSynthesis" in window) cachedVoices = window.speechSynthesis.getVoices() || []; } catch (e) {}
}
refreshVoices();
try { if ("speechSynthesis" in window && "onvoiceschanged" in window.speechSynthesis) window.speechSynthesis.onvoiceschanged = refreshVoices; } catch (e) {}

function hashName(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = ((h << 5) - h) + str.charCodeAt(i);
  return Math.abs(h);
}

function getVoiceProfile(speakerName, explicitGender) {
  const sp = (speakerName || "").toLowerCase();
  const enVoices = cachedVoices.filter(v => (v.lang || "").toLowerCase().startsWith("en"));
  const femaleRe = /(female|zira|samantha|victoria|karen|moira|tessa|fiona|jenny|aria|sara|emma|olivia|google us english)/i;
  const maleRe = /(male|david|mark|guy|daniel|alex|fred|george|ryan|christopher|eric|andrew|brian)/i;

  const maleVoices = enVoices.filter(v => maleRe.test(v.name) && !/female/i.test(v.name));
  const femaleVoices = enVoices.filter(v => femaleRe.test(v.name));

  const isNarrator = explicitGender === "narrator" || (!explicitGender && (!sp || sp.includes("narrator")));
  const isFemaleChar = explicitGender === "female" || (!explicitGender && /(elena|maya|judge carter|judge alvarez|clara|sofia|carla|claire|applicant|wife|woman|whistleblower|clerk|prosecutor)/i.test(sp));

  if (isNarrator) return { voice: maleVoices[0] || enVoices[0] || null, pitch: 0.78 };
  const h = hashName(sp);
  if (isFemaleChar) {
    const femalePitches = [1.18, 1.26, 1.34];
    const fv = femaleVoices.length > 0 ? femaleVoices[h % femaleVoices.length] : (enVoices[1] || enVoices[0] || null);
    return { voice: fv, pitch: femalePitches[h % femalePitches.length] };
  }
  const malePitches = [0.96, 1.05, 1.14];
  const altMales = maleVoices.length > 1 ? maleVoices.slice(1) : maleVoices;
  const mv = altMales.length > 0 ? altMales[h % altMales.length] : (enVoices[2] || enVoices[0] || null);
  return { voice: mv, pitch: malePitches[h % malePitches.length] };
}

function highlightWordByCharIndex(lineIdx, charIndex) {
  const row = document.querySelector(`#reader-container > div[data-line-idx="${lineIdx}"]`);
  if (!row) return;
  clearSpeakingHighlights();
  const spans = row.querySelectorAll(".word-token");
  for (const sp of spans) {
    const st = parseInt(sp.dataset.start, 10);
    const en = parseInt(sp.dataset.end, 10);
    if (charIndex >= st && charIndex < en) {
      sp.classList.add("tok-speaking");
      break;
    }
  }
}

function speakText(text, silent, speakerName, explicitGender, onEndCallback, lineIdxForBoundary, baseCharOffset) {
  try {
    if (!("speechSynthesis" in window)) {
      if (!silent) showToast("Áudio TTS não disponível neste navegador.");
      if (onEndCallback) setTimeout(onEndCallback, 1200);
      return;
    }
    if (cachedVoices.length === 0) refreshVoices();
    window.speechSynthesis.cancel();

    setTimeout(() => {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = "en-US";
      u.rate = playbackSpeed;
      const prof = getVoiceProfile(speakerName, explicitGender);
      if (prof.voice) u.voice = prof.voice;
      u.pitch = prof.pitch;
      if (typeof lineIdxForBoundary === "number") {
        u.onboundary = (ev) => {
          if (ev.name === "word" || typeof ev.charIndex === "number") {
            const absIdx = (baseCharOffset || 0) + ev.charIndex;
            lastBoundaryCharIdx = absIdx;
            highlightWordByCharIndex(lineIdxForBoundary, absIdx);
          }
        };
      }
      if (onEndCallback) {
        u.onend = () => { clearSpeakingHighlights(); onEndCallback(); };
        u.onerror = () => { clearSpeakingHighlights(); onEndCallback(); };
      } else {
        u.onend = () => clearSpeakingHighlights();
      }
      window.speechSynthesis.speak(u);
    }, 40);
  } catch (e) {
    if (!silent) showToast("Áudio TTS bloqueado neste navegador.");
    if (onEndCallback) setTimeout(onEndCallback, 1200);
  }
}

function showToast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(window._toastTimer);
  window._toastTimer = setTimeout(() => t.classList.add("hidden"), 2600);
}

function openExerciseModal() {
  const lesson = getActiveLesson();
  selectedMcqAnswers = {};
  document.getElementById("finish-modal-title").textContent = lesson.title;
  const mcqBox = document.getElementById("mcq-container");
  mcqBox.innerHTML = "";

  (lesson.mcqs || []).forEach((item, qIdx) => {
    const card = document.createElement("div");
    card.className = "rounded-xl bg-[#0D172B] border border-[#24385E] p-4 space-y-2.5";
    const qTitle = document.createElement("p");
    qTitle.className = "text-xs sm:text-sm font-bold text-white";
    qTitle.textContent = `${qIdx + 1}. ${item.q}`;
    card.appendChild(qTitle);

    const optsWrap = document.createElement("div");
    optsWrap.className = "space-y-1.5";
    item.options.forEach((optText, oIdx) => {
      const optBtn = document.createElement("button");
      optBtn.type = "button";
      optBtn.className = "w-full text-left px-3 py-2 rounded-lg text-xs border border-[#2B4370] bg-[#142342] text-[#E2E8F0] hover:border-[#C9A227] transition";
      optBtn.textContent = optText;
      optBtn.onclick = () => {
        selectedMcqAnswers[qIdx] = oIdx;
        Array.from(optsWrap.children).forEach((b, bi) => {
          b.className = bi === oIdx
            ? "w-full text-left px-3 py-2 rounded-lg text-xs border border-[#C9A227] bg-[#C9A227]/20 text-amber-200 font-bold transition"
            : "w-full text-left px-3 py-2 rounded-lg text-xs border border-[#2B4370] bg-[#142342] text-[#E2E8F0] hover:border-[#C9A227] transition";
        });
      };
      optsWrap.appendChild(optBtn);
    });
    card.appendChild(optsWrap);

    const exp = document.createElement("p");
    exp.id = `mcq-exp-${qIdx}`;
    exp.className = "hidden text-xs pt-1";
    card.appendChild(exp);
    mcqBox.appendChild(card);
  });

  document.getElementById("writing-prompt").textContent = lesson.writingPrompt || "Escreva 1 ou 2 frases em inglês resumindo o caso.";
  const chips = document.getElementById("writing-target-chips");
  chips.innerHTML = "";
  (lesson.targetTerms || []).forEach(t => {
    const s = document.createElement("span");
    s.className = "px-2 py-0.5 rounded bg-[#162749] border border-[#2B4370] text-[11px] font-semibold text-amber-300";
    s.textContent = t;
    chips.appendChild(s);
  });

  document.getElementById("writing-input").value = "";
  document.getElementById("writing-correction-box").classList.add("hidden");
  document.getElementById("modal-finish").classList.remove("hidden");
  const idx = lessons.findIndex(l => l.id === activeLessonId);
  document.getElementById("btn-advance-next").classList.toggle("hidden", idx >= lessons.length - 1);
}

function gradeAllExercises() {
  const lesson = getActiveLesson();
  let mcqCorrect = 0;
  (lesson.mcqs || []).forEach((item, qIdx) => {
    const chosen = selectedMcqAnswers[qIdx];
    const expEl = document.getElementById(`mcq-exp-${qIdx}`);
    expEl.classList.remove("hidden");
    if (chosen === item.correct) {
      mcqCorrect++;
      expEl.className = "text-xs pt-1 text-emerald-300 font-medium";
      expEl.textContent = `✓ Correto! ${item.explanation}`;
    } else {
      expEl.className = "text-xs pt-1 text-rose-300 font-medium";
      expEl.textContent = `✗ Resposta certa: "${item.options[item.correct]}". ${item.explanation}`;
    }
  });

  const userText = document.getElementById("writing-input").value.trim();
  const targets = lesson.targetTerms || [];
  const used = targets.filter(t => userText.toLowerCase().includes(t.toLowerCase()));
  document.getElementById("writing-correction-box").classList.remove("hidden");
  document.getElementById("writing-model-answer").textContent = lesson.modelAnswer || "Use the target vocabulary in complete sentences.";

  const fbText = document.getElementById("writing-feedback");
  if (!userText) {
    fbText.textContent = `Objetivas: ${mcqCorrect}/${(lesson.mcqs || []).length}. Escreva sua frase acima ou confira o modelo ideal abaixo:`;
  } else {
    const tips = [];
    if (!/^[A-Z]/.test(userText)) tips.push("inicie com letra maiúscula");
    if (!/[.!?]$/.test(userText)) tips.push("finalize com ponto final");
    if (used.length < 2 && targets.length >= 2) tips.push(`use pelo menos 2 termos-alvo (${targets.join(", ")})`);
    fbText.textContent = `Objetivas: ${mcqCorrect}/${(lesson.mcqs || []).length} | Termos-alvo usados: ${used.length}/${targets.length}. ` +
      (tips.length === 0 ? "Excelente resposta e vocabulário!" : `Sugestão: ${tips.join("; ")}. Compare com o modelo abaixo:`);
  }

  completedLessons[lesson.id] = true;
  saveDone();
  renderTabs();
}

function renderVocabModal() {
  const list = document.getElementById("vocab-list");
  list.innerHTML = "";
  const q = vocabSearchQuery.trim().toLowerCase();
  const entries = Object.entries(wordStates).filter(([key, st]) => {
    const matchFilter = vocabFilter === "all" ? true : st === vocabFilter;
    if (!matchFilter) return false;
    if (!q) return true;
    const info = lookupInfo(key);
    return key.toLowerCase().includes(q) || (info.translation || "").toLowerCase().includes(q);
  });

  if (entries.length === 0) {
    list.innerHTML = `<p class="text-xs text-[#94A3B8] text-center py-6">Nenhuma palavra encontrada nesta categoria.</p>`;
    return;
  }
  entries.forEach(([key, st]) => {
    const info = lookupInfo(key);
    const row = document.createElement("div");
    row.className = "rounded-xl bg-[#0D172B] border border-[#24385E] p-3 flex items-center justify-between gap-3";
    row.innerHTML = `
      <div>
        <div class="flex items-center gap-2">
          <span class="font-bold text-sm text-white">${key}</span>
          <span class="text-xs font-semibold text-amber-300">${info.translation}</span>
        </div>
        <p class="text-[11px] text-[#94A3B8]">${info.note}</p>
      </div>
      <div class="flex items-center gap-1.5 shrink-0">
        <button class="v-speak px-2 py-1 rounded bg-[#162749] text-[#C9A227] text-xs font-bold">Ouvir</button>
        <button class="v-known px-2 py-1 rounded bg-emerald-500/20 text-emerald-300 text-xs font-bold">${st === "known" ? "Rever" : "Conhecida"}</button>
      </div>
    `;
    row.querySelector(".v-speak").onclick = () => speakText(key);
    row.querySelector(".v-known").onclick = () => {
      setStatus(key, st === "known" ? "learning" : "known");
      renderVocabModal();
    };
    list.appendChild(row);
  });
}

function getSortedSrsKeys() {
  const learningKeys = Object.entries(wordStates).filter(([, st]) => st === "learning").map(([k]) => k);
  return learningKeys.sort((a, b) => {
    const ra = (srsData[a] && srsData[a].nextReview) || 0;
    const rb = (srsData[b] && srsData[b].nextReview) || 0;
    return ra - rb;
  });
}

function renderFlashcard() {
  const learningKeys = getSortedSrsKeys();
  const area = document.getElementById("flashcard-area");
  if (learningKeys.length === 0) {
    document.getElementById("fc-counter").textContent = "0 / 0";
    document.getElementById("fc-srs-meta").textContent = "Revisões: 0";
    document.getElementById("fc-term").textContent = "Sem palavras em Aprendendo";
    document.getElementById("fc-answer").classList.add("hidden");
    area.dataset.currentKey = "";
    return;
  }
  if (flashcardIndex >= learningKeys.length) flashcardIndex = 0;
  const key = learningKeys[flashcardIndex];
  const info = lookupInfo(key);
  const meta = srsData[key] || { reps: 0 };
  document.getElementById("fc-counter").textContent = `${flashcardIndex + 1} / ${learningKeys.length}`;
  document.getElementById("fc-srs-meta").textContent = `Revisões: ${meta.reps || 0}`;
  document.getElementById("fc-term").textContent = key;
  document.getElementById("fc-translation").textContent = info.translation;
  document.getElementById("fc-note").textContent = info.note;
  document.getElementById("fc-answer").classList.add("hidden");
  area.dataset.currentKey = key;

  const autoAudio = document.getElementById("chk-fc-autoaudio");
  if (autoAudio && autoAudio.checked && !area.classList.contains("hidden")) speakText(key, true);
}

function bindEvents() {
  document.addEventListener("click", (e) => {
    const tip = document.getElementById("floating-tooltip");
    if (!tip.classList.contains("hidden") && !tip.contains(e.target) && !e.target.classList.contains("word-token")) {
      hideTooltip();
    }
  });

  // Navigation arrows & quick jump select
  document.getElementById("btn-tabs-left").onclick = () => {
    document.getElementById("lesson-tabs").scrollBy({ left: -280, behavior: "smooth" });
  };
  document.getElementById("btn-tabs-right").onclick = () => {
    document.getElementById("lesson-tabs").scrollBy({ left: 280, behavior: "smooth" });
  };
  document.getElementById("lesson-jump-select").onchange = (e) => {
    switchLesson(e.target.value);
  };

  document.getElementById("btn-toggle-carousel").onclick = (e) => {
    carouselCollapsed = !carouselCollapsed;
    document.getElementById("carousel-body").classList.toggle("hidden", carouselCollapsed);
    e.target.textContent = carouselCollapsed ? "Expandir Quadro" : "Recolher Quadro";
  };

  document.getElementById("btn-scroll-top").onclick = () => window.scrollTo({ top: 0, behavior: "smooth" });

  document.getElementById("btn-font-dec").onclick = () => {
    readerFontSize = Math.max(13, readerFontSize - 1);
    document.getElementById("reader-container").style.fontSize = `${readerFontSize}px`;
  };
  document.getElementById("btn-font-inc").onclick = () => {
    readerFontSize = Math.min(22, readerFontSize + 1);
    document.getElementById("reader-container").style.fontSize = `${readerFontSize}px`;
  };

  document.getElementById("btn-resume-bookmark").onclick = () => {
    const lesson = getActiveLesson();
    const idx = lessonBookmarks[lesson.id];
    if (typeof idx === "number") startGuidedPlaybackFrom(idx, 0);
  };

  document.querySelectorAll(".domain-btn").forEach(btn => {
    btn.onclick = () => {
      activeDomainFilter = btn.getAttribute("data-domain");
      document.querySelectorAll(".domain-btn").forEach(x => {
        const isAct = x.getAttribute("data-domain") === activeDomainFilter;
        x.className = isAct
          ? "domain-btn shrink-0 px-2.5 py-1 rounded-md text-[11px] font-bold bg-[#C9A227] text-[#0B1324]"
          : "domain-btn shrink-0 px-2.5 py-1 rounded-md text-[11px] font-semibold bg-[#111D35] text-[#CBD5E1] border border-[#24385E] hover:border-[#C9A227]";
      });
      const list = getFilteredLessons();
      if (list.length > 0 && !list.some(l => l.id === activeLessonId)) switchLesson(list[0].id);
      else renderTabs();
    };
  });

  document.getElementById("ft-close").onclick = hideTooltip;
  document.getElementById("ft-speak").onclick = () => { if (selectedTerm) speakText(selectedTerm); };
  document.getElementById("btn-tts-word").onclick = () => { if (selectedTerm) speakText(selectedTerm); };

  document.getElementById("btn-slide-prev").onclick = () => {
    const slides = getActiveLesson().slides || [];
    activeSlideIdx = (activeSlideIdx - 1 + slides.length) % slides.length;
    renderCarousel();
  };
  document.getElementById("btn-slide-next").onclick = () => {
    const slides = getActiveLesson().slides || [];
    activeSlideIdx = (activeSlideIdx + 1) % slides.length;
    renderCarousel();
  };

  document.getElementById("btn-guided-read").onclick = toggleGuidedPlayback;
  document.getElementById("btn-rewind-5").onclick = rewindFiveWords;
  document.getElementById("btn-repeat-line").onclick = () => {
    const lesson = getActiveLesson();
    if (!lesson || !lesson.lines.length) return;
    const idx = Math.min(currentPartIndex, lesson.lines.length - 1);
    const line = lesson.lines[idx];
    stopGuidedPlayback();
    lastBoundaryCharIdx = 0;
    updatePlaybackBarUI(idx);
    speakLineObj(line, idx, null, 0);
  };

  document.getElementById("btn-listening-mode").onclick = (e) => {
    listeningMode = !listeningMode;
    e.target.classList.toggle("bg-purple-500", listeningMode);
    e.target.classList.toggle("text-[#0B1324]", listeningMode);
    document.getElementById("reader-container").classList.toggle("listening-blur", listeningMode);
    showToast(listeningMode ? "Modo Escuta ativado: passe o mouse ou toque na palavra para revelar." : "Modo Escuta desativado.");
  };

  document.getElementById("btn-toggle-line-tr").onclick = (e) => {
    showLineTranslations = !showLineTranslations;
    e.target.classList.toggle("bg-[#C9A227]", showLineTranslations);
    e.target.classList.toggle("text-[#0B1324]", showLineTranslations);
    renderReaderOnly();
  };

  document.getElementById("btn-legal-focus").onclick = (e) => {
    legalFocusMode = !legalFocusMode;
    e.target.classList.toggle("bg-[#C9A227]", legalFocusMode);
    e.target.classList.toggle("text-[#0B1324]", legalFocusMode);
    document.getElementById("reader-container").classList.toggle("legal-focus-mode", legalFocusMode);
    showToast(legalFocusMode ? "Destaque de Termos Jurídicos ativado." : "Destaque normal restaurado.");
  };

  document.querySelectorAll(".speed-btn").forEach(b => {
    b.onclick = () => {
      playbackSpeed = parseFloat(b.getAttribute("data-speed"));
      document.querySelectorAll(".speed-btn").forEach(x => {
        const v = parseFloat(x.getAttribute("data-speed"));
        x.className = v === playbackSpeed
          ? "speed-btn px-2 py-0.5 rounded text-xs font-bold bg-[#C9A227] text-[#0B1324]"
          : "speed-btn px-2 py-0.5 rounded text-xs font-bold bg-[#162749] text-[#CBD5E1] hover:bg-[#1F3666]";
      });
      if (!isPlayingScene) document.getElementById("btn-guided-read").textContent = `▶ Leitura Guiada (${playbackSpeed}x)`;
      else startGuidedPlaybackFrom(currentPartIndex, lastBoundaryCharIdx);
    };
  });

  document.querySelectorAll(".ft-status-btn").forEach(btn => {
    btn.onclick = () => {
      if (!selectedTerm) return;
      const st = btn.getAttribute("data-ft-status");
      setStatus(selectedTerm, st);
      hideTooltip();
    };
  });

  document.getElementById("btn-mark-rest-known").onclick = () => {
    const lesson = getActiveLesson();
    let changed = 0;
    lesson.lines.forEach(l => tokenizeLine(l.text, lesson.chunks || []).forEach(t => {
      if (t.type === "word" && getStatus(t.key) === "new") {
        wordStates[t.key] = "known";
        changed++;
      }
    }));
    saveWords();
    refreshTokenColorsInPlace();
    updateStats();
    showToast(`${changed} palavras marcadas como conhecidas!`);
  };

  document.getElementById("btn-prev-lesson").onclick = () => {
    const idx = lessons.findIndex(l => l.id === activeLessonId);
    if (idx > 0) switchLesson(lessons[idx - 1].id);
  };
  document.getElementById("btn-next-lesson").onclick = () => {
    const idx = lessons.findIndex(l => l.id === activeLessonId);
    if (idx < lessons.length - 1) switchLesson(lessons[idx + 1].id);
  };

  document.getElementById("btn-finish-lesson").onclick = openExerciseModal;
  document.getElementById("btn-close-finish").onclick = () => document.getElementById("modal-finish").classList.add("hidden");
  document.getElementById("btn-grade-all").onclick = gradeAllExercises;
  document.getElementById("btn-speak-model").onclick = () => speakText(getActiveLesson().modelAnswer || "");

  document.getElementById("btn-advance-next").onclick = () => {
    document.getElementById("modal-finish").classList.add("hidden");
    const idx = lessons.findIndex(l => l.id === activeLessonId);
    if (idx < lessons.length - 1) switchLesson(lessons[idx + 1].id);
  };

  document.getElementById("btn-open-vocab").onclick = () => {
    renderVocabModal();
    document.getElementById("modal-vocab").classList.remove("hidden");
  };
  document.getElementById("btn-close-vocab").onclick = () => document.getElementById("modal-vocab").classList.add("hidden");
  document.getElementById("vocab-search-input").oninput = (e) => {
    vocabSearchQuery = e.target.value;
    renderVocabModal();
  };

  document.querySelectorAll(".vfilter-btn").forEach(btn => {
    btn.onclick = () => {
      vocabFilter = btn.getAttribute("data-vfilter");
      renderVocabModal();
    };
  });

  document.getElementById("btn-toggle-flashcard").onclick = () => {
    const area = document.getElementById("flashcard-area");
    area.classList.toggle("hidden");
    if (!area.classList.contains("hidden")) { flashcardIndex = 0; renderFlashcard(); }
  };

  document.getElementById("btn-fc-speak").onclick = () => {
    const k = document.getElementById("flashcard-area").dataset.currentKey;
    if (k) speakText(k);
  };
  document.getElementById("btn-fc-reveal").onclick = () => document.getElementById("fc-answer").classList.remove("hidden");
  document.getElementById("btn-fc-again").onclick = () => {
    const k = document.getElementById("flashcard-area").dataset.currentKey;
    if (!k) return;
    const prev = srsData[k] || { reps: 0 };
    srsData[k] = { reps: prev.reps + 1, nextReview: Date.now() + 60 * 1000 };
    saveSrs();
    incrementDailyReviews();
    flashcardIndex++;
    renderFlashcard();
  };
  document.getElementById("btn-fc-easy").onclick = () => {
    const k = document.getElementById("flashcard-area").dataset.currentKey;
    if (!k) return;
    const prev = srsData[k] || { reps: 0 };
    srsData[k] = { reps: prev.reps + 1, nextReview: Date.now() + 24 * 60 * 60 * 1000 };
    saveSrs();
    incrementDailyReviews();
    if (prev.reps >= 2) {
      setStatus(k, "known");
      showToast(`"${k}" movida para Conhecidas!`);
    }
    flashcardIndex++;
    renderFlashcard();
  };
  document.getElementById("btn-fc-next").onclick = () => { flashcardIndex++; renderFlashcard(); };

  document.getElementById("btn-open-import").onclick = () => document.getElementById("modal-import").classList.remove("hidden");
  document.getElementById("btn-close-import").onclick = () => document.getElementById("modal-import").classList.add("hidden");
  document.getElementById("btn-save-import").onclick = () => {
    const title = document.getElementById("imp-title").value.trim();
    const rawText = document.getElementById("imp-text").value.trim();
    if (!title || !rawText) { showToast("Preencha o título e o texto em inglês."); return; }
    const newLines = rawText.split(/\n+/).map(line => {
      const m = line.match(/^([^:]{2,25}):\s*(.+)$/);
      return m ? { speaker: m[1].trim(), text: m[2].trim(), gender: "male" } : { speaker: "Narrator", text: line.trim(), gender: "narrator" };
    }).filter(x => x.text);

    const newLesson = {
      id: "custom-" + Date.now(),
      badge: "IMPORTADA",
      domain: "cotidiano",
      iracNote: "História personalizada importada para prática de leitura e vocabulário.",
      title,
      slides: [{ img: "assets/office.webp", caption: title }],
      chunks: [],
      lines: newLines,
      mcqs: [],
      writingPrompt: "Escreva 1 frase em inglês usando vocabulário deste texto.",
      targetTerms: [],
      modelAnswer: newLines[0]?.text || ""
    };
    lessons.push(newLesson);
    saveCustomLessons();
    document.getElementById("modal-import").classList.add("hidden");
    document.getElementById("imp-title").value = "";
    document.getElementById("imp-text").value = "";
    switchLesson(newLesson.id);
    showToast("História importada com sucesso!");
  };

  document.getElementById("btn-open-backup").onclick = () => document.getElementById("modal-backup").classList.remove("hidden");
  document.getElementById("btn-close-backup").onclick = () => document.getElementById("modal-backup").classList.add("hidden");
  document.getElementById("btn-export-backup").onclick = () => {
    const payload = {
      version: 4,
      exportedAt: new Date().toISOString(),
      wordStates,
      srsData,
      completedLessons,
      lessonBookmarks,
      customLessons: lessons.filter(l => !BASE_LESSONS.some(d => d.id === l.id))
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `lextale-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast("Backup baixado!");
  };
  document.getElementById("input-import-backup").onchange = (ev) => {
    const file = ev.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        if (parsed.wordStates) wordStates = parsed.wordStates;
        if (parsed.srsData) srsData = parsed.srsData;
        if (parsed.completedLessons) completedLessons = parsed.completedLessons;
        if (parsed.lessonBookmarks) lessonBookmarks = parsed.lessonBookmarks;
        saveWords(); saveSrs(); saveDone(); saveBookmarks();
        if (Array.isArray(parsed.customLessons)) localStorage.setItem(STORAGE_CUSTOM, JSON.stringify(parsed.customLessons));
        loadState();
        switchLesson(activeLessonId);
        document.getElementById("modal-backup").classList.add("hidden");
        showToast("Backup restaurado com sucesso!");
      } catch (err) {
        showToast("Arquivo de backup inválido.");
      }
    };
    reader.readAsText(file);
  };
  document.getElementById("btn-reset-lesson").onclick = () => {
    const lesson = getActiveLesson();
    if (!lesson) return;
    lesson.lines.forEach(l => tokenizeLine(l.text, lesson.chunks || []).forEach(t => {
      if (t.type === "word") delete wordStates[t.key];
    }));
    delete completedLessons[lesson.id];
    delete lessonBookmarks[lesson.id];
    saveWords(); saveDone(); saveBookmarks();
    renderTabs(); refreshTokenColorsInPlace(); updateStats(); updateBookmarkBanner();
    document.getElementById("modal-backup").classList.add("hidden");
    showToast("Progresso da lição atual resetado!");
  };

  document.addEventListener("keydown", (e) => {
    const tag = (e.target.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select") return;

    const fcArea = document.getElementById("flashcard-area");
    const vocabOpen = !document.getElementById("modal-vocab").classList.contains("hidden");
    if (vocabOpen && fcArea && !fcArea.classList.contains("hidden")) {
      if (e.key === " ") { e.preventDefault(); document.getElementById("btn-fc-reveal").click(); return; }
      if (e.key === "1") { document.getElementById("btn-fc-again").click(); return; }
      if (e.key === "2") { document.getElementById("btn-fc-easy").click(); return; }
    }

    if (e.key === "Escape") {
      hideTooltip();
      ["modal-finish", "modal-vocab", "modal-import", "modal-backup"].forEach(id => document.getElementById(id).classList.add("hidden"));
    } else if (e.key === "ArrowLeft") {
      document.getElementById("btn-slide-prev").click();
    } else if (e.key === "ArrowRight") {
      document.getElementById("btn-slide-next").click();
    } else if (e.key.toLowerCase() === "r") {
      document.getElementById("btn-repeat-line").click();
    }
  });
}

async function initApp() {
  try {
    const [dictResp, lessonsResp] = await Promise.all([
      fetch("lessons/dictionary.json?v=4.1", { cache: "no-store" }),
      fetch("lessons/starter-lessons.json?v=4.1", { cache: "no-store" })
    ]);
    DICTIONARY_DB = await dictResp.json();
    BASE_LESSONS = await lessonsResp.json();
    loadState();
    bindEvents();
    switchLesson(activeLessonId);
  } catch (err) {
    console.error(err);
    showToast("Erro ao carregar lições. Abra via servidor HTTP ou GitHub Pages.");
  }
}

initApp();
