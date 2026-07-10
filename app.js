const FEATURE_DEFS = [
  { key: "sharpness", label: "Sharpness", defaultWeight: 0.29 },
  { key: "contrast", label: "Contrast", defaultWeight: 0.23 },
  { key: "ice", label: "Ice", defaultWeight: 0.22 },
  { key: "brightness", label: "Tone", defaultWeight: 0.16 },
  { key: "clean", label: "Clean", defaultWeight: 0.1 },
];

const DEFAULT_WEIGHTS = normalizeWeights(
  Object.fromEntries(FEATURE_DEFS.map((feature) => [feature.key, feature.defaultWeight]))
);

const state = {
  files: [],
  analyses: [],
  results: [],
  labels: new Map(),
  weights: { ...DEFAULT_WEIGHTS },
  calibrationNote: "Default scoring",
};

const refs = {
  dropZone: document.getElementById("dropZone"),
  fileInput: document.getElementById("fileInput"),
  labelInput: document.getElementById("labelInput"),
  scoreButton: document.getElementById("scoreButton"),
  demoButton: document.getElementById("demoButton"),
  csvButton: document.getElementById("csvButton"),
  reportButton: document.getElementById("reportButton"),
  clearLabelsButton: document.getElementById("clearLabelsButton"),
  labelsCsvButton: document.getElementById("labelsCsvButton"),
  resetWeightsButton: document.getElementById("resetWeightsButton"),
  brightnessTarget: document.getElementById("brightnessTarget"),
  brightnessTargetValue: document.getElementById("brightnessTargetValue"),
  strictness: document.getElementById("strictness"),
  strictnessValue: document.getElementById("strictnessValue"),
  simulationCount: document.getElementById("simulationCount"),
  simulationSeed: document.getElementById("simulationSeed"),
  microscopeRate: document.getElementById("microscopeRate"),
  minutesPerSkip: document.getElementById("minutesPerSkip"),
  minutesPerReview: document.getElementById("minutesPerReview"),
  roiStatus: document.getElementById("roiStatus"),
  labelStatus: document.getElementById("labelStatus"),
  calibrationStatus: document.getElementById("calibrationStatus"),
  validationStats: document.getElementById("validationStats"),
  weightBars: document.getElementById("weightBars"),
  resultsBody: document.getElementById("resultsBody"),
  resultsInfo: document.getElementById("resultsInfo"),
  totalCount: document.getElementById("totalCount"),
  collectCount: document.getElementById("collectCount"),
  reviewCount: document.getElementById("reviewCount"),
  skipCount: document.getElementById("skipCount"),
  timeSaved: document.getElementById("timeSaved"),
  costSaved: document.getElementById("costSaved"),
  reportPanel: document.getElementById("reportPanel"),
  reportStatus: document.getElementById("reportStatus"),
  reportBody: document.getElementById("reportBody"),
  rowTemplate: document.getElementById("rowTemplate"),
};

const strictnessLabels = ["Fast", "Medium", "Strict"];
const thresholdsByStrictness = [
  { collect: 68, review: 48 },
  { collect: 75, review: 55 },
  { collect: 82, review: 62 },
];

bindEvents();
syncKnobs();
renderWeightBars();
resetSummary();

function bindEvents() {
  refs.fileInput.addEventListener("change", (event) => {
    setFiles([...event.target.files]);
  });

  refs.labelInput.addEventListener("change", async (event) => {
    const [file] = event.target.files;
    if (!file) return;
    await importLabels(file);
    event.target.value = "";
  });

  refs.dropZone.addEventListener("dragover", (event) => {
    event.preventDefault();
    refs.dropZone.classList.add("drag");
  });

  refs.dropZone.addEventListener("dragleave", () => {
    refs.dropZone.classList.remove("drag");
  });

  refs.dropZone.addEventListener("drop", (event) => {
    event.preventDefault();
    refs.dropZone.classList.remove("drag");
    const selectedFiles = [...event.dataTransfer.files].filter((file) =>
      file.type.startsWith("image/")
    );
    setFiles(selectedFiles);
  });

  refs.brightnessTarget.addEventListener("input", () => {
    syncKnobs();
    if (state.analyses.length > 0) rerunFromAnalyses();
  });

  refs.strictness.addEventListener("input", () => {
    syncKnobs();
    if (state.analyses.length > 0) rerunFromAnalyses();
  });

  for (const input of [refs.microscopeRate, refs.minutesPerSkip, refs.minutesPerReview]) {
    input.addEventListener("input", () => {
      renderSummary();
      renderReportPreview();
    });
  }

  refs.scoreButton.addEventListener("click", runTriage);
  refs.demoButton.addEventListener("click", loadDemoSet);
  refs.csvButton.addEventListener("click", exportCsv);
  refs.reportButton.addEventListener("click", exportPilotReport);
  refs.labelsCsvButton.addEventListener("click", exportLabelsCsv);
  refs.clearLabelsButton.addEventListener("click", clearLabels);
  refs.resetWeightsButton.addEventListener("click", resetWeights);
}

function syncKnobs() {
  refs.brightnessTargetValue.textContent = refs.brightnessTarget.value;
  refs.strictnessValue.textContent = strictnessLabels[Number(refs.strictness.value)];
}

function setFiles(files) {
  state.files = files;
  state.analyses = [];
  state.results = [];
  refs.csvButton.disabled = true;
  refs.reportButton.disabled = true;
  refs.reportPanel.hidden = true;
  refs.resultsInfo.textContent =
    files.length > 0 ? `${files.length} image(s) staged.` : "No images analyzed yet.";
  refs.resultsBody.innerHTML = `
    <tr>
      <td colspan="11" class="empty">${
        files.length > 0 ? "Ready to analyze." : "Upload images or load a demo set."
      }</td>
    </tr>
  `;
  resetSummary();
  renderValidation();
}

async function runTriage() {
  if (state.files.length === 0) {
    refs.resultsInfo.textContent = "Upload images or load the demo set first.";
    return;
  }

  refs.scoreButton.disabled = true;
  refs.scoreButton.textContent = "Analyzing...";
  refs.resultsBody.innerHTML =
    '<tr><td colspan="11" class="empty">Computing image metrics...</td></tr>';

  try {
    const targetTone = Number(refs.brightnessTarget.value);
    state.analyses = await Promise.all(
      state.files.map((file) => analyzeImage(file, targetTone))
    );
    calibrateFromLabels();
    rerunFromAnalyses();
    refs.csvButton.disabled = false;
    refs.reportButton.disabled = false;
  } catch (error) {
    refs.resultsInfo.textContent = `Analysis failed: ${error.message}`;
    refs.resultsBody.innerHTML =
      '<tr><td colspan="11" class="empty">Try PNG or JPG files.</td></tr>';
  } finally {
    refs.scoreButton.disabled = false;
    refs.scoreButton.textContent = "Run Triage";
  }
}

function rerunFromAnalyses() {
  const strictnessIndex = Number(refs.strictness.value);
  const thresholds = thresholdsByStrictness[strictnessIndex];

  state.results = state.analyses
    .map((analysis) => {
      const score = round1(weightedScore(analysis.components, state.weights) * 100);
      const priority = classifyPriority(score, thresholds);
      const label = state.labels.get(normalizeFileName(analysis.fileName)) ?? null;
      return {
        ...analysis,
        score,
        priority,
        label,
        fit: label ? classifyFit(priority, label) : "Unlabeled",
        reasoning: buildReasoning(analysis.components, state.weights),
      };
    })
    .sort((a, b) => b.score - a.score)
    .map((result, index) => ({ ...result, rank: index + 1 }));

  renderResults();
  renderValidation();
  renderWeightBars();
}

function classifyPriority(score, thresholds) {
  if (score >= thresholds.collect) return "Collect now";
  if (score >= thresholds.review) return "Review";
  return "Skip";
}

async function analyzeImage(file, targetTone) {
  const bitmap = await loadBitmap(file);
  const maxDimension = 512;
  const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(8, Math.round(bitmap.width * scale));
  const height = Math.max(8, Math.round(bitmap.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0, width, height);
  if (typeof bitmap.close === "function") bitmap.close();

  const { data } = ctx.getImageData(0, 0, width, height);
  const gray = new Float32Array(width * height);

  let sum = 0;
  let sumSq = 0;
  let darkCount = 0;
  let brightCount = 0;
  let midCount = 0;

  for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
    const lum = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
    gray[p] = lum;
    sum += lum;
    sumSq += lum * lum;
    if (lum < 40) darkCount += 1;
    if (lum > 215) brightCount += 1;
    if (lum >= 80 && lum <= 170) midCount += 1;
  }

  const pixelCount = gray.length;
  const mean = sum / pixelCount;
  const variance = Math.max(0, sumSq / pixelCount - mean * mean);
  const stdDev = Math.sqrt(variance);

  let lapSum = 0;
  let lapSq = 0;
  let lapCount = 0;
  let edgeCount = 0;

  for (let y = 1; y < height - 1; y += 1) {
    const rowOffset = y * width;
    for (let x = 1; x < width - 1; x += 1) {
      const idx = rowOffset + x;
      const c = gray[idx];
      const lap =
        -4 * c + gray[idx - 1] + gray[idx + 1] + gray[idx - width] + gray[idx + width];
      lapSum += lap;
      lapSq += lap * lap;
      lapCount += 1;

      const gx = Math.abs(gray[idx + 1] - gray[idx - 1]);
      const gy = Math.abs(gray[idx + width] - gray[idx - width]);
      if (gx + gy > 42) edgeCount += 1;
    }
  }

  const lapMean = lapSum / Math.max(1, lapCount);
  const lapVar = Math.max(0, lapSq / Math.max(1, lapCount) - lapMean * lapMean);
  const edgeRatio = edgeCount / Math.max(1, lapCount);
  const midToneRatio = midCount / pixelCount;
  const extremeRatio = (darkCount + brightCount) / pixelCount;

  const brightnessScore = clamp01(1 - Math.abs(mean - targetTone) / 55);
  const contrastScore = clamp01((stdDev - 18) / 35);
  const sharpnessScore = clamp01((Math.log10(lapVar + 1) - 1.55) / 1.2);
  const iceScore =
    0.68 * clamp01((midToneRatio - 0.22) / 0.42) +
    0.32 * clamp01(1 - extremeRatio / 0.28);
  const contaminationRaw =
    0.62 * clamp01((extremeRatio - 0.05) / 0.2) +
    0.38 * clamp01((edgeRatio - 0.06) / 0.16);
  const cleanScore = clamp01(1 - contaminationRaw);

  return {
    fileName: file.name,
    sharpness: round1(sharpnessScore * 100),
    contrast: round1(contrastScore * 100),
    ice: round1(iceScore * 100),
    contamination: round1((1 - cleanScore) * 100),
    components: {
      brightness: brightnessScore,
      contrast: contrastScore,
      sharpness: sharpnessScore,
      ice: iceScore,
      clean: cleanScore,
    },
    metrics: {
      mean: round2(mean),
      stdDev: round2(stdDev),
      lapVar: round2(lapVar),
      midToneRatio: round3(midToneRatio),
      edgeRatio: round3(edgeRatio),
      width,
      height,
    },
  };
}

async function importLabels(file) {
  try {
    const text = await file.text();
    const imported = parseLabelCsv(text);
    state.labels = imported;
    refs.clearLabelsButton.disabled = imported.size === 0;
    refs.labelsCsvButton.disabled = imported.size === 0;
    refs.labelStatus.textContent =
      imported.size > 0 ? `${imported.size} label(s) loaded` : "No valid labels found";
    calibrateFromLabels();
    if (state.analyses.length > 0) rerunFromAnalyses();
  } catch (error) {
    refs.labelStatus.textContent = `Label import failed: ${error.message}`;
  }
}

function clearLabels() {
  state.labels.clear();
  refs.clearLabelsButton.disabled = true;
  refs.labelsCsvButton.disabled = true;
  refs.labelStatus.textContent = "No labels loaded";
  resetWeights();
  if (state.analyses.length > 0) rerunFromAnalyses();
}

function resetWeights() {
  state.weights = { ...DEFAULT_WEIGHTS };
  state.calibrationNote = state.labels.size > 0 ? "Default scoring, labels retained" : "Default scoring";
  refs.calibrationStatus.textContent = state.calibrationNote;
  renderWeightBars();
  if (state.analyses.length > 0) rerunFromAnalyses();
}

function calibrateFromLabels() {
  const labeled = state.analyses
    .map((analysis) => ({
      analysis,
      label: state.labels.get(normalizeFileName(analysis.fileName)),
    }))
    .filter((entry) => entry.label);

  if (state.labels.size === 0) {
    state.weights = { ...DEFAULT_WEIGHTS };
    state.calibrationNote = "Default scoring";
    refs.calibrationStatus.textContent = state.calibrationNote;
    return;
  }

  if (labeled.length < 3) {
    state.weights = { ...DEFAULT_WEIGHTS };
    state.calibrationNote = `${labeled.length}/${state.labels.size} labels matched`;
    refs.calibrationStatus.textContent = state.calibrationNote;
    return;
  }

  const targets = labeled.map((entry) => labelToTarget(entry.label));
  const learned = {};

  for (const feature of FEATURE_DEFS) {
    const values = labeled.map((entry) => entry.analysis.components[feature.key]);
    const corr = pearson(values, targets);
    learned[feature.key] = Math.max(0.025, Number.isFinite(corr) && corr > 0 ? corr : 0.025);
  }

  const normalizedLearned = normalizeWeights(learned);
  const blend = Math.min(0.68, 0.28 + labeled.length * 0.035);
  state.weights = normalizeWeights(
    Object.fromEntries(
      FEATURE_DEFS.map((feature) => [
        feature.key,
        DEFAULT_WEIGHTS[feature.key] * (1 - blend) + normalizedLearned[feature.key] * blend,
      ])
    )
  );

  state.calibrationNote = `Calibrated on ${labeled.length}/${state.labels.size} labels`;
  refs.calibrationStatus.textContent = state.calibrationNote;
}

function parseLabelCsv(text) {
  const rows = parseCsv(text).filter((row) => row.some((cell) => cell.trim() !== ""));
  if (rows.length === 0) return new Map();

  const first = rows[0].map((cell) => normalizeHeader(cell));
  const hasHeader = first.some((cell) =>
    ["filename", "file", "image", "name", "label", "decision", "priority", "class"].includes(cell)
  );

  const filenameIndex = hasHeader
    ? first.findIndex((cell) => ["filename", "file", "image", "name"].includes(cell))
    : 0;
  const labelIndex = hasHeader
    ? first.findIndex((cell) => ["label", "decision", "priority", "class"].includes(cell))
    : 1;

  if (filenameIndex < 0 || labelIndex < 0) {
    throw new Error("CSV needs filename and label columns");
  }

  const labels = new Map();
  const dataRows = hasHeader ? rows.slice(1) : rows;
  for (const row of dataRows) {
    const fileName = row[filenameIndex]?.trim();
    const label = normalizeLabel(row[labelIndex]);
    if (fileName && label) labels.set(normalizeFileName(fileName), label);
  }
  return labels;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (quoted) {
      if (char === "\"" && next === "\"") {
        field += "\"";
        i += 1;
      } else if (char === "\"") {
        quoted = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === "\"") {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }

  row.push(field);
  rows.push(row);
  return rows;
}

function normalizeLabel(value = "") {
  const label = value.trim().toLowerCase();
  if (["collect", "collect now", "good", "usable", "use", "accept", "accepted", "yes", "1"].includes(label)) {
    return "Collect";
  }
  if (["review", "maybe", "inspect", "borderline", "hold", "0.5"].includes(label)) {
    return "Review";
  }
  if (["skip", "bad", "reject", "rejected", "unusable", "empty", "contam", "contaminated", "no", "0"].includes(label)) {
    return "Skip";
  }
  return null;
}

function normalizeHeader(value = "") {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function normalizeFileName(value = "") {
  return value.trim().split(/[\\/]/).pop().toLowerCase();
}

function labelToTarget(label) {
  if (label === "Collect") return 1;
  if (label === "Review") return 0.55;
  return 0;
}

function priorityToLabel(priority) {
  if (priority === "Collect now") return "Collect";
  if (priority === "Review") return "Review";
  return "Skip";
}

function classifyFit(priority, label) {
  const predicted = priorityToLabel(priority);
  if (predicted === label) return "Match";
  if (predicted !== "Skip" && label !== "Skip") return "Usable";
  return "Miss";
}

function renderResults() {
  if (state.results.length === 0) {
    refs.resultsBody.innerHTML =
      '<tr><td colspan="11" class="empty">No results available.</td></tr>';
    resetSummary();
    refs.reportButton.disabled = true;
    refs.reportPanel.hidden = true;
    return;
  }

  refs.resultsBody.innerHTML = "";

  for (const result of state.results) {
    const row = refs.rowTemplate.content.firstElementChild.cloneNode(true);
    row.querySelector(".rank").textContent = String(result.rank);
    row.querySelector(".name").textContent = result.fileName;
    row.querySelector(".priority").appendChild(priorityPill(result.priority));
    row.querySelector(".score").textContent = formatScore(result.score);
    row.querySelector(".label").appendChild(labelPill(result.label));
    row.querySelector(".fit").appendChild(fitPill(result.fit));
    row.querySelector(".sharpness").textContent = formatScore(result.sharpness);
    row.querySelector(".contrast").textContent = formatScore(result.contrast);
    row.querySelector(".ice").textContent = formatScore(result.ice);
    row.querySelector(".contam").textContent = formatScore(result.contamination);
    row.querySelector(".reason").textContent = result.reasoning;
    refs.resultsBody.appendChild(row);
  }

  refs.resultsInfo.textContent = `Ranked ${state.results.length} image(s).`;
  renderSummary();
  renderReportPreview();
}

function renderSummary() {
  const summary = getEconomicsSummary();

  refs.totalCount.textContent = String(summary.totalCount);
  refs.collectCount.textContent = String(summary.collectCount);
  refs.reviewCount.textContent = String(summary.reviewCount);
  refs.skipCount.textContent = String(summary.skipCount);
  refs.timeSaved.textContent = `${round1(summary.minutesSaved)} min`;
  refs.costSaved.textContent = formatMoney(summary.costSaved);
  refs.roiStatus.textContent = `${formatMoney(summary.hourlyRate)}/hr microscope model`;
}

function resetSummary() {
  refs.totalCount.textContent = "0";
  refs.collectCount.textContent = "0";
  refs.reviewCount.textContent = "0";
  refs.skipCount.textContent = "0";
  refs.timeSaved.textContent = "0 min";
  refs.costSaved.textContent = "$0";
  refs.roiStatus.textContent = `${formatMoney(safeNumber(refs.microscopeRate.value, 550))}/hr microscope model`;
}

function renderValidation() {
  refs.validationStats.textContent = getValidationSummary().statusText;
}

function getEconomicsSummary() {
  const collectCount = state.results.filter((row) => row.priority === "Collect now").length;
  const reviewCount = state.results.filter((row) => row.priority === "Review").length;
  const skipCount = state.results.filter((row) => row.priority === "Skip").length;
  const minutesPerSkip = safeNumber(refs.minutesPerSkip.value, 3.2);
  const minutesPerReview = safeNumber(refs.minutesPerReview.value, 1.1);
  const hourlyRate = safeNumber(refs.microscopeRate.value, 550);
  const minutesSaved = skipCount * minutesPerSkip + reviewCount * minutesPerReview;
  const costSaved = (minutesSaved / 60) * hourlyRate;

  return {
    totalCount: state.results.length,
    collectCount,
    reviewCount,
    skipCount,
    minutesPerSkip,
    minutesPerReview,
    hourlyRate,
    minutesSaved,
    costSaved,
  };
}

function getValidationSummary() {
  const labeled = state.results.filter((result) => result.label);
  if (state.labels.size === 0) {
    return {
      labelCount: 0,
      matchedCount: 0,
      exact: 0,
      tp: 0,
      fp: 0,
      fn: 0,
      tn: 0,
      precision: 0,
      recall: 0,
      exactRate: 0,
      statusText: "Awaiting labeled results.",
    };
  }
  if (labeled.length === 0) {
    return {
      labelCount: state.labels.size,
      matchedCount: 0,
      exact: 0,
      tp: 0,
      fp: 0,
      fn: 0,
      tn: 0,
      precision: 0,
      recall: 0,
      exactRate: 0,
      statusText: `${state.labels.size} label(s) loaded; none match staged images yet.`,
    };
  }

  let exact = 0;
  let tp = 0;
  let fp = 0;
  let fn = 0;
  let tn = 0;

  for (const result of labeled) {
    if (classifyFit(result.priority, result.label) === "Match") exact += 1;
    const predictedUseful = priorityToLabel(result.priority) !== "Skip";
    const actualUseful = result.label !== "Skip";
    if (predictedUseful && actualUseful) tp += 1;
    if (predictedUseful && !actualUseful) fp += 1;
    if (!predictedUseful && actualUseful) fn += 1;
    if (!predictedUseful && !actualUseful) tn += 1;
  }

  const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
  const exactRate = exact / labeled.length;

  return {
    labelCount: state.labels.size,
    matchedCount: labeled.length,
    exact,
    tp,
    fp,
    fn,
    tn,
    precision,
    recall,
    exactRate,
    statusText: `Labels matched: ${labeled.length}/${state.labels.size} | Exact: ${percent(exactRate)} | Useful precision: ${percent(precision)} | Useful recall: ${percent(recall)} | TN: ${tn}`,
  };
}

function renderWeightBars() {
  refs.weightBars.innerHTML = "";
  for (const feature of FEATURE_DEFS) {
    const row = document.createElement("div");
    row.className = "weight-row";
    row.innerHTML = `
      <span>${feature.label}</span>
      <div class="bar"><div class="bar-fill" style="width: ${round1(state.weights[feature.key] * 100)}%"></div></div>
      <span class="mono">${round1(state.weights[feature.key] * 100)}%</span>
    `;
    refs.weightBars.appendChild(row);
  }
}

function priorityPill(priority) {
  if (priority === "Collect now") return pill(priority, "collect");
  if (priority === "Review") return pill(priority, "review");
  return pill(priority, "skip");
}

function labelPill(label) {
  if (!label) return pill("None", "neutral");
  if (label === "Collect") return pill(label, "collect");
  if (label === "Review") return pill(label, "review");
  return pill(label, "skip");
}

function fitPill(fit) {
  if (fit === "Match" || fit === "Usable") return pill(fit, "fit");
  if (fit === "Miss") return pill(fit, "miss");
  return pill("None", "neutral");
}

function pill(text, className) {
  const el = document.createElement("span");
  el.className = `pill ${className}`;
  el.textContent = text;
  return el;
}

function buildReasoning(components, weights) {
  const ranked = FEATURE_DEFS.map((feature) => ({
    label: feature.label.toLowerCase(),
    value: components[feature.key],
    contribution: components[feature.key] * weights[feature.key],
  }));

  const strongest = [...ranked]
    .sort((a, b) => b.contribution - a.contribution)
    .slice(0, 2)
    .map((item) => item.label);
  const weakest = [...ranked].sort((a, b) => a.value - b.value)[0].label;
  return `Strong: ${strongest.join(", ")}. Watch: ${weakest}.`;
}

function renderReportPreview() {
  if (state.results.length === 0) {
    refs.reportPanel.hidden = true;
    return;
  }

  const model = getReportModel();
  refs.reportPanel.hidden = false;
  refs.reportStatus.textContent = `${model.sourceType} | ${model.generatedAtText}`;
  refs.reportBody.innerHTML = `
    <div class="report-kpis">
      ${reportKpi("Images", model.summary.totalCount)}
      ${reportKpi("Collect queue", model.summary.collectCount)}
      ${reportKpi("Time saved", `${round1(model.summary.minutesSaved)} min`)}
      ${reportKpi("Cost saved", formatMoney(model.summary.costSaved))}
    </div>
    <div class="report-section">
      <h3>Decision Brief</h3>
      <p>${escapeHtml(model.recommendation)}</p>
    </div>
    <div class="report-section">
      <h3>Validation</h3>
      <p>${escapeHtml(model.validation.statusText)}</p>
    </div>
    <div class="report-section">
      <h3>Recommended Collection Queue</h3>
      ${reportList(
        model.topQueue.map(
          (result) =>
            `#${result.rank} ${result.fileName} (${formatScore(result.score)}) - ${result.reasoning}`
        )
      )}
    </div>
    <div class="report-section">
      <h3>Next Actions</h3>
      ${reportList(model.nextActions)}
    </div>
  `;
}

function reportKpi(label, value) {
  return `
    <div class="report-kpi">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(String(value))}</strong>
    </div>
  `;
}

function reportList(items) {
  if (items.length === 0) {
    return "<p>No matching items.</p>";
  }
  return `<ul class="report-list">${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
}

function getReportModel() {
  const summary = getEconomicsSummary();
  const validation = getValidationSummary();
  const generatedAt = new Date();
  const isSynthetic =
    state.results.length > 0 &&
    state.results.every((result) => normalizeFileName(result.fileName).startsWith("sim_"));
  const topQueue = state.results
    .filter((result) => result.priority === "Collect now")
    .slice(0, 10);
  const reviewQueue = state.results
    .filter((result) => result.priority === "Review")
    .slice(0, 10);
  const missedUseful = state.results.filter(
    (result) => result.label && result.label !== "Skip" && priorityToLabel(result.priority) === "Skip"
  );
  const falseCollects = state.results.filter(
    (result) => result.label === "Skip" && priorityToLabel(result.priority) !== "Skip"
  );
  const sourceType = isSynthetic ? "Synthetic session" : "Uploaded session";
  const recommendation = buildReportRecommendation({
    isSynthetic,
    validation,
    summary,
    missedUseful,
    falseCollects,
  });

  return {
    generatedAt,
    generatedAtText: generatedAt.toLocaleString(),
    sourceType,
    summary,
    validation,
    topQueue,
    reviewQueue,
    missedUseful,
    falseCollects,
    recommendation,
    nextActions: buildNextActions({ isSynthetic, validation, summary, missedUseful }),
    weights: FEATURE_DEFS.map((feature) => ({
      label: feature.label,
      value: state.weights[feature.key],
    })),
  };
}

function buildReportRecommendation({ isSynthetic, validation, summary, missedUseful, falseCollects }) {
  if (summary.totalCount === 0) {
    return "Run triage before generating a pilot report.";
  }
  if (isSynthetic) {
    return "This is a workflow benchmark from simulated data. Use it for demos and pipeline testing, then replace it with a real labeled facility session before making performance claims.";
  }
  if (validation.matchedCount === 0) {
    return "The queue is ranked, but no matching labels are available. Add human labels to estimate false-skip risk and pilot readiness.";
  }
  if (missedUseful.length > 0) {
    return `False-skip risk needs review: ${missedUseful.length} labeled useful image(s) were placed in Skip. Lower strictness or inspect skipped items before collection decisions.`;
  }
  if (falseCollects.length > 0) {
    return `The workflow avoided false skips, but ${falseCollects.length} labeled skip image(s) remained in the useful queue. Tighten thresholds if microscope time is the main constraint.`;
  }
  if (validation.recall >= 0.9 && validation.precision >= 0.8) {
    return "The labeled session is ready for a small facility pilot: useful recall and precision are strong enough to test operational time savings.";
  }
  return "The workflow is useful for queue review, but more labels are needed before treating it as a decision-support pilot.";
}

function buildNextActions({ isSynthetic, validation, summary, missedUseful }) {
  const actions = [];
  if (isSynthetic) {
    actions.push("Use the synthetic report in outreach only as a product workflow demonstration.");
    actions.push("Request 50-200 anonymized atlas or hole images with collect/review/skip labels from one facility session.");
  } else if (validation.matchedCount === 0) {
    actions.push("Export the ranked CSV and ask a human operator to label the same filenames.");
    actions.push("Re-import the label CSV to calculate false-skip risk and useful recall.");
  } else if (missedUseful.length > 0) {
    actions.push("Audit the skipped-but-useful images before changing collection policy.");
    actions.push("Run the same images at lower strictness and compare useful recall.");
  } else {
    actions.push("Run a second labeled session from a different grid condition.");
    actions.push("Package the report as an ROI memo for a core facility manager.");
  }

  if (summary.costSaved > 0) {
    actions.push(`Use ${formatMoney(summary.costSaved)} estimated savings as a discovery hypothesis, not a validated claim.`);
  }
  return actions;
}

function exportPilotReport() {
  if (state.results.length === 0) return;

  const html = buildStandaloneReport(getReportModel());
  const blob = new Blob([html], { type: "text/html;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  const timestamp = new Date().toISOString().slice(0, 19).replaceAll(":", "-");
  link.download = `cryo-triage-pilot-report-${timestamp}.html`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function buildStandaloneReport(model) {
  const topRows = model.topQueue.map(reportTableRow).join("");
  const reviewRows = model.reviewQueue.map(reportTableRow).join("");
  const weights = model.weights
    .map((weight) => `<tr><td>${escapeHtml(weight.label)}</td><td>${round1(weight.value * 100)}%</td></tr>`)
    .join("");
  const misses = model.missedUseful.map(reportTableRow).join("");
  const falseCollects = model.falseCollects.map(reportTableRow).join("");
  const actions = model.nextActions.map((item) => `<li>${escapeHtml(item)}</li>`).join("");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>CryoTriage Pilot Report</title>
  <style>
    :root { color-scheme: light; --ink: #172126; --muted: #5d6a70; --line: #d8dfdc; --bg: #f6f8f8; --accent: #008f7a; }
    body { margin: 0; background: var(--bg); color: var(--ink); font-family: Arial, sans-serif; }
    main { max-width: 1040px; margin: 0 auto; padding: 32px 18px 48px; }
    h1 { margin: 0 0 6px; font-size: 30px; }
    h2 { margin: 26px 0 10px; font-size: 17px; }
    p { color: var(--muted); line-height: 1.5; }
    .kpis { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; margin: 22px 0; }
    .kpi, section { background: white; border: 1px solid var(--line); border-radius: 8px; padding: 14px; }
    .kpi span { color: var(--muted); display: block; font-size: 12px; font-weight: 700; text-transform: uppercase; }
    .kpi strong { display: block; font-family: Menlo, monospace; font-size: 24px; margin-top: 6px; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border-bottom: 1px solid var(--line); font-size: 13px; padding: 8px; text-align: left; vertical-align: top; }
    th { color: var(--muted); font-size: 11px; text-transform: uppercase; }
    .note { border-left: 4px solid var(--accent); padding-left: 12px; }
    @media (max-width: 760px) { .kpis { grid-template-columns: 1fr 1fr; } }
  </style>
</head>
<body>
  <main>
    <p>${escapeHtml(model.sourceType)} | Generated ${escapeHtml(model.generatedAtText)}</p>
    <h1>CryoTriage Pilot Report</h1>
    <p class="note">${escapeHtml(model.recommendation)}</p>
    <div class="kpis">
      ${standaloneKpi("Images", model.summary.totalCount)}
      ${standaloneKpi("Collect", model.summary.collectCount)}
      ${standaloneKpi("Time saved", `${round1(model.summary.minutesSaved)} min`)}
      ${standaloneKpi("Cost saved", formatMoney(model.summary.costSaved))}
    </div>

    <section>
      <h2>Validation</h2>
      <p>${escapeHtml(model.validation.statusText)}</p>
      <table>
        <tbody>
          <tr><td>Matched labels</td><td>${model.validation.matchedCount}/${model.validation.labelCount}</td></tr>
          <tr><td>Exact agreement</td><td>${percent(model.validation.exactRate)}</td></tr>
          <tr><td>Useful precision</td><td>${percent(model.validation.precision)}</td></tr>
          <tr><td>Useful recall</td><td>${percent(model.validation.recall)}</td></tr>
          <tr><td>False skips</td><td>${model.validation.fn}</td></tr>
          <tr><td>False useful queue</td><td>${model.validation.fp}</td></tr>
        </tbody>
      </table>
    </section>

    <section>
      <h2>Recommended Collection Queue</h2>
      ${reportTable(topRows)}
    </section>

    <section>
      <h2>Review Queue</h2>
      ${reportTable(reviewRows)}
    </section>

    <section>
      <h2>Risk Audit</h2>
      <p>Skipped but labeled useful</p>
      ${reportTable(misses)}
      <p>Labeled skip but kept in useful queue</p>
      ${reportTable(falseCollects)}
    </section>

    <section>
      <h2>Scoring Weights</h2>
      <table><tbody>${weights}</tbody></table>
    </section>

    <section>
      <h2>Next Actions</h2>
      <ul>${actions}</ul>
    </section>
  </main>
</body>
</html>`;
}

function standaloneKpi(label, value) {
  return `<div class="kpi"><span>${escapeHtml(label)}</span><strong>${escapeHtml(String(value))}</strong></div>`;
}

function reportTable(rows) {
  if (!rows) return "<p>No matching items.</p>";
  return `
    <table>
      <thead>
        <tr><th>Rank</th><th>Image</th><th>Priority</th><th>Score</th><th>Label</th><th>Reasoning</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function reportTableRow(result) {
  return `
    <tr>
      <td>${result.rank}</td>
      <td>${escapeHtml(result.fileName)}</td>
      <td>${escapeHtml(result.priority)}</td>
      <td>${formatScore(result.score)}</td>
      <td>${escapeHtml(result.label ?? "")}</td>
      <td>${escapeHtml(result.reasoning)}</td>
    </tr>
  `;
}

function exportCsv() {
  if (state.results.length === 0) return;

  const assumptions = {
    microscope_rate_per_hour: safeNumber(refs.microscopeRate.value, 550),
    minutes_per_skip: safeNumber(refs.minutesPerSkip.value, 3.2),
    minutes_per_review: safeNumber(refs.minutesPerReview.value, 1.1),
  };

  const rows = [
    [
      "rank",
      "filename",
      "priority",
      "score",
      "label",
      "fit",
      "sharpness",
      "contrast",
      "ice",
      "contamination",
      "tone_component",
      "clean_component",
      "mean_intensity",
      "std_dev",
      "laplacian_variance",
      "mid_tone_ratio",
      "edge_ratio",
      "calibration",
      "weights_json",
      "roi_assumptions_json",
      "reasoning",
    ],
    ...state.results.map((result) => [
      result.rank,
      result.fileName,
      result.priority,
      result.score,
      result.label ?? "",
      result.fit,
      result.sharpness,
      result.contrast,
      result.ice,
      result.contamination,
      round3(result.components.brightness),
      round3(result.components.clean),
      result.metrics.mean,
      result.metrics.stdDev,
      result.metrics.lapVar,
      result.metrics.midToneRatio,
      result.metrics.edgeRatio,
      state.calibrationNote,
      JSON.stringify(state.weights),
      JSON.stringify(assumptions),
      result.reasoning,
    ]),
  ];

  const blob = new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  const timestamp = new Date().toISOString().slice(0, 19).replaceAll(":", "-");
  link.download = `cryo-triage-${timestamp}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function toCsv(rows) {
  return rows
    .map((columns) =>
      columns
        .map((column) => {
          const value = String(column ?? "");
          return value.includes(",") || value.includes("\"") || value.includes("\n")
            ? `"${value.replaceAll("\"", "\"\"")}"`
            : value;
        })
        .join(",")
    )
    .join("\n");
}

async function loadDemoSet() {
  refs.demoButton.disabled = true;
  refs.demoButton.textContent = "Simulating...";

  try {
    const count = Math.max(8, Math.min(160, Math.round(safeNumber(refs.simulationCount.value, 48))));
    const seed = Math.max(1, Math.round(safeNumber(refs.simulationSeed.value, 42)));
    refs.simulationCount.value = String(count);
    refs.simulationSeed.value = String(seed);

    const specs = generateSyntheticSpecs(count, seed);
    const files = await Promise.all(specs.map((spec, index) => createDemoImage(spec, seed + index + 11)));
    state.labels = new Map(specs.map((spec) => [normalizeFileName(spec.fileName), spec.label]));
    refs.clearLabelsButton.disabled = false;
    refs.labelsCsvButton.disabled = false;
    refs.labelStatus.textContent = `${state.labels.size} simulated label(s) loaded`;
    setFiles(files);
    await runTriage();
  } finally {
    refs.demoButton.disabled = false;
    refs.demoButton.textContent = "Simulate Session";
  }
}

function generateSyntheticSpecs(count, seed) {
  const rand = seededRandom(seed);
  const specs = [];
  const gridIds = ["A", "B", "C", "D"];

  for (let i = 0; i < count; i += 1) {
    const bucket = rand();
    const label = bucket < 0.38 ? "Collect" : bucket < 0.68 ? "Review" : "Skip";
    const grid = gridIds[Math.floor(rand() * gridIds.length)];
    const square = String(1 + Math.floor(rand() * 72)).padStart(3, "0");
    const hole = String(1 + Math.floor(rand() * 96)).padStart(3, "0");
    const replicate = String(i + 1).padStart(3, "0");

    const baseSpec = {
      Collect: {
        base: 108 + rand() * 34,
        noise: 20 + rand() * 16,
        spots: 62 + Math.floor(rand() * 42),
        contam: 1 + Math.floor(rand() * 6),
      },
      Review: {
        base: rand() < 0.5 ? 84 + rand() * 28 : 146 + rand() * 24,
        noise: 13 + rand() * 19,
        spots: 32 + Math.floor(rand() * 38),
        contam: 6 + Math.floor(rand() * 14),
      },
      Skip: {
        base: rand() < 0.5 ? 42 + rand() * 42 : 188 + rand() * 48,
        noise: 4 + rand() * 42,
        spots: 5 + Math.floor(rand() * 34),
        contam: 14 + Math.floor(rand() * 36),
      },
    }[label];

    specs.push({
      ...baseSpec,
      label,
      fileName: `sim_grid_${grid}_sq${square}_hole${hole}_${replicate}.png`,
    });
  }

  return specs;
}

function exportLabelsCsv() {
  if (state.labels.size === 0) return;

  const rows = [
    ["filename", "label"],
    ...[...state.labels.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([fileName, label]) => [fileName, label.toLowerCase()]),
  ];
  const blob = new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  const timestamp = new Date().toISOString().slice(0, 19).replaceAll(":", "-");
  link.download = `cryo-triage-labels-${timestamp}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

async function createDemoImage(spec, seed) {
  const width = 256;
  const height = 256;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  const imageData = ctx.createImageData(width, height);
  const rand = seededRandom(seed);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = (y * width + x) * 4;
      const wave = Math.sin(x / 11) * 4 + Math.cos(y / 17) * 5;
      const lum = clamp255(spec.base + wave + (rand() - 0.5) * spec.noise);
      imageData.data[idx] = lum;
      imageData.data[idx + 1] = lum;
      imageData.data[idx + 2] = lum;
      imageData.data[idx + 3] = 255;
    }
  }

  ctx.putImageData(imageData, 0, 0);
  ctx.globalCompositeOperation = "multiply";
  for (let i = 0; i < spec.spots; i += 1) {
    const radius = 1.2 + rand() * 3.6;
    ctx.fillStyle = `rgba(${70 + rand() * 50}, ${70 + rand() * 50}, ${70 + rand() * 50}, ${0.16 + rand() * 0.22})`;
    ctx.beginPath();
    ctx.arc(rand() * width, rand() * height, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.globalCompositeOperation = "screen";
  for (let i = 0; i < spec.contam; i += 1) {
    const radius = 3 + rand() * 15;
    ctx.fillStyle = `rgba(245, 245, 245, ${0.18 + rand() * 0.4})`;
    ctx.beginPath();
    ctx.arc(rand() * width, rand() * height, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.globalCompositeOperation = "source-over";
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  return new File([blob], spec.fileName, { type: "image/png" });
}

function seededRandom(seed) {
  let value = seed % 2147483647;
  return () => {
    value = (value * 16807) % 2147483647;
    return (value - 1) / 2147483646;
  };
}

async function loadBitmap(file) {
  if (typeof createImageBitmap === "function") {
    return createImageBitmap(file);
  }

  const url = URL.createObjectURL(file);
  try {
    return await new Promise((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("Image decoding failed"));
      element.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

function weightedScore(components, weights) {
  return FEATURE_DEFS.reduce(
    (total, feature) => total + components[feature.key] * weights[feature.key],
    0
  );
}

function pearson(values, targets) {
  const valueMean = mean(values);
  const targetMean = mean(targets);
  let numerator = 0;
  let valueSumSq = 0;
  let targetSumSq = 0;

  for (let i = 0; i < values.length; i += 1) {
    const valueDelta = values[i] - valueMean;
    const targetDelta = targets[i] - targetMean;
    numerator += valueDelta * targetDelta;
    valueSumSq += valueDelta * valueDelta;
    targetSumSq += targetDelta * targetDelta;
  }

  return numerator / Math.sqrt(valueSumSq * targetSumSq);
}

function normalizeWeights(weights) {
  const positive = {};
  let total = 0;
  for (const feature of FEATURE_DEFS) {
    positive[feature.key] = Math.max(0, weights[feature.key] ?? 0);
    total += positive[feature.key];
  }
  if (total <= 0) return { ...DEFAULT_WEIGHTS };
  return Object.fromEntries(
    FEATURE_DEFS.map((feature) => [feature.key, positive[feature.key] / total])
  );
}

function mean(values) {
  return values.reduce((total, value) => total + value, 0) / Math.max(1, values.length);
}

function safeNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function formatScore(value) {
  return Number(value).toFixed(1);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#039;");
}

function formatMoney(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function percent(value) {
  return `${Math.round(value * 100)}%`;
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function clamp255(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function round1(value) {
  return Math.round(value * 10) / 10;
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

function round3(value) {
  return Math.round(value * 1000) / 1000;
}
