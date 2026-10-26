import { createState, getTopColor, getTopRun, getMove, applyMove, addRod, undo, isSolved, getLegalMoves, getVisibleRod } from './engine.js?v=4';
import { LEVELS, CAMPAIGNS } from './levels.js?v=6';
import { selectStartupLevel, nextCampaignLevel } from './navigation.js?v=6';
import { MODES } from './modes.js';
import { loadProgress, createProgressSaver } from './storage.js?v=6';
import { createAdvisor } from './advisor.js?v=4';
import { createRun, advanceRun, noteRodAdded, resumeRun, finishRun, updateRecords, formatDuration } from './results.js?v=5';
import { COLORS, nutMarkup, rodMarkup, rodGeometry, floatingNutsMarkup, guideMarkup } from './art.js';

const $ = id => document.getElementById(id);
const board = $('game-board');
const feedback = $('feedback');
const levelDialog = $('level-dialog');
const helpDialog = $('help-dialog');
const motion = matchMedia('(prefers-reduced-motion: reduce)');
const completed = new Set();
const sessionBoards = new Map();
const activeAnimations = new Set();
const runs = new Map();
const saveGameProgress = createProgressSaver();
let records = {}, clockStarted = null, clockLevelId = null, clockTicks = 0;
let currentLevel, state, selected = null, feedbackTimer;
let expanded = false, saveAvailable = true, initialized = false;
const advisors = new Map();
let advice = { state: null, levelId: null, status: 'idle' };
let adviceController = null, adviceEpoch = 0, adviceBusy = null, hintMove = null, adviceNotice = null;
const arrow = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14m-5-5 5 5-5 5"/></svg>';
const currentMode = () => currentLevel.mode || 'classic';
const campaign = () => CAMPAIGNS[currentMode()];
const colorName = color => COLORS[color % COLORS.length].name;
const rodComplete = rod => rod.length === state.capacity && rod.every(color => color === rod[0]);
const initialMessage = () => '先点一根螺柱，再点同色或空柱。';
const guideKey = () => `nut-sort-guide-seen-v2-${currentMode()}`;
const badgeInk = color => {
  const rgb = color.match(/[a-f\d]{2}/gi).map(pair => parseInt(pair, 16) / 255)
    .map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
  const luminance = rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
  return luminance > .179 ? '#000' : '#fff';
};

function currentRun() {
  if (!runs.has(currentLevel.id)) runs.set(currentLevel.id, createRun(currentLevel, state));
  return runs.get(currentLevel.id);
}

function flushClock() {
  if (clockStarted === null) return;
  const stamp = performance.now();
  const run = runs.get(clockLevelId);
  if (run) runs.set(clockLevelId, advanceRun(run, Math.max(0, stamp - clockStarted)));
  clockStarted = stamp;
}

function pauseClock() {
  flushClock(); clockStarted = null; clockLevelId = null;
}

function syncClock() {
  const run = currentRun();
  const shouldRun = !document.hidden && !helpDialog.open && !levelDialog.open && !isSolved(state) && !run.finished;
  if (!shouldRun || (clockLevelId !== null && clockLevelId !== currentLevel.id)) pauseClock();
  if (shouldRun && clockStarted === null) { clockLevelId = currentLevel.id; clockStarted = performance.now(); }
}

function updateElapsed() {
  const run = currentRun();
  const delta = clockLevelId === currentLevel.id && clockStarted !== null ? Math.max(0, performance.now() - clockStarted) : 0;
  $('elapsed').textContent = formatDuration(run.elapsedMs + delta);
  $('elapsed').title = run.eligible ? '本次有效游玩时间，后台和玩法说明暂停计时' : '旧局面从本次更新起计时，不计入完整用时纪录';
}

function updateRunForBoard() {
  flushClock();
  let run = currentRun();
  const solved = isSolved(state);
  if (!solved && run.finished) { run = resumeRun(run); runs.set(currentLevel.id, run); }
  if (solved && !run.finished) {
    pauseClock();
    const finished = finishRun(currentRun(), currentLevel, state);
    runs.set(currentLevel.id, finished.run);
    if (finished.result) records = updateRecords(records, finished.result).records;
  }
  syncClock(); updateElapsed();
}

function renderSettlement() {
  const result = currentRun().result;
  if (!result) return;
  $('success-message').textContent = `${MODES[currentMode()].name} · 第 ${currentLevel.number} 关`;
  $('result-time-label').textContent = result.eligible ? '本次用时' : '更新后计时';
  $('result-time').textContent = formatDuration(result.elapsedMs);
  $('result-moves').textContent = `${result.moves} 步`;
  $('result-rods').textContent = result.rodAdds ? `加过 ${result.rodAdds} 根 · 当前额外 ${result.extraRods} 根` : '未加柱';
  const book = records[currentLevel.id] || {};
  for (const category of ['standard', 'assisted']) {
    const best = book[category];
    $(`best-${category}`).textContent = best?.bestTime && best?.bestMoves ? `最快 ${formatDuration(best.bestTime.elapsedMs)} · 最少 ${best.bestMoves.moves} 步` : '暂无完整成绩';
  }
  const best = book[result.category];
  const fastest = best?.bestTime?.id === result.id;
  const fewest = best?.bestMoves?.id === result.id;
  $('result-note').textContent = !result.eligible ? '本局在计时更新前已开始，之前用时无法补算，本次不计入完整成绩纪录。重新整理后可记录完整成绩。' :
    fastest && fewest ? '这次是本关同类成绩中的最快用时与最少步数。' : fastest ? '这次是本关同类成绩中的最快用时。' : fewest ? '这次是本关同类成绩中的最少步数。' : '完整成绩已保存。未加柱与加柱辅助分别比较。';
}

function revealSettlement() {
  const wonState = state, levelId = currentLevel.id;
  setTimeout(() => {
    if (state !== wonState || currentLevel.id !== levelId || !isSolved(state)) return;
    clearAnimations();
    $('success').scrollIntoView({ block: 'nearest', behavior: motion.matches ? 'instant' : 'smooth' });
  }, motion.matches ? 0 : 560);
}

function advisorFor(level) {
  const advisor = advisors.get(level.id) || createAdvisor(level);
  advisors.delete(level.id); advisors.set(level.id, advisor);
  if (advisors.size > 6) advisors.delete(advisors.keys().next().value);
  return advisor;
}

function beginAdviceJob(kind) {
  adviceController?.abort();
  adviceController = new AbortController();
  adviceBusy = kind;
  return { epoch: ++adviceEpoch, state, level: currentLevel, signal: adviceController.signal };
}

function adviceJobCurrent(job) {
  return !job.signal.aborted && job.epoch === adviceEpoch && job.state === state && job.level.id === currentLevel.id;
}

function updateAdvice() {
  const panel = $('advice-panel');
  const text = $('advice-text');
  const notice = adviceNotice?.state === state ? adviceNotice : null;
  let message = '', tone = '';
  if (adviceBusy === 'recover') message = '正在查找已确认有解的位置，你仍可以继续操作。';
  else if (adviceBusy === 'hint') message = '正在找一条能通关的路线…';
  else if (advice.status === 'dead') {
    message = getLegalMoves(state).length ? '这盘已卡住：虽然还有可搬的位置，但已经无法通关。' : '这盘已卡住，没有可以继续搬的位置。';
    tone = 'dead';
  } else if (notice) {
    message = notice.text; tone = notice.kind;
    if (notice.kind === 'added' && advice.status === 'unknown') message += ' 是否能通关暂未判定。';
  } else if (advice.status === 'unknown') message = '暂未判定是否有解。可以加一根空柱继续，或用“提示”和可解回退。';
  panel.hidden = !message;
  panel.className = `advice-panel${tone ? ` is-${tone}` : ''}`;
  text.textContent = message;
  $('add-rod').hidden = false;
  $('add-rod').disabled = isSolved(state);
  const canRecover = state.history.length > 0 && (advice.status === 'dead' || advice.status === 'unknown' || adviceBusy === 'recover');
  $('recover').hidden = !canRecover;
  $('recover').disabled = adviceBusy === 'recover' || adviceBusy === 'hint';
  $('recover').textContent = adviceBusy === 'recover' ? '查找可解处…' : '撤回到可解处';
  $('hint').disabled = adviceBusy === 'recover' || adviceBusy === 'hint' || isSolved(state);
  $('hint-label').textContent = adviceBusy === 'hint' ? '找提示…' : '提示';
}

function syncAdviceForState() {
  if (advice.state === state && advice.levelId === currentLevel.id) return;
  hintMove = null; adviceNotice = null;
  advice = { state, levelId: currentLevel.id, status: 'checking' };
  const job = beginAdviceJob('auto');
  void (async () => {
    try {
      const result = await advisorFor(job.level).analyze(job.state, { maxNodes: 4000, timeMs: 90, signal: job.signal });
      if (!adviceJobCurrent(job)) return;
      advice = { ...result, state: job.state, levelId: job.level.id }; adviceBusy = null; updateAdvice();
    } catch (error) {
      if (!adviceJobCurrent(job) || error.name === 'AbortError') return;
      advice = { state: job.state, levelId: job.level.id, status: 'unknown' }; adviceBusy = null; updateAdvice();
      console.error('局面检查暂不可用', error);
    }
  })();
}

async function requestHint() {
  clearAnimations(); hintMove = null; adviceNotice = null;
  const job = beginAdviceJob('hint'); render();
  try {
    const result = await advisorFor(job.level).analyze(job.state, { maxNodes: 50000, timeMs: 1200, signal: job.signal });
    if (!adviceJobCurrent(job)) return;
    advice = { ...result, state: job.state, levelId: job.level.id }; adviceBusy = null;
    const first = result.status === 'solvable' ? result.moves?.[0] : null;
    if (first && getMove(state, first.from, first.to).ok) {
      hintMove = { from: first.from, to: first.to }; selected = null;
      adviceNotice = { state, kind: 'hint', text: `第${first.from + 1}柱 → 第${first.to + 1}柱：搬顶部的${colorName(getTopColor(state.rods[first.from]))}。这条路线已验证可通关。` };
    } else if (result.status === 'solved') {
      adviceNotice = { state, kind: 'recovered', text: '这一关已经完成了，可以选择下一关。' };
    }
    render();
  } catch (error) {
    if (!adviceJobCurrent(job) || error.name === 'AbortError') return;
    adviceBusy = null; advice.status = 'unknown';
    adviceNotice = { state, kind: '', text: '暂时没有找到可靠的提示。你的局面没有改变。' }; updateAdvice();
    console.error('提示暂不可用', error);
  }
}

async function recoverSolvable() {
  clearAnimations(); hintMove = null; adviceNotice = null; selected = null;
  const job = beginAdviceJob('recover'); render();
  try {
    const result = await advisorFor(job.level).recover(job.state, { maxNodes: 50000, timeMs: 1800, signal: job.signal });
    if (!adviceJobCurrent(job)) return;
    adviceBusy = null;
    if (result.status === 'found' && result.steps > 0) {
      state = result.state; selected = null; render(); persist(); updateSaveNote();
      say('已回到可继续整理的位置。', 'good', true);
      adviceNotice = { state, kind: 'recovered', text: `已撤回 ${result.steps} 次操作，这里已确认有解。可以继续整理，或点“提示”。` };
    } else adviceNotice = { state, kind: '', text: '暂时没有找到可确认的回退位置，局面保持不变。可以手动撤回或重新整理。' };
    updateAdvice();
  } catch (error) {
    if (!adviceJobCurrent(job) || error.name === 'AbortError') return;
    adviceBusy = null;
    adviceNotice = { state, kind: '', text: '这次未能确认回退位置，局面保持不变。' }; updateAdvice();
    console.error('回退检查暂不可用', error);
  }
}

function addEmptyRod() {
  if (isSolved(state)) return;
  clearAnimations();
  const result = addRod(state);
  if (!result.ok) return;
  flushClock(); runs.set(currentLevel.id, noteRodAdded(currentRun()));
  state = result.state; selected = null;
  render(); persist(); updateSaveNote();
  say('加了一根空柱，搬运步数不变。撤回一步也能撤掉它。', 'good', true);
  adviceNotice = { state, kind: 'added', rodIndex: result.rodIndex,
    text: `第${result.rodIndex + 1}根空柱已加好，可以放任意颜色。需要时还能继续加。` };
  render();
  const added = board.querySelector(`[data-rod-index="${result.rodIndex}"]`);
  added?.focus({ preventScroll: true });
  added?.scrollIntoView({ block: 'nearest', behavior: motion.matches ? 'instant' : 'smooth' });
}

function say(message, tone = '', keep = false) {
  if (state && !isSolved(state) && getLegalMoves(state).length === 0) {
    message = '暂时没地方放了，撤回一步再试。'; tone = ''; keep = true;
  }
  clearTimeout(feedbackTimer);
  feedback.textContent = message;
  feedback.className = tone ? `is-${tone}` : '';
  if (!keep) feedbackTimer = setTimeout(() => {
    feedback.textContent = selected === null ? initialMessage() : '点同色或空柱放下，再点已选柱取消。';
    feedback.className = '';
  }, 3600);
}

function rememberBoard() {
  sessionBoards.delete(currentLevel.id);
  sessionBoards.set(currentLevel.id, state);
}

function persist() {
  flushClock();
  rememberBoard();
  try {
    saveAvailable = saveGameProgress({ levelId: currentLevel.id, state, completed: [...completed],
      boards: [...sessionBoards].map(([levelId, savedState]) => ({ levelId, state: savedState })),
      runs: [...runs].map(([levelId, run]) => ({ levelId, run })), records }) !== false;
  } catch { saveAvailable = false; }
}

function updateSaveNote() {
  document.querySelector('.gentle-note').textContent = saveAvailable ? '不限次数 · 随时撤回 · 自动保存' : '当前无法存档，请保持页面打开；仍可继续玩。';
}

function clearAnimations() {
  [...activeAnimations].forEach(animation => animation.cancel());
  activeAnimations.clear();
  $('animation-layer').replaceChildren();
}

function columnsFor(count) {
  if (expanded) return count <= 6 ? 3 : 4;
  return count <= 3 ? 3 : count <= 8 ? 4 : count <= 15 ? 5 : 6;
}

function updateLayout() {
  const columns = columnsFor(state.rods.length);
  board.style.setProperty('--columns', columns);
  board.style.setProperty('--board-max', `${columns * (expanded ? 103 : 84)}px`);
  board.classList.toggle('is-expanded', expanded);
  $('zoom').setAttribute('aria-pressed', String(expanded));
  $('zoom-label').textContent = expanded ? '紧凑' : '放大';
}

function renderCollection() {
  const collecting = currentMode() === 'collect';
  $('collection-panel').hidden = !collecting;
  if (!collecting) return;
  const cursor = state.collected;
  const order = state.targetOrder;
  $('collection-progress').textContent = `${cursor} / ${order.length}`;
  $('collection-current').textContent = cursor < order.length ? `现在收集：${colorName(order[cursor])}` : '全部收好了';
  $('collection-order').innerHTML = order.map((color, i) => `<span role="listitem" class="collection-color${i < cursor ? ' is-collected' : i === cursor ? ' is-current' : ''}" style="--nut-color:${COLORS[color].fill};--badge-ink:${badgeInk(COLORS[color].fill)}" aria-label="第${i + 1}个目标，${colorName(color)}，${i < cursor ? '已收集' : i === cursor ? '当前目标' : '等待收集'}"><span>${String(color + 1).padStart(2, '0')}</span></span>`).join('');
  const current = $('collection-order').querySelector('.is-current');
  if (current) $('collection-order').scrollLeft = Math.max(0, current.offsetLeft - $('collection-order').offsetLeft - 10);
}

function render({ completedNow = [], preserveFocus = true } = {}) {
  updateRunForBoard();
  syncAdviceForState();
  const focused = preserveFocus && document.activeElement?.matches('[data-rod-index]') ? document.activeElement.dataset.rodIndex : null;
  const solved = isSolved(state);
  if (solved) completed.add(currentLevel.id);
  const mode = currentMode();
  const number = currentLevel.number;
  $('level-label').textContent = `第 ${number} / ${campaign().length} 关`;
  $('level-name').textContent = currentLevel.name;
  const colors = currentLevel.difficulty?.colors ?? new Set(currentLevel.rods.flat()).size;
  $('level-difficulty').textContent = `${colors} 色 · ${state.rods.length} 柱 · ${state.capacity} 层`;
  $('mode-hint').textContent = MODES[mode].hint;
  document.querySelectorAll('[data-mode]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.mode === mode)));
  $('moves').textContent = state.moves;
  $('undo').disabled = state.history.length === 0;
  updateLayout();
  renderCollection();
  // Targets are checked when tapped. Avoid handing out the whole solution space visually.
  board.innerHTML = state.rods.map((rod, index) => {
    const isSelected = index === selected;
    const complete = rodComplete(rod);
    const top = getTopColor(rod);
    const detail = top === null ? '空柱' : `顶部${colorName(top)}`;
    const visible = getVisibleRod(state, index);
    const maskedIndices = visible.flatMap((color, i) => color === null ? [i] : []);
    const hintSource = hintMove?.from === index, hintTarget = hintMove?.to === index;
    const extraRod = index >= currentLevel.rods.length;
    const newRod = adviceNotice?.state === state && adviceNotice.kind === 'added' && adviceNotice.rodIndex === index;
    const label = `第${index + 1}根螺柱${extraRod ? '，新增辅助柱' : ''}，${rod.length}/${state.capacity}个螺母，${detail}${maskedIndices.length ? `，${maskedIndices.length}个未揭色` : ''}${complete ? '，同色满柱' : ''}${isSelected ? '，已选中' : ''}${hintSource ? '，提示起点' : hintTarget ? '，提示落点' : ''}`;
    return `<button class="rod-button${isSelected ? ' is-selected' : ''}${completedNow.includes(index) ? ' just-complete' : ''}${hintSource ? ' is-hint-source' : hintTarget ? ' is-hint-target' : ''}${extraRod ? ' extra-rod' : ''}${newRod ? ' is-new-rod' : ''}" type="button" data-rod-index="${index}" aria-label="${label}" aria-pressed="${isSelected}"${solved ? ' disabled' : ''}>${rodMarkup(rod, state.capacity, { index, selected: isSelected, complete, liftCount: isSelected ? getTopRun(rod) : 0, maskedIndices })}<span class="rod-label" aria-hidden="true">${index + 1}</span></button>`;
  }).join('');
  $('success').hidden = !solved;
  if (solved) renderSettlement();
  $('next-level').innerHTML = number === campaign().length ? '再挑一关' : `下一关${arrow}`;
  if (focused !== null) board.querySelector(`[data-rod-index="${focused}"]`)?.focus({ preventScroll: true });
  updateSaveNote();
  updateAdvice();
}

function rodRect(index) {
  return board.querySelector(`[data-rod-index="${index}"] .rod-art`)?.getBoundingClientRect() || null;
}

function animateMove(move, sourceCount, destinationCount, sourceRect, targetRect, beforeRods) {
  if (motion.matches || !sourceRect || !targetRect || typeof Element.prototype.animate !== 'function') return;
  const g = rodGeometry(state.capacity);
  const scale = sourceRect.width / g.width;
  const groupHeight = (move.count * g.step + g.floatingPadding) * scale;
  const bottom = (rect, index) => rect.top + (g.baseY - g.nutOffset - index * g.step + g.nutBottom) / g.height * rect.height;
  const sourceBottom = bottom(sourceRect, sourceCount - move.count);
  const targetBottom = bottom(targetRect, destinationCount);
  const startY = sourceBottom - groupHeight - g.lift * scale;
  const dx = targetRect.left - sourceRect.left;
  const dy = targetBottom - sourceBottom + g.lift * scale;
  const lift = -Math.max(24, 36 * scale);
  const piece = document.createElement('div');
  piece.className = 'flying-nuts';
  piece.style.cssText = `left:${sourceRect.left}px;top:${startY}px;width:${sourceRect.width}px;height:${groupHeight}px`;
  piece.innerHTML = floatingNutsMarkup(move.color, move.count);
  $('animation-layer').append(piece);
  const targetNuts = [...board.querySelectorAll(`[data-rod-index="${move.to}"] .nut`)].slice(-move.count);
  const destinationCleared = currentMode() === 'collect' && state.rods[move.to].length === 0;
  const collectionGhosts = [];
  if (move.collectedColors?.length) {
    const arrived = beforeRods.map(rod => [...rod]);
    arrived[move.to].push(...arrived[move.from].splice(-move.count));
    const stackSvg = rod => `<svg viewBox="0 0 ${g.width} ${g.height}" aria-hidden="true">${rod.map((color, i) => nutMarkup(color, 50, g.baseY - g.nutOffset - i * g.step)).join('')}</svg>`;
    arrived.forEach((rod, index) => {
      if (!rod.length || !move.collectedColors.includes(rod[0]) || !rod.every(color => color === rod[0]) || rod.length !== state.capacity) return;
      const rect = rodRect(index); if (!rect) return;
      const ghost = document.createElement('div');
      ghost.className = 'collecting-stack';
      ghost.style.cssText = `left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px`;
      ghost.innerHTML = stackSvg(index === move.to ? beforeRods[index] : rod);
      $('animation-layer').append(ghost);
      collectionGhosts.push({ ghost, full: stackSvg(rod) });
    });
  }
  if (!destinationCleared) targetNuts.forEach(nut => { nut.style.opacity = '0'; });
  const animation = piece.animate([
    { transform: 'translate(0,0)', offset: 0 },
    { transform: `translate(0,${lift}px)`, offset: .26 },
    { transform: `translate(${dx}px,${Math.min(lift, dy - 24)}px)`, offset: .66 },
    { transform: `translate(${dx}px,${dy}px)`, offset: 1 }
  ], { duration: 320, easing: 'cubic-bezier(.2,.8,.3,1)', fill: 'forwards' });
  activeAnimations.add(animation);
  const clean = () => {
    targetNuts.forEach(nut => { nut.style.opacity = ''; });
    piece.remove(); activeAnimations.delete(animation);
  };
  animation.onfinish = () => {
    clean();
    collectionGhosts.forEach(({ ghost, full }) => {
      ghost.innerHTML = full;
      const collectAnimation = ghost.animate([{ transform: 'translateY(0)', opacity: 1 }, { transform: 'translateY(-20px)', opacity: 0 }], { duration: 220, easing: 'ease-out', fill: 'forwards' });
      activeAnimations.add(collectAnimation);
      const remove = () => { ghost.remove(); activeAnimations.delete(collectAnimation); };
      collectAnimation.onfinish = remove; collectAnimation.oncancel = remove;
    });
  };
  animation.oncancel = () => { clean(); collectionGhosts.forEach(({ ghost }) => ghost.remove()); };
}

function bump(index) {
  const button = board.querySelector(`[data-rod-index="${index}"]`);
  if (!button || motion.matches) return;
  button.classList.remove('is-bump'); void button.offsetWidth; button.classList.add('is-bump');
}

function chooseRod(index) {
  if (isSolved(state)) return;
  clearAnimations();
  if (selected === null) {
    if (!state.rods[index].length) { say('这是空柱，可以把别处的螺母搬过来。'); bump(index); return; }
    selected = index; render();
    say(`已拿起${colorName(getTopColor(state.rods[index]))}，再点同色或空柱。`, '', true);
    return;
  }
  if (selected === index) { selected = null; render(); say('已放回。'); return; }
  const from = selected;
  const move = getMove(state, from, index);
  if (!move.ok) {
    say(move.reason === 'full' ? '这根满了，换个有空位的落点。' : '顶部颜色不同，只能放在同色或空柱上。', 'error');
    bump(index); return;
  }
  const sourceCount = state.rods[from].length, destinationCount = state.rods[index].length;
  const sourceRect = rodRect(from), targetRect = rodRect(index);
  const oldComplete = state.rods.map(rodComplete);
  const beforeRods = state.rods.map(rod => [...rod]);
  const result = applyMove(state, from, index);
  if (!result.ok) return;
  state = result.state; selected = null;
  const completedNow = state.rods.flatMap((rod, i) => rodComplete(rod) && !oldComplete[i] ? [i] : []);
  render({ completedNow }); persist(); updateSaveNote();
  animateMove(result.move, sourceCount, destinationCount, sourceRect, targetRect, beforeRods);
  if (isSolved(state)) { say('这一关整理好了！结算已记录，仍可以撤回。', 'good', true); revealSettlement(); }
  else if (result.move.collectedColors?.length) say(`收好了${result.move.collectedColors.map(colorName).join('、')}，空柱腾出来了。`, 'good');
  else if (completedNow.length) say(currentMode() === 'collect' ? '同色满柱先留好，轮到它时会自动收走。' : '一种颜色整理好了。', 'good');
  else say(`搬好了 ${move.count} 个${colorName(move.color)}螺母。`, 'good');
}

function openDialog(dialog) { clearAnimations(); pauseClock(); if (!dialog.open) dialog.showModal(); persist(); updateElapsed(); }
function updateHelp() {
  $('help-title').textContent = MODES[currentMode()].name;
  $('help-mode-rule').textContent = MODES[currentMode()].guide;
  $('help-mode-detail').textContent = MODES[currentMode()].detail;
}
function showHelp() { updateHelp(); openDialog(helpDialog); }
function helpSeen() { try { return localStorage.getItem(guideKey()) === '1'; } catch { return false; } }
function closeHelp() { helpDialog.close(); try { localStorage.setItem(guideKey(), '1'); } catch {} }

function showLevels() {
  $('level-dialog-title').textContent = `${MODES[currentMode()].name} · ${campaign().length} 关`;
  $('level-intro').textContent = '全部可以直接选。31关起继续增加色层交错，后期需要更细地安排空柱周转。';
  $('level-list').innerHTML = campaign().map(level => `<button class="level-choice${level.id === currentLevel.id ? ' is-current' : ''}${completed.has(level.id) ? ' is-completed' : ''}" type="button" data-level-id="${level.id}" aria-label="第${level.number}关，${level.name}${completed.has(level.id) ? '，已通过' : ''}"><span>${level.number}</span>${completed.has(level.id) ? '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3 8 3 3 7-7"/></svg>' : ''}</button>`).join('');
  openDialog(levelDialog);
  $('level-list').querySelector('.is-current')?.scrollIntoView({ block: 'nearest', behavior: 'instant' });
}

function syncLevelUrl() {
  const url = new URL(location.href);
  url.searchParams.set('mode', currentMode());
  url.searchParams.set('level', currentLevel.number);
  history.replaceState(null, '', url);
}

function changeLevel(id, { modeChange = false } = {}) {
  const next = LEVELS.find(level => level.id === id);
  if (!next) return;
  clearAnimations(); pauseClock(); rememberBoard();
  currentLevel = next; state = sessionBoards.get(next.id) || createState(next); selected = null;
  syncLevelUrl();
  render({ preserveFocus: false }); persist(); updateSaveNote();
  say(isSolved(state) ? '这一关已完成，可以撤回或重新整理。' : initialMessage(), '', true);
  levelDialog.close();
  syncClock();
  window.scrollTo({ top: 0, behavior: 'instant' });
  $('level-open').focus({ preventScroll: true });
  if (modeChange && !helpSeen()) showHelp();
  if (isSolved(state)) revealSettlement();
}

function changeMode(mode) {
  if (!CAMPAIGNS[mode] || mode === currentMode()) return;
  const savedId = [...sessionBoards.keys()].reverse().find(id => LEVELS.find(level => level.id === id)?.mode === mode);
  changeLevel(savedId || CAMPAIGNS[mode][0].id, { modeChange: true });
}

function undoMove() {
  clearAnimations();
  const result = undo(state); if (!result.ok) return;
  state = result.state; selected = null; render(); persist(); updateSaveNote(); say('回到上一步，换个顺序也没关系。');
}
function restart() {
  clearAnimations(); pauseClock(); state = createState(currentLevel); selected = null;
  runs.set(currentLevel.id, createRun(currentLevel, state));
  render(); persist(); updateSaveNote(); say('重新摆好了。');
}

function init() {
  if (initialized) return; initialized = true;
  const progress = loadProgress(LEVELS);
  for (const entry of progress?.boards || []) sessionBoards.set(entry.levelId, entry.state);
  if (progress?.state) sessionBoards.set(progress.levelId, progress.state);
  currentLevel = selectStartupLevel(LEVELS, progress, location.search);
  state = sessionBoards.get(currentLevel.id) || createState(currentLevel);
  syncLevelUrl();
  records = progress?.records || {};
  for (const entry of progress?.runs || []) {
    const level = LEVELS.find(item => item.id === entry.levelId);
    const savedBoard = entry.levelId === currentLevel.id ? state : sessionBoards.get(entry.levelId);
    if (level && savedBoard) runs.set(entry.levelId, createRun(level, savedBoard, entry.run));
  }
  (progress?.completed || []).forEach(id => completed.add(id));
  $('guide-animation').innerHTML = guideMarkup();
  render(); persist(); updateSaveNote(); say(initialMessage(), '', true);
  board.addEventListener('click', event => {
    const button = event.target.closest('[data-rod-index]');
    if (button && board.contains(button)) chooseRod(Number(button.dataset.rodIndex));
  });
  board.addEventListener('keydown', event => {
    const source = event.target.closest('[data-rod-index]'); if (!source) return;
    const index = Number(source.dataset.rodIndex), columns = columnsFor(state.rods.length);
    const shifts = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -columns, ArrowDown: columns };
    if (Object.hasOwn(shifts, event.key)) {
      event.preventDefault(); board.querySelector(`[data-rod-index="${Math.max(0, Math.min(state.rods.length - 1, index + shifts[event.key]))}"]`)?.focus();
    } else if (event.key === 'Escape') { selected = null; render(); say('已取消选择。'); }
  });
  $('undo').addEventListener('click', undoMove);
  $('hint').addEventListener('click', requestHint);
  $('recover').addEventListener('click', recoverSolvable);
  $('add-rod').addEventListener('click', addEmptyRod);
  $('restart').addEventListener('click', restart);
  $('level-open').addEventListener('click', showLevels);
  $('help-open').addEventListener('click', showHelp);
  $('help-start').addEventListener('click', closeHelp);
  $('zoom').addEventListener('click', () => { clearAnimations(); expanded = !expanded; updateLayout(); });
  document.querySelectorAll('[data-mode]').forEach(button => button.addEventListener('click', () => changeMode(button.dataset.mode)));
  $('next-level').addEventListener('click', () => {
    const next = nextCampaignLevel(campaign(), currentLevel.id);
    if (next) changeLevel(next.id); else showLevels();
  });
  $('level-list').addEventListener('click', event => {
    const button = event.target.closest('[data-level-id]'); if (button) changeLevel(Number(button.dataset.levelId));
  });
  document.querySelectorAll('[data-close-dialog]').forEach(button => button.addEventListener('click', () => {
    const dialog = button.closest('dialog'); if (dialog === helpDialog) closeHelp(); else dialog.close();
  }));
  helpDialog.addEventListener('cancel', () => { try { localStorage.setItem(guideKey(), '1'); } catch {} });
  [levelDialog, helpDialog].forEach(dialog => dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) {
      if (dialog === helpDialog) closeHelp(); else dialog.close();
    }
  }));
  [levelDialog, helpDialog].forEach(dialog => dialog.addEventListener('close', () => { syncClock(); updateElapsed(); persist(); }));
  document.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && !helpDialog.open && !levelDialog.open && !event.target.matches('input,textarea,[contenteditable]')) {
      event.preventDefault(); undoMove();
    }
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) pauseClock(); else syncClock(); updateElapsed(); persist(); });
  window.addEventListener('pagehide', () => { adviceController?.abort(); pauseClock(); persist(); });
  window.addEventListener('pageshow', event => {
    if (event.persisted || adviceController?.signal.aborted) {
      adviceBusy = null;
      advice = { state: null, levelId: null, status: 'idle' };
      render();
    }
    syncClock(); updateElapsed();
  });
  window.addEventListener('resize', clearAnimations, { passive: true });
  motion.addEventListener?.('change', clearAnimations);
  if (!helpSeen()) showHelp();
  else if (isSolved(state)) revealSettlement();
  setInterval(() => {
    flushClock(); syncClock(); updateElapsed();
    if (++clockTicks % 5 === 0) { persist(); updateSaveNote(); }
  }, 1000);
}

try { init(); }
catch (error) {
  const message = document.createElement('p'); message.className = 'load-error'; message.setAttribute('role', 'alert');
  message.textContent = '游戏暂时没能打开，请刷新后再试。'; board.replaceChildren(message); console.error(error);
}
