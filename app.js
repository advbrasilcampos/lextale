// JurisLingQ / LexTale — Motor Modular PWA v2
let DICTIONARY_DB = {};
let BASE_LESSONS = [];
let lessons = [];
let wordStates = {};
let srsData = {};
let completedLessons = {};
let activeLessonId = "act-1";
let activeSlideIdx = 0;
let selectedTerm = null;
let vocabFilter = "learning";
let flashcardIndex = 0;
let selectedMcqAnswers = {};
let isPlayingScene = false;
let playbackSpeed = 0.25;
let currentPartIndex = 0;
let showLineTranslations = false;
let playbackWatchdog = null;

const STORAGE_WORDS = "jurislingq_words_v4";
const STORAGE_CUSTOM = "jurislingq_custom_v4";
const STORAGE_DONE = "jurislingq_done_v4";
const STORAGE_SRS = "jurislingq_srs_v4";

function loadState() {
  try {
    const sw = localStorage.getItem(STORAGE_WORDS);
    if (sw) wordStates = JSON.parse(sw);
  } catch (e) {}
  try {
    const ss = localStorage.getItem(STORAGE_SRS);
    if (ss) srsData = JSON.parse(ss);
  } catch (e) {}
  lessons = BASE_LESSONS.map(l => ({ ...l }));
  try {
    const sc = localStorage.getItem(STORAGE_CUSTOM);
    if (sc) {
      const parsed = JSON.parse(sc);
      if (Array.isArray(parsed)) lessons = [...lessons, ...parsed];
    }
  } catch (e) {}
  try {
    const sd = localStorage.getItem(STORAGE_DONE);
    if (sd) completedLessons = JSON.parse(sd);
  } catch (e) {}
  if (lessons.length > 0 && !lessons.some(l => l.id === activeLessonId)) {
    activeLessonId = lessons[0].id;
  }
}

function saveWords() { try { localStorage.setItem(STORAGE_WORDS, JSON.stringify(wordStates)); } catch (e) {} }
function saveSrs() { try { localStorage.setItem(STORAGE_SRS, JSON.stringify(srsData)); } catch (e) {} }
function saveDone() { try { localStorage.setItem(STORAGE_DONE, JSON.stringify(completedLessons)); } catch (e) {} }
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
  const candidates = [
    k,
    clean,
    base,
    base.replace(/s$/, ""),
    base.replace(/ed$/, ""),
    base.replace(/ing$/, ""),
    base.replace(/ly$/, "")
  ];

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
      return { type: "word", text: clean, key: clean.toLowerCase(), prefix: part.slice(0, idx), suffix: part.slice(idx + clean.length) };
    });
  }
  const escaped = sorted.map(c => c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const regex = new RegExp("(" + escaped.join("|") + ")", "gi");
  const tokens = [];
  text.split(regex).forEach(seg => {
    if (!seg) return;
    const isChunk = sorted.some(c => c.toLowerCase() === seg.toLowerCase());
    if (isChunk) {
      tokens.push({ type: "word", text: seg, key: seg.toLowerCase(), prefix: "", suffix: "" });
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
            tokens.push({ type: "word", text: clean, key: clean.toLowerCase(), prefix: part.slice(0, idx), suffix: part.slice(idx + clean.length) });
          }
        }
      });
    }
  });
  return tokens;
}

function getActiveLesson() { return lessons.find(l => l.id === activeLessonId) || lessons[0]; }

function renderTabs() {
  const container = document.getElementById("lesson-tabs");
  container.innerHTML = "";
  let doneCount = 0;
  lessons.forEach(l => {
    const isDone = !!completedLessons[l.id];
    if (isDone) doneCount++;
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
  renderTabs();
  renderCarousel();
  renderPlaybackSegments();
  renderReaderOnly();
  updateStats();
  const l = getActiveLesson();
  document.getElementById("lesson-badge").textContent = l.badge || "ATIVIDADE";
  document.getElementById("lesson-title").textContent = l.title;
}

function renderCarousel() {
  const lesson = getActiveLesson();
  if (!lesson) return;
  const slides = lesson.slides && lesson.slides.length ? lesson.slides : [{ img: "assets/office.webp", caption: lesson.title }];
  if (activeSlideIdx >= slides.length) activeSlideIdx = 0;
  if (activeSlideIdx < 0) activeSlideIdx = slides.length - 1;

  const slide = slides[activeSlideIdx];
  document.getElementById("carousel-img").src = slide.img;
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
    span.className = `word-token tok-${st}` + (isActive ? " tok-active" : "");
  });
}

function buildLineQuickTranslation(text, chunks) {
  const tokens = tokenizeLine(text, chunks || []);
  const parts = tokens.map(t => {
    if (t.type !== "word") return t.text;
    const info = lookupInfo(t.text);
    const tr = (info.translation || "").split("/")[0].replace(/^Termo em inglês:\s*"[^"]+"/, t.text).trim();
    return tr || t.text;
  });
  return parts.join("");
}

function renderReaderOnly() {
  const lesson = getActiveLesson();
  if (!lesson) return;
  const reader = document.getElementById("reader-container");
  reader.innerHTML = "";
  lesson.lines.forEach((line, lineIdx) => {
    const row = document.createElement("div");
    row.className = "p-3.5 rounded-xl bg-[#0D172B] border border-[#203357] transition-all cursor-pointer";
    row.dataset.lineIdx = lineIdx;

    const headerRow = document.createElement("div");
    headerRow.className = "flex items-center justify-between gap-2 mb-1.5";

    const sp = document.createElement("div");
    sp.className = "text-[11px] font-extrabold uppercase tracking-wider text-[#C9A227]";
    sp.textContent = line.speaker || "Narrator";
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
      updatePlaybackBarUI(lineIdx);
      speakText(line.text, false, line.speaker, line.gender);
    };
    headerRow.appendChild(playOne);
    row.appendChild(headerRow);

    const p = document.createElement("div");
    const tokens = tokenizeLine(line.text, lesson.chunks || []);
    tokens.forEach(tok => {
      if (tok.type !== "word") {
        p.appendChild(document.createTextNode(tok.text));
      } else {
        if (tok.prefix) p.appendChild(document.createTextNode(tok.prefix));
        const span = document.createElement("span");
        const st = getStatus(tok.key);
        const isActive = selectedTerm && selectedTerm.toLowerCase() === tok.key;
        span.className = `word-token tok-${st}` + (isActive ? " tok-active" : "");
        span.textContent = tok.text;
        span.dataset.key = tok.key;
        span.onclick = (ev) => {
          ev.stopPropagation();
          selectedTerm = tok.text;
          const targetRect = ev.currentTarget.getBoundingClientRect();
          refreshTokenColorsInPlace();
          syncWordInfo(tok.text);
          showTooltipAtRect(tok.text, targetRect);
          speakText(tok.text, true, line.speaker, line.gender);
        };
        p.appendChild(span);
        if (tok.suffix) p.appendChild(document.createTextNode(tok.suffix));
      }
    });
    row.appendChild(p);

    if (showLineTranslations) {
      const trBox = document.createElement("p");
      trBox.className = "mt-2 pt-2 border-t border-[#1E3156] text-xs text-sky-200/90 leading-relaxed";
      trBox.textContent = line.pt || buildLineQuickTranslation(line.text, lesson.chunks || []);
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
  if (top + tipH > window.innerHeight - 10) {
    top = Math.max(10, rect.top - tipH - 8);
  }
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
}

function stopGuidedPlayback() {
  isPlayingScene = false;
  clearTimeout(playbackWatchdog);
  try { if ("speechSynthesis" in window) window.speechSynthesis.cancel(); } catch (e) {}
  document.querySelectorAll("#reader-container > div").forEach(el => {
    el.classList.remove("ring-2", "ring-amber-400", "bg-[#162749]");
  });
  updatePlaybackBarUI(-1);
  const btn = document.getElementById("btn-guided-read");
  if (btn) btn.textContent = `▶ Leitura Guiada (${playbackSpeed}x)`;
}

function startGuidedPlaybackFrom(startIdx) {
  clearTimeout(playbackWatchdog);
  try { if ("speechSynthesis" in window) window.speechSynthesis.cancel(); } catch (e) {}
  isPlayingScene = true;
  currentPartIndex = startIdx;
  document.getElementById("btn-guided-read").textContent = "■ Parar Leitura";
  runPlaybackStep();
}

function runPlaybackStep() {
  const lesson = getActiveLesson();
  const rows = document.querySelectorAll("#reader-container > div");
  if (!isPlayingScene || !lesson || currentPartIndex >= lesson.lines.length) {
    stopGuidedPlayback();
    return;
  }
  const activeIdx = currentPartIndex;
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
    if (!isPlayingScene || currentPartIndex !== activeIdx) return;
    currentPartIndex++;
    runPlaybackStep();
  };

  // Fallback watchdog in case browser TTS does not fire onend
  const fallbackMs = Math.max(4000, Math.round((line.text.length * 95) / Math.max(0.25, playbackSpeed))) + 3000;
  clearTimeout(playbackWatchdog);
  playbackWatchdog = setTimeout(advanceNext, fallbackMs);

  speakText(line.text, true, line.speaker, line.gender, advanceNext);
}

function toggleGuidedPlayback() {
  if (isPlayingScene) { stopGuidedPlayback(); return; }
  startGuidedPlaybackFrom(0);
}

let cachedVoices = [];
function refreshVoices() {
  try {
    if ("speechSynthesis" in window) {
      cachedVoices = window.speechSynthesis.getVoices() || [];
    }
  } catch (e) {}
}
refreshVoices();
try {
  if ("speechSynthesis" in window && "onvoiceschanged" in window.speechSynthesis) {
    window.speechSynthesis.onvoiceschanged = refreshVoices;
  }
} catch (e) {}

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
  const isFemaleChar = explicitGender === "female" || (!explicitGender && /(elena|maya|judge carter|judge alvarez|clara|sofia|carla|claire|applicant|wife|woman)/i.test(sp));

  if (isNarrator) {
    return { voice: maleVoices[0] || enVoices[0] || null, pitch: 0.78 };
  }
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

function speakText(text, silent, speakerName, explicitGender, onEndCallback) {
  try {
    if (!("speechSynthesis" in window)) {
      if (!silent) showToast("Áudio TTS não disponível neste navegador.");
      if (onEndCallback) setTimeout(onEndCallback, 1200);
      return;
    }
    if (cachedVoices.length === 0) refreshVoices();
    window.speechSynthesis.cancel();

    // Small 40ms pause prevents Chrome/Android from swallowing the first syllable after cancel()
    setTimeout(() => {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = "en-US";
      u.rate = playbackSpeed;
      const prof = getVoiceProfile(speakerName, explicitGender);
      if (prof.voice) u.voice = prof.voice;
      u.pitch = prof.pitch;
      if (onEndCallback) {
        u.onend = () => onEndCallback();
        u.onerror = () => onEndCallback();
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
  const entries = Object.entries(wordStates).filter(([, st]) => vocabFilter === "all" ? true : st === vocabFilter);
  if (entries.length === 0) {
    list.innerHTML = `<p class="text-xs text-[#94A3B8] text-center py-6">Nenhuma palavra nesta categoria ainda. Clique em palavras no texto e marque como Aprendendo!</p>`;
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
}

function bindEvents() {
  document.addEventListener("click", (e) => {
    const tip = document.getElementById("floating-tooltip");
    if (!tip.classList.contains("hidden") && !tip.contains(e.target) && !e.target.classList.contains("word-token")) {
      hideTooltip();
    }
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
  document.getElementById("btn-repeat-line").onclick = () => {
    const lesson = getActiveLesson();
    if (!lesson || !lesson.lines.length) return;
    const idx = Math.min(currentPartIndex, lesson.lines.length - 1);
    const line = lesson.lines[idx];
    stopGuidedPlayback();
    updatePlaybackBarUI(idx);
    speakText(line.text, false, line.speaker, line.gender);
  };

  document.getElementById("btn-toggle-line-tr").onclick = (e) => {
    showLineTranslations = !showLineTranslations;
    e.target.classList.toggle("bg-[#C9A227]", showLineTranslations);
    e.target.classList.toggle("text-[#0B1324]", showLineTranslations);
    renderReaderOnly();
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
      if (!isPlayingScene) {
        document.getElementById("btn-guided-read").textContent = `▶ Leitura Guiada (${playbackSpeed}x)`;
      } else {
        startGuidedPlaybackFrom(currentPartIndex);
      }
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
  document.getElementById("btn-speak-model").onclick = () => {
    const lesson = getActiveLesson();
    speakText(lesson.modelAnswer || "");
  };

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
    flashcardIndex++;
    renderFlashcard();
  };
  document.getElementById("btn-fc-easy").onclick = () => {
    const k = document.getElementById("flashcard-area").dataset.currentKey;
    if (!k) return;
    const prev = srsData[k] || { reps: 0 };
    srsData[k] = { reps: prev.reps + 1, nextReview: Date.now() + 24 * 60 * 60 * 1000 };
    saveSrs();
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

  // Backup Export / Import
  document.getElementById("btn-open-backup").onclick = () => document.getElementById("modal-backup").classList.remove("hidden");
  document.getElementById("btn-close-backup").onclick = () => document.getElementById("modal-backup").classList.add("hidden");
  document.getElementById("btn-export-backup").onclick = () => {
    const payload = {
      version: 2,
      exportedAt: new Date().toISOString(),
      wordStates,
      srsData,
      completedLessons,
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
        saveWords();
        saveSrs();
        saveDone();
        if (Array.isArray(parsed.customLessons)) {
          localStorage.setItem(STORAGE_CUSTOM, JSON.stringify(parsed.customLessons));
        }
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

  // Keyboard shortcuts
  document.addEventListener("keydown", (e) => {
    const tag = (e.target.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea") return;
    if (e.key === "Escape") {
      hideTooltip();
      ["modal-finish", "modal-vocab", "modal-import", "modal-backup"].forEach(id => {
        document.getElementById(id).classList.add("hidden");
      });
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
      fetch("lessons/dictionary.json"),
      fetch("lessons/starter-lessons.json")
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
