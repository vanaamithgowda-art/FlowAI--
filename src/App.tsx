import { useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import {
  ArrowLeft, ArrowRight, ArrowUpRight, BookMarked, BookOpen, Check, CheckCircle2,
  ChevronRight, CircleHelp, Copy, FileText, FlaskConical, Home, ImagePlus,
  Lightbulb, LoaderCircle, Printer, RefreshCw, Save, Settings, ShieldCheck, Sparkles,
  Trash2, Upload, Workflow, X, Zap,
} from 'lucide-react';
import Diagram from './components/Diagram';
import {
  type Attempt, type ClassLevel, type SavedLesson,
} from './lib/contracts';
import {
  evaluateAnswer, explainConcept, FlowApiError, getHint, makeLessonContext, revealAnswer,
  type FlowImageInput,
} from './lib/api';
import { clearSavedLessons, formatDate, lessonAsPlainText, loadSavedLessons, persistSavedLessons } from './lib/storage';

type View = 'home' | 'new' | 'lesson' | 'saved' | 'settings';
type SourceMode = 'text' | 'image' | 'none';
type BusyAction = 'explain' | 'evaluate' | 'hint' | 'reveal' | null;
type UploadedImage = FlowImageInput & { previewUrl: string; size: number };

function makeId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function detectImageType(bytes: Uint8Array): FlowImageInput['mimeType'] | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') return 'image/webp';
  return null;
}

async function imageFileToInput(file: File): Promise<UploadedImage> {
  if (file.size > 5 * 1024 * 1024) throw new Error(`${file.name} is over 5 MB. Choose a smaller image.`);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const mimeType = detectImageType(bytes);
  if (!mimeType) throw new Error(`${file.name} is not a valid JPEG, PNG, or WebP image.`);
  if (file.type && file.type !== mimeType) throw new Error(`${file.name} does not match its declared file type. Choose a valid image.`);
  const previewUrl = URL.createObjectURL(file);
  try {
    if (typeof createImageBitmap === 'function') {
      const bitmap = await createImageBitmap(file);
      bitmap.close();
    } else {
      await new Promise<void>((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve();
        image.onerror = () => reject(new Error(`${file.name} could not be decoded. Try another or clearer image.`));
        image.src = previewUrl;
      });
    }
  } catch {
    URL.revokeObjectURL(previewUrl);
    throw new Error(`${file.name} could not be decoded. Try another or clearer image.`);
  }
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Could not read the image file.'));
    reader.onerror = () => reject(new Error('Could not read the image file.'));
    reader.readAsDataURL(file);
  });
  return { name: file.name, mimeType, data: dataUrl.split(',')[1] ?? '', previewUrl, size: file.size };
}

// Workers AI's selected vision model accepts one image per inference. If the
// student uploads two pages, combine them into one resized JPEG in the browser.
// The combined image is sent for this request only and is never added to history.
async function prepareImagesForAI(images: UploadedImage[]): Promise<FlowImageInput[]> {
  if (images.length === 0) return [];
  if (images.length === 1) {
    const { name, mimeType, data } = images[0];
    return [{ name, mimeType, data }];
  }

  const pages = await Promise.all(images.map(async (page) => {
    const image = new Image();
    image.src = page.previewUrl;
    if (typeof image.decode === 'function') {
      await image.decode();
    } else {
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error(`Could not prepare ${page.name} for reading.`));
      });
    }
    const scale = Math.min(1, 1600 / image.naturalWidth, 1900 / image.naturalHeight);
    return {
      image,
      width: Math.max(1, Math.round(image.naturalWidth * scale)),
      height: Math.max(1, Math.round(image.naturalHeight * scale)),
    };
  }));

  const gap = 20;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(...pages.map((page) => page.width));
  canvas.height = pages.reduce((height, page) => height + page.height, 0) + gap * (pages.length - 1);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('This browser could not prepare the textbook pages. Upload one image instead.');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  let y = 0;
  for (const page of pages) {
    context.drawImage(page.image, Math.round((canvas.width - page.width) / 2), y, page.width, page.height);
    y += page.height + gap;
  }

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((result) => result ? resolve(result) : reject(new Error('Could not prepare the combined textbook image. Try uploading one page instead.')), 'image/jpeg', 0.84);
  });
  if (blob.size > 5 * 1024 * 1024) throw new Error('The combined textbook image is too large. Upload one page or choose smaller images.');
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Could not read the combined image.'));
    reader.onerror = () => reject(new Error('Could not read the combined image.'));
    reader.readAsDataURL(blob);
  });
  return [{ name: 'combined-textbook-pages.jpg', mimeType: 'image/jpeg', data: dataUrl.split(',')[1] ?? '' }];
}

function SectionHeading({ number, title, eyebrow }: { number: string; title: string; eyebrow?: string }) {
  return (
    <div className="section-heading">
      <span className="section-number">{number}</span>
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h2>{title}</h2>
      </div>
    </div>
  );
}

function FieldError({ children }: { children: string }) {
  return <p className="field-error" role="alert">{children}</p>;
}

export default function App() {
  const [view, setView] = useState<View>('home');
  const [classLevel, setClassLevel] = useState<ClassLevel>('10');
  const [topic, setTopic] = useState('');
  const [confusion, setConfusion] = useState('');
  const [sourceMode, setSourceMode] = useState<SourceMode>('text');
  const [sourceText, setSourceText] = useState('');
  const [uploadedImages, setUploadedImages] = useState<UploadedImage[]>([]);
  const [savedLessons, setSavedLessons] = useState<SavedLesson[]>(() => loadSavedLessons());
  const [activeLesson, setActiveLesson] = useState<SavedLesson | null>(null);
  const [answerDraft, setAnswerDraft] = useState('');
  const [busy, setBusy] = useState<BusyAction>(null);
  const [notice, setNotice] = useState('');
  const [formError, setFormError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const answerRef = useRef<HTMLTextAreaElement>(null);

  const recentLessons = useMemo(() => [...savedLessons].sort((a, b) => b.savedAt.localeCompare(a.savedAt)).slice(0, 3), [savedLessons]);
  const isCurrentSaved = Boolean(activeLesson && savedLessons.some((lesson) => lesson.id === activeLesson.id));
  const latestAttempt = activeLesson?.attempts.at(-1);

  const dismissNotice = () => setNotice('');

  function commitSaved(nextLessons: SavedLesson[], successMessage?: string) {
    setSavedLessons(nextLessons);
    const persisted = persistSavedLessons(nextLessons);
    if (!persisted) {
      setNotice('This browser could not store the lesson, possibly because local storage is full. It remains open until you leave this page.');
      return;
    }
    if (successMessage) setNotice(successMessage);
  }

  function updateActiveLesson(nextLesson: SavedLesson) {
    setActiveLesson(nextLesson);
    if (savedLessons.some((lesson) => lesson.id === nextLesson.id)) {
      commitSaved(savedLessons.map((lesson) => lesson.id === nextLesson.id ? nextLesson : lesson));
    }
  }

  function removePendingImage(index: number) {
    setUploadedImages((current) => {
      const next = [...current];
      const [removed] = next.splice(index, 1);
      if (removed) URL.revokeObjectURL(removed.previewUrl);
      return next;
    });
  }

  function clearPendingImages() {
    uploadedImages.forEach((image) => URL.revokeObjectURL(image.previewUrl));
    setUploadedImages([]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function chooseSourceMode(nextMode: SourceMode) {
    setSourceMode(nextMode);
    setFormError('');
    if (nextMode !== 'image') clearPendingImages();
  }

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (!files.length) return;
    if (uploadedImages.length + files.length > 2) {
      setFormError('Upload no more than two textbook images per lesson.');
      return;
    }
    if (uploadedImages.reduce((total, image) => total + image.size, 0) + files.reduce((total, file) => total + file.size, 0) > 5 * 1024 * 1024) {
      setFormError('The combined size of textbook images must be 5 MB or smaller.');
      return;
    }
    setFormError('');
    try {
      const validImages = await Promise.all(files.map(imageFileToInput));
      setUploadedImages((current) => [...current, ...validImages]);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'The selected image could not be read.');
    }
  }

  async function handleExplain(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError('');
    dismissNotice();
    if (confusion.trim().length < 8) {
      setFormError('Describe the confusing part in at least a few words.');
      return;
    }
    if (sourceMode === 'image' && uploadedImages.length === 0) {
      setFormError('Choose at least one textbook image, or switch to pasted text or no source.');
      return;
    }
    if (sourceMode === 'text' && sourceText.length > 12000) {
      setFormError('Keep the pasted passage under 12,000 characters.');
      return;
    }
    setBusy('explain');
    try {
      const imagesForAI = sourceMode === 'image' ? await prepareImagesForAI(uploadedImages) : [];
      const explanation = await explainConcept({
        classLevel,
        topic: topic.trim(),
        confusion: confusion.trim(),
        sourceText: sourceMode === 'text' ? sourceText : '',
        images: imagesForAI,
      });
      const now = new Date().toISOString();
      const lesson: SavedLesson = {
        id: makeId(), classLevel, topic: topic.trim(), confusion: confusion.trim(),
        sourceText: sourceMode === 'text' ? sourceText : '', explanation,
        createdAt: now, savedAt: now, attempts: [],
      };
      setActiveLesson(lesson);
      setAnswerDraft('');
      setView('lesson');
      setNotice(explanation.sourceAssessment.sourceStatus === 'unreadable' ? 'The image could not be read reliably. Check the source note in this lesson and upload a clearer page.' : '');
      clearPendingImages();
    } catch (error) {
      setFormError(error instanceof FlowApiError ? error.message : error instanceof Error ? error.message : 'Flow AI could not generate this lesson. Please retry.');
    } finally {
      setBusy(null);
    }
  }

  async function submitAnswer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeLesson || busy) return;
    const answer = answerDraft.trim();
    if (!answer) {
      setNotice('Write an answer before submitting it.');
      return;
    }
    dismissNotice();
    setBusy('evaluate');
    try {
      const previousAttempts = activeLesson.attempts.slice(-8).map((attempt) => ({ answer: attempt.answer, verdict: attempt.feedback.verdict }));
      const feedback = await evaluateAnswer(makeLessonContext(activeLesson), answer, previousAttempts);
      const attempt: Attempt = { id: makeId(), answer, submittedAt: new Date().toISOString(), feedback };
      const next = { ...activeLesson, attempts: [...activeLesson.attempts, attempt].slice(-30) };
      updateActiveLesson(next);
      setAnswerDraft('');
    } catch (error) {
      setNotice(error instanceof FlowApiError ? error.message : 'Could not evaluate that answer. The text is still here; retry when connected.');
    } finally {
      setBusy(null);
    }
  }

  async function requestHint() {
    if (!activeLesson || !latestAttempt || busy) return;
    dismissNotice();
    setBusy('hint');
    try {
      const response = await getHint(makeLessonContext(activeLesson), latestAttempt.answer, latestAttempt.feedback);
      const nextAttempts = activeLesson.attempts.map((attempt) => attempt.id === latestAttempt.id ? { ...attempt, hint: response.hint } : attempt);
      updateActiveLesson({ ...activeLesson, attempts: nextAttempts });
    } catch (error) {
      setNotice(error instanceof FlowApiError ? error.message : 'Could not generate a hint. Try again when connected.');
    } finally {
      setBusy(null);
    }
  }

  async function requestModelAnswer() {
    if (!activeLesson || !latestAttempt || busy) return;
    dismissNotice();
    setBusy('reveal');
    try {
      const response = await revealAnswer(makeLessonContext(activeLesson), latestAttempt.answer);
      const nextAttempts = activeLesson.attempts.map((attempt) => attempt.id === latestAttempt.id
        ? { ...attempt, modelAnswer: response.modelAnswer, modelReasoning: response.reasoning }
        : attempt);
      updateActiveLesson({ ...activeLesson, attempts: nextAttempts });
    } catch (error) {
      setNotice(error instanceof FlowApiError ? error.message : 'Could not reveal the model answer. Try again when connected.');
    } finally {
      setBusy(null);
    }
  }

  function saveActiveLesson() {
    if (!activeLesson) return;
    const existing = savedLessons.find((lesson) => lesson.id === activeLesson.id);
    const nextLesson = { ...activeLesson, savedAt: existing?.savedAt ?? new Date().toISOString() };
    const nextLessons = [nextLesson, ...savedLessons.filter((lesson) => lesson.id !== nextLesson.id)];
    setActiveLesson(nextLesson);
    commitSaved(nextLessons, existing ? 'Saved lesson updated.' : 'Lesson saved in this browser.');
  }

  function openSavedLesson(lesson: SavedLesson) {
    setActiveLesson(lesson);
    setAnswerDraft('');
    setView('lesson');
    dismissNotice();
  }

  function deleteLesson(lesson: SavedLesson) {
    if (!window.confirm(`Delete “${lesson.explanation.title}” from this browser?`)) return;
    const next = savedLessons.filter((item) => item.id !== lesson.id);
    commitSaved(next, 'Lesson deleted from this browser.');
    if (activeLesson?.id === lesson.id) setActiveLesson(lesson);
  }

  function deleteAllLessons() {
    if (!window.confirm('Delete every saved lesson from this browser? This cannot be undone.')) return;
    const cleared = clearSavedLessons();
    setSavedLessons([]);
    setNotice(cleared ? 'All saved lessons were removed from this browser.' : 'The browser could not clear local storage. Check browser storage settings and retry.');
  }

  async function copyActiveLesson() {
    if (!activeLesson) return;
    try {
      await navigator.clipboard.writeText(lessonAsPlainText(activeLesson));
      setNotice('Lesson copied to the clipboard.');
    } catch {
      setNotice('Clipboard access was blocked by the browser. Use Print to save a readable copy, or allow clipboard access.');
    }
  }

  function startNewLesson() {
    setFormError('');
    dismissNotice();
    setTopic('');
    setConfusion('');
    setSourceText('');
    setSourceMode('text');
    clearPendingImages();
    setView('new');
  }

  function navTo(nextView: View) {
    setView(nextView);
    setFormError('');
    dismissNotice();
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="brand" onClick={() => navTo('home')} aria-label="Flow AI home">
          <span className="brand-mark"><Workflow size={22} strokeWidth={2.4} /></span>
          <span className="brand-copy"><strong>flow<span>ai</span></strong><small>SCIENCE, UNSTUCK</small></span>
        </button>
        <nav className="top-navigation" aria-label="Main navigation">
          <button className={view === 'home' ? 'nav-link active' : 'nav-link'} onClick={() => navTo('home')}><Home size={16} /> Home</button>
          <button className={view === 'saved' ? 'nav-link active' : 'nav-link'} onClick={() => navTo('saved')}><BookMarked size={16} /> My lessons{savedLessons.length > 0 && <span className="nav-count">{savedLessons.length}</span>}</button>
          <button className={view === 'settings' ? 'nav-link active icon-nav active-icon' : 'nav-link icon-nav'} onClick={() => navTo('settings')} aria-label="Settings" title="Settings"><Settings size={17} /><span>Settings</span></button>
        </nav>
      </header>

      <main className="main-content">
        {notice && <div className="notice-bar" role="status"><span>{notice}</span><button aria-label="Dismiss notification" onClick={dismissNotice}><X size={16} /></button></div>}

        {view === 'home' && (
          <div className="home-view">
            <section className="hero-grid">
              <div className="hero-copy">
                <div className="pill-label"><span className="status-dot" /> BUILT FOR CBSE CLASSES 9–10</div>
                <h1>Science makes sense<br /><span>when the logic flows.</span></h1>
                <p className="hero-description">Start with the part that confuses you. Flow AI connects the steps, uses your NCERT source, and checks whether you can apply the idea yourself.</p>
                <div className="hero-actions">
                  <button className="button button-primary button-large" onClick={startNewLesson}>Explain a concept <ArrowRight size={18} /></button>
                  <button className="text-button" onClick={() => navTo('saved')}>Open my lessons <ArrowUpRight size={16} /></button>
                </div>
                <div className="trust-row"><ShieldCheck size={17} /><span>No account. Lessons stay in this browser.</span></div>
              </div>
              <div className="hero-visual" aria-label="Three stages of the Flow AI learning process">
                <div className="visual-topline"><span>THE FLOW METHOD</span><span>01 — 03</span></div>
                <div className="flow-steps-art">
                  <div className="flow-card flow-card-one"><span className="flow-step-icon"><CircleHelp size={18} /></span><div><b>Your confusion</b><small>Find the exact gap</small></div><span className="flow-card-number">01</span></div>
                  <div className="flow-connector"><span /><span /><span /></div>
                  <div className="flow-card flow-card-two"><span className="flow-step-icon"><Workflow size={18} /></span><div><b>Follow the logic</b><small>Connect each cause</small></div><span className="flow-card-number">02</span></div>
                  <div className="flow-connector"><span /><span /><span /></div>
                  <div className="flow-card flow-card-three"><span className="flow-step-icon"><CheckCircle2 size={18} /></span><div><b>Test your understanding</b><small>Explain it yourself</small></div><span className="flow-card-number">03</span></div>
                </div>
                <div className="visual-footer"><Sparkles size={15} /><span>Less memorising. More understanding.</span></div>
                <div className="decor-circle decor-circle-one" /><div className="decor-circle decor-circle-two" />
              </div>
            </section>

            <section className="how-section">
              <div className="section-intro"><div className="eyebrow">A BETTER WAY TO LEARN</div><h2>From “I don't get it” to “I can explain it.”</h2><p>One concept at a time. No generic chatbot detours.</p></div>
              <div className="feature-grid">
                <article className="feature-card"><span className="feature-icon blue"><BookOpen size={20} /></span><h3>Your source comes first</h3><p>Paste the NCERT passage or upload the page. Flow AI tells you when source-specific checking is limited.</p></article>
                <article className="feature-card"><span className="feature-icon mint"><Workflow size={20} /></span><h3>See how it works</h3><p>Follow small causal steps, a labelled diagram, and one everyday example that has clear limits.</p></article>
                <article className="feature-card"><span className="feature-icon amber"><Zap size={20} /></span><h3>Prove it to yourself</h3><p>Answer an application question, get reasoning feedback, and try a hint before revealing the model answer.</p></article>
              </div>
            </section>

            {savedLessons.length > 0 ? (
              <section className="recent-section">
                <div className="section-row"><div><div className="eyebrow">PICK UP WHERE YOU LEFT OFF</div><h2>Recent lessons</h2></div><button className="text-button" onClick={() => navTo('saved')}>View all <ArrowRight size={16} /></button></div>
                <LessonList lessons={recentLessons} onOpen={openSavedLesson} onDelete={deleteLesson} compact />
              </section>
            ) : (
              <section className="empty-history-strip"><div className="empty-history-icon"><BookMarked size={20} /></div><div><h3>Your lesson history starts here</h3><p>Save an explanation to return to it later, even when the AI service is offline.</p></div><button className="button button-secondary" onClick={startNewLesson}>Start a lesson <ArrowRight size={16} /></button></section>
            )}
            <footer className="page-footer"><span>Flow AI</span><span>Understand the science. Follow the logic.</span><span>Made for learning, not memorising.</span></footer>
          </div>
        )}

        {view === 'new' && (
          <section className="form-page">
            <button className="back-link" onClick={() => navTo('home')}><ArrowLeft size={16} /> Back to dashboard</button>
            <div className="form-intro"><div className="eyebrow">NEW LESSON · ABOUT 2 MINUTES</div><h1>What part of science<br /><span>is confusing you?</span></h1><p>Be specific. The gap between what you understand and what you don't is where we should start.</p></div>
            <form className="lesson-form" onSubmit={handleExplain}>
              <div className="form-row two-columns">
                <div className="field-group"><div className="field-label">Your class <span className="required-mark">*</span></div><div className="class-options" role="group" aria-label="Select your class">
                  <button type="button" className={classLevel === '9' ? 'class-option selected' : 'class-option'} onClick={() => setClassLevel('9')} aria-pressed={classLevel === '9'}><span>Class</span><strong>09</strong></button>
                  <button type="button" className={classLevel === '10' ? 'class-option selected' : 'class-option'} onClick={() => setClassLevel('10')} aria-pressed={classLevel === '10'}><span>Class</span><strong>10</strong></button>
                </div></div>
                <div className="field-group"><label htmlFor="topic">Topic or chapter <span className="optional">OPTIONAL</span></label><input id="topic" value={topic} onChange={(event) => setTopic(event.target.value)} maxLength={160} placeholder="e.g. Electricity, Life Processes" /></div>
              </div>

              <div className="field-group"><label htmlFor="confusion">What exactly don't you understand? <span className="required-mark">*</span></label><textarea id="confusion" value={confusion} onChange={(event) => setConfusion(event.target.value)} minLength={8} maxLength={3000} rows={4} placeholder="I understand that electric current flows through a wire, but I don't understand why resistance decreases the current." required /><div className="field-foot"><span>Describe the exact step, term, or relationship that feels unclear.</span><span>{confusion.length}/3000</span></div></div>

              <div className="field-group source-field"><div className="source-label-row"><div><label>NCERT source</label><p className="field-subtitle">Give the tutor something concrete to check against.</p></div><span className="optional">OPTIONAL, BUT RECOMMENDED</span></div>
                <div className="source-tabs" role="tablist" aria-label="Choose textbook source type">
                  <button type="button" role="tab" aria-selected={sourceMode === 'text'} className={sourceMode === 'text' ? 'source-tab active' : 'source-tab'} onClick={() => chooseSourceMode('text')}><FileText size={16} /> Paste text</button>
                  <button type="button" role="tab" aria-selected={sourceMode === 'image'} className={sourceMode === 'image' ? 'source-tab active' : 'source-tab'} onClick={() => chooseSourceMode('image')}><ImagePlus size={16} /> Upload image</button>
                  <button type="button" role="tab" aria-selected={sourceMode === 'none'} className={sourceMode === 'none' ? 'source-tab active' : 'source-tab'} onClick={() => chooseSourceMode('none')}><X size={16} /> No source</button>
                </div>
                {sourceMode === 'text' && <div className="source-panel"><textarea id="source-text" value={sourceText} onChange={(event) => setSourceText(event.target.value)} rows={5} maxLength={12000} placeholder="Paste the relevant NCERT paragraph, definition, equation, or explanation here…" /><div className="field-foot"><span>Only paste the section relevant to your confusion.</span><span>{sourceText.length}/12000</span></div></div>}
                {sourceMode === 'image' && <div className="source-panel image-source-panel">
                  <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={handleFileChange} aria-label="Choose textbook images" />
                  {uploadedImages.length === 0 ? <button type="button" className="upload-dropzone" onClick={() => fileInputRef.current?.click()}><span className="upload-icon"><Upload size={22} /></span><b>Choose textbook page images</b><span>JPEG, PNG, or WebP · 5 MB combined · up to 2 images</span><span className="upload-action">Browse files</span></button> : <div className="upload-preview-grid">
                    {uploadedImages.map((image, index) => <div className="uploaded-image" key={`${image.name}-${index}`}><img src={image.previewUrl} alt={`Preview of ${image.name}`} /><div className="uploaded-image-meta"><span title={image.name}>{image.name}</span><small>{(image.size / 1024 / 1024).toFixed(2)} MB</small></div><button type="button" className="remove-image" onClick={() => removePendingImage(index)} aria-label={`Remove ${image.name}`}><X size={15} /></button></div>)}
                    {uploadedImages.length < 2 && <button type="button" className="add-image-tile" onClick={() => fileInputRef.current?.click()}><ImagePlus size={20} /> Add another</button>}
                  </div>}
                  <p className="source-note"><ShieldCheck size={14} /> Images are sent to the AI for this request and aren't stored in lesson history.</p>
                </div>}
                {sourceMode === 'none' && <div className="no-source-note"><CircleHelp size={18} /><p>Flow AI will explain from general scientific knowledge. It cannot verify the explanation against a specific NCERT passage without a source.</p></div>}
              </div>

              {formError && <FieldError>{formError}</FieldError>}
              <div className="form-submit-row"><div className="form-privacy"><ShieldCheck size={16} /><span>Your source isn't saved to lesson history as an image. Pasted text may be saved locally with the lesson.</span></div><button className="button button-primary button-large submit-button" type="submit" disabled={busy !== null}>{busy === 'explain' ? <><LoaderCircle className="spin" size={18} /> Building lesson…</> : <>Explain my confusion <ArrowRight size={18} /></>}</button></div>
            </form>
            <p className="form-footnote">Flow AI supports learning. Check important scientific details against your teacher and textbook.</p>
          </section>
        )}

        {view === 'lesson' && activeLesson && (
          <section className="lesson-workspace">
            <div className="lesson-toolbar"><button className="back-link" onClick={() => navTo('home')}><ArrowLeft size={16} /> Dashboard</button><div className="lesson-tools">
              <button className="tool-button" onClick={copyActiveLesson} title="Copy lesson"><Copy size={16} /><span>Copy</span></button>
              <button className="tool-button" onClick={() => window.print()} title="Print lesson"><Printer size={16} /><span>Print</span></button>
              <button className={isCurrentSaved ? 'tool-button saved' : 'tool-button'} onClick={saveActiveLesson} title={isCurrentSaved ? 'Update saved lesson' : 'Save lesson'}><Save size={16} /><span>{isCurrentSaved ? 'Saved' : 'Save lesson'}</span></button>
            </div></div>
            <div className="lesson-title-block"><div className="lesson-meta"><span className="class-tag">CBSE CLASS {activeLesson.classLevel}</span><span className="meta-dot" />{activeLesson.topic || 'Science concept'}<span className="meta-dot" />{formatDate(activeLesson.createdAt)}</div><h1>{activeLesson.explanation.title}</h1><p className="original-confusion"><span className="confusion-icon"><CircleHelp size={17} /></span><span><b>Your original confusion</b>{activeLesson.confusion}</span></p></div>
            {activeLesson.explanation.sourceAssessment.sourceStatus === 'unreadable' && <div className="source-warning"><CircleHelp size={18} /><div><b>The textbook image wasn't readable enough to verify.</b><p>{activeLesson.explanation.sourceAssessment.limitations.join(' ') || 'Upload a clearer image or paste the relevant NCERT passage, then try again.'}</p></div></div>}
            {activeLesson.explanation.sourceAssessment.sourceStatus === 'none' && <div className="source-info"><ShieldCheck size={17} /><span>No NCERT source was supplied. This is a general science explanation, not a source-verified reading of a specific textbook passage.</span></div>}
            {activeLesson.explanation.sourceAssessment.sourceStatus !== 'none' && activeLesson.explanation.sourceAssessment.sourceStatus !== 'unreadable' && activeLesson.explanation.sourceAssessment.limitations.length > 0 && <div className="source-info"><ShieldCheck size={17} /><span>{activeLesson.explanation.sourceAssessment.limitations.join(' ')}</span></div>}

            <div className="lesson-sections">
              <article className="lesson-section core-section"><SectionHeading number="01" title="Core idea" eyebrow="START HERE" /><p className="core-idea-text">{activeLesson.explanation.coreIdea}</p></article>
              <article className="lesson-section"><SectionHeading number="02" title="How it works" eyebrow="FOLLOW THE CAUSE AND EFFECT" /><div className="steps-list">{activeLesson.explanation.steps.map((step, index) => <div className="mechanism-step" key={`${step.title}-${index}`}><div className="step-rail"><span className="step-index">{String(index + 1).padStart(2, '0')}</span>{index < activeLesson.explanation.steps.length - 1 && <span className="step-line" />}</div><div className="step-content"><h3>{step.title}</h3><p>{step.explanation}</p></div></div>)}</div></article>
              <article className="lesson-section"><SectionHeading number="03" title="Everyday example" eyebrow="CONNECT IT TO REAL LIFE" /><div className="example-card"><span className="example-icon"><FlaskConical size={21} /></span><div><h3>The situation</h3><p>{activeLesson.explanation.everydayExample.scenario}</p><h3>What it shows</h3><p>{activeLesson.explanation.everydayExample.connection}</p><div className="analogy-limit"><b>Where the analogy stops</b><p>{activeLesson.explanation.everydayExample.limitation}</p></div></div></div></article>
              <article className="lesson-section"><SectionHeading number="04" title="Visual explanation" eyebrow="SEE THE RELATIONSHIP" /><Diagram diagram={activeLesson.explanation.diagram} /></article>
              <article className="lesson-section"><SectionHeading number="05" title="NCERT connection" eyebrow="KEEP THE SCIENCE TERMS" /><div className="terms-list">{activeLesson.explanation.ncertTerms.map((term, index) => <div className="term-card" key={`${term.term}-${index}`}><div className="term-topline"><span className="term-number">T{String(index + 1).padStart(2, '0')}</span><h3>{term.term}</h3></div><p>{term.meaning}</p><div className="term-role"><b>Role in this concept</b><span>{term.role}</span></div></div>)}</div></article>
              <article className="lesson-section"><SectionHeading number="06" title="Common confusion" eyebrow="FIX THE MENTAL MODEL" /><div className="confusion-card"><div className="confusion-part"><span className="confusion-label">WHAT'S UNCLEAR</span><p>{activeLesson.explanation.commonConfusion.misunderstanding}</p></div><div className="confusion-part corrected"><span className="confusion-label"><Check size={13} /> THE CORRECTION</span><p>{activeLesson.explanation.commonConfusion.correction}</p></div><p className="why-it-matters"><b>Why this matters</b>{activeLesson.explanation.commonConfusion.reason}</p></div></article>
              <article className="lesson-section understanding-section"><SectionHeading number="07" title="Understanding check" eyebrow="YOUR TURN" /><p className="check-intro">Apply the idea to a slightly different situation. The model answer stays hidden until you've attempted the question.</p><div className="question-card"><div className="question-label"><Lightbulb size={16} /> THINK IT THROUGH</div><p className="application-question">{activeLesson.explanation.understandingCheck.question}</p>
                <form onSubmit={submitAnswer} className="answer-form"><label htmlFor="answer-input">Your reasoning</label><textarea ref={answerRef} id="answer-input" value={answerDraft} onChange={(event) => setAnswerDraft(event.target.value)} rows={4} maxLength={2500} placeholder="Explain why you think this happens. Show the link between cause and result…" disabled={busy !== null} /><div className="answer-footer"><span>Explain the logic, not just the final result.</span><button type="submit" className="button button-primary" disabled={busy !== null || !answerDraft.trim()}>{busy === 'evaluate' ? <><LoaderCircle className="spin" size={16} /> Checking…</> : <>Check my reasoning <ArrowRight size={16} /></>}</button></div></form>
              </div>
              {activeLesson.attempts.length > 0 && <div className="attempts-area"><div className="attempts-header"><div><div className="eyebrow">YOUR REASONING</div><h3>Attempts and feedback</h3></div><span className="attempt-count">{activeLesson.attempts.length} {activeLesson.attempts.length === 1 ? 'attempt' : 'attempts'}</span></div>
                {activeLesson.attempts.map((attempt, index) => <div className="attempt-card" key={attempt.id}><div className="attempt-topline"><span className="attempt-number">Attempt {index + 1}</span><span className={`verdict verdict-${attempt.feedback.verdict}`}>{attempt.feedback.verdict === 'correct' ? <CheckCircle2 size={14} /> : attempt.feedback.verdict === 'partially-correct' ? <CircleHelp size={14} /> : <RefreshCw size={14} />}{attempt.feedback.verdict === 'correct' ? 'Correct reasoning' : attempt.feedback.verdict === 'partially-correct' ? 'Partly correct' : 'Needs another look'}</span><time>{formatDate(attempt.submittedAt)}</time></div><p className="submitted-answer">{attempt.answer}</p><div className="feedback-block"><b>What you understood</b><p>{attempt.feedback.whatWasUnderstood}</p></div><div className="feedback-block"><b>What to work on</b><p>{attempt.feedback.conceptualGap}</p></div>
                  {attempt.feedback.verdict !== 'correct' && attempt.feedback.targetedHint && <div className="inline-hint"><Lightbulb size={16} /><p>{attempt.feedback.targetedHint}</p></div>}
                  {attempt.hint && <div className="hint-result"><span><Lightbulb size={15} /> EXTRA HINT</span><p>{attempt.hint}</p></div>}
                  {attempt.modelAnswer && <div className="model-answer"><span><BookOpen size={15} /> MODEL ANSWER</span><p>{attempt.modelAnswer}</p><div className="model-reasoning"><b>Why it works</b><p>{attempt.modelReasoning}</p></div></div>}
                </div>)}
                {latestAttempt && <div className="assessment-actions"><div><b>Keep working the idea</b><span>Try a new explanation, ask for a hint, or reveal the model answer.</span></div><div className="assessment-buttons"><button className="button button-secondary" onClick={() => { setAnswerDraft(''); answerRef.current?.focus(); }} disabled={busy !== null}><RefreshCw size={15} /> Try again</button><button className="button button-secondary" onClick={requestHint} disabled={busy !== null || Boolean(latestAttempt.hint)}>{busy === 'hint' ? <LoaderCircle className="spin" size={15} /> : <Lightbulb size={15} />}{latestAttempt.hint ? 'Hint shown' : 'Give me a hint'}</button><button className="button button-outline" onClick={requestModelAnswer} disabled={busy !== null || Boolean(latestAttempt.modelAnswer)}>{busy === 'reveal' ? <LoaderCircle className="spin" size={15} /> : <BookOpen size={15} />}{latestAttempt.modelAnswer ? 'Answer revealed' : 'Show model answer'}</button></div></div>}
              </div>}
              {activeLesson.attempts.length === 0 && <p className="assessment-gate"><ShieldCheck size={16} /> Hint and model answer unlock after your first attempt.</p>}
              </article>
            </div>
            <div className="lesson-end-actions"><button className="button button-secondary" onClick={() => navTo('home')}><ArrowLeft size={16} /> Back to dashboard</button><button className="button button-primary" onClick={saveActiveLesson}><Save size={16} /> {isCurrentSaved ? 'Update saved lesson' : 'Save this lesson'}</button></div>
          </section>
        )}

        {view === 'saved' && (
          <section className="saved-page"><div className="page-heading"><div><div className="eyebrow">YOUR LEARNING LIBRARY</div><h1>My lessons</h1><p>Saved in this browser, ready to revisit whenever you need them.</p></div><button className="button button-primary" onClick={startNewLesson}><Sparkles size={16} /> New lesson</button></div>
            {savedLessons.length > 0 ? <LessonList lessons={[...savedLessons].sort((a, b) => b.savedAt.localeCompare(a.savedAt))} onOpen={openSavedLesson} onDelete={deleteLesson} /> : <div className="large-empty-state"><div className="empty-illustration"><BookMarked size={28} /></div><h2>No saved lessons yet</h2><p>Generate an explanation and save it. Your lesson and assessment attempts stay in this browser only.</p><button className="button button-primary" onClick={startNewLesson}>Explain your first concept <ArrowRight size={17} /></button></div>}
            <div className="storage-note"><ShieldCheck size={16} /><p><b>Local by design.</b> Lessons are kept in this browser's storage and do not sync across devices. Uploaded images are not saved to lesson history.</p></div>
          </section>
        )}

        {view === 'settings' && (
          <section className="settings-page"><div className="page-heading"><div><div className="eyebrow">YOUR PREFERENCES</div><h1>Settings</h1><p>Small controls for your Flow AI experience.</p></div></div>
            <div className="settings-card"><div className="settings-icon"><ShieldCheck size={20} /></div><div className="settings-copy"><h2>Local lesson storage</h2><p>Flow AI saves lessons and answer attempts in your current browser. They are not automatically synced to another phone or computer. Uploaded images aren't stored in lesson history; pasted source text may be saved with the lesson.</p><div className="storage-stats"><span><BookMarked size={16} /> {savedLessons.length} saved {savedLessons.length === 1 ? 'lesson' : 'lessons'}</span><span><ShieldCheck size={16} /> No account required</span></div></div></div>
            <div className="settings-card danger-settings"><div className="settings-icon danger"><Trash2 size={20} /></div><div className="settings-copy"><h2>Delete saved lessons</h2><p>Remove every saved lesson from this browser. This action cannot be undone. It does not delete information held by the AI provider under its applicable service policies.</p><button className="button button-danger" onClick={deleteAllLessons} disabled={savedLessons.length === 0}><Trash2 size={16} /> Delete all saved lessons</button></div></div>
            <div className="settings-card"><div className="settings-icon"><Settings size={20} /></div><div className="settings-copy"><h2>AI connection</h2><p>Generating, evaluating, hinting, and revealing answers require the deployed backend and a Workers AI binding. Saved lessons remain readable if the AI service is unavailable.</p><span className="settings-inline-note"><span className="status-dot" /> AI runs through Cloudflare on the server, not on your device.</span></div></div>
          </section>
        )}
      </main>
      <footer className="global-footer"><span>FLOW AI <i>·</i> Understand the science. Follow the logic.</span><span>CBSE Classes 9–10</span></footer>
    </div>
  );
}

function LessonList({ lessons, onOpen, onDelete, compact = false }: {
  lessons: SavedLesson[];
  onOpen: (lesson: SavedLesson) => void;
  onDelete: (lesson: SavedLesson) => void;
  compact?: boolean;
}) {
  return (
    <div className={compact ? 'lesson-list compact' : 'lesson-list'}>
      {lessons.map((lesson) => <article className="saved-lesson-card" key={lesson.id}>
        <button className="saved-lesson-main" onClick={() => onOpen(lesson)} aria-label={`Open lesson ${lesson.explanation.title}`}>
          <span className="saved-lesson-icon"><BookOpen size={19} /></span><span className="saved-lesson-copy"><span className="saved-lesson-meta">CLASS {lesson.classLevel} <span /> {formatDate(lesson.savedAt)}</span><strong>{lesson.explanation.title}</strong><span className="saved-lesson-confusion">{lesson.confusion}</span><span className="saved-lesson-bottom"><span>{lesson.attempts.length} {lesson.attempts.length === 1 ? 'attempt' : 'attempts'}</span>{lesson.topic && <span>{lesson.topic}</span>}</span></span><ChevronRight className="saved-chevron" size={18} />
        </button>
        <button className="delete-lesson-button" onClick={() => onDelete(lesson)} aria-label={`Delete ${lesson.explanation.title}`} title="Delete lesson"><Trash2 size={16} /></button>
      </article>)}
    </div>
  );
}
