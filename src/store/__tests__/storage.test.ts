import { describe, expect, it, vi } from 'vitest';
import { createStorage } from '../storage';
import { mergeSettings, DEFAULT_SETTINGS, DEFAULT_PROMPT_PRESETS } from '../settings';

function fakeChromeStorage() {
  const data: Record<string, unknown> = {};
  const listeners: Array<(changes: Record<string, { newValue?: unknown }>) => void> = [];
  const area = {
    get: vi.fn(async (keys: string[]) => Object.fromEntries(keys.filter(k => k in data).map(k => [k, data[k]]))),
    set: vi.fn(async (items: Record<string, unknown>) => {
      Object.assign(data, items);
      const changes = Object.fromEntries(Object.entries(items).map(([k, v]) => [k, { newValue: v }]));
      listeners.forEach(l => l(changes));
    }),
    onChanged: { addListener: (l: (typeof listeners)[number]) => listeners.push(l) },
  };
  return { data, area };
}

describe('createStorage', () => {
  it('reads the fallback, writes, updates with a function and notifies', async () => {
    const { area, data } = fakeChromeStorage();
    vi.stubGlobal('chrome', { storage: { local: area } });
    const storage = createStorage('k', 1, { liveUpdate: true });
    expect(await storage.get()).toBe(1);
    const listener = vi.fn();
    storage.subscribe(listener);
    await storage.set(5);
    await storage.set(prev => prev + 1);
    expect(data.k).toBe(6);
    expect(storage.getSnapshot()).toBe(6);
    expect(listener).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('merges stored settings over the defaults', () => {
    expect(mergeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(mergeSettings({ turnCap: 7 }).turnCap).toBe(7);
    expect(mergeSettings({ turnCap: 7 }).defaultMode).toBe('auto');
  });

  it('has 5 built-in presets with non-empty prompts in DEFAULT_PROMPT_PRESETS', () => {
    expect(DEFAULT_PROMPT_PRESETS).toHaveLength(5);
    const ids = DEFAULT_PROMPT_PRESETS.map(p => p.id);
    expect(ids).toEqual(['default', 'mcq-specialist', 'coding-specialist', 'detailed-coding-mcq', 'general-web']);
    for (const preset of DEFAULT_PROMPT_PRESETS) {
      expect(preset.prompt.trim().length).toBeGreaterThan(0);
      expect(preset.isBuiltIn).toBe(true);
    }
  });

  it('syncs all 5 built-in presets and preserves custom user presets in mergeSettings', () => {
    const legacyStored = {
      customPrompts: [
        { id: 'default', name: 'Old Default', prompt: '', isBuiltIn: true },
        { id: 'user-custom-1', name: 'My Own Prompt', prompt: 'custom instructions', isBuiltIn: false },
      ],
    };
    const merged = mergeSettings(legacyStored);
    expect(merged.customPrompts).toHaveLength(6);
    const defaultPreset = merged.customPrompts.find(p => p.id === 'default');
    expect(defaultPreset?.name).toBe('Default Hybrid (Fast & Compact)');
    expect(defaultPreset?.prompt).toBe(DEFAULT_PROMPT_PRESETS[0].prompt);
    expect(merged.customPrompts.find(p => p.id === 'coding-specialist')).toBeDefined();
    expect(merged.customPrompts.find(p => p.id === 'mcq-specialist')).toBeDefined();
    expect(merged.customPrompts.find(p => p.id === 'detailed-coding-mcq')).toBeDefined();
    expect(merged.customPrompts.find(p => p.id === 'general-web')).toBeDefined();
    const userPreset = merged.customPrompts.find(p => p.id === 'user-custom-1');
    expect(userPreset).toEqual({
      id: 'user-custom-1',
      name: 'My Own Prompt',
      prompt: 'custom instructions',
      isBuiltIn: false,
    });
  });
});

describe('decideWrite: the mode and the site rule', () => {
  it.each([
    ['ask', undefined, 'ask'],
    ['auto', undefined, 'run'],
    ['ask', 'allow', 'run'],
    ['auto', 'allow', 'run'],
    ['ask', 'ask', 'ask'],
    ['auto', 'ask', 'ask'],
  ] as const)('mode %s, rule %s → %s', async (mode, rule, expected) => {
    const { decideWrite } = await import('../settings');
    expect(decideWrite(mode, rule)).toBe(expected);
  });
});
