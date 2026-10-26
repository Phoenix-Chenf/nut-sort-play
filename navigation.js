/** Catalog IDs are stable save keys; shared links use the visible per-mode number. */
export function selectStartupLevel(levels, progress, search = '') {
  const fallback = levels.find(level => level.id === progress?.levelId) ||
    levels.find(level => level.mode === 'classic') || levels[0];
  const params = new URLSearchParams(search);
  const requestedMode = params.get('mode');
  if (requestedMode !== null && !levels.some(level => level.mode === requestedMode)) return fallback;
  const mode = requestedMode || fallback?.mode;
  const campaign = levels.filter(level => level.mode === mode);
  const recent = fallback?.mode === mode ? fallback : [...(Array.isArray(progress?.boards) ? progress.boards : [])].reverse()
    .map(entry => campaign.find(level => level.id === entry.levelId)).find(Boolean);
  const remembered = recent || campaign[0] || fallback;
  const rawNumber = params.get('level');
  if (!rawNumber || !/^\d+$/.test(rawNumber)) return remembered;
  return campaign.find(level => level.number === Number(rawNumber)) || remembered;
}

export function nextCampaignLevel(campaign, levelId) {
  const index = campaign.findIndex(level => level.id === levelId);
  return index >= 0 ? campaign[index + 1] || null : null;
}
