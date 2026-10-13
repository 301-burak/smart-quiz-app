const DATABASE_NAME = "smart-quiz-app";
const DATABASE_VERSION = 2;
const SUBJECT_STORE = "subjects";
const QUIZ_STORE = "quizzes";
const QUESTION_STORE = "questions";
const PROGRESS_STORE = "quizProgress";
const RESULTS_STORE = "quizResults";
const BACKUP_FORMAT = "smart-quiz-app-backup";
const BACKUP_VERSION = 1;
const BACKUP_STORES = [SUBJECT_STORE, QUIZ_STORE, QUESTION_STORE, PROGRESS_STORE, RESULTS_STORE];
const MAX_BACKUP_BYTES = 25 * 1024 * 1024;
const DEFAULT_SUBJECTS = ["Math", "English"];
const PDF_LIBRARY_URL = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
const PDF_WORKER_URL = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
const DOCX_LIBRARY_URL = "https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.8.0/mammoth.browser.min.js";

const state = {
  database: null,
  subjects: [],
  quizzes: [],
  questions: [],
  quizProgress: [],
  quizResults: [],
  currentStudy: null,
  studyActionInFlight: false,
  pendingLibraryNavigation: null,
  activeSubjectId: null,
  dialogMode: null,
  editingId: null,
  draftQuestions: [],
  pendingBackup: null,
  libraryLoads: new Map()
};

const elements = {
  subjectList: document.querySelector("#subject-list"),
  libraryContent: document.querySelector("#library-content"),
  libraryDashboard: document.querySelector("#library-dashboard"),
  studyView: document.querySelector("#study-view"),
  breadcrumbSubject: document.querySelector("#breadcrumb-subject"),
  collectionTitle: document.querySelector("#collection-title"),
  subjectCount: document.querySelector("#subject-count"),
  quizCount: document.querySelector("#quiz-count"),
  questionCount: document.querySelector("#question-count"),
  addQuizButton: document.querySelector("#add-quiz-button"),
  message: document.querySelector("#app-message"),
  dialog: document.querySelector("#editor-dialog"),
  form: document.querySelector("#editor-form"),
  dialogTitle: document.querySelector("#dialog-title"),
  dialogDescription: document.querySelector("#dialog-description"),
  nameLabel: document.querySelector("#name-field-label"),
  nameInput: document.querySelector("#entity-name"),
  subjectField: document.querySelector("#subject-field"),
  subjectSelect: document.querySelector("#subject-select"),
  submitButton: document.querySelector("#dialog-submit"),
  importDialog: document.querySelector("#import-dialog"),
  importForm: document.querySelector("#import-form"),
  importQuizName: document.querySelector("#import-quiz-name"),
  importSubject: document.querySelector("#import-subject"),
  importFile: document.querySelector("#question-file"),
  importText: document.querySelector("#question-text"),
  importFeedback: document.querySelector("#import-feedback"),
  importPreview: document.querySelector("#import-preview"),
  previewQuestions: document.querySelector("#preview-questions"),
  previewCount: document.querySelector("#preview-count"),
  reviewWarning: document.querySelector("#review-warning"),
  saveImport: document.querySelector("#save-import"),
  exportBackupButton: document.querySelector("#export-backup-button"),
  importBackupButton: document.querySelector("#import-backup-button"),
  backupDialog: document.querySelector("#backup-dialog"),
  backupFilePicker: document.querySelector("#backup-file-picker"),
  backupFeedback: document.querySelector("#backup-feedback"),
  backupPreview: document.querySelector("#backup-preview"),
  backupFileName: document.querySelector("#backup-file-name"),
  backupCounts: document.querySelector("#backup-counts"),
  restoreBackupButton: document.querySelector("#restore-backup-button")
};

function makeId() {
  return crypto.randomUUID();
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(SUBJECT_STORE)) {
        database.createObjectStore(SUBJECT_STORE, { keyPath: "id" });
      }
      if (!database.objectStoreNames.contains(QUIZ_STORE)) {
        const quizzes = database.createObjectStore(QUIZ_STORE, { keyPath: "id" });
        quizzes.createIndex("subjectId", "subjectId", { unique: false });
      }
      if (!database.objectStoreNames.contains(QUESTION_STORE)) {
        const questions = database.createObjectStore(QUESTION_STORE, { keyPath: "id" });
        questions.createIndex("quizId", "quizId", { unique: false });
      }
      if (!database.objectStoreNames.contains(PROGRESS_STORE)) {
        database.createObjectStore(PROGRESS_STORE, { keyPath: "quizId" });
      }
      if (!database.objectStoreNames.contains(RESULTS_STORE)) {
        const results = database.createObjectStore(RESULTS_STORE, { keyPath: "id" });
        results.createIndex("quizId", "quizId", { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open the local database."));
    request.onblocked = () => reject(new Error("The local database is waiting for another tab to close."));
  });
}

function initializeDefaultSubjects() {
  return new Promise((resolve, reject) => {
    const transaction = state.database.transaction(SUBJECT_STORE, "readwrite");
    const subjects = transaction.objectStore(SUBJECT_STORE);
    const request = subjects.getAll();

    request.onsuccess = () => {
      const existingSubjects = request.result;
      const cloudSecuritySubjects = existingSubjects.filter(
        (subject) => subject.name.trim().toLocaleLowerCase() === "cloud security"
      );

      if (existingSubjects.length === 0) {
        for (const name of DEFAULT_SUBJECTS) {
          subjects.add({ id: makeId(), name, createdAt: new Date().toISOString() });
        }
      } else {
        for (const subject of cloudSecuritySubjects) {
          subjects.put({
            ...subject,
            name: "English",
            updatedAt: new Date().toISOString()
          });
        }
      }
    };

    request.onerror = () => reject(request.error ?? new Error("Could not initialize subject folders."));
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error ?? new Error("Could not initialize subject folders."));
    transaction.onabort = () => reject(transaction.error ?? new Error("Could not initialize subject folders."));
  });
}

function readAll(storeName, database = state.database) {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, "readonly");
    const request = transaction.objectStore(storeName).getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error(`Could not read ${storeName}.`));
    transaction.onabort = () => reject(transaction.error ?? new Error(`Could not read ${storeName}.`));
  });
}

function writeTransaction(storeNames, write, database = state.database) {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeNames, "readwrite");
    try {
      write(transaction);
    } catch (error) {
      transaction.abort();
      reject(error);
      return;
    }
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error ?? new Error("Could not save your changes."));
    transaction.onabort = () => reject(transaction.error ?? new Error("Could not save your changes."));
  });
}

async function exportBackupData(database = state.database) {
  const [subjects, quizzes, questions, quizProgress, quizResults] = await Promise.all(
    BACKUP_STORES.map((storeName) => readAll(storeName, database))
  );
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    data: { subjects, quizzes, questions, quizProgress, quizResults }
  };
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function validateBackupDocument(backup) {
  if (!isRecord(backup) || backup.format !== BACKUP_FORMAT || backup.version !== BACKUP_VERSION) {
    throw new Error("This is not a supported Smart Quiz App backup.");
  }
  if (!hasText(backup.exportedAt) || !isRecord(backup.data)) {
    throw new Error("The backup is missing its export date or data section.");
  }

  const data = backup.data;
  for (const storeName of BACKUP_STORES) {
    if (!Array.isArray(data[storeName])) {
      throw new Error(`The backup is missing a valid "${storeName}" collection.`);
    }
  }

  const recordsByStore = Object.fromEntries(BACKUP_STORES.map((storeName) => [storeName, data[storeName]]));
  const identifiers = new Map();
  for (const storeName of [SUBJECT_STORE, QUIZ_STORE, QUESTION_STORE, RESULTS_STORE]) {
    const seen = new Set();
    for (const [index, record] of recordsByStore[storeName].entries()) {
      if (!isRecord(record) || !hasText(record.id) || seen.has(record.id)) {
        throw new Error(`The backup contains an invalid or duplicate ID in "${storeName}" at record ${index + 1}.`);
      }
      seen.add(record.id);
    }
    identifiers.set(storeName, seen);
  }

  const subjectIds = identifiers.get(SUBJECT_STORE);
  const quizIds = identifiers.get(QUIZ_STORE);
  const questionIds = identifiers.get(QUESTION_STORE);
  for (const [index, subject] of recordsByStore[SUBJECT_STORE].entries()) {
    if (!hasText(subject.name) || !hasText(subject.createdAt)) {
      throw new Error(`Subject ${index + 1} is missing its name or creation date.`);
    }
  }
  for (const [index, quiz] of recordsByStore[QUIZ_STORE].entries()) {
    if (!hasText(quiz.name) || !hasText(quiz.createdAt) || !subjectIds.has(quiz.subjectId)) {
      throw new Error(`Quiz ${index + 1} has invalid details or refers to a missing subject.`);
    }
  }
  const questionsByQuiz = new Map();
  for (const [index, question] of recordsByStore[QUESTION_STORE].entries()) {
    if (!hasText(question.quizId) || !quizIds.has(question.quizId)
      || !hasText(question.text) || !isRecord(question.options)
      || !["A", "B", "C", "D"].every((label) => typeof question.options[label] === "string")
      || !(question.correctAnswer === null || ["A", "B", "C", "D"].includes(question.correctAnswer))
      || typeof question.needsReview !== "boolean") {
      throw new Error(`Question ${index + 1} has invalid details or refers to a missing quiz.`);
    }
    if (!questionsByQuiz.has(question.quizId)) questionsByQuiz.set(question.quizId, new Set());
    questionsByQuiz.get(question.quizId).add(question.id);
  }

  const progressQuizIds = new Set();
  for (const [index, progress] of recordsByStore[PROGRESS_STORE].entries()) {
    const quizQuestionIds = questionsByQuiz.get(progress?.quizId);
    if (!isRecord(progress) || !hasText(progress.quizId) || !quizIds.has(progress.quizId)
      || progressQuizIds.has(progress.quizId)
      || !Array.isArray(progress.questionIds) || progress.questionIds.length === 0
      || new Set(progress.questionIds).size !== progress.questionIds.length
      || !Array.isArray(progress.queue) || progress.queue.length === 0
      || !Number.isInteger(progress.queueIndex) || progress.queueIndex < 0
      || progress.queueIndex >= progress.queue.length
      || !Number.isInteger(progress.round) || progress.round < 1
      || !["in-progress", "completed"].includes(progress.status)
      || !hasText(progress.startedAt) || !hasText(progress.updatedAt)
      || !["questions", "first-round-score", undefined].includes(progress.stage)
      || !["firstRoundCorrect", "firstRoundIncorrect"]
        .every((field) => Number.isInteger(progress[field]) && progress[field] >= 0)
      || !progress.questionIds.every((id) => quizQuestionIds?.has(id))
      || !progress.queue.every((id) => progress.questionIds.includes(id))) {
      throw new Error(`Progress record ${index + 1} is invalid or refers to missing quiz questions.`);
    }
    for (const field of ["reviewCorrectCount", "reviewIncorrectCount", "correctCount", "incorrectCount"]) {
      if (progress[field] !== undefined
        && (!Number.isInteger(progress[field]) || progress[field] < 0)) {
        throw new Error(`Progress record ${index + 1} contains an invalid ${field}.`);
      }
    }
    progressQuizIds.add(progress.quizId);
    for (const field of ["firstRoundIncorrectIds", "roundMissedIds"]) {
      if (progress[field] !== undefined
        && (!Array.isArray(progress[field])
          || !progress[field].every((id) => progress.questionIds.includes(id)))) {
        throw new Error(`Progress record ${index + 1} contains invalid ${field}.`);
      }
    }
    if (progress.answers !== undefined && (!Array.isArray(progress.answers)
      || !progress.answers.every((answer) => isRecord(answer)
        && progress.questionIds.includes(answer.questionId)
        && ["A", "B", "C", "D"].includes(answer.selectedAnswer)
        && typeof answer.correct === "boolean"
        && Number.isInteger(answer.round) && answer.round > 0
        && hasText(answer.answeredAt)))) {
      throw new Error(`Progress record ${index + 1} contains invalid answer history.`);
    }
    if (progress.awaitingNext !== undefined && progress.awaitingNext !== null
      && (!isRecord(progress.awaitingNext)
        || !progress.questionIds.includes(progress.awaitingNext.questionId)
        || !["A", "B", "C", "D"].includes(progress.awaitingNext.selectedAnswer)
        || typeof progress.awaitingNext.correct !== "boolean")) {
      throw new Error(`Progress record ${index + 1} contains an invalid pending answer.`);
    }
  }

  for (const [index, result] of recordsByStore[RESULTS_STORE].entries()) {
    if (!hasText(result.quizId) || !quizIds.has(result.quizId)
      || !subjectIds.has(result.subjectId)
      || !hasText(result.attemptId) || !hasText(result.quizName)
      || !hasText(result.completedAt)
      || !["firstRoundCorrect", "firstRoundIncorrect", "questionTotal", "correctCount", "incorrectCount", "rounds"]
        .every((field) => Number.isInteger(result[field]) && result[field] >= 0)
      || result.rounds < 1
      || result.firstRoundCorrect + result.firstRoundIncorrect !== result.questionTotal) {
      throw new Error(`Score history record ${index + 1} is invalid or refers to missing data.`);
    }
  }

  return recordsByStore;
}

async function findBackupConflicts(recordsByStore, database = state.database) {
  const conflicts = [];
  for (const storeName of BACKUP_STORES) {
    const records = recordsByStore[storeName];
    if (records.length === 0) continue;
    const existing = await readAll(storeName, database);
    const existingIds = new Set(existing.map((record) => (
      storeName === PROGRESS_STORE ? record.quizId : record.id
    )));
    const keyPath = storeName === PROGRESS_STORE ? "quizId" : "id";
    const overlap = records.filter((record) => existingIds.has(record[keyPath])).length;
    if (overlap > 0) conflicts.push(`${overlap} ${storeName} record${overlap === 1 ? "" : "s"}`);
  }
  return conflicts;
}

async function restoreBackupData(recordsByStore, database = state.database) {
  const conflicts = await findBackupConflicts(recordsByStore, database);
  if (conflicts.length > 0) {
    throw new Error(`Restore stopped because IDs already exist: ${conflicts.join(", ")}. No records were changed.`);
  }
  await writeTransaction(BACKUP_STORES, (transaction) => {
    for (const storeName of BACKUP_STORES) {
      const objectStore = transaction.objectStore(storeName);
      for (const record of recordsByStore[storeName]) objectStore.add(record);
    }
  }, database);
}

async function downloadBackup() {
  try {
    const backup = await exportBackupData();
    validateBackupDocument(backup);
    const blob = new Blob([`${JSON.stringify(backup, null, 2)}\n`], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `smart-quiz-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    showMessage("Your Smart Quiz App backup was exported.", "success");
  } catch (error) {
    showMessage(error.message || "The backup could not be exported.", "error");
  }
}

function setBackupFeedback(message, kind = "") {
  elements.backupFeedback.textContent = message;
  elements.backupFeedback.dataset.kind = kind;
}

function openBackupDialog() {
  state.pendingBackup = null;
  elements.backupFilePicker.value = "";
  elements.backupPreview.hidden = true;
  elements.backupCounts.replaceChildren();
  elements.restoreBackupButton.disabled = true;
  setBackupFeedback("");
  elements.backupDialog.showModal();
}

async function previewBackupFile() {
  state.pendingBackup = null;
  elements.restoreBackupButton.disabled = true;
  elements.backupPreview.hidden = true;
  const file = elements.backupFilePicker.files[0];
  if (!file) return;
  if (file.size > MAX_BACKUP_BYTES) {
    setBackupFeedback("Backup files must be 25 MB or smaller.", "error");
    return;
  }

  try {
    const parsed = JSON.parse(await file.text());
    const recordsByStore = validateBackupDocument(parsed);
    const conflicts = await findBackupConflicts(recordsByStore);
    state.pendingBackup = recordsByStore;
    elements.backupFileName.textContent = `${file.name} · exported ${new Date(parsed.exportedAt).toLocaleString()}`;
    elements.backupCounts.replaceChildren(...BACKUP_STORES.map((storeName) => {
      const item = document.createElement("li");
      const label = storeName === PROGRESS_STORE ? "Quiz progress"
        : storeName === RESULTS_STORE ? "Score history"
          : storeName.charAt(0).toUpperCase() + storeName.slice(1);
      item.textContent = `${label}: ${recordsByStore[storeName].length}`;
      return item;
    }));
    elements.backupPreview.hidden = false;
    if (conflicts.length > 0) {
      setBackupFeedback(
        `This backup contains IDs already in your library (${conflicts.join(", ")}). No data will be restored.`,
        "error"
      );
      return;
    }
    setBackupFeedback("Backup validated. Review the contents, then choose Restore backup to continue.", "success");
    elements.restoreBackupButton.disabled = false;
  } catch (error) {
    setBackupFeedback(error.message || "This backup could not be validated.", "error");
  }
}

async function restoreSelectedBackup() {
  if (!state.pendingBackup) return;
  const recordCount = BACKUP_STORES.reduce((total, storeName) => (
    total + state.pendingBackup[storeName].length
  ), 0);
  if (!window.confirm(
    `Restore ${recordCount} records from this backup? Existing data will not be overwritten or deleted. If any record IDs conflict, the entire restore will be cancelled.`
  )) return;

  elements.restoreBackupButton.disabled = true;
  try {
    await restoreBackupData(state.pendingBackup);
    state.pendingBackup = null;
    elements.backupDialog.close();
    await refreshLibrary();
    showMessage(`Backup restored: ${recordCount} records were added. Existing data was preserved.`, "success");
  } catch (error) {
    setBackupFeedback(error.message || "The backup could not be restored.", "error");
    elements.restoreBackupButton.disabled = false;
  }
}

async function refreshLibrary() {
  const [subjects, quizzes, questions, quizProgress, quizResults] = await Promise.all([
    readAll(SUBJECT_STORE),
    readAll(QUIZ_STORE),
    readAll(QUESTION_STORE),
    readAll(PROGRESS_STORE),
    readAll(RESULTS_STORE)
  ]);
  state.subjects = subjects.sort((left, right) => left.name.localeCompare(right.name));
  state.quizzes = quizzes.sort((left, right) => left.name.localeCompare(right.name));
  state.questions = questions;
  state.quizProgress = quizProgress;
  state.quizResults = quizResults;
  if (!state.subjects.some((subject) => subject.id === state.activeSubjectId)) {
    state.activeSubjectId = null;
  }
  render();
}

function showMessage(message, kind = "") {
  elements.message.textContent = message;
  elements.message.dataset.kind = kind;
}

function getQuizCount(subjectId) {
  return state.quizzes.filter((quiz) => quiz.subjectId === subjectId).length;
}

function getQuestionCount(quizId) {
  return state.questions.filter((question) => question.quizId === quizId).length;
}

function getQuizProgress(quizId) {
  return state.quizProgress.find((progress) => progress.quizId === quizId);
}

function getLatestQuizResult(quizId) {
  return state.quizResults
    .filter((result) => result.quizId === quizId)
    .sort((left, right) => right.completedAt.localeCompare(left.completedAt))[0];
}

function render() {
  const activeSubject = state.subjects.find((subject) => subject.id === state.activeSubjectId);
  elements.subjectCount.textContent = String(state.subjects.length);
  elements.quizCount.textContent = String(state.quizzes.length);
  elements.questionCount.textContent = String(state.questions.length);
  elements.breadcrumbSubject.textContent = activeSubject?.name ?? "All subjects";
  elements.collectionTitle.textContent = activeSubject?.name ?? "All subjects";
  elements.addQuizButton.disabled = !activeSubject;
  renderSubjectNavigation();
  renderLibrary(activeSubject);
}

function renderSubjectNavigation() {
  const allButton = document.createElement("button");
  allButton.type = "button";
  allButton.className = "subject-item";
  allButton.setAttribute("aria-current", state.activeSubjectId ? "false" : "page");
  allButton.innerHTML = '<span class="folder-icon" aria-hidden="true">▦</span><span class="subject-name">All subjects</span>';
  allButton.addEventListener("click", () => {
    returnToLibrary(null);
  });
  elements.subjectList.replaceChildren(allButton);

  for (const subject of state.subjects) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "subject-item";
    button.setAttribute("aria-current", subject.id === state.activeSubjectId ? "page" : "false");

    const icon = document.createElement("span");
    icon.className = "folder-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = "▱";
    const name = document.createElement("span");
    name.className = "subject-name";
    name.textContent = subject.name;
    const count = document.createElement("span");
    count.className = "subject-count";
    count.textContent = String(getQuizCount(subject.id));
    button.append(icon, name, count);
    button.addEventListener("click", () => {
      returnToLibrary(subject.id);
    });
    elements.subjectList.append(button);
  }
}

function createEmptyState(title, description, buttonText, action) {
  const wrapper = document.createElement("div");
  wrapper.className = "empty-state";
  const illustration = document.createElement("span");
  illustration.className = "empty-illustration";
  illustration.setAttribute("aria-hidden", "true");
  illustration.textContent = "✦";
  const heading = document.createElement("h3");
  heading.textContent = title;
  const text = document.createElement("p");
  text.textContent = description;
  wrapper.append(illustration, heading, text);
  if (buttonText && action) {
    const button = document.createElement("button");
    button.className = "button button-primary";
    button.type = "button";
    button.textContent = buttonText;
    button.addEventListener("click", action);
    wrapper.append(button);
  }
  return wrapper;
}

function renderLibrary(activeSubject) {
  if (!activeSubject) {
    if (state.subjects.length === 0) {
      elements.libraryContent.replaceChildren(createEmptyState(
        "Start with a subject folder",
        "Create a folder for a class or topic, then add quizzes to keep your study material organized.",
        "Create your first subject",
        () => openEditor("create-subject")
      ));
      return;
    }
    const grid = document.createElement("div");
    grid.className = "subject-grid";
    for (const subject of state.subjects) {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "subject-card";
      card.setAttribute("aria-label", `Open ${subject.name}`);
      const icon = document.createElement("span");
      icon.className = "card-folder-mark";
      icon.setAttribute("aria-hidden", "true");
      icon.textContent = "▱";
      const copy = document.createElement("span");
      copy.className = "subject-card-copy";
      const title = document.createElement("strong");
      title.textContent = subject.name;
      const count = document.createElement("span");
      const quizCount = getQuizCount(subject.id);
      count.textContent = `${quizCount} ${quizCount === 1 ? "quiz" : "quizzes"}`;
      const chevron = document.createElement("span");
      chevron.className = "card-chevron";
      chevron.setAttribute("aria-hidden", "true");
      chevron.textContent = "›";
      copy.append(title, count);
      card.append(icon, copy, chevron);
      card.addEventListener("click", () => {
        returnToLibrary(subject.id);
      });
      grid.append(card);
    }
    elements.libraryContent.replaceChildren(grid);
    return;
  }

  const toolbar = document.createElement("div");
  toolbar.className = "subject-toolbar";
  const actions = document.createElement("div");
  actions.className = "subject-toolbar-actions";
  const renameButton = document.createElement("button");
  renameButton.type = "button";
  renameButton.className = "small-icon-button";
  renameButton.setAttribute("aria-label", `Rename ${activeSubject.name}`);
  renameButton.title = "Rename subject";
  renameButton.textContent = "✎";
  renameButton.addEventListener("click", () => openEditor("rename-subject", activeSubject));
  const deleteButton = document.createElement("button");
  deleteButton.type = "button";
  deleteButton.className = "small-icon-button danger";
  deleteButton.setAttribute("aria-label", `Delete ${activeSubject.name}`);
  deleteButton.title = "Delete subject";
  deleteButton.textContent = "⌫";
  deleteButton.addEventListener("click", () => deleteSubject(activeSubject));
  actions.append(renameButton, deleteButton);
  toolbar.append(actions);

  const subjectQuizzes = state.quizzes.filter((quiz) => quiz.subjectId === activeSubject.id);
  if (subjectQuizzes.length === 0) {
    elements.libraryContent.replaceChildren(toolbar, createEmptyState(
      "This subject is ready for a quiz",
      "Give your quiz a name to start building your personal study library.",
      "Create a quiz",
      () => openEditor("create-quiz")
    ));
    return;
  }

  const grid = document.createElement("div");
  grid.className = "quiz-grid";
  for (const quiz of subjectQuizzes) {
    const card = document.createElement("article");
    card.className = "quiz-card";
    const startButton = document.createElement("button");
    startButton.type = "button";
    startButton.className = "quiz-card-start";
    const progress = getQuizProgress(quiz.id);
    startButton.setAttribute("aria-label", `${progress?.status === "in-progress" ? "Resume" : "Open"} quiz ${quiz.name}`);
    const icon = document.createElement("span");
    icon.className = "quiz-mark";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = "▤";
    const copy = document.createElement("div");
    copy.className = "quiz-card-copy";
    const title = document.createElement("strong");
    title.className = "quiz-card-title";
    title.textContent = quiz.name;
    const meta = document.createElement("span");
    meta.className = "quiz-card-meta";
    const questionCount = getQuestionCount(quiz.id);
    const latestResult = getLatestQuizResult(quiz.id);
    const progressLabel = progress?.status === "in-progress"
      ? ` · In progress, round ${progress.round}`
      : latestResult
        ? ` · Best ${latestResult.firstRoundCorrect}/${latestResult.questionTotal}`
        : "";
    meta.textContent = `${questionCount} ${questionCount === 1 ? "question" : "questions"}${progressLabel}`;
    copy.append(title, meta);
    startButton.append(icon, copy);
    startButton.addEventListener("click", () => openQuiz(quiz));
    const cardActions = document.createElement("div");
    cardActions.className = "quiz-card-actions";
    if (progress?.status === "in-progress") {
      cardActions.append(
        createQuizProgressAction(quiz, "Resume Quiz", () => openQuiz(quiz)),
        createQuizProgressAction(quiz, "Restart Quiz", () => retakeQuiz(quiz))
      );
    } else if (progress?.status === "completed") {
      cardActions.append(createQuizProgressAction(quiz, "Retake Quiz", () => retakeQuiz(quiz)));
    } else {
      cardActions.append(createQuizProgressAction(quiz, "Start Quiz", () => openQuiz(quiz)));
    }
    cardActions.append(
      createQuizAction(quiz, "Rename quiz", "✎", () => openEditor("rename-quiz", quiz)),
      createQuizAction(quiz, "Move quiz", "↗", () => openEditor("move-quiz", quiz)),
      createQuizAction(quiz, "Delete quiz", "⌫", () => deleteQuiz(quiz))
    );
    card.append(startButton, cardActions);
    grid.append(card);
  }
  elements.libraryContent.replaceChildren(toolbar, grid);
}

function createQuizAction(quiz, label, symbol, action) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `small-icon-button${label === "Delete quiz" ? " danger" : ""}`;
  button.setAttribute("aria-label", `${label}: ${quiz.name}`);
  button.title = label;
  button.textContent = symbol;
  button.addEventListener("click", action);
  return button;
}

function createQuizProgressAction(quiz, label, action) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "quiz-progress-action";
  button.setAttribute("aria-label", `${label}: ${quiz.name}`);
  button.textContent = label;
  button.addEventListener("click", action);
  return button;
}

function validateQuizQuestions(questions) {
  const invalidIndex = questions.findIndex((question) => {
    return !question.text?.trim()
      || !["A", "B", "C", "D"].every((label) => question.options?.[label]?.trim())
      || !["A", "B", "C", "D"].includes(question.correctAnswer)
      || !question.options?.[question.correctAnswer]?.trim();
  });
  return invalidIndex;
}

async function openQuiz(quiz, forceNew = false) {
  const questions = state.questions
    .filter((question) => question.quizId === quiz.id)
    .sort((left, right) => {
      if (Number.isInteger(left.order) && Number.isInteger(right.order)) {
        return left.order - right.order;
      }
      return (left.createdAt ?? "").localeCompare(right.createdAt ?? "")
        || left.id.localeCompare(right.id);
    });
  if (questions.length === 0) {
    showMessage(`"${quiz.name}" does not have any questions yet. Import questions before starting.`, "error");
    return;
  }
  const invalidIndex = validateQuizQuestions(questions);
  if (invalidIndex >= 0) {
    showMessage(
      `Question ${invalidIndex + 1} in "${quiz.name}" needs a question, four answer choices, and a confirmed correct answer before this quiz can start.`,
      "error"
    );
    return;
  }

  const savedProgress = getQuizProgress(quiz.id);
  if (!forceNew && savedProgress?.status === "in-progress") {
    const questionIds = new Set(questions.map((question) => question.id));
    if (savedProgress.questionIds.length === questions.length
      && savedProgress.questionIds.every((id) => questionIds.has(id))) {
      normalizeQuizProgress(savedProgress);
      state.currentStudy = { quiz, questions, progress: savedProgress };
      showMessage("");
      renderStudyView();
      return;
    }
  }

  const now = new Date().toISOString();
  const progress = {
    quizId: quiz.id,
    attemptId: makeId(),
    questionIds: questions.map((question) => question.id),
    queue: questions.map((question) => question.id),
    queueIndex: 0,
    round: 1,
    stage: "questions",
    firstRoundCorrect: 0,
    firstRoundIncorrect: 0,
    firstRoundIncorrectIds: [],
    roundMissedIds: [],
    reviewCorrectCount: 0,
    reviewIncorrectCount: 0,
    correctCount: 0,
    incorrectCount: 0,
    answers: [],
    awaitingNext: null,
    status: "in-progress",
    startedAt: now,
    updatedAt: now
  };
  state.studyActionInFlight = true;
  try {
    await writeTransaction([PROGRESS_STORE], (transaction) => {
      transaction.objectStore(PROGRESS_STORE).put(progress);
    });
    state.quizProgress = [
      ...state.quizProgress.filter((entry) => entry.quizId !== quiz.id),
      progress
    ];
    state.currentStudy = { quiz, questions, progress };
    showMessage("");
    renderStudyView();
    render();
  } catch (error) {
    showMessage(error.message || "Quiz progress could not be saved.", "error");
  } finally {
    state.studyActionInFlight = false;
    flushPendingLibraryNavigation();
  }
}

async function retakeQuiz(quiz) {
  const progress = getQuizProgress(quiz.id);
  if (progress?.status === "in-progress"
    && !window.confirm(`Restart "${quiz.name}" from the beginning? Current progress will be replaced.`)) {
    return;
  }
  await openQuiz(quiz, true);
}

function normalizeQuizProgress(progress) {
  progress.stage ??= "questions";
  progress.reviewCorrectCount ??= progress.answers?.filter((answer) => answer.round > 1 && answer.correct).length ?? 0;
  progress.reviewIncorrectCount ??= progress.answers?.filter((answer) => answer.round > 1 && !answer.correct).length ?? 0;
}

function renderStudyView() {
  const session = state.currentStudy;
  if (!session) return;
  const { quiz, questions, progress } = session;
  const subject = state.subjects.find((item) => item.id === quiz.subjectId);
  const questionId = progress.awaitingNext?.questionId ?? progress.queue[progress.queueIndex];
  const question = questions.find((item) => item.id === questionId);
  if (!question) {
    showMessage("The current question is no longer available. Return to the library and reopen the quiz.", "error");
    return;
  }

  elements.libraryDashboard.hidden = true;
  elements.studyView.hidden = false;
  elements.breadcrumbSubject.textContent = `${subject?.name ?? "Subject"} / ${quiz.name}`;
  elements.studyView.replaceChildren();

  const toolbar = document.createElement("div");
  toolbar.className = "study-toolbar";
  const backButton = document.createElement("button");
  backButton.type = "button";
  backButton.className = "button button-quiet";
  backButton.textContent = "← Back to library";
  backButton.addEventListener("click", () => returnToLibrary());
  const roundLabel = document.createElement("span");
  roundLabel.className = "study-round";
  roundLabel.textContent = progress.round === 1 ? "FIRST ROUND" : `MISTAKE REVIEW · ROUND ${progress.round}`;
  toolbar.append(backButton, roundLabel);

  if (progress.status === "completed") {
    renderCompletedStudy(session, toolbar);
    return;
  }
  if (progress.stage === "first-round-score") {
    renderFirstRoundScore(session, toolbar);
    return;
  }

  const position = progress.queueIndex + 1;
  const total = progress.queue.length;
  const heading = document.createElement("div");
  heading.className = "study-heading";
  const eyebrow = document.createElement("p");
  eyebrow.className = "eyebrow";
  eyebrow.textContent = subject?.name ?? "YOUR QUIZ";
  const title = document.createElement("h1");
  title.textContent = quiz.name;
  const subtitle = document.createElement("p");
  subtitle.className = "page-subtitle";
  subtitle.textContent = progress.round === 1
    ? "Take your time. Your missed questions will come back at the end."
    : "Keep going — questions return until you answer them correctly.";
  heading.append(eyebrow, title, subtitle);

  const progressRow = document.createElement("div");
  progressRow.className = "study-progress-row";
  const progressLabel = document.createElement("span");
  progressLabel.textContent = `Question ${position} of ${total}`;
  const scoreLabel = document.createElement("span");
  scoreLabel.textContent = progress.round === 1
    ? `${progress.firstRoundCorrect} correct · ${progress.firstRoundIncorrect} incorrect`
    : `First round ${progress.firstRoundCorrect}/${progress.questionIds.length} · Review ${progress.reviewCorrectCount} correct, ${progress.reviewIncorrectCount} incorrect`;
  progressRow.append(progressLabel, scoreLabel);
  const progressTrack = document.createElement("div");
  progressTrack.className = "study-progress-track";
  progressTrack.setAttribute("role", "progressbar");
  progressTrack.setAttribute("aria-label", `Round ${progress.round} progress`);
  progressTrack.setAttribute("aria-valuemin", "0");
  progressTrack.setAttribute("aria-valuemax", String(total));
  progressTrack.setAttribute("aria-valuenow", String(position - (progress.awaitingNext ? 0 : 1)));
  const progressFill = document.createElement("span");
  progressFill.style.width = `${Math.max(0, Math.min(100, ((position - (progress.awaitingNext ? 0 : 1)) / total) * 100))}%`;
  progressTrack.append(progressFill);

  const card = document.createElement("article");
  card.className = "study-question-card";
  const cardLabel = document.createElement("p");
  cardLabel.className = "eyebrow";
  cardLabel.textContent = progress.round === 1 ? `QUESTION ${position}` : `REVIEW QUESTION ${position}`;
  const prompt = document.createElement("h2");
  prompt.textContent = question.text;
  const choices = document.createElement("div");
  choices.className = "study-choices";
  const selectedAnswer = progress.awaitingNext?.selectedAnswer;
  for (const label of ["A", "B", "C", "D"]) {
    const choice = document.createElement("button");
    choice.type = "button";
    choice.className = "study-choice";
    choice.disabled = Boolean(progress.awaitingNext);
    choice.setAttribute("aria-pressed", selectedAnswer === label ? "true" : "false");
    if (progress.awaitingNext && label === question.correctAnswer) choice.classList.add("choice-correct");
    if (progress.awaitingNext && selectedAnswer === label && !progress.awaitingNext.correct) choice.classList.add("choice-incorrect");
    const badge = document.createElement("span");
    badge.className = "choice-letter";
    badge.textContent = label;
    const text = document.createElement("span");
    text.className = "choice-text";
    text.textContent = question.options[label];
    choice.append(badge, text);
    choice.addEventListener("click", () => submitStudyAnswer(label));
    choices.append(choice);
  }
  card.append(cardLabel, prompt, choices);

  if (progress.awaitingNext) {
    const feedback = document.createElement("p");
    feedback.className = `study-feedback ${progress.awaitingNext.correct ? "feedback-correct" : "feedback-incorrect"}`;
    feedback.setAttribute("role", "status");
    feedback.textContent = progress.awaitingNext.correct
      ? "Correct! Nice work."
      : `Not quite. The correct answer is ${question.correctAnswer}: ${question.options[question.correctAnswer]}.`;
    card.append(feedback);
  }

  const nextRow = document.createElement("div");
  nextRow.className = "study-next-row";
  const answerHint = document.createElement("span");
  answerHint.className = "study-answer-hint";
  answerHint.textContent = progress.awaitingNext
    ? "Your answer and progress are saved on this device."
    : "Choose an answer to continue.";
  const nextButton = document.createElement("button");
  nextButton.type = "button";
  nextButton.className = "button button-primary";
  nextButton.disabled = !progress.awaitingNext;
  nextButton.textContent = getNextButtonLabel(progress);
  nextButton.addEventListener("click", advanceStudy);
  nextRow.append(answerHint, nextButton);

  elements.studyView.append(toolbar, heading, progressRow, progressTrack, card, nextRow);
}

function getNextButtonLabel(progress) {
  if (progress.queueIndex < progress.queue.length - 1) return "Next question →";
  if (progress.round === 1) return "See first-round score";
  if (progress.round > 1 && progress.roundMissedIds.length > 0) return "Repeat missed questions →";
  return "See final score";
}

async function submitStudyAnswer(answer) {
  const session = state.currentStudy;
  if (!session || session.progress.awaitingNext || state.studyActionInFlight) return;
  state.studyActionInFlight = true;
  const { progress, questions } = session;
  const questionId = progress.queue[progress.queueIndex];
  const question = questions.find((item) => item.id === questionId);
  if (!question) {
    state.studyActionInFlight = false;
    flushPendingLibraryNavigation();
    showMessage("The current question is no longer available.", "error");
    return;
  }

  const previousProgress = {
    ...progress,
    queue: [...progress.queue],
    firstRoundIncorrectIds: [...progress.firstRoundIncorrectIds],
    roundMissedIds: [...progress.roundMissedIds],
    answers: [...progress.answers],
    awaitingNext: progress.awaitingNext ? { ...progress.awaitingNext } : null
  };
  const correct = answer === question.correctAnswer;
  const now = new Date().toISOString();
  progress.correctCount += correct ? 1 : 0;
  progress.incorrectCount += correct ? 0 : 1;
  if (progress.round === 1) {
    progress.firstRoundCorrect += correct ? 1 : 0;
    progress.firstRoundIncorrect += correct ? 0 : 1;
    if (!correct && !progress.firstRoundIncorrectIds.includes(questionId)) {
      progress.firstRoundIncorrectIds.push(questionId);
    }
  }
  if (progress.round > 1) {
    progress.reviewCorrectCount += correct ? 1 : 0;
    progress.reviewIncorrectCount += correct ? 0 : 1;
  }
  if (!correct && !progress.roundMissedIds.includes(questionId)) progress.roundMissedIds.push(questionId);
  progress.answers.push({ questionId, selectedAnswer: answer, correct, round: progress.round, answeredAt: now });
  progress.awaitingNext = { questionId, selectedAnswer: answer, correct };
  progress.updatedAt = now;
  try {
    await writeTransaction([PROGRESS_STORE], (transaction) => {
      transaction.objectStore(PROGRESS_STORE).put(progress);
    });
    if (state.currentStudy?.progress.attemptId === progress.attemptId) {
      renderStudyView();
      render();
    }
  } catch (error) {
    Object.assign(progress, previousProgress);
    showMessage(error.message || "Your answer could not be saved. Please try again.", "error");
    if (state.currentStudy?.progress.attemptId === progress.attemptId) renderStudyView();
  } finally {
    state.studyActionInFlight = false;
    flushPendingLibraryNavigation();
  }
}

async function advanceStudy() {
  const session = state.currentStudy;
  if (!session?.progress.awaitingNext || state.studyActionInFlight) return;
  state.studyActionInFlight = true;
  const { progress } = session;
  const previousProgress = {
    ...progress,
    queue: [...progress.queue],
    roundMissedIds: [...progress.roundMissedIds],
    awaitingNext: { ...progress.awaitingNext }
  };
  progress.awaitingNext = null;
  if (progress.queueIndex < progress.queue.length - 1) {
    progress.queueIndex += 1;
  } else if (progress.round === 1) {
    progress.stage = "first-round-score";
    progress.awaitingNext = null;
  } else if (progress.round > 1 && progress.roundMissedIds.length > 0) {
    progress.round += 1;
    progress.queue = [...progress.roundMissedIds];
    progress.queueIndex = 0;
    progress.roundMissedIds = [];
  } else {
    progress.updatedAt = new Date().toISOString();
    try {
      await completeStudy(session);
    } finally {
      state.studyActionInFlight = false;
      flushPendingLibraryNavigation();
    }
    return;
  }
  progress.updatedAt = new Date().toISOString();
  try {
    await writeTransaction([PROGRESS_STORE], (transaction) => {
      transaction.objectStore(PROGRESS_STORE).put(progress);
    });
    if (state.currentStudy?.progress.attemptId === progress.attemptId) renderStudyView();
  } catch (error) {
    Object.assign(progress, previousProgress);
    showMessage(error.message || "Quiz progress could not be saved.", "error");
    if (state.currentStudy?.progress.attemptId === progress.attemptId) renderStudyView();
  } finally {
    state.studyActionInFlight = false;
    flushPendingLibraryNavigation();
    if (state.currentStudy?.progress.attemptId === progress.attemptId
      && progress.stage === "first-round-score") {
      renderStudyView();
    }
  }
}

async function startMistakeReview() {
  const session = state.currentStudy;
  if (!session || session.progress.stage !== "first-round-score" || state.studyActionInFlight) return;
  state.studyActionInFlight = true;
  const { progress } = session;
  const previousProgress = {
    ...progress,
    roundMissedIds: [...progress.roundMissedIds],
    queue: [...progress.queue],
    awaitingNext: progress.awaitingNext ? { ...progress.awaitingNext } : null
  };
  progress.stage = "questions";
  progress.round = 2;
  progress.queue = [...progress.firstRoundIncorrectIds];
  progress.queueIndex = 0;
  progress.roundMissedIds = [];
  progress.awaitingNext = null;
  progress.updatedAt = new Date().toISOString();
  try {
    await writeTransaction([PROGRESS_STORE], (transaction) => {
      transaction.objectStore(PROGRESS_STORE).put(progress);
    });
    if (state.currentStudy?.progress.attemptId === progress.attemptId) {
      renderStudyView();
      render();
    }
  } catch (error) {
    Object.assign(progress, previousProgress);
    showMessage(error.message || "Mistake review could not be started.", "error");
    if (state.currentStudy?.progress.attemptId === progress.attemptId) renderStudyView();
  } finally {
    state.studyActionInFlight = false;
    flushPendingLibraryNavigation();
  }
}

function renderFirstRoundScore(session, toolbar) {
  const { quiz, progress } = session;
  const total = progress.questionIds.length;
  const correct = progress.firstRoundCorrect;
  const percentage = total ? Math.round((correct / total) * 100) : 0;
  const scoreView = document.createElement("div");
  scoreView.className = "study-completion first-round-score";
  const icon = document.createElement("span");
  icon.className = "completion-icon";
  icon.setAttribute("aria-hidden", "true");
  icon.textContent = "◎";
  const eyebrow = document.createElement("p");
  eyebrow.className = "eyebrow";
  eyebrow.textContent = "FIRST ROUND COMPLETE";
  const title = document.createElement("h1");
  title.textContent = "Your first-round score";
  const description = document.createElement("p");
  description.className = "page-subtitle";
  description.textContent = `Here is your score for "${quiz.name}" before mistake review.`;
  const score = document.createElement("div");
  score.className = "final-score";
  const scoreValue = document.createElement("strong");
  scoreValue.textContent = `${correct}/${total}`;
  const scoreLabel = document.createElement("span");
  scoreLabel.textContent = `${percentage}% correct`;
  score.append(scoreValue, scoreLabel);
  const detail = document.createElement("p");
  detail.className = "completion-details";
  detail.textContent = progress.firstRoundIncorrectIds.length
    ? `${progress.firstRoundIncorrectIds.length} missed ${progress.firstRoundIncorrectIds.length === 1 ? "question is" : "questions are"} ready for review.`
    : "You answered every question correctly in the first round.";
  const actions = document.createElement("div");
  actions.className = "completion-actions";
  const libraryButton = document.createElement("button");
  libraryButton.type = "button";
  libraryButton.className = "button button-quiet";
  libraryButton.textContent = "Back to library";
  libraryButton.addEventListener("click", () => returnToLibrary());
  actions.append(libraryButton);

  if (progress.firstRoundIncorrectIds.length > 0) {
    const reviewButton = document.createElement("button");
    reviewButton.type = "button";
    reviewButton.className = "button button-primary";
    reviewButton.textContent = "Review Mistakes";
    reviewButton.disabled = state.studyActionInFlight;
    reviewButton.addEventListener("click", startMistakeReview);
    actions.append(reviewButton);
  } else {
    const finishButton = document.createElement("button");
    finishButton.type = "button";
    finishButton.className = "button button-primary";
    finishButton.textContent = "Finish quiz";
    finishButton.disabled = state.studyActionInFlight;
    finishButton.addEventListener("click", () => finishStudy(session));
    actions.append(finishButton);
  }

  scoreView.append(icon, eyebrow, title, description, score, detail, actions);
  elements.studyView.replaceChildren(toolbar, scoreView);
}

async function completeStudy(session) {
  const { quiz, questions, progress } = session;
  const completedAt = new Date().toISOString();
  const result = {
    id: makeId(),
    quizId: quiz.id,
    attemptId: progress.attemptId,
    subjectId: quiz.subjectId,
    quizName: quiz.name,
    firstRoundCorrect: progress.firstRoundCorrect,
    firstRoundIncorrect: progress.firstRoundIncorrect,
    questionTotal: questions.length,
    correctCount: progress.correctCount,
    incorrectCount: progress.incorrectCount,
    rounds: progress.round,
    completedAt
  };
  progress.status = "completed";
  progress.completedAt = completedAt;
  progress.updatedAt = completedAt;
  progress.awaitingNext = null;
  try {
    await writeTransaction([PROGRESS_STORE, RESULTS_STORE], (transaction) => {
      transaction.objectStore(PROGRESS_STORE).put(progress);
      transaction.objectStore(RESULTS_STORE).add(result);
    });
    state.quizResults.push(result);
    state.quizProgress = [
      ...state.quizProgress.filter((entry) => entry.quizId !== quiz.id),
      progress
    ];
    renderStudyView();
    render();
  } catch (error) {
    progress.status = "in-progress";
    delete progress.completedAt;
    const lastAnswer = progress.answers[progress.answers.length - 1];
    if (lastAnswer) {
      progress.awaitingNext = {
        questionId: lastAnswer.questionId,
        selectedAnswer: lastAnswer.selectedAnswer,
        correct: lastAnswer.correct
      };
    }
    showMessage(error.message || "The final score could not be saved.", "error");
    renderStudyView();
  }
}

async function finishStudy(session) {
  if (state.studyActionInFlight || state.currentStudy?.progress.attemptId !== session.progress.attemptId) return;
  state.studyActionInFlight = true;
  try {
    await completeStudy(session);
  } finally {
    state.studyActionInFlight = false;
    flushPendingLibraryNavigation();
  }
}

function renderCompletedStudy(session, toolbar) {
  const { quiz, progress } = session;
  const result = getLatestQuizResult(quiz.id);
  const completion = document.createElement("div");
  completion.className = "study-completion";
  const icon = document.createElement("span");
  icon.className = "completion-icon";
  icon.setAttribute("aria-hidden", "true");
  icon.textContent = "✦";
  const heading = document.createElement("p");
  heading.className = "eyebrow";
  heading.textContent = "QUIZ COMPLETE";
  const title = document.createElement("h1");
  title.textContent = "Look at you go.";
  const description = document.createElement("p");
  description.className = "page-subtitle";
  description.textContent = `You answered every question in "${quiz.name}" correctly.`;
  const score = document.createElement("div");
  score.className = "final-score";
  const scoreValue = document.createElement("strong");
  scoreValue.textContent = `${result?.firstRoundCorrect ?? progress.firstRoundCorrect}/${result?.questionTotal ?? progress.questionIds.length}`;
  const scoreLabel = document.createElement("span");
  scoreLabel.textContent = "correct in the first round";
  score.append(scoreValue, scoreLabel);
  const details = document.createElement("p");
  details.className = "completion-details";
  details.textContent = `Final result: ${progress.correctCount} correct and ${progress.incorrectCount} incorrect answers across ${progress.round} ${progress.round === 1 ? "round" : "rounds"}.`;
  const actions = document.createElement("div");
  actions.className = "completion-actions";
  const libraryButton = document.createElement("button");
  libraryButton.type = "button";
  libraryButton.className = "button button-quiet";
  libraryButton.textContent = "Back to library";
  libraryButton.addEventListener("click", () => returnToLibrary());
  const retakeButton = document.createElement("button");
  retakeButton.type = "button";
  retakeButton.className = "button button-primary";
  retakeButton.textContent = "Retake quiz";
  retakeButton.addEventListener("click", () => retakeQuiz(quiz));
  actions.append(libraryButton, retakeButton);
  completion.append(icon, heading, title, description, score, details, actions);
  elements.studyView.replaceChildren(toolbar, completion);
}

async function returnToLibrary(subjectId = state.activeSubjectId) {
  if (state.studyActionInFlight) {
    state.pendingLibraryNavigation = { subjectId };
    showMessage("Saving quiz progress before switching…");
    return;
  }

  const session = state.currentStudy;
  if (session) {
    state.studyActionInFlight = true;
    try {
      await writeTransaction([PROGRESS_STORE], (transaction) => {
        transaction.objectStore(PROGRESS_STORE).put(session.progress);
      });
    } catch (error) {
      showMessage(error.message || "Quiz progress could not be saved. You are still in the quiz.", "error");
      return;
    } finally {
      state.studyActionInFlight = false;
      flushPendingLibraryNavigation();
    }
  }

  state.currentStudy = null;
  state.activeSubjectId = subjectId;
  elements.studyView.hidden = true;
  elements.libraryDashboard.hidden = false;
  showMessage("");
  render();
}

function flushPendingLibraryNavigation() {
  if (state.studyActionInFlight || state.pendingLibraryNavigation === null) return;
  const { subjectId } = state.pendingLibraryNavigation;
  state.pendingLibraryNavigation = null;
  void returnToLibrary(subjectId);
}

function openEditor(mode, entity = null) {
  state.dialogMode = mode;
  state.editingId = entity?.id ?? null;
  elements.form.reset();
  elements.nameInput.setAttribute("aria-invalid", "false");
  elements.subjectField.hidden = mode !== "move-quiz";
  const settings = {
    "create-subject": ["New subject folder", "Create a place to keep quizzes for one class or topic.", "Subject name", "Create folder", ""],
    "rename-subject": ["Rename subject", "Choose a new name for this subject folder.", "Subject name", "Save changes", entity?.name ?? ""],
    "create-quiz": ["New quiz", "Add a named quiz to this subject. You can add questions in a later step.", "Quiz name", "Create quiz", ""],
    "rename-quiz": ["Rename quiz", "Choose a new name for this quiz.", "Quiz name", "Save changes", entity?.name ?? ""],
    "move-quiz": ["Move quiz", "Choose which subject folder should contain this quiz.", "Quiz name", "Move quiz", entity?.name ?? ""]
  };
  const [title, description, label, submitText, value] = settings[mode];
  elements.dialogTitle.textContent = title;
  elements.dialogDescription.textContent = description;
  elements.nameLabel.textContent = label;
  elements.nameInput.value = value;
  elements.nameInput.readOnly = mode === "move-quiz";
  elements.submitButton.textContent = submitText;
  if (mode === "move-quiz") {
    const quiz = entity;
    const choices = state.subjects.filter((subject) => subject.id !== quiz.subjectId);
    elements.subjectSelect.replaceChildren(...choices.map((subject) => {
      const option = document.createElement("option");
      option.value = subject.id;
      option.textContent = subject.name;
      return option;
    }));
    if (choices.length === 0) {
      showMessage("Create another subject folder before moving a quiz.", "error");
      return;
    }
    elements.subjectSelect.value = choices[0].id;
  }
  elements.dialog.showModal();
  elements.nameInput.focus();
  if (mode !== "move-quiz") elements.nameInput.select();
}

async function handleEditorSubmit(event) {
  event.preventDefault();
  const name = elements.nameInput.value.trim();
  const mode = state.dialogMode;
  if (mode !== "move-quiz" && !name) {
    elements.nameInput.setAttribute("aria-invalid", "true");
    elements.nameInput.focus();
    return;
  }
  elements.submitButton.disabled = true;
  try {
    if (mode === "create-subject") {
      const subject = { id: makeId(), name, createdAt: new Date().toISOString() };
      await writeTransaction([SUBJECT_STORE], (transaction) => {
        transaction.objectStore(SUBJECT_STORE).add(subject);
      });
      state.activeSubjectId = subject.id;
      showMessage(`Created subject "${name}".`, "success");
    } else if (mode === "rename-subject") {
      const subject = state.subjects.find((item) => item.id === state.editingId);
      if (!subject) throw new Error("That subject folder no longer exists.");
      await writeTransaction([SUBJECT_STORE], (transaction) => {
        transaction.objectStore(SUBJECT_STORE).put({ ...subject, name, updatedAt: new Date().toISOString() });
      });
      showMessage(`Renamed subject to "${name}".`, "success");
    } else if (mode === "create-quiz") {
      if (!state.activeSubjectId) throw new Error("Select a subject folder before creating a quiz.");
      const quiz = {
        id: makeId(),
        subjectId: state.activeSubjectId,
        name,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      await writeTransaction([QUIZ_STORE], (transaction) => {
        transaction.objectStore(QUIZ_STORE).add(quiz);
      });
      showMessage(`Created quiz "${name}".`, "success");
    } else if (mode === "rename-quiz") {
      const quiz = state.quizzes.find((item) => item.id === state.editingId);
      if (!quiz) throw new Error("That quiz no longer exists.");
      await writeTransaction([QUIZ_STORE], (transaction) => {
        transaction.objectStore(QUIZ_STORE).put({ ...quiz, name, updatedAt: new Date().toISOString() });
      });
      showMessage(`Renamed quiz to "${name}".`, "success");
    } else if (mode === "move-quiz") {
      const quiz = state.quizzes.find((item) => item.id === state.editingId);
      if (!quiz) throw new Error("That quiz no longer exists.");
      const subjectId = elements.subjectSelect.value;
      if (!state.subjects.some((subject) => subject.id === subjectId)) {
        throw new Error("Choose an available subject folder.");
      }
      await writeTransaction([QUIZ_STORE], (transaction) => {
        transaction.objectStore(QUIZ_STORE).put({ ...quiz, subjectId, updatedAt: new Date().toISOString() });
      });
      state.activeSubjectId = subjectId;
      showMessage(`Moved "${quiz.name}" to another subject.`, "success");
    }
    elements.dialog.close();
    await refreshLibrary();
  } catch (error) {
    showMessage(error.message || "Your change could not be saved.", "error");
  } finally {
    elements.submitButton.disabled = false;
  }
}

async function deleteSubject(subject) {
  const quizzes = state.quizzes.filter((quiz) => quiz.subjectId === subject.id);
  const message = quizzes.length
    ? `Delete "${subject.name}" and its ${quizzes.length} ${quizzes.length === 1 ? "quiz" : "quizzes"}? Any questions in those quizzes will also be deleted. This cannot be undone.`
    : `Delete the subject folder "${subject.name}"? This cannot be undone.`;
  if (!window.confirm(message)) return;
  try {
    const questionsByQuiz = await Promise.all(quizzes.map((quiz) => readByIndex(QUESTION_STORE, "quizId", quiz.id)));
    const resultsByQuiz = await Promise.all(quizzes.map((quiz) => readByIndex(RESULTS_STORE, "quizId", quiz.id)));
    await writeTransaction([SUBJECT_STORE, QUIZ_STORE, QUESTION_STORE, PROGRESS_STORE, RESULTS_STORE], (transaction) => {
      transaction.objectStore(SUBJECT_STORE).delete(subject.id);
      for (const quiz of quizzes) transaction.objectStore(QUIZ_STORE).delete(quiz.id);
      for (const quiz of quizzes) transaction.objectStore(PROGRESS_STORE).delete(quiz.id);
      for (const questions of questionsByQuiz) {
        for (const question of questions) transaction.objectStore(QUESTION_STORE).delete(question.id);
      }
      for (const results of resultsByQuiz) {
        for (const result of results) transaction.objectStore(RESULTS_STORE).delete(result.id);
      }
    });
    state.activeSubjectId = null;
    showMessage(`Deleted subject "${subject.name}".`, "success");
    await refreshLibrary();
  } catch (error) {
    showMessage(error.message || "The subject folder could not be deleted.", "error");
  }
}

function readByIndex(storeName, indexName, value) {
  return new Promise((resolve, reject) => {
    const transaction = state.database.transaction(storeName, "readonly");
    const request = transaction.objectStore(storeName).index(indexName).getAll(value);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error(`Could not read ${storeName}.`));
    transaction.onabort = () => reject(transaction.error ?? new Error(`Could not read ${storeName}.`));
  });
}

async function deleteQuiz(quiz) {
  if (!window.confirm(`Delete "${quiz.name}" and all of its questions? This cannot be undone.`)) return;
  try {
    const questions = await readByIndex(QUESTION_STORE, "quizId", quiz.id);
    const results = await readByIndex(RESULTS_STORE, "quizId", quiz.id);
    await writeTransaction([QUIZ_STORE, QUESTION_STORE, PROGRESS_STORE, RESULTS_STORE], (transaction) => {
      transaction.objectStore(QUIZ_STORE).delete(quiz.id);
      for (const question of questions) transaction.objectStore(QUESTION_STORE).delete(question.id);
      transaction.objectStore(PROGRESS_STORE).delete(quiz.id);
      for (const result of results) transaction.objectStore(RESULTS_STORE).delete(result.id);
    });
    showMessage(`Deleted quiz "${quiz.name}".`, "success");
    await refreshLibrary();
  } catch (error) {
    showMessage(error.message || "The quiz could not be deleted.", "error");
  }
}

function loadBrowserLibrary(url, globalName, displayName) {
  if (window[globalName]) return Promise.resolve(window[globalName]);
  if (state.libraryLoads.has(url)) return state.libraryLoads.get(url);

  const loading = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = url;
    script.async = true;
    script.onload = () => {
      if (window[globalName]) {
        resolve(window[globalName]);
      } else {
        reject(new Error(`${displayName} loaded without its browser API.`));
      }
    };
    script.onerror = () => reject(new Error(
      `Could not load the ${displayName} reader. Check your internet connection and try again. Your file stays on this device.`
    ));
    document.head.append(script);
  });
  state.libraryLoads.set(url, loading);
  loading.catch(() => state.libraryLoads.delete(url));
  return loading;
}

async function extractPdfText(file) {
  const bytes = await file.arrayBuffer();
  const header = new TextDecoder().decode(bytes.slice(0, 1024));
  if (!header.includes("%PDF-")) {
    throw new Error("This file does not contain a valid PDF document. Choose a PDF or DOCX file.");
  }

  const pdfjs = await loadBrowserLibrary(PDF_LIBRARY_URL, "pdfjsLib", "PDF.js");
  pdfjs.GlobalWorkerOptions.workerSrc = PDF_WORKER_URL;
  let documentProxy;
  try {
    documentProxy = await pdfjs.getDocument({ data: new Uint8Array(bytes) }).promise;
    const pages = [];
    for (let pageNumber = 1; pageNumber <= documentProxy.numPages; pageNumber += 1) {
      const page = await documentProxy.getPage(pageNumber);
      const content = await page.getTextContent();
      let line = "";
      const lines = [];
      let previousY = null;
      for (const item of content.items) {
        if (!("str" in item)) continue;
        const currentY = item.transform?.[5];
        if (line && typeof currentY === "number" && previousY !== null && Math.abs(currentY - previousY) > 2) {
          lines.push(line);
          line = "";
        }
        line += `${line ? " " : ""}${item.str}`;
        if (item.hasEOL) {
          lines.push(line);
          line = "";
        }
        previousY = typeof currentY === "number" ? currentY : previousY;
      }
      if (line) lines.push(line);
      pages.push(lines.join("\n"));
    }
    const text = pages.join("\n");
    if (!text.trim()) {
      throw new Error("No selectable text was found in this PDF. It may be scanned; OCR is not supported.");
    }
    return text;
  } catch (error) {
    if (error instanceof Error && /No selectable text/.test(error.message)) throw error;
    throw new Error(`Could not read this PDF. It may be damaged, password protected, or scanned without selectable text. ${error.message}`);
  } finally {
    if (documentProxy) await documentProxy.destroy();
  }
}

async function extractDocxText(file) {
  const bytes = await file.arrayBuffer();
  const header = new Uint8Array(bytes.slice(0, 4));
  if (header[0] !== 0x50 || header[1] !== 0x4b) {
    throw new Error("This file is not a valid DOCX document. Choose a PDF or DOCX file.");
  }
  const mammoth = await loadBrowserLibrary(DOCX_LIBRARY_URL, "mammoth", "Mammoth");
  const result = await mammoth.extractRawText({ arrayBuffer: bytes });
  if (!result.value.trim()) {
    throw new Error("No readable text was found in this DOCX file.");
  }
  return result.value;
}

function parseQuestionStart(line) {
  const numbered = line.match(/^\s*(?:question\s*)?(\d{1,4})\s*[.):\-]\s*(.+?)\s*$/i);
  if (numbered) return { number: Number(numbered[1]), text: numbered[2] };
  const qNumbered = line.match(/^\s*q\s*(\d{1,4})\s*[.):\-]\s*(.+?)\s*$/i);
  if (qNumbered) return { number: Number(qNumbered[1]), text: qNumbered[2] };
  const named = line.match(/^\s*question\s*:\s*(.+?)\s*$/i);
  if (named) return { number: null, text: named[1] };
  return null;
}

function parseOption(line) {
  const match = line.match(/^\s*(?:\(\s*([A-D])\s*\)|\[\s*([A-D])\s*\]|([A-D])\s*[).:])\s*(.*?)\s*$/i);
  if (!match) return null;
  return { label: (match[1] ?? match[2] ?? match[3]).toUpperCase(), text: match[4] };
}

function parseAnswerKeyEntries(line) {
  const entries = [];
  const pattern = /(?:^|[,;\s])(?:q(?:uestion)?\s*)?(\d{1,4})\s*[.):\-]\s*([A-D])\b/gi;
  for (const match of line.matchAll(pattern)) {
    entries.push([Number(match[1]), match[2].toUpperCase()]);
  }
  return entries;
}

function parseImportedQuestions(rawText) {
  const lines = rawText.replace(/\r\n?/g, "\n").split("\n");
  const questions = [];
  const answerKeys = new Map();
  const sourceNumbers = new Map();
  let current = null;
  let inAnswerKey = false;

  const finishQuestion = () => {
    if (!current) return;
    current.text = current.text.trim();
    for (const label of ["A", "B", "C", "D"]) current.options[label] = current.options[label]?.trim() ?? "";
    questions.push(current);
    current = null;
  };

  for (const originalLine of lines) {
    const line = originalLine.trim();
    if (!line) continue;

    const keyHeading = line.match(/^\s*(?:answer\s*key|answers)\s*:?\s*(.*)$/i);
    if (keyHeading) {
      inAnswerKey = true;
      for (const [number, answer] of parseAnswerKeyEntries(keyHeading[1])) {
        const answers = answerKeys.get(number) ?? [];
        answers.push(answer);
        answerKeys.set(number, answers);
      }
      continue;
    }
    if (inAnswerKey) {
      for (const [number, answer] of parseAnswerKeyEntries(line)) {
        const answers = answerKeys.get(number) ?? [];
        answers.push(answer);
        answerKeys.set(number, answers);
      }
      continue;
    }

    const start = parseQuestionStart(line);
    if (start) {
      finishQuestion();
      current = { sourceNumber: start.number, text: start.text, options: {}, correctAnswer: "" };
      continue;
    }
    if (!current) continue;

    const answer = line.match(/^(?:correct\s+answer|answer|ans)\s*(?:key)?\s*[:=\-]\s*([A-D])\b/i);
    if (answer) {
      current.inlineAnswers = [...(current.inlineAnswers ?? []), answer[1].toUpperCase()];
      continue;
    }

    const option = parseOption(line);
    if (option) {
      current.options[option.label] = [current.options[option.label], option.text].filter(Boolean).join(" ").trim();
    } else if (Object.values(current.options).some(Boolean)) {
      const lastOption = ["D", "C", "B", "A"].find((label) => current.options[label]);
      current.options[lastOption] = `${current.options[lastOption]} ${line}`.trim();
    } else {
      current.text = `${current.text} ${line}`.trim();
    }
  }
  finishQuestion();

  if (questions.length === 0) {
    throw new Error("No numbered questions were recognized. Use question numbers, A–D options, and an Answer: B line or an answer key.");
  }

  for (const question of questions) {
    const keyedAnswers = question.sourceNumber === null ? [] : (answerKeys.get(question.sourceNumber) ?? []);
    const answers = [...new Set([...(question.inlineAnswers ?? []), ...keyedAnswers])];
    if (answers.length === 1) question.correctAnswer = answers[0];
    if (question.sourceNumber !== null) {
      sourceNumbers.set(question.sourceNumber, (sourceNumbers.get(question.sourceNumber) ?? 0) + 1);
    }
    question.needsReview = !question.text
      || ["A", "B", "C", "D"].some((label) => !question.options[label])
      || answers.length !== 1
      || !question.options[question.correctAnswer];
    delete question.inlineAnswers;
  }
  for (const question of questions) {
    if (question.sourceNumber !== null && sourceNumbers.get(question.sourceNumber) > 1) {
      question.needsReview = true;
      question.correctAnswer = "";
    }
  }
  return questions;
}

function openImportDialog() {
  if (state.subjects.length === 0) {
    showMessage("Create a subject folder before importing a quiz.", "error");
    return;
  }
  state.draftQuestions = [];
  elements.importForm.reset();
  elements.importSubject.replaceChildren(...state.subjects.map((subject) => {
    const option = document.createElement("option");
    option.value = subject.id;
    option.textContent = subject.name;
    return option;
  }));
  elements.importSubject.value = state.activeSubjectId
    ?? state.subjects[0].id;
  document.querySelector("#paste-source").hidden = false;
  document.querySelector("#file-source").hidden = true;
  elements.importPreview.hidden = true;
  elements.importFeedback.textContent = "";
  elements.importFeedback.dataset.kind = "";
  elements.reviewWarning.hidden = true;
  elements.importDialog.showModal();
  elements.importQuizName.focus();
}

function setImportFeedback(message, kind = "") {
  elements.importFeedback.textContent = message;
  elements.importFeedback.dataset.kind = kind;
}

async function getImportSourceText() {
  const sourceType = elements.importForm.elements.sourceType.value;
  if (sourceType === "paste") {
    if (!elements.importText.value.trim()) throw new Error("Paste questions and answers before previewing.");
    return elements.importText.value;
  }

  const file = elements.importFile.files[0];
  if (!file) throw new Error("Choose a PDF or DOCX file before previewing.");
  const extension = file.name.split(".").pop().toLowerCase();
  if (extension === "pdf") return extractPdfText(file);
  if (extension === "docx") return extractDocxText(file);
  throw new Error("Unsupported file format. Choose a PDF or Word (.docx) file.");
}

function isQuestionReady(question) {
  return Boolean(question.text.trim())
    && ["A", "B", "C", "D"].every((label) => question.options[label].trim())
    && ["A", "B", "C", "D"].includes(question.correctAnswer)
    && Boolean(question.options[question.correctAnswer].trim());
}

function updateDraftStatus(index) {
  const question = state.draftQuestions[index];
  question.needsReview = !isQuestionReady(question);
  const card = elements.previewQuestions.querySelector(`[data-question-index="${index}"]`);
  card.classList.toggle("needs-review", question.needsReview);
  const badge = card.querySelector(".review-badge");
  badge.hidden = !question.needsReview;
  const needsReviewCount = state.draftQuestions.filter((item) => item.needsReview).length;
  elements.reviewWarning.hidden = needsReviewCount === 0;
  elements.reviewWarning.textContent = needsReviewCount
    ? `${needsReviewCount} question${needsReviewCount === 1 ? "" : "s"} need review. Missing or unclear answers are left blank; no answers have been guessed. You can save them flagged for later correction.`
    : "";
}

function renderImportPreview() {
  elements.previewQuestions.replaceChildren();
  state.draftQuestions.forEach((question, index) => {
    const card = document.createElement("article");
    card.className = `preview-question${question.needsReview ? " needs-review" : ""}`;
    card.dataset.questionIndex = String(index);

    const heading = document.createElement("div");
    heading.className = "preview-question-header";
    const title = document.createElement("strong");
    title.textContent = `Question ${index + 1}`;
    const badge = document.createElement("span");
    badge.className = "review-badge";
    badge.textContent = "Needs review";
    badge.hidden = !question.needsReview;
    heading.append(title, badge);

    const stem = document.createElement("textarea");
    stem.rows = 2;
    stem.required = true;
    stem.setAttribute("aria-label", `Question ${index + 1} text`);
    stem.dataset.field = "text";
    stem.value = question.text;

    const options = document.createElement("div");
    options.className = "option-fields";
    for (const label of ["A", "B", "C", "D"]) {
      const field = document.createElement("div");
      field.className = "option-field";
      const optionLabel = document.createElement("label");
      optionLabel.textContent = label;
      optionLabel.setAttribute("for", `question-${index}-option-${label}`);
      const input = document.createElement("input");
      input.type = "text";
      input.id = `question-${index}-option-${label}`;
      input.maxLength = 500;
      input.dataset.field = "option";
      input.dataset.option = label;
      input.setAttribute("aria-label", `Question ${index + 1}, option ${label}`);
      input.value = question.options[label];
      field.append(optionLabel, input);
      options.append(field);
    }

    const answerField = document.createElement("div");
    answerField.className = "answer-field";
    const answerLabel = document.createElement("label");
    answerLabel.setAttribute("for", `question-${index}-answer`);
    answerLabel.textContent = "Correct answer";
    const answerSelect = document.createElement("select");
    answerSelect.id = `question-${index}-answer`;
    answerSelect.dataset.field = "answer";
    answerSelect.setAttribute("aria-label", `Question ${index + 1} correct answer`);
    const unsureOption = document.createElement("option");
    unsureOption.value = "";
    unsureOption.textContent = "Unclear — needs review";
    answerSelect.append(unsureOption);
    for (const label of ["A", "B", "C", "D"]) {
      const option = document.createElement("option");
      option.value = label;
      option.textContent = label;
      answerSelect.append(option);
    }
    answerSelect.value = question.correctAnswer;
    answerField.append(answerLabel, answerSelect);
    card.append(heading, stem, options, answerField);
    elements.previewQuestions.append(card);
  });

  elements.previewCount.textContent = `${state.draftQuestions.length} ${state.draftQuestions.length === 1 ? "question" : "questions"}`;
  const needsReviewCount = state.draftQuestions.filter((question) => question.needsReview).length;
  elements.reviewWarning.hidden = needsReviewCount === 0;
  elements.reviewWarning.textContent = needsReviewCount
    ? `${needsReviewCount} question${needsReviewCount === 1 ? "" : "s"} need review. Missing or unclear answers are left blank; no answers have been guessed. You can save them flagged for later correction.`
    : "";
  elements.importPreview.hidden = false;
}

async function previewImport() {
  const quizName = elements.importQuizName.value.trim();
  const subjectId = elements.importSubject.value;
  if (!quizName) {
    elements.importQuizName.setAttribute("aria-invalid", "true");
    elements.importQuizName.focus();
    setImportFeedback("Enter a name for this quiz before previewing.", "error");
    return;
  }
  if (!state.subjects.some((subject) => subject.id === subjectId)) {
    setImportFeedback("Choose a valid subject folder.", "error");
    return;
  }
  const previewButton = document.querySelector("#preview-import");
  previewButton.disabled = true;
  setImportFeedback("Reading your questions on this device…");
  try {
    const sourceText = await getImportSourceText();
    state.draftQuestions = parseImportedQuestions(sourceText);
    renderImportPreview();
    setImportFeedback("Review every question and answer before saving.", "success");
  } catch (error) {
    state.draftQuestions = [];
    elements.importPreview.hidden = true;
    setImportFeedback(error.message || "The questions could not be read.", "error");
  } finally {
    previewButton.disabled = false;
  }
}

async function saveImportedQuiz(event) {
  event.preventDefault();
  if (state.draftQuestions.length === 0) {
    setImportFeedback("Preview at least one question before saving.", "error");
    return;
  }
  const name = elements.importQuizName.value.trim();
  const subjectId = elements.importSubject.value;
  if (!name || !state.subjects.some((subject) => subject.id === subjectId)) {
    setImportFeedback("Enter a quiz name and choose a valid subject folder.", "error");
    return;
  }
  const blankQuestionIndex = state.draftQuestions.findIndex((question) => !question.text.trim());
  if (blankQuestionIndex >= 0) {
    setImportFeedback(`Question ${blankQuestionIndex + 1} needs question text before it can be saved.`, "error");
    elements.previewQuestions.querySelector(`[data-question-index="${blankQuestionIndex}"] textarea`).focus();
    return;
  }

  elements.saveImport.disabled = true;
  const timestamp = new Date().toISOString();
  const quizId = makeId();
  const quiz = { id: quizId, subjectId, name, createdAt: timestamp, updatedAt: timestamp };
  const questions = state.draftQuestions.map((question, order) => ({
    id: makeId(),
    quizId,
    order,
    text: question.text.trim(),
    options: { ...question.options },
    correctAnswer: question.correctAnswer || null,
    needsReview: !isQuestionReady(question),
    createdAt: timestamp
  }));
  try {
    await writeTransaction([QUIZ_STORE, QUESTION_STORE], (transaction) => {
      transaction.objectStore(QUIZ_STORE).add(quiz);
      const questionStore = transaction.objectStore(QUESTION_STORE);
      for (const question of questions) questionStore.add(question);
    });
    state.activeSubjectId = subjectId;
    elements.importDialog.close();
    showMessage(
      `Saved quiz "${name}" with ${questions.length} ${questions.length === 1 ? "question" : "questions"}${questions.some((question) => question.needsReview) ? " — some questions are flagged for review" : ""}.`,
      "success"
    );
    await refreshLibrary();
  } catch (error) {
    setImportFeedback(error.message || "The quiz could not be saved.", "error");
  } finally {
    elements.saveImport.disabled = false;
  }
}

function updateDraftFromPreview(event) {
  const field = event.target.dataset.field;
  if (!field) return;
  const card = event.target.closest("[data-question-index]");
  if (!card) return;
  const index = Number(card.dataset.questionIndex);
  const question = state.draftQuestions[index];
  if (!question) return;
  if (field === "text") question.text = event.target.value;
  if (field === "option") question.options[event.target.dataset.option] = event.target.value;
  if (field === "answer") question.correctAnswer = event.target.value;
  updateDraftStatus(index);
}

function discardImport() {
  if (state.draftQuestions.length > 0 && !window.confirm("Discard this import and its review changes?")) return;
  elements.importDialog.close();
}

document.querySelector("#add-subject-sidebar").addEventListener("click", () => openEditor("create-subject"));
document.querySelector("#add-subject-top").addEventListener("click", () => openEditor("create-subject"));
elements.addQuizButton.addEventListener("click", () => openEditor("create-quiz"));
elements.form.addEventListener("submit", handleEditorSubmit);
document.querySelector("#dialog-close").addEventListener("click", () => elements.dialog.close());
document.querySelector("#dialog-cancel").addEventListener("click", () => elements.dialog.close());
elements.nameInput.addEventListener("input", () => elements.nameInput.setAttribute("aria-invalid", "false"));
document.querySelector("#import-questions-button").addEventListener("click", openImportDialog);
elements.exportBackupButton.addEventListener("click", downloadBackup);
elements.importBackupButton.addEventListener("click", openBackupDialog);
elements.backupFilePicker.addEventListener("change", previewBackupFile);
elements.restoreBackupButton.addEventListener("click", restoreSelectedBackup);
document.querySelector("#backup-close").addEventListener("click", () => elements.backupDialog.close());
document.querySelector("#backup-cancel").addEventListener("click", () => elements.backupDialog.close());
elements.backupDialog.addEventListener("close", () => {
  state.pendingBackup = null;
});
document.querySelector("#import-close").addEventListener("click", discardImport);
document.querySelector("#import-cancel").addEventListener("click", discardImport);
document.querySelector("#preview-import").addEventListener("click", previewImport);
elements.importForm.addEventListener("submit", saveImportedQuiz);
elements.previewQuestions.addEventListener("input", updateDraftFromPreview);
elements.previewQuestions.addEventListener("change", updateDraftFromPreview);
elements.importQuizName.addEventListener("input", () => elements.importQuizName.setAttribute("aria-invalid", "false"));
elements.importForm.addEventListener("change", (event) => {
  if (event.target.name === "sourceType") {
    const usePaste = event.target.value === "paste";
    document.querySelector("#paste-source").hidden = !usePaste;
    document.querySelector("#file-source").hidden = usePaste;
    invalidateImportPreview();
  } else if (event.target === elements.importFile) {
    invalidateImportPreview();
  }
});
elements.importText.addEventListener("input", invalidateImportPreview);
elements.importDialog.addEventListener("close", () => {
  state.draftQuestions = [];
  elements.importPreview.hidden = true;
  elements.importForm.reset();
});
elements.importDialog.addEventListener("cancel", (event) => {
  if (state.draftQuestions.length > 0 && !window.confirm("Discard this import and its review changes?")) {
    event.preventDefault();
  }
});

function invalidateImportPreview() {
  elements.importPreview.hidden = true;
  state.draftQuestions = [];
  setImportFeedback("");
}

async function startApp() {
  try {
    state.database = await openDatabase();
    state.database.onversionchange = () => {
      state.database.close();
      showMessage("The database changed in another tab. Refresh this page to continue.", "error");
    };
    await initializeDefaultSubjects();
    await refreshLibrary();
  } catch (error) {
    showMessage(error.message || "Smart Quiz App could not open its local database.", "error");
    elements.libraryContent.replaceChildren(createEmptyState(
      "Your local library is unavailable",
      "This browser could not open IndexedDB. Try a current browser with local storage enabled.",
      "",
      null
    ));
  }
}

startApp();
