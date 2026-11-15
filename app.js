const STORAGE_VOCAB = "lextale_vocab_v1";
const STORAGE_CUSTOM_LESSONS = "lextale_custom_lessons_v1";

let lessons = [];
let currentLessonIdx = 0;
let currentPanelIdx = 0;
let currentSegmentIdx = 0;
let playbackSpeed = 0.25;
let isPlaying = false;
let selectedWord = null;

// Estado salvo no aparelho
let vocabMap = JSON.parse(localStorage.getItem(STORAGE_VOCAB) || "{}");

async function init() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }

  const res = await fetch("lessons/starter-lessons.json");
  const starter = await res.json();
  const custom = JSON.parse(localStorage.getItem(STORAGE_CUSTOM_LESSONS) || "[]");
  lessons = [...starter, ...custom];

  bindEvents();
  renderLessonStrip();
  loadLesson(0);
  updateVocabCounter();
}

function bindEvents() {
  document.querySelectorAll(".speed-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".speed-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      playbackSpeed = parseFloat(btn.dataset.speed);
      if (isPlaying) {
        stopSpeech();
        playFromSegment(currentSegmentIdx);
      }
    });
  });

  document.getElementById("btn-play").addEventListener("click", () => {
    if (isPlaying) {
      stopSpeech();
    } else {
      playFromSegment(currentSegmentIdx);
    }
  });

  document.getElementById("btn-prev-panel").addEventListener("click", () => {
    const panels = lessons[currentLessonIdx].panels || [];
    if (currentPanelIdx > 0) {
      currentPanelIdx--;
      renderPanel();
    }
  });

  document.getElementById("btn-next-panel").addEventListener("click", () => {
    const panels = lessons[currentLessonIdx].panels || [];
    if (currentPanelIdx < panels.length - 1) {
      currentPanelIdx++;
      renderPanel();
    }
  });

  document.addEventListener("click", (e) => {
    const tooltip = document.getElementById("word-tooltip");
    if (!e.target.classList.contains("word-token") && !tooltip.contains(e.target)) {
      tooltip.classList.add("hidden");
    }
  });

  document.querySelectorAll(".tt-status-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (selectedWord) setWordStatus(selectedWord, btn.dataset.status);
    });
  });

  document.getElementById("qc-status-blue").addEventListener("click", () => selectedWord && setWordStatus(selectedWord, "blue"));
  document.getElementById("qc-status-yellow").addEventListener("click", () => selectedWord && setWordStatus(selectedWord, "yellow"));
  document.getElementById("qc-status-white").addEventListener("click", () => selectedWord && setWordStatus(selectedWord, "white"));

  document.getElementById("tt-speak").addEventListener("click", () => selectedWord && speakSingleWord(selectedWord));
  document.getElementById("qc-speak").addEventListener("click", () => selectedWord && speakSingleWord(selectedWord));

  document.getElementById("btn-open-quiz").addEventListener("click", openQuiz);
  document.getElementById("btn-vocab").addEventListener("click", openVocabModal);
  document.getElementById("btn-import").addEventListener("click", () => {
    document.getElementById("modal-import").classList.remove("hidden");
  });

  document.querySelectorAll(".btn-close").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.getElementById(btn.dataset.close).classList.add("hidden");
    });
  });

  document.getElementById("import-file").addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      document.getElementById("import-json").value = reader.result;
    };
    reader.readAsText(file);
  });

  document.getElementById("btn-confirm-import").addEventListener("click", importLessonFromModal);
}

function renderLessonStrip() {
  const strip = document.getElementById("lesson-strip");
  strip.innerHTML = "";
  lessons.forEach((lesson, idx) => {
    const btn = document.createElement("button");
    btn.className = "lesson-pill" + (idx === currentLessonIdx ? " active" : "");
    btn.textContent = lesson.title;
    btn.type = "button";
    btn.addEventListener("click", () => loadLesson(idx));
    strip.appendChild(btn);
  });
}

function loadLesson(idx) {
  stopSpeech();
  currentLessonIdx = idx;
  currentPanelIdx = 0;
  currentSegmentIdx = 0;
  document.getElementById("word-tooltip").classList.add("hidden");

  const lesson = lessons[idx];
  document.getElementById("lesson-category").textContent = lesson.category || "Direito";
  document.getElementById("lesson-title").textContent = lesson.title;

  renderLessonStrip();
  renderMedia(lesson);
  renderSegmentsBar(lesson);
  renderReader(lesson);
}

function renderMedia(lesson) {
  const carousel = document.getElementById("carousel-wrapper");
  const video = document.getElementById("video-wrapper");

  if (lesson.youtubeEmbedUrl) {
    carousel.classList.add("hidden");
    video.classList.remove("hidden");
    document.getElementById("youtube-frame").src = lesson.youtubeEmbedUrl;
  } else if (lesson.panels && lesson.panels.length > 0) {
    video.classList.add("hidden");
    carousel.classList.remove("hidden");
    renderPanel();
  } else {
    carousel.classList.add("hidden");
    video.classList.add("hidden");
  }
}

function renderPanel() {
  const panels = lessons[currentLessonIdx].panels || [];
  const panel = panels[currentPanelIdx];
  const visual = document.getElementById("panel-visual");

  if (panel.imageUrl) {
    visual.innerHTML = `<img src="${panel.imageUrl}" alt="${panel.caption || 'Scene panel'}" />`;
  } else {
    visual.innerHTML = `<div class="panel-scene-box">${panel.sceneDescription || ""}</div>`;
  }

  document.getElementById("panel-caption").textContent = panel.caption || "";
  document.getElementById("panel-indicator").textContent = `Panel ${currentPanelIdx + 1} of ${panels.length}`;
}

function renderSegmentsBar(lesson) {
  const bar = document.getElementById("segments-bar");
  bar.innerHTML = "";
  lesson.segments.forEach((seg, idx) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "seg-chip" + (idx === currentSegmentIdx ? " active" : "");
    chip.textContent = `${idx + 1}. ${seg.speaker}`;
    chip.addEventListener("click", () => {
      stopSpeech();
      playFromSegment(idx);
    });
    bar.appendChild(chip);
  });
}

function renderReader(lesson) {
  const reader = document.getElementById("reader-card");
  reader.innerHTML = "";

  lesson.segments.forEach((seg, sIdx) => {
    const block = document.createElement("div");
    block.className = "segment-block";
    block.id = `seg-block-${sIdx}`;

    const label = document.createElement("span");
    label.className = "speaker-label";
    label.textContent = seg.speaker;
    block.appendChild(label);

    const tokens = seg.text.split(/(\s+)/);
    tokens.forEach((tok) => {
      if (/^\s+$/.test(tok)) {
        block.appendChild(document.createTextNode(tok));
        return;
      }
      const clean = tok.toLowerCase().replace(/[^a-z'-]/g, "");
      const span = document.createElement("span");
      span.textContent = tok;
      if (!clean) {
        block.appendChild(span);
        return;
      }

      const status = vocabMap[clean]?.status || "blue";
      span.className = `word-token status-${status}`;
      span.dataset.word = clean;
      span.addEventListener("click", (e) => {
        e.stopPropagation();
        onWordClick(span, clean, lesson);
      });
      block.appendChild(span);
    });

    reader.appendChild(block);
  });
}

function onWordClick(el, word, lesson) {
  document.querySelectorAll(".word-token.selected").forEach((t) => t.classList.remove("selected"));
  el.classList.add("selected");
  selectedWord = word;

  const entry = (lesson.dictionary && lesson.dictionary[word]) || {
    pt: "Termo salvo para revisão",
    note: "Toque em Aprendendo ou Conhecida para atualizar seu progresso."
  };

  if (!vocabMap[word]) {
    vocabMap[word] = { status: "blue", pt: entry.pt };
    saveVocab();
  }

  // Atualiza Card Superior
  document.getElementById("quick-card").classList.remove("hidden");
  document.getElementById("qc-word").textContent = word;
  document.getElementById("qc-translation").textContent = entry.pt;

  // Posiciona Balão logo abaixo da palavra clicada
  const tooltip = document.getElementById("word-tooltip");
  document.getElementById("tt-word").textContent = word;
  document.getElementById("tt-translation").textContent = entry.pt;
  document.getElementById("tt-note").textContent = entry.note || "";
  tooltip.classList.remove("hidden");

  const rect = el.getBoundingClientRect();
  const top = rect.bottom + window.scrollY + 8;
  const left = Math.min(Math.max(12, rect.left + window.scrollX), window.innerWidth - tooltip.offsetWidth - 12);
  tooltip.style.top = `${top}px`;
  tooltip.style.left = `${left}px`;
}

function setWordStatus(word, status) {
  const lesson = lessons[currentLessonIdx];
  const pt = (lesson.dictionary && lesson.dictionary[word]?.pt) || vocabMap[word]?.pt || "";
  vocabMap[word] = { status, pt };
  saveVocab();

  document.querySelectorAll(`.word-token[data-word="${word}"]`).forEach((el) => {
    el.classList.remove("status-blue", "status-yellow", "status-white");
    el.classList.add(`status-${status}`);
  });
  updateVocabCounter();
}

function saveVocab() {
  localStorage.setItem(STORAGE_VOCAB, JSON.stringify(vocabMap));
}

function updateVocabCounter() {
  const count = Object.values(vocabMap).filter((v) => v.status === "yellow").length;
  document.getElementById("vocab-count").textContent = count;
}

function speakSingleWord(word) {
  if (!("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(word);
  u.lang = "en-US";
  u.rate = Math.max(0.5, playbackSpeed);
  window.speechSynthesis.speak(u);
}

function playFromSegment(idx) {
  const lesson = lessons[currentLessonIdx];
  if (idx >= lesson.segments.length) {
    stopSpeech();
    return;
  }

  isPlaying = true;
  currentSegmentIdx = idx;
  const playBtn = document.getElementById("btn-play");
  playBtn.textContent = "⏹ Parar";
  playBtn.classList.add("playing");

  document.querySelectorAll(".seg-chip").forEach((c, i) => c.classList.toggle("active", i === idx));
  document.querySelectorAll(".segment-block").forEach((b, i) => b.classList.toggle("speaking", i === idx));

  const seg = lesson.segments[idx];
  if (!("speechSynthesis" in window)) return;

  window.speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(seg.text);
  utter.lang = "en-US";
  utter.rate = playbackSpeed;

  // Diferenciação de voz: Narrador mais grave, personagens alternando pitch
  if (seg.voiceRole === "narrator") {
    utter.pitch = 0.85;
  } else if (seg.voiceRole === "female") {
    utter.pitch = 1.2;
  } else {
    utter.pitch = 1.0;
  }

  utter.onend = () => {
    if (isPlaying) playFromSegment(idx + 1);
  };
  window.speechSynthesis.speak(utter);
}

function stopSpeech() {
  isPlaying = false;
  if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  const playBtn = document.getElementById("btn-play");
  playBtn.textContent = "▶ Ouvir";
  playBtn.classList.remove("playing");
  document.querySelectorAll(".segment-block").forEach((b) => b.classList.remove("speaking"));
}

function openQuiz() {
  const lesson = lessons[currentLessonIdx];
  const body = document.getElementById("quiz-body");
  body.innerHTML = "";

  const chosen = {};
  (lesson.quiz || []).forEach((q, qIdx) => {
    const box = document.createElement("div");
    box.className = "quiz-q";
    box.innerHTML = `<strong>${qIdx + 1}. ${q.question}</strong>`;
    q.options.forEach((opt, oIdx) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "quiz-opt";
      btn.textContent = opt;
      btn.addEventListener("click", () => {
        chosen[qIdx] = oIdx;
        box.querySelectorAll(".quiz-opt").forEach((b) => b.classList.remove("picked"));
        btn.classList.add("picked");
      });
      box.appendChild(btn);
    });
    body.appendChild(box);
  });

  if (lesson.writingPrompt) {
    const wBox = document.createElement("div");
    wBox.className = "quiz-q";
    wBox.innerHTML = `<strong>Prática Escrita:</strong><p class="hint">${lesson.writingPrompt}</p><textarea id="writing-answer" rows="3" placeholder="Escreva sua resposta em inglês..."></textarea>`;
    body.appendChild(wBox);
  }

  const checkBtn = document.createElement("button");
  checkBtn.type = "button";
  checkBtn.className = "btn-primary btn-large";
  checkBtn.textContent = "Corrigir & Ver Modelo";
  checkBtn.addEventListener("click", () => {
    let score = 0;
    const total = (lesson.quiz || []).length;
    (lesson.quiz || []).forEach((q, i) => {
      if (chosen[i] === q.answerIndex) score++;
    });
    const fb = document.createElement("div");
    fb.className = "quiz-feedback";
    fb.innerHTML = `<strong>Resultado: ${score}/${total} acertos.</strong><br/><br/><strong>Resposta modelo sugerida:</strong><br/><em>${lesson.modelAnswer || ""}</em>`;
    body.appendChild(fb);
    checkBtn.disabled = true;
  });
  body.appendChild(checkBtn);

  document.getElementById("modal-quiz").classList.remove("hidden");
}

function openVocabModal() {
  const body = document.getElementById("vocab-body");
  body.innerHTML = "";
  const entries = Object.entries(vocabMap).filter(([, v]) => v.status === "yellow");
  if (entries.length === 0) {
    body.innerHTML = `<p class="hint">Nenhuma palavra marcada como "Aprendendo" (amarela) ainda.</p>`;
  } else {
    entries.forEach(([word, data]) => {
      const row = document.createElement("div");
      row.className = "vocab-item";
      row.innerHTML = `<div><strong>${word}</strong><br/><span class="hint">${data.pt || ""}</span></div>`;
      const doneBtn = document.createElement("button");
      doneBtn.type = "button";
      doneBtn.className = "btn-secondary";
      doneBtn.textContent = "Já sei ✓";
      doneBtn.addEventListener("click", () => {
        setWordStatus(word, "white");
        openVocabModal();
      });
      row.appendChild(doneBtn);
      body.appendChild(row);
    });
  }
  document.getElementById("modal-vocab").classList.remove("hidden");
}

function importLessonFromModal() {
  const raw = document.getElementById("import-json").value.trim();
  const errEl = document.getElementById("import-error");
  try {
    const parsed = JSON.parse(raw);
    const list = Array.isArray(parsed) ? parsed : [parsed];
    const custom = JSON.parse(localStorage.getItem(STORAGE_CUSTOM_LESSONS) || "[]");
    const updated = [...custom, ...list];
    localStorage.setItem(STORAGE_CUSTOM_LESSONS, JSON.stringify(updated));
    lessons = [...lessons, ...list];
    errEl.classList.add("hidden");
    document.getElementById("modal-import").classList.add("hidden");
    document.getElementById("import-json").value = "";
    renderLessonStrip();
    loadLesson(lessons.length - 1);
  } catch (e) {
    errEl.textContent = "JSON inválido. Verifique o formato antes de salvar.";
    errEl.classList.remove("hidden");
  }
}

init();
